# Builds an editor that solves its gradient with MeshShader2's WebGPU renderer: the diffusion gradient editor, the
# points and lines gradient editor or the freeform-gradient() editor. Each is made of the shared parts of
# mesh-gradient-editor.html, the parts in this directory, and its own parts in tools/<editor>/: editor.css,
# editor.html and editor.js, which say where the shared parts go, and words.json, the editor's own words for the
# shared HTML and, if it has models of its own, its MODELS. An editor can also add to the shared HTML from files in
# its more/: settings.html, grid.html, edges.html, views.html and visualize.html.
import json
import os
import re

common = os.path.dirname(os.path.abspath(__file__))


def read(path):
    with open(path) as file:
        return file.read()


# The parts every editor takes from mesh-gradient-editor.html, by name. The freeform-gradient() editor's builder
# takes them from here too.
def mesh_parts(source_path):
    lines = read(source_path).split("\n")

    def index_of(text, start=0):
        for i in range(start, len(lines)):
            if lines[i].startswith(text):
                return i
        raise SystemExit(f"marker not found: {text!r}")

    def between(start_marker, end_marker, include_end=False):
        a = index_of(start_marker)
        b = index_of(end_marker, a + 1)
        return "\n".join(lines[a:b + (1 if include_end else 0)])

    # The mesh editor's backdrop, behind every box rather than its one.
    backdrop = between("// MARK: - Backdrop", "// MARK: - Start")
    backdrop_stage = """    stage.classList.toggle("checkerboard", state.backdrop === "checkerboard");
    stage.classList.toggle("image", !!url);
    const backgroundImage = url ? `url("${url}")` : "";
    if (stage.style.backgroundImage !== backgroundImage)
        stage.style.backgroundImage = backgroundImage;
    stage.style.backgroundColor = state.backdrop === "color" ? state.backdropColor ?? "#ffffff" : "";
"""
    assert backdrop.count(backdrop_stage) == 1
    backdrop = backdrop.replace(backdrop_stage, """    const backgroundImage = url ? `url("${url}")` : "";
    for (const { stage } of views) {
        stage.classList.toggle("checkerboard", state.backdrop === "checkerboard");
        stage.classList.toggle("image", !!url);
        if (stage.style.backgroundImage !== backgroundImage)
            stage.style.backgroundImage = backgroundImage;
        stage.style.backgroundColor = state.backdrop === "color" ? state.backdropColor ?? "#ffffff" : "";
    }
""")

    # The WGSL color conversions: the functions from transform() through toPremultipliedColor().
    shader_color = between("fn transform(m: array<vec3f, 3>, v: vec3f) -> vec3f {", "@fragment fn meshGradientFragment")
    assert "fn toPremultipliedColor(color: vec4f) -> vec4f {" in shader_color

    # Overlay coordinates and reach, without updateMargin(), which lays out the mesh editor's one box.
    overlay_helpers = between("function toOverlay(p) {", "function drawOverlay(width, height, dpr) {")
    overlay_helpers = (overlay_helpers[:overlay_helpers.index("function updateMargin(")]
                       + overlay_helpers[overlay_helpers.index("narrowScreen.addEventListener("):])

    return {
        # The page's head and CSS, up to the end of the shared rules.
        "style": between("<!DOCTYPE html>", "</style>"),
        # A photo of a puppy, for the Puppy backdrop.
        "puppy": lines[index_of("const PUPPY_IMAGE = ")],
        # Color spaces and parsing, up to the mesh's hue fixup.
        "colors": between("// MARK: - Color spaces", "// MARK: - Hue fixup"),
        "shader_helpers": between("const wgslNumber = ", "const wgslMatrix = ", include_end=True),
        "shader_matrices": between('${wgslMatrix("linSRGBToXYZ"', "const D50 = ", include_end=True),
        "shader_color": shader_color,
        "backdrop": backdrop,
        # Margins and the narrow-screen scale.
        "margins": between("// Space around the box for the overlay.", "let viewScale = 1;", include_end=True),
        "overlay_helpers": overlay_helpers,
        "copy": between("async function copy(text, label) {", '$("copyLink").addEventListener("click", () => {'),
    }


