# The model behind the diffusion and points and lines gradient editors

This says what the two editors draw as a problem on the box, apart from the grid that solves it, and then lists what
still depends on the grid. It's the starting point a specification would need: an engine that solved this problem
another way should get the same picture, to a tolerance.

## The picture

A gradient is a color at every point of a box. Each component of the color, in the interpolation space, is its own
function *u* on the box, found the same way. Colors are premultiplied by alpha, except the hue of a polar space,
which is carried as it is, with the hues given first moved by whole turns to within half a turn of their mean.

*u* is the function that minimizes an energy, subject to what the stops and curves hold. There are two models, which
differ only in the energy.

| Model | Energy | Where nothing is held |
|---|---|---|
| Harmonic | ∫ \|∇u\|² | ∆u = 0: a stretched membrane |
| Biharmonic | ∫ u_xx² + 2 u_xy² + u_yy² | ∆²u = 0: a thin plate |

Lengths below are in units of the box's shorter side, unless they say otherwise.

## What is held

**A stop** holds its color at its point.

- With a spread, or in the points and lines editor's default, it holds its color over a disc. The radius runs from
  0.01 at no spread to 0.35 at full spread. A disc also holds the biharmonic's slope flat there.
- As "one texel", with no spread, it holds only its point. The slope there is free.

**A line through stops** (points and lines) holds a color along a band 0.01 either side of it, the color running from
stop to stop. The band holds the biharmonic's slope across the line flat.

**A two-colored curve** (diffusion) holds one color on its left and another on its right, each across a band 0.01
wide beside it. So on each side it holds a color and, for the biharmonic, a flat slope across the curve; between the
sides the color jumps. In Finch et al.'s terms this is a slope-value curve each side of a tear.

**A curve with a free slope** is their plain tear: *u* may jump across it, its limit from the left is the left color
and from the right the right color, and nothing is said about its slope. The harmonic model has no slope to hold, so
only the biharmonic differs. An open curve with a free slope tilts each side into a steep plane.

**A blurred curve** is two one-colored copies of the curve, moved apart by the blur plus the two bands, each holding
one side's color. The model fills the gap between them.

**Strength** below 100% is defined per model, since a partial hold makes the biharmonic overshoot.

- Harmonic: inside the band the equation is −∆u + κ (u − c) = 0, a pull toward the color *c* with strength κ per unit
  area. For a strength *s*, with σ = s³, κ = (4 / 0.9) (512 / L)² σ / (1 − σ), where L is the box's longer side.
- Biharmonic: solve without the curves below 100%, giving *u₀*. Then solve with them held fully, each to
  (1 − s) u₀ + s c. For a lone curve this is exactly (1 − s) times the gradient without it plus *s* times the gradient
  with it.

**Where holds overlap**, the held color is their mean, each weighted by how much of the point it covers and by its
strength.

## The box's edges

| Edges | Harmonic | Biharmonic |
|---|---|---|
| Mirrored | No flow across the side: ∂u/∂n = 0 | The plate as if mirrored in the side: ∂u/∂n = 0 and ∂(∆u)/∂n = 0 |
| Natural | The same | Nothing holds the plate at the side: the energy's own conditions |
| Open | Mirrored, in a box twice the size with the gradient in its middle | The same |

With natural edges and fewer than three points held, the thin plate leaves a plane's tilt free. A weak membrane
decides it: the energy gains 0.016 / L² ∫ \|∇u\|², with L the box's longer side. With two one-texel stops the result
is a linear ramp between them, carried on past them; with three, a plane.

## What still depends on the grid

These are the renderer's choices, not the model's. A specification would have to define each, or define the model so
they stop mattering.

- **The grid.** The longest side has 128 to 1024 texels, and never more than the box's pixels. The picture is the
  grid's solution, filtered up to the box.
