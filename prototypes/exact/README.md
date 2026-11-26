# The renderer's biharmonic solve against an exact one

The renderer solves the biharmonic model in 32-bit floats, in a fixed number of steps, and nothing in it says how
near the answer it stopped. These two scripts say: one captures what a solve held and what it came to, and the other
solves the same equation outright in double precision and compares.

    python3 prototypes/exact/capture.py      opens the built diffusion editor in Safari, as the tests do
    python3 prototypes/exact/exact.py        needs NumPy and SciPy

`capture.py` solves each preset on 256, 512 and 1024 grids and saves the finest level's held colors, their weights,
its tears and its solution in `data/`, which isn't checked in. It saves the solution twice: as the renderer solves
it, and with the residual never formed afresh on the way, to tell what the fresh starts are worth.

`exact.py` builds the level's own equation from the thin plate's energy a term at a time, where the shader builds it
a texel's row at a time, so that the two agree also says the rows are that energy's. The renderer's constants come
from its sources.

## What it found

In November 2026, in a color's components from 0 to 1, the furthest any texel was from the exact solution:

| Preset | 256 | 512 | 1024 | 1024, no fresh starts |
|---|---|---|---|---|
| A circle | 0.0000 | 0.0000 | 0.0000 | 0.0016 |
| A leaf | 0.0000 | 0.0000 | 0.0000 | 0.0030 |
| Sunset | 0.0000 | 0.0001 | 0.0006 | 0.0009 |
| Overlapping shapes | 0.0001 | 0.0003 | 0.0010 | 0.0070 |
| Flat and smooth | 0.0000 | 0.0002 | 0.0014 | 0.0005 |
| A line between two colors | 0.0001 | 0.0011 | 0.0044 | 0.0135 |
| Finch et al., Figure 5: a tear | 0.0002 | 0.0012 | 0.0073 | 0.0340 |
| A circle, natural edges | | | 0.0019 | 0.0029 |
| A leaf, natural edges | | | 0.0065 | 0.0235 |

The furthest texels are at the box's corners and sides, far from any curve.

## What it doesn't cover

A curve at a strength under 100% is solved twice and mixed, and a point of no radius is solved twice too;
`exact.py` solves only what the last of those held. The harmonic model and the coarser levels aren't checked.
