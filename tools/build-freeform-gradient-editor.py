#!/usr/bin/env python3
# Builds freeform-gradient-editor.html from the shared parts of mesh-gradient-editor.html and the page's own parts in
# tools/freeform-gradient-editor/. Run from anywhere: python3 tools/build-freeform-gradient-editor.py [mesh source] [output]
import os
import sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
source_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "mesh-gradient-editor.html")
output_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, "freeform-gradient-editor.html")
mesh = open(source_path).read()
lines = mesh.split("\n")


def index_of(text, start=0):
    for i in range(start, len(lines)):
        if lines[i].startswith(text):
            return i
    raise SystemExit(f"marker not found: {text!r}")


def between(start_marker, end_marker, include_end=False):
    a = index_of(start_marker)
    b = index_of(end_marker, a + 1)
    return "\n".join(lines[a:b + (1 if include_end else 0)])


# The page's CSS, up to the end of the shared rules.
style = between("<!DOCTYPE html>", "</style>")
style = style.replace("<title>mesh-gradient() Editor</title>", "<title>freeform-gradient() Editor</title>")
assert "#swatches button.selected" in style

# A photo of a puppy, for the Puppy backdrop.
puppy = lines[index_of("const PUPPY_IMAGE = ")]

# Margins and the narrow-screen scale.
margins = between("// Space around the box for the overlay.", "let viewScale = 1;", include_end=True)

# Color spaces and parsing, up to the mesh's hue fixup.
colors = between("// MARK: - Color spaces", "// MARK: - Hue fixup")

# The WGSL color conversions: the matrices, and the functions from transform() through toPremultipliedColor().
shader_matrices = between('${wgslMatrix("linSRGBToXYZ"', "const D50 = ", include_end=True)
shader_helpers = between("const wgslNumber = ", "const wgslMatrix = ", include_end=True)
shader_color = between("fn transform(m: array<vec3f, 3>, v: vec3f) -> vec3f {", "@fragment fn meshGradientFragment")
assert "fn toPremultipliedColor(color: vec4f) -> vec4f {" in shader_color
shader_color = shader_color.replace("// Equivalent to toPremultipliedColor() in MeshGradient.cpp.", "// Equivalent to toPremultipliedColor() in FreeformGradient.cpp.")
shader_color = shader_color.rstrip()

# Overlay coordinates, reach, and margins.
overlay_helpers = between("function toOverlay(p) {", "function drawOverlay(width, height, dpr) {")
# updateMargin() is the page's own, since it lays out a box for each model.
overlay_helpers = overlay_helpers[:overlay_helpers.index("function updateMargin(")] + overlay_helpers[overlay_helpers.index("narrowScreen.addEventListener("):]

# The backdrop.
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

# Copying.
copy_code = between("async function copy(text, label) {", '$("copyLink").addEventListener("click", () => {')

# The page's own parts, in tools/freeform-gradient-editor/: its CSS, its HTML, and its script, where the shared parts
# go in at the __MARKERS__.
parts = os.path.join(os.path.dirname(os.path.abspath(__file__)), "freeform-gradient-editor")


def read_part(name):
    with open(os.path.join(parts, name)) as file:
        return file.read()


script = read_part("editor.js")

replacements = {
    "__MARGINS__": margins,
    "__COLORS__": colors,
    "__SHADER_HELPERS__": shader_helpers,
    "__SHADER_MATRICES__": shader_matrices,
    "__SHADER_COLOR__": shader_color,
    "__OVERLAY_HELPERS__": overlay_helpers.rstrip(),
    "__COPY__": copy_code.rstrip(),
    "__BACKDROP__": backdrop,
}
for marker, text in replacements.items():
    assert script.count(marker) == 1, marker
    script = script.replace(marker, text)

# The mesh editor's head and shared CSS, then the page's own CSS, HTML and script, which starts with the puppy.
page = (style.rstrip() + "\n" + read_part("editor.css") + "</style>\n</head>\n" + read_part("editor.html")
        + "<script>\n" + puppy + "\n" + script.lstrip("\n"))
open(output_path, "w").write(page)
print("wrote", output_path, len(page), "bytes")
