#!/usr/bin/env python3
# Captures what the renderer's biharmonic model holds and solves, for exact.py to check: opens the built diffusion
# editor in Safari as the tests do, solves each preset on each grid, and saves the finest level's held colors, their
# weights, its tears and its solution in data/. See README.md.
#
#   python3 prototypes/exact/capture.py                          the usual presets on 256, 512 and 1024 grids
#   python3 prototypes/exact/capture.py "A leaf" --grids 1024    one preset, one grid
#   python3 prototypes/exact/capture.py "A leaf" --edges natural
import argparse
import http.server
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.parse

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(os.path.dirname(here))
data = os.path.join(here, "data")
PRESETS = ["A circle", "A line between two colors", "A leaf", "Overlapping shapes", "Sunset", "Flat and smooth",
           "Finch et al., Figure 5: a tear"]


class Receiver(http.server.BaseHTTPRequestHandler):
    def allow(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self.allow()
        self.end_headers()

    def do_POST(self):
        name = os.path.basename(urllib.parse.unquote(self.path))
        body = self.rfile.read(int(self.headers["Content-Length"]))
        open(os.path.join(data, name), "wb").write(body)
        self.send_response(200)
        self.allow()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *arguments):
        pass


def main():
    parser = argparse.ArgumentParser(description="Capture the renderer's biharmonic solves for exact.py.")
    parser.add_argument("presets", nargs="*", help="the diffusion editor's presets to capture, by name")
    parser.add_argument("--grids", default="256,512,1024", help="the grids to solve on")
    parser.add_argument("--edges", default="", help="the Edges setting, if not the preset's: natural, say")
    parser.add_argument("--timeout", type=int, default=900)
    arguments = parser.parse_args()
    captures = []
    for preset in arguments.presets or PRESETS:
        for grid in arguments.grids.split(","):
            slug = re.sub(r"[^A-Za-z0-9]+", "-", preset + (" " + arguments.edges if arguments.edges else "")).strip("-")
            captures.append({"slug": f"{slug}-{grid}", "preset": preset, "edges": arguments.edges, "resolution": int(grid)})

    # The tests' runner, pointed at a folder with this capture as the diffusion editor's only case.
    spec = importlib.util.spec_from_file_location("harness", os.path.join(root, "tests", "run.py"))
    harness = importlib.util.module_from_spec(spec)
    sys.modules["harness"] = harness
    spec.loader.exec_module(harness)
    if harness.screen_is_locked():
        sys.exit("The screen is locked. Safari draws no frames behind a locked screen.")
    subprocess.Popen(["caffeinate", "-di", "-w", str(os.getpid())])

    os.makedirs(data, exist_ok=True)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Receiver)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    folder = tempfile.mkdtemp(prefix="gradient-editor-capture-")
    os.mkdir(os.path.join(folder, "diffusion"))
    shutil.copy(os.path.join(root, "tests", "prelude.js"), folder)
    with open(os.path.join(folder, "diffusion", "capture.js"), "w") as case:
        case.write(f"const CAPTURE_PORT = {server.server_address[1]};\nconst CAPTURES = {json.dumps(captures)};\n")
        case.write(open(os.path.join(here, "capture.js")).read())
    harness.here = folder
    try:
        results = harness.run("diffusion", "", arguments.timeout)
    finally:
        shutil.rmtree(folder)
        server.shutdown()
    failures = [failure for _, failed in results for failure in failed]
    for failure in failures:
        print(failure)
    if failures:
        sys.exit(1)
    print("Captured: " + " ".join(capture["slug"] for capture in captures))


if __name__ == "__main__":
    main()