# Text as a JavaScript template literal, so it reads in the page as it does in its file: a line to a line.
def template_literal(text):
    return "`" + text.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${") + "`"


def fill(text, replacements):
    for marker, value in replacements.items():
        assert marker in text, marker
        text = text.replace(marker, value)
    return text


def build(parts, output_path, source_path):
    mesh = mesh_parts(source_path)

    words = json.loads(read(os.path.join(parts, "words.json")))

    style = mesh["style"]
    assert style.count("<title>mesh-gradient() Editor</title>") == 1
    style = style.replace("<title>mesh-gradient() Editor</title>", f"<title>{words['TITLE']}</title>")

    # A box for each model, and a button to show or hide it. An editor with models of its own lists them as MODELS:
    # each an id, a name, and the words key of the note under its box.
    models = words.pop("MODELS", [["biharmonic", "Biharmonic", "BIHARMONIC_NOTE"], ["harmonic", "Harmonic", "HARMONIC_NOTE"]])
    view = read(os.path.join(common, "view.html"))
    page = fill(read(os.path.join(common, "page.html")), {
        "{{MODEL_BUTTONS}}": "".join(f'                <button data-model="{model}">{name}</button>\n' for model, name, _ in models),
        "{{VIEWS}}": "".join(fill(view, {"{{MODEL}}": model, "{{NAME}}": name, "{{NOTE}}": "{{" + note + "}}"}) for model, name, note in models),
    })
    html = fill(read(os.path.join(parts, "editor.html")), {
        "{{PAGE}}": page,
        "{{VISUALIZE}}": read(os.path.join(common, "visualize.html")),
        "{{CSS}}": read(os.path.join(common, "css.html")),
    })
    # What the editor adds to the shared HTML, if anything.
    for marker in sorted(set(re.findall(r"\{\{MORE_(\w+)\}\}", html))):
        path = os.path.join(parts, "more", marker.lower() + ".html")
        html = html.replace("{{MORE_" + marker + "}}", read(path) if os.path.exists(path) else "")
    html = fill(html, {"{{" + key + "}}": value for key, value in words.items()})
    leftover = re.findall(r"\{\{\w+\}\}", html)
    assert not leftover, leftover

    # MeshShader2's renderer, as a classic script rather than a module.
    vendor = os.path.join(common, "vendor")
    renderer = read(os.path.join(vendor, "WebGPUFreeformGradient.js"))
    assert renderer.count("export class WebGPUFreeformGradientRenderer") == 1
    renderer = renderer.replace("export class WebGPUFreeformGradientRenderer", "class WebGPUFreeformGradientRenderer")

    script = fill(read(os.path.join(parts, "editor.js")), {
        "__COMMON_HEAD__": read(os.path.join(common, "head.js")).rstrip("\n"),
        "__COMMON_PAGE__": read(os.path.join(common, "page.js")).rstrip("\n") + "\n",
        "__COMMON_CONTROLS__": read(os.path.join(common, "controls.js")).rstrip("\n"),
        "__COMMON_FRAGMENT__": read(os.path.join(common, "fragment.js")).rstrip("\n") + "\n</script>\n</body>\n</html>",
    })
    script = fill(script, {
        "__PUPPY__": mesh["puppy"],
        "__BACKDROP__": mesh["backdrop"].rstrip("\n"),
    })
    # srgbToLinear() is renamed, since the renderer's shader has its own.
    shader_color = re.sub(r"\bsrgbToLinear\(", "colorSRGBToLinear(", mesh["shader_color"].rstrip())
    script = fill(script, {
        "__COLORS__": mesh["colors"],
        "__SHADER_HELPERS__": mesh["shader_helpers"],
        "__SHADER_MATRICES__": mesh["shader_matrices"],
        "__SHADER_COLOR__": shader_color,
        "__RENDERER__": renderer.rstrip(),
        "__SHADER__": template_literal(read(os.path.join(vendor, "WebGPUFreeformGradient.wgsl"))),
    })

    page = (style.rstrip() + "\n" + read(os.path.join(common, "common.css")) + read(os.path.join(parts, "editor.css"))
            + "</style>\n</head>\n" + html + "<script>\n" + script.lstrip("\n"))
    with open(output_path, "w") as file:
        file.write(page)
    print("wrote", output_path, len(page), "bytes")
