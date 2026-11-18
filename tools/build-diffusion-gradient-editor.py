#!/usr/bin/env python3
# Builds diffusion-gradient-editor.html from the shared parts of mesh-gradient-editor.html, MeshShader2's WebGPU
# freeform gradient renderer in tools/diffusion-gradient-editor/vendor/, and the page's own parts in
# tools/diffusion-gradient-editor/. Run from anywhere: python3 tools/build-diffusion-gradient-editor.py [mesh source] [output]
#
# build() also builds the points and lines gradient editor, from its own parts and the same renderer: see
# build-points-and-lines-gradient-editor.py.
import json
import os
import sys

tools = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(tools)


def build(parts, title, output_path, source_path):
    lines = open(source_path).read().split("\n")

    def index_of(text, start=0):
        for i in range(start, len(lines)):
            if lines[i].startswith(text):
                return i
        raise SystemExit(f"marker not found: {text!r}")

    def between(start_marker, end_marker):
        a = index_of(start_marker)
        b = index_of(end_marker, a + 1)
        return "\n".join(lines[a:b])

    def read(path):
        with open(path) as file:
            return file.read()

    vendor = os.path.join(tools, "diffusion-gradient-editor", "vendor")

    # The page's CSS, up to the end of the shared rules.
    style = between("<!DOCTYPE html>", "</style>")
    assert style.count("<title>mesh-gradient() Editor</title>") == 1
    style = style.replace("<title>mesh-gradient() Editor</title>", f"<title>{title}</title>")

    # Color spaces and parsing, up to the mesh's hue fixup.
    colors = between("// MARK: - Color spaces", "// MARK: - Hue fixup")

    # MeshShader2's renderer, as a classic script rather than a module.
    renderer = read(os.path.join(vendor, "WebGPUFreeformGradient.js"))
    assert renderer.count("export class WebGPUFreeformGradientRenderer") == 1
    renderer = renderer.replace("export class WebGPUFreeformGradientRenderer", "class WebGPUFreeformGradientRenderer")
    shader = read(os.path.join(vendor, "WebGPUFreeformGradient.wgsl"))

    script = read(os.path.join(parts, "editor.js"))
    replacements = {
        "__COLORS__": colors,
        "__RENDERER__": renderer.rstrip(),
        "__SHADER__": json.dumps(shader),
    }
    for marker, text in replacements.items():
        assert script.count(marker) == 1, marker
        script = script.replace(marker, text)

    page = (style.rstrip() + "\n" + read(os.path.join(parts, "editor.css")) + "</style>\n</head>\n"
            + read(os.path.join(parts, "editor.html")) + "<script>\n" + script.lstrip("\n"))
    open(output_path, "w").write(page)
    print("wrote", output_path, len(page), "bytes")


if __name__ == "__main__":
    build(os.path.join(tools, "diffusion-gradient-editor"), "Diffusion Gradient Editor",
          sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, "diffusion-gradient-editor.html"),
          sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "mesh-gradient-editor.html"))
