#!/usr/bin/env python3
# Builds points-and-lines-gradient-editor.html from the shared parts of mesh-gradient-editor.html, MeshShader2's
# WebGPU freeform gradient renderer in tools/diffusion-gradient-editor/vendor/, and the page's own parts in
# tools/points-and-lines-gradient-editor/. Run from anywhere:
# python3 tools/build-points-and-lines-gradient-editor.py [mesh source] [output]
import importlib.util
import os
import sys

tools = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(tools)
spec = importlib.util.spec_from_file_location("diffusion", os.path.join(tools, "build-diffusion-gradient-editor.py"))
diffusion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diffusion)
diffusion.build(os.path.join(tools, "points-and-lines-gradient-editor"), "Points and Lines Gradient Editor",
                sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, "points-and-lines-gradient-editor.html"),
                sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "mesh-gradient-editor.html"))
