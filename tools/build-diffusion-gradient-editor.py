#!/usr/bin/env python3
# Builds diffusion-gradient-editor.html from the shared parts of mesh-gradient-editor.html, MeshShader2's WebGPU
# freeform gradient renderer in tools/diffusion-gradient-editor/vendor/, and the page's own parts in
# tools/diffusion-gradient-editor/. Run from anywhere: python3 tools/build-diffusion-gradient-editor.py [mesh source] [output]
import json
import os
import sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
source_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "mesh-gradient-editor.html")
output_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, "diffusion-gradient-editor.html")
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


parts = os.path.join(os.path.dirname(os.path.abspath(__file__)), "diffusion-gradient-editor")


def read_part(name):
    with open(os.path.join(parts, name)) as file:
        return file.read()


# The page's CSS, up to the end of the shared rules.
style = between("<!DOCTYPE html>", "</style>")
style = style.replace("<title>mesh-gradient() Editor</title>", "<title>Diffusion Gradient Editor</title>")

# Color spaces and parsing, up to the mesh's hue fixup.
colors = between("// MARK: - Color spaces", "// MARK: - Hue fixup")

# MeshShader2's renderer, as a classic script rather than a module.
renderer = read_part("vendor/WebGPUFreeformGradient.js")
assert renderer.count("export class WebGPUFreeformGradientRenderer") == 1
renderer = renderer.replace("export class WebGPUFreeformGradientRenderer", "class WebGPUFreeformGradientRenderer")
shader = read_part("vendor/WebGPUFreeformGradient.wgsl")

script = read_part("editor.js")
replacements = {
    "__COLORS__": colors,
    "__RENDERER__": renderer.rstrip(),
    "__SHADER__": json.dumps(shader),
}
for marker, text in replacements.items():
    assert script.count(marker) == 1, marker
    script = script.replace(marker, text)

page = (style.rstrip() + "\n" + read_part("editor.css") + "</style>\n</head>\n" + read_part("editor.html")
        + "<script>\n" + script.lstrip("\n"))
open(output_path, "w").write(page)
print("wrote", output_path, len(page), "bytes")