- **A band's least width.** A two-colored curve's band is at least 3 texels a side: with fewer than two whole texels
  the biharmonic's slope isn't held, and the answer changes character. So on a coarse grid a band is wider than 0.01.
- **A point.** A one-texel stop holds the texel it's in, at the texel's center. The biharmonic is solved twice, the
  second time with each center held off its stop's color by as much as the first solution differs between the
  center and the stop, so the stop's color is at the stop itself and moving it moves the gradient smoothly. The
  harmonic's stop still moves in steps of a texel.
- **A tear.** It holds the texel either side of each edge of the grid it crosses.
- **Partly covered texels.** A texel a band covers in part is held in part, which moves a band's edge smoothly as a
  curve moves but means something a little different on each grid.
- **Open ends of two-colored curves.** The band fades out over 4 texels past an open end, and the two colors blend
  across a fan there.
- **Corners.** Past a segment's end its color gives way, over a texel, to the segment the texel is beside.
- **Sharp edges on screen.** Strips are drawn along two-colored curves over the filtered grid, so the jump is sharp
  at the screen's resolution, and antialiased with a mix of the two sides' colors as drawn.
- **Accuracy.** The solver works in 32-bit floats for a fixed number of steps. Against an exact plane, three
  one-texel stops with natural edges come within 0.003 of the colors' range at a 128 grid, 0.017 at 512 and 0.033 at
  804.

## The thin plate spline

The freeform-gradient() editor draws a third model beside these two, from stops alone: the thin plate spline, which is
what WebKit's `freeform-gradient()` draws. It minimizes the biharmonic's energy over the whole plane rather than the
box, held at each stop's point, so it has a formula and nothing here depends on a grid:

*u*(p) = a + b·p + Σ wᵢ U(|p − pᵢ|), with U(r) = r² log r

The weights *wᵢ* and the plane *a + b·p* are the ones that give each stop its color, with Σ wᵢ = 0 and Σ wᵢ pᵢ = 0.
One stop is its color everywhere; stops all on one line give a spline with no tilt across the line, the same on both sides of it; of stops in the same place, the last is
used. Spread means nothing to it.

The biharmonic model with natural edges and one-texel stops is the nearest to it: the same energy held at the same
points, but over the box. The two agree where the answer is a plane, with three stops or fewer, and differ otherwise,
since the spline's sheet still bends where it crosses the box's sides.

The editor also has Free edges: Open and Natural at once, the box twice the size with nothing holding the plate at
its sides, which is how Finch et al. have their grid. It takes in stops outside the box, which the spline uses
wherever they are.

The editor fits the spline in double precision. It draws the gradient from the spline itself at every pixel, as
WebKit does, or from the grid; either way it evaluates the spline at each texel of the grid in single precision, to
within 0.00002 of the colors' range, for everything that reads the grid. So its grid is the spline sampled, not
solved.

## A reference

`prototypes/tears/tears.py` solves the biharmonic model exactly on a grid, in double precision with a direct solver,
from the energy term by term, with tears, natural or mirrored edges, and an emulation of the bands. It's the place
to check a claim about the model apart from the renderer: that a band is a tear with flat sides, that tears alone
tilt an open curve into a plane, that natural edges make stops into ramps and planes.

`prototypes/tears/single.py` checks that a solver built like the renderer's reaches those answers in single
precision, and what it needs to: differences between texels rather than their values, and a residual formed afresh
every few steps.

A grid-free reference, such as boundary elements, would be better still for a specification, since it has no texels
to disagree about. There isn't one here.

## Sources

- Orzan et al., "Diffusion Curves: A Vector Representation for Smooth-Shaded Images", 2008: the harmonic model,
  curves with a color each side, and blur.
- Finch, Snyder and Hoppe, "Freeform Vector Graphics with Controlled Thin-Plate Splines", 2011: the biharmonic model
  as an energy of per-pixel terms, tears, value and slope curves, natural edges, and the membrane that regularizes
  it.
