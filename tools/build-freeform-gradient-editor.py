#!/usr/bin/env python3
# Builds freeform-gradient-editor.html from the page's own parts in tools/freeform-gradient-editor/ and the parts of
# mesh-gradient-editor.html it shares with the other editors, which tools/gradient-editor-common/build.py picks out.
# Run from anywhere: python3 tools/build-freeform-gradient-editor.py [mesh source] [output]
import importlib.util
import os
import sys

tools = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(tools)
spec = importlib.util.spec_from_file_location("common", os.path.join(tools, "gradient-editor-common", "build.py"))
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)

source_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "mesh-gradient-editor.html")
output_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, "freeform-gradient-editor.html")
parts = os.path.join(tools, "freeform-gradient-editor")
mesh = common.mesh_parts(source_path)

style = mesh["style"]
assert style.count("<title>mesh-gradient() Editor</title>") == 1
style = style.replace("<title>mesh-gradient() Editor</title>", "<title>freeform-gradient() Editor</title>")
assert "#swatches button.selected" in style

shader_color = mesh["shader_color"].replace("// Equivalent to toPremultipliedColor() in MeshGradient.cpp.",
                                            "// Equivalent to toPremultipliedColor() in FreeformGradient.cpp.").rstrip()

script = common.read(os.path.join(parts, "editor.js"))
replacements = {
    "__MARGINS__": mesh["margins"],
    "__COLORS__": mesh["colors"],
    "__SHADER_HELPERS__": mesh["shader_helpers"],
    "__SHADER_MATRICES__": mesh["shader_matrices"],
    "__SHADER_COLOR__": shader_color,
    "__OVERLAY_HELPERS__": mesh["overlay_helpers"].rstrip(),
    "__COPY__": mesh["copy"].rstrip(),
    "__BACKDROP__": mesh["backdrop"],
}
for marker, text in replacements.items():
    assert script.count(marker) == 1, marker
    script = script.replace(marker, text)

# The mesh editor's head and shared CSS, then the page's own CSS, HTML and script, which starts with the puppy.
page = (style.rstrip() + "\n" + common.read(os.path.join(parts, "editor.css")) + "</style>\n</head>\n"
        + common.read(os.path.join(parts, "editor.html")) + "<script>\n" + mesh["puppy"] + "\n" + script.lstrip("\n"))
with open(output_path, "w") as file:
    file.write(page)
print("wrote", output_path, len(page), "bytes")
