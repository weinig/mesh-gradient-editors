# Tests for the gradient editors

These run the built editors in Safari, which has the WebGPU they need, and check what they draw and how their
controls behave.

    python3 tests/run.py                  every editor's cases
    python3 tests/run.py diffusion        one editor's: diffusion, points-and-lines, points, freeform, mesh or hue
    python3 tests/run.py -k Strength      the cases whose names contain "Strength"

Build the editors first (`python3 tools/build-diffusion-gradient-editor.py` and the others); the tests run the built
pages at the top of the repository, not the sources.

## How it works

For each editor, `run.py` makes a copy of its built page with `prelude.js` and the editor's cases appended, opens it in
a Safari window of its own, and waits. The page runs its cases one after another and reports them in its title, a part at a
time since a title is cut short, which `run.py` reads back before closing the window. So a full run opens six windows, one at a time, and brings Safari to
the front for each: a page in the background draws no frames, and the tests would never finish.

For the same reason `run.py` refuses to start while the screen is locked, and keeps the display awake while it runs.
If another window covers Safari's partway through, the cases that only wait for the page to draw can stall until
their editor times out; run that editor again.

## Cases

A case is `test(name, async t => { ... })` in a `.js` file in the editor's folder. It runs inside the editor's page,
so it sees the page's own `state`, `views`, `changed()` and the rest. Before each case the page's state is put back
as it was when it opened. A case fails if one of its checks fails (`t.ok`, `t.equal`, `t.below`, `t.above`), if it
throws, or if the page logs a JavaScript or WebGPU error while it runs.

`prelude.js` has the helpers: `set(id, value)` to change a control as a user would, `preset(name)`, `grab(view)` to
read a box's solve back, `pointer(view)` for clicks and drags on a box, and a few more.

The cases in `renderer.js` measure the solve itself. Their tolerances are a few times what they measured when they
were written, so they catch a change in what the renderer draws, not a change in its last digit.

## What isn't here

`prototypes/tears/` has a CPU reference for the biharmonic model with tears, and a check that a solver like the
renderer's can solve it in single precision. Those need NumPy, SciPy and Pillow, and run on their own.
