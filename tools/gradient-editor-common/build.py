# Builds an editor that solves its gradient with MeshShader2's WebGPU renderer: the diffusion gradient editor or the
# points and lines gradient editor. Each is made of the shared parts of mesh-gradient-editor.html, the parts in this
# directory, and its own parts in tools/<editor>/: editor.css, editor.html and editor.js, which say where the shared
# parts go, and words.json, the editor's own words for the shared HTML.
import json
import os
import re

common = os.path.dirname(os.path.abspath(__file__))


def read(path):
    with open(path) as file:
        return file.read()


def build(parts, output_path, source_path):
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

    def fill(text, replacements):
        for marker, value in replacements.items():
            assert marker in text, marker
            text = text.replace(marker, value)
        return text

    words = json.loads(read(os.path.join(parts, "words.json")))

    # The page's CSS, up to the end of the shared rules.
    style = between("<!DOCTYPE html>", "</style>")
    assert style.count("<title>mesh-gradient() Editor</title>") == 1
    style = style.replace("<title>mesh-gradient() Editor</title>", f"<title>{words['TITLE']}</title>")

    html = fill(read(os.path.join(parts, "editor.html")), {
        "{{PAGE}}": read(os.path.join(common, "page.html")),
        "{{VISUALIZE}}": read(os.path.join(common, "visualize.html")),
        "{{CSS}}": read(os.path.join(common, "css.html")),
    })
    html = fill(html, {"{{" + key + "}}": value for key, value in words.items()})
    leftover = re.findall(r"\{\{\w+\}\}", html)
    assert not leftover, leftover

    # MeshShader2's renderer, as a classic script rather than a module.
    vendor = os.path.join(common, "vendor")
    renderer = read(os.path.join(vendor, "WebGPUFreeformGradient.js"))
    assert renderer.count("export class WebGPUFreeformGradientRenderer") == 1
    renderer = renderer.replace("export class WebGPUFreeformGradientRenderer", "class WebGPUFreeformGradientRenderer")

    # The mesh editor's backdrop, behind every box rather than its one.
    backdrop = between("// MARK: - Backdrop", "// MARK: - Start")
    backdrop_stage = """    stage.classList.toggle("checkerboard", state.backdrop === "checkerboard");
    stage.classList.toggle("image", !!url);
    const backgroundImage = url ? `url("${url}")` : "";
    if (stage.style.backgroundImage !== backgroundImage)
        stage.style.backgroundImage = backgroundImage;
"""
    assert backdrop.count(backdrop_stage) == 1
    backdrop = backdrop.replace(backdrop_stage, """    const backgroundImage = url ? `url("${url}")` : "";
    for (const { stage } of views) {
        stage.classList.toggle("checkerboard", state.backdrop === "checkerboard");
        stage.classList.toggle("image", !!url);
        if (stage.style.backgroundImage !== backgroundImage)
            stage.style.backgroundImage = backgroundImage;
    }
""")
    script = fill(read(os.path.join(parts, "editor.js")), {
        "__COMMON_HEAD__": read(os.path.join(common, "head.js")).rstrip("\n"),
        "__COMMON_PAGE__": read(os.path.join(common, "page.js")).rstrip("\n") + "\n",
        "__COMMON_CONTROLS__": read(os.path.join(common, "controls.js")).rstrip("\n"),
        "__COMMON_FRAGMENT__": read(os.path.join(common, "fragment.js")).rstrip("\n") + "\n</script>\n</body>\n</html>",
    })
    script = fill(script, {
        "__PUPPY__": lines[index_of("const PUPPY_IMAGE = ")],
        "__BACKDROP__": backdrop.rstrip("\n"),
    })
    # The WGSL color conversions: the matrices, and the functions from transform() through toPremultipliedColor(), as
    # the freeform-gradient() editor takes them. srgbToLinear() is renamed, since the renderer's shader has its own.
    shader_color = between("fn transform(m: array<vec3f, 3>, v: vec3f) -> vec3f {", "@fragment fn meshGradientFragment")
    assert "fn toPremultipliedColor(color: vec4f) -> vec4f {" in shader_color
    shader_color = re.sub(r"\bsrgbToLinear\(", "colorSRGBToLinear(", shader_color.rstrip())
    # Color spaces and parsing, up to the mesh's hue fixup.
    script = fill(script, {
        "__COLORS__": between("// MARK: - Color spaces", "// MARK: - Hue fixup"),
        "__SHADER_HELPERS__": between("const wgslNumber = ", "const wgslMatrix = ", include_end=True),
        "__SHADER_MATRICES__": between('${wgslMatrix("linSRGBToXYZ"', "const D50 = ", include_end=True),
        "__SHADER_COLOR__": shader_color,
        "__RENDERER__": renderer.rstrip(),
        "__SHADER__": json.dumps(read(os.path.join(vendor, "WebGPUFreeformGradient.wgsl"))),
    })

    page = (style.rstrip() + "\n" + read(os.path.join(common, "common.css")) + read(os.path.join(parts, "editor.css"))
            + "</style>\n</head>\n" + html + "<script>\n" + script.lstrip("\n"))
    with open(output_path, "w") as file:
        file.write(page)
    print("wrote", output_path, len(page), "bytes")
