#!/usr/bin/env python3
# Runs the editors' tests in Safari, which has the WebGPU the editors need: for each editor, a copy of its built page
# with prelude.js and the editor's cases appended is opened in a window of its own, runs its cases, and reports them
# in its title, which this reads back. See README.md.
#
#   python3 tests/run.py                 every editor
#   python3 tests/run.py diffusion       one editor's cases
#   python3 tests/run.py -k strength     the cases whose names have "strength" in them
import argparse
import base64
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
    "mesh": "mesh-gradient-editor.html",
    "hue": "hue-fixup-explorer.html",
}


# The test window's left, top, right and bottom on the screen.
WINDOW = (0, 33, 1600, 1033)


def osascript(*lines):
    arguments = [argument for line in lines for argument in ("-e", line)]
    return subprocess.run(["osascript", *arguments], capture_output=True, text=True).stdout.strip()


def screen_is_locked():
    result = subprocess.run(["swift", os.path.join(here, "locked.swift")], capture_output=True, text=True)
    return "locked: 1" in result.stdout


def page_for(editor, only, name):
    page = open(os.path.join(root, EDITORS[editor])).read()
    assert page.count("</body>") == 1, f"{EDITORS[editor]} has more than one </body>"
    folder = os.path.join(here, editor)
    # The run's name is in the page's title, so its window can be told from any other.
    scripts = [f"const TEST_RUN = {json.dumps(name)};", open(os.path.join(here, "prelude.js")).read()]
    scripts += [open(os.path.join(folder, name)).read() for name in sorted(os.listdir(folder)) if name.endswith(".js")]
    scripts.append(f"cases.splice(0, cases.length, ...cases.filter(c => c.name.includes({json.dumps(only)})));" if only else "")
    scripts.append("runCases();")
    return page.replace("</body>", "".join(f"<script>\n{script}\n</script>\n" for script in scripts) + "</body>")


def run(editor, only, timeout):
    directory = tempfile.mkdtemp(prefix="gradient-editor-tests-")
    path = os.path.join(directory, f"{editor}.html")
    name = f"{editor}-{os.getpid()}"
    window = f'(first window whose name starts with "TESTS {name} ")'
    open(path, "w").write(page_for(editor, only, name))
    # A window of one size, whatever the last one was: a box is sized to fit the window, and its grid to fit the box.
    osascript(f'tell application "Safari" to make new document with properties {{URL:"file://{path}"}}',
              f'tell application "Safari" to set bounds of window 1 to {{{", ".join(map(str, WINDOW))}}}',
              'tell application "Safari" to activate')
    # The results come a part at a time, each "TESTS <run> done <place>/<count> <part>", over and over.
    title, started, parts, count = "", time.time(), {}, None
    while time.time() - started < timeout and (count is None or len(parts) < count):
        title = osascript(f'tell application "Safari" to get name of {window}')
        if title.startswith(f"TESTS {name} done "):
            place, _, part = title[len(f"TESTS {name} done "):].partition(" ")
            index, _, total = place.partition("/")
            parts[int(index)], count = part, int(total)
        time.sleep(0.1 if count else 0.5)
    osascript(f'tell application "Safari" to close {window}')
    os.remove(path)
    os.rmdir(directory)
    if count is None or len(parts) < count:
        return [(f"{editor}: did not finish", [f"timed out after {timeout} s, at: {title or 'no page'}"])]
    return [(name, failures) for name, failures in json.loads(base64.b64decode("".join(parts[i] for i in range(1, count + 1))))]


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
