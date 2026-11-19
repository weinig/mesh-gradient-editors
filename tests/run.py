#!/usr/bin/env python3
# Runs the editors' tests in Safari, which has the WebGPU the editors need: for each editor, a copy of its built page
# with prelude.js and the editor's cases appended is opened in a window of its own, runs its cases, and reports them
# in its title, which this reads back. See README.md.
#
#   python3 tests/run.py                 every editor
#   python3 tests/run.py diffusion       one editor's cases
#   python3 tests/run.py -k strength     the cases whose names have "strength" in them
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)

# Each editor's folder of cases here, and its built page.
EDITORS = {
    "diffusion": "diffusion-gradient-editor.html",
    "points-and-lines": "points-and-lines-gradient-editor.html",
    "freeform": "freeform-gradient-editor.html",
}


def osascript(*lines):
    arguments = [argument for line in lines for argument in ("-e", line)]
    return subprocess.run(["osascript", *arguments], capture_output=True, text=True).stdout.strip()


def screen_is_locked():
    result = subprocess.run(["swift", os.path.join(here, "locked.swift")], capture_output=True, text=True)
    return "locked: 1" in result.stdout


def page_for(editor, only):
    page = open(os.path.join(root, EDITORS[editor])).read()
    assert page.count("</body>") == 1, f"{EDITORS[editor]} has more than one </body>"
    folder = os.path.join(here, editor)
    scripts = [open(os.path.join(here, "prelude.js")).read()]
    scripts += [open(os.path.join(folder, name)).read() for name in sorted(os.listdir(folder)) if name.endswith(".js")]
    scripts.append(f"cases.splice(0, cases.length, ...cases.filter(c => c.name.includes({json.dumps(only)})));" if only else "")
    scripts.append("runCases();")
    return page.replace("</body>", "".join(f"<script>\n{script}\n</script>\n" for script in scripts) + "</body>")


def run(editor, only, timeout):
    directory = tempfile.mkdtemp(prefix="gradient-editor-tests-")
    path = os.path.join(directory, f"{editor}.html")
    open(path, "w").write(page_for(editor, only))
    osascript(f'tell application "Safari" to make new document with properties {{URL:"file://{path}"}}',
              'tell application "Safari" to activate')
    title, started = "", time.time()
    while time.time() - started < timeout:
        title = osascript('tell application "Safari" to get name of (first window whose name starts with "TESTS ")')
        if title.startswith("TESTS done "):
            break
        time.sleep(0.5)
    osascript('tell application "Safari" to close (first window whose name starts with "TESTS ")')
    os.remove(path)
    os.rmdir(directory)
    if not title.startswith("TESTS done "):
        return [(f"{editor}: did not finish", [f"timed out after {timeout} s, at: {title or 'no page'}"])]
    return [(name, failures) for name, failures in json.loads(title[len("TESTS done "):])]


def main():
    parser = argparse.ArgumentParser(description="Run the gradient editors' tests in Safari.")
    parser.add_argument("editors", nargs="*", help=f"which editors' cases to run, of {', '.join(EDITORS)}; all by default")
    parser.add_argument("-k", dest="only", default="", help="only the cases whose names contain this")
    parser.add_argument("--timeout", type=int, default=900, help="seconds to wait for one editor's cases")
    arguments = parser.parse_args()
    for editor in arguments.editors:
        if editor not in EDITORS:
            parser.error(f"no editor named {editor}")
    if screen_is_locked():
        sys.exit("The screen is locked. Safari draws no frames behind a locked screen, so the tests would never finish.")
    # Keep the display awake while this runs: a sleeping display stops the frames too.
    subprocess.Popen(["caffeinate", "-di", "-w", str(os.getpid())])
    failed = 0
    for editor in arguments.editors or EDITORS:
        print(f"{editor}:")
        for name, failures in run(editor, arguments.only, arguments.timeout):
            print(f"  {'FAIL' if failures else 'pass'}  {name}")
            for failure in failures:
                print(f"        {failure}")
            failed += bool(failures)
    print(f"{failed} failed." if failed else "All passed.")
    sys.exit(1 if failed else 0)


main()
