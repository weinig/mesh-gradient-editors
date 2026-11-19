#!/usr/bin/env python3
# Builds freeform-gradient-editor.html from tools/freeform-gradient-editor/ and the parts it shares in
# tools/gradient-editor-common/. Run from anywhere:
# python3 tools/build-freeform-gradient-editor.py [mesh source] [output]
import importlib.util
import os
import sys

tools = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(tools)
spec = importlib.util.spec_from_file_location("common", os.path.join(tools, "gradient-editor-common", "build.py"))
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)
common.build(os.path.join(tools, "freeform-gradient-editor"),
             sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, "freeform-gradient-editor.html"),
             sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "mesh-gradient-editor.html"))
