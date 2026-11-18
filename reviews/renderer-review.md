# Review of the diffusion and points-and-lines gradient renderer

Scope: `tools/gradient-editor-common/vendor/WebGPUFreeformGradient.js` (below, **JS**) and `.wgsl` (**WGSL**), and how
`tools/diffusion-gradient-editor/editor.js`, `tools/points-and-lines-gradient-editor/editor.js` and
`tools/gradient-editor-common/page.js` feed them. Reviewed at commit `09b7d3d`. Review only; no code was changed.

## How this was checked

- All of JS and WGSL were read line by line, with the editor entry points.
- Three findings were reproduced numerically in NumPy ports of the kernel arithmetic (F1, F2 and the Jacobi smoothing
  factor in L2). The numbers are quoted where they are used.
- **The renderer itself was not run.** WebGPU is not available in this session's headless browser, so nothing here is
  a measurement of the GPU code: no timings, no images, no convergence runs. Findings are from reading the code and
  from the ports; each says which.
- Literature: citations were checked by web search against publisher, author and archive pages. Citation databases
  (Semantic Scholar, DBLP, Crossref, OpenAlex, HAL) were blocked by the session's network policy, so the "cited by"
  lists could not be crawled and no citation counts were obtained. The PDF of Finch et al. could not be fetched
  either; statements about that paper beyond its abstract are marked.

## Summary

The solver is sound as a solver. The harmonic path is a conventional full multigrid, and the biharmonic path
(Galerkin coarse operators built with a truncated prolongation, Chebyshev smoothing, a dense coarsest solve, V-cycle
preconditioned CG) is more careful than most published diffusion-curve grid solvers, including about 32-bit
cancellation. I found no bug that corrupts a solve.

The weak points are in the *problem being solved*, not in solving it:

1. Solver tuning constants and the grid spacing leak into what a soft hold means, so harmonic Strength changes with
   the grid (F1).
2. Two-sided corners hold a mix of both sides' colors on the outside of the corner (F2).
3. The biharmonic model has no tear: a jump is only representable as two thick bands, each of which clamps the slope
   to zero. That is why thin bands "don't settle", and it is the largest difference from Finch et al. (R4).
4. Edge antialiasing mixes colors in the interpolation space, which in a polar space puts a foreign hue on the edge
   (F3).

For a CSS feature, the main conclusion is that the picture is defined by this discretization (band radius, coverage
rule, penalty constants, grid size), not by a continuous problem another engine could match. Section 4 says what
would have to be pinned down.

---

## 1. High-level design

### 1.1 Formulation

- **Harmonic.** Per texel, `w (x − c) + (1 − w)(ω / s)(x − n) = 0`, with `n` the mean of four mirrored neighbors
  (WGSL:238–244). `w` is coverage × strength, `c` the held color. `w = 1` is a hard hold, `0 < w < 1` a penalty.
- **Biharmonic.** `K x = D x + B x = D c`, with `B` the 13-point stencil, `D = w / ((1 − w) ω_b / 20)`, and texels
  with `w ≥ 1` eliminated (WGSL:499–509, 585–611).
- **Curves** are flattened to polylines by the editors and rasterized as capsules of radius `r` into color and weight
  on every pyramid level (WGSL:99–179). A two-sided curve is one band whose color switches across the centerline over
  one texel (WGSL:152–157). Blur is two one-sided copies offset by `blur/2 + r` (diffusion `editor.js`:363–366). Open
  two-sided ends fade coverage over 4 texels and fan the side blend (WGSL:95–97, 150–156).
- The band radius is fixed by the editors at 0.01 of the box's shorter side (`CURVE_RADIUS`, `STOP_RADIUS`), about 5
  texels at a 512 grid. The renderer's own floor is 1.5 texels (JS:27, 1099–1100).

Consequences of the band formulation:

- **Nothing thinner than about 2r is representable.** Two curves closer than 2% of the box overlap and are held to
  their average in the overlap. Original diffusion curves hold a one-pixel line each side.
- **Every curve carries a flat plateau** of width 2r, with the gradient's kink at the band edge, not at the curve.
- **In the biharmonic, a band two or more texels wide of one color is a clamped condition**: the stencil of the first
  free texel reads two equal held rows, which fixes both value and a zero normal slope. A 1D check of the same
  stencil with two plateaus gives a smoothstep between them and an exactly flat solution outside, with no overshoot.
  So the biharmonic here is "value and zero slope along every curve", not thin-plate interpolation of values.

### 1.2 Boundary conditions

- Mirroring half a texel out (WGSL:225–229) is the natural condition for the harmonic model.
- For the biharmonic it is not. Mirroring imposes zero normal slope and zero third derivative, so only constants are
  in the operator's null space. The thin-plate energy's natural conditions leave linear functions free, which is what
  lets a thin-plate spline through two values be a linear ramp. Here the solution flattens toward every edge.
- **Open edges** solve a box twice the size and show the middle (`page.js`:81–100, 228–231). It halves the resolution
  in view for the same texel count, and it only moves the mirror further away. See R5.

### 1.3 Discretization and solver architecture

- Cell-centered grid, longest side `min(resolution, 2048, box pixels)` (JS:380–382), halved with rounding up until
  the longest side is 8 or less (JS:391–398).
- **Harmonic:** full multigrid. Coarsest level relaxed 500 times, each finer level prolonged and V(2,2)-cycled once,
  the finest 3 times, 5 with two-sided lines (JS:532–546). Coarse operators are rediscretized: constraints are
  rasterized again at each level's texel size.
- **Biharmonic:** the same coarse-to-fine sweep, but each level's V-cycle uses Galerkin operators `Pᵀ K P / 4` of that
  level's own equation (JS:733–752), Chebyshev smoothing, a 64 × 64 dense inverse at the bottom, and on the finest
  level 16 (20) steps of CG preconditioned by a V(2,2) cycle (JS:837–874).
- All iteration counts are fixed; there is no residual test.

The fine-level equation alone defines the result, and coarse levels only accelerate it. That is the right fix for
the temporal strobing Jeschke et al. report for the original diffusion-curve multigrid.

### 1.4 Sharp edges at display

The solution is filtered bilinearly up to the view (WGSL:432–439). Over it, each two-sided segment draws a strip per
side in its held color out to the held radius, then a strip blending to the solution over 1.5 texels (JS:969–1006,
1121–1243). Within half a pixel of the line the strip blends to the mean of the two sides (WGSL:488–494). Strips are
opaque and drawn in segment order.

### 1.5 What it can and cannot represent

| Can | Cannot |
|---|---|
| Value curves with a color per side, varying along the curve | Features thinner than about 2r |
| Points with a radius | A discontinuity with free (unconstrained) colors: a tear or barrier |
| Soft holds in the harmonic model | Slope or contour constraints; a crease |
| Blur as a filled band | Per-side gradient control (Ilbery et al.) |
| Alpha, premultiplied | Hues that go all the way round the wheel (one scalar hue field, `page.js`:18–37) |
| | A linear ramp from two biharmonic stops |

---

## 2. Low-level choices

**L1. Harmonic smoother.** Damped Jacobi with `ω = 0.9` (JS:24). For the 5-point Laplacian the damping that
minimizes the high-frequency amplification is 0.8: the smoothing factor is 0.6, against 0.8 at `ω = 0.9`. Over the
four sweeps of a V(2,2) cycle that is 0.13 against 0.41 (computed from the stencil's symbol). The checkerboard mode is
the one left behind; the 2 × 2 restriction cannot see it. Changing `ω` alone would change pictures, because of L2.

**L2. Solver constants are part of the equation.** `ω` multiplies the Laplacian term in the residual (WGSL:239) and
`ω_b / 20` sits in the biharmonic penalty (WGSL:585–587, JS:34). Retuning either damping factor changes what a
partially covered or partially held texel resolves to. Small in effect (0.985 → 0.991 at a held band's center in
a 1D port, `ω` 0.9 → 0.6), but it couples tuning to output.

**L3. Transfers.** Harmonic: 2 × 2 mean restriction, bilinear prolongation, correction scaled by `1 − w`
(WGSL:325–368). Standard and adequate for a second-order operator. Biharmonic: bilinear `P` and `Pᵀ/4`. The usual
rule is that the orders of prolongation and restriction should sum to more than the operator's order; bilinear both
ways gives 4 for a fourth-order operator, the borderline. Convergence may therefore slow as the grid grows. The CG
wrapper covers for it, but the fixed 16 steps were presumably tuned at one grid size. (The rule is quoted from
memory, usually attributed to Hemker; not verified in this session.)

**L4. Galerkin construction.** Only the diagonal and later entries are computed and the earlier ones mirrored
(WGSL:826–934), which relies on `K` being symmetric. It is: the mirrored 13-point stencil is the square of the
symmetric Neumann 5-point operator. Row sums are carried separately and the diagonal recovered from them
(WGSL:692–711, 917–933), which avoids cancellation against penalties up to about 10⁸. Texels with `w ≥ 0.5` are
dropped from `P` and left to the smoother. Background rows are precomputed (JS:60–98). All consistent; this is good
work.

**L5. Chebyshev.** Bounds `[1/16, 1]` after Gershgorin scaling by `D + 64` (JS:103–118, WGSL:1004). 1/16 is the
right lower bound for a fourth-order operator coarsened by 2. The reduction is weak for the cost, though: about 0.26
over 4 steps and 0.64 over the preconditioner's 2 (from the Chebyshev polynomial at the interval's ratio).

**L6. CG.** Symmetric V-cycle, pairwise summation of dot products (WGSL:1320–1375), a guard for converged channels.
There is no guard for a negative `r·z` (WGSL:1368–1370): `β` becomes 0 but `α` keeps its sign. I found no input that
makes the preconditioner indefinite, so this is a note, not a finding.

**L7. Precision.** Everything is f32. The stencil is applied to differences from the center (WGSL:589–597), which
keeps the residual's rounding proportional to local variation. The discrete biharmonic's condition number grows as
N⁴ (about 10¹¹ at 1024, 10¹³ at 2048), far past f32, so accuracy at large grids with few constraints rests on that
trick and on the iteration never amplifying rounding. The recorded convergence check (agreement with 25× the
iterations to 0.004) shows the iteration is stable, but both runs share the same f32 arithmetic, so it does not
measure the f32 error. A comparison with an f64 CPU solve at 1024 with two stops would. The 2048 cap (JS:45, 380) is
the size of the partial-sums buffer, not a precision bound; the pages offer at most 1024.

**L8. Coverage and antialiasing.** `saturate((r − d)/texel + 0.5)`, forced to 1 where the centerline crosses the
texel (WGSL:116–119, 138–141). Partial coverage becomes a penalty, which moves a band edge continuously as a curve
moves. That is a reasonable heuristic for temporal smoothness, not a consistent sub-texel boundary treatment, and its
meaning depends on the grid (F1).

**L9. Overlaps.** Coverage- and strength-weighted mean color, maximum weight (WGSL:167–169). Continuous in curve
position, which is why it beat "top wins". The display contradicts it: strips are opaque and later segments overdraw
earlier ones (F5).

**L10. Color.** Premultiplied solve with the hue left unpremultiplied is the right choice. Unpremultiplying by the
unclamped alpha (WGSL:419–421) is right too. Hue is a single scalar field, unwrapped about the circular mean
(`page.js`:18–30).

**L11. GPU cost.**
- Constraint rasterization is `O(texels × (points + segments))` on every level, with no culling (WGSL:113–170), and
  runs twice more for weak biharmonic segments (JS:506–518).
- A biharmonic solve is roughly 240 full-resolution passes of a 13-tap `rgba32float` stencil on the finest level (20
  CG steps × about 12 passes), counted from JS:837–920.
- Memory on the finest level is 14 `rgba32float` and one `r32float` texture for the biharmonic, 228 bytes a texel:
  about 330 MB a renderer at 1024², including coarser levels and coefficients; about 160 MB for the harmonic. Each
  view can also have an influence renderer.
- Ping-pong textures are forced by `rgba32float` not being read-write storage. Nothing here uses filtering, so
  storage buffers would do the same job and allow in-place updates (R6).

---

## 3. Findings

Ranked by severity. None corrupts a solve; F1–F3 change the picture.

### F1. Harmonic Strength depends on the grid (medium)

`w` is a penalty per texel (WGSL:167–169, 238–244), while the Laplacian term scales as texel². The same strength
therefore holds more firmly on a finer grid. In a 1D port of the kernel's equation (band of radius 0.01 softly held
to 1, a hard 0 at one end), the value at the band's center:

| Strength (weight = strength³) | 128 | 256 | 512 | 1024 |
|---|---|---|---|---|
| 10% | 0.27 | 0.59 | 0.86 | 0.96 |
| 20% | 0.75 | 0.92 | 0.98 | 1.00 |
| 30% | 0.91 | 0.98 | 1.00 | 1.00 |

**Failure scenario:** a curve at 10–20% strength looks different at each Grid setting, and shifts visibly during a
drag when "While editing" is half or quarter (`page.js`:63–66). It is also why "the solve barely gives at all above a
weight of 0.3" and why the editor needs the cube (diffusion `editor.js`:349–351, 361).

**Fix:** make the penalty a density. Multiply the weight's penalty by `(texel / reference length)²` so the continuous
equation is `−∆u + κ(u − c) = 0` in the band with `κ` in box units. Strength then has a usable range without the cube
and is the same on every grid. The biharmonic's two-solve mix is already grid independent.

### F2. Two-sided corners hold a mix of both sides on the outside of the corner (medium)

Each segment decides left or right from its own infinite line (WGSL:147, 153) but covers a round cap past its end
(WGSL:135–138). Past a joint, the cap of the incoming segment and the body of the outgoing one disagree about the
side, and the texel is held, at full weight, to the mean. In a port of the kernel for two segments meeting at a
corner, the share of fully held texels within `r` of the corner held more than 25% away from their true side's color:

| Turn | 30° | 90° | 150° |
|---|---|---|---|
| Texels held to the wrong mix | 15% | 52% | 85% |

**Failure scenario:** a two-sided rectangle or any curve with a corner node. Outside each corner, two quadrant-shaped
patches of radius `r` are held at half inside, half outside color, and that diffuses outward. The strips repaint the
band itself, so with strips on it shows as a tint in the gradient just outside each corner; with strips off the
patches are visible directly. Smooth curves are affected only by a sliver proportional to each joint's turn.

**Fix:** decide the side from the polyline, not the segment: clip each segment's coverage to its own slab (and give
the joint wedge to the mitre), or take the side from the nearest segment only.

### F3. Edge antialiasing mixes in the interpolation space (medium in polar spaces)

The strip blends toward `edgeColor`, the mean of the two sides' packed colors, before conversion (WGSL:490–491,
JS:1213–1214). In `hsl`, `hwb`, `lch` or `oklch` the mean of two hues is a third hue.

**Failure scenario:** a red-to-cyan two-sided edge in `oklch` gets a one-pixel line of the hue halfway between along
its whole length. In rectangular spaces it is only the usual small error of blending in a non-linear space.

**Fix:** convert each side with `toSRGB()` and mix the results by coverage.

### F4. Biharmonic Strength steps at 100% and doubles the cost below it (low)

Any strength below 1 switches to the two-solve path (JS:506–518) and removes that curve's strips (JS:976–983).

**Failure scenario:** moving Strength from 100% to 99% removes the sharp edge at once and halves the frame rate.
The solution itself is continuous. Fading the strips with strength would remove the step.

### F5. Strips at crossings are order dependent and smear the other curve's edge (low)

Blend-strip corners sample the solution per vertex (WGSL:477–479), two texels apart (JS:985), and strips are opaque.

**Failure scenario:** where curve B crosses earlier curve A, B's strips overwrite A's. B's blend strip interpolates
linearly between samples taken either side of A's jump, so A's sharp edge is replaced by a two-texel ramp for the
width of B's band. The solve averaged the two curves there; the display shows "B on top".

### F6. Open two-sided ends finish square (low)

The held strip runs at full width to the segment's end (JS:1222–1228), while the solver widens the side blend to 5
texels at the end and holds a round, fading cap beyond it (WGSL:150–156).

**Failure scenario:** the end of an open two-sided curve shows a butt end about `2r` wide where the sharp two-color
strip meets the smooth fan. Tapering the held width over the last few texels, as the blend already is (JS:1194),
would match the solver. Derived from the code; not seen rendered.

### F7. Flattening is fixed in box units (low)

Pieces are 0.01 of the box, at most 64 a stretch (diffusion `editor.js`:286; points-and-lines `editor.js`:231).

**Failure scenario:** on a tight curve (radius of curvature 0.05 of the box) the chord is 0.00025 of the box off the
arc: a quarter texel at 1024, but over a device pixel on a 4000-pixel view, where the strips draw the facets
sharply. A flatness tolerance in device pixels would fix it. Offset copies for blur also fold over themselves where
`blur/2 + r` exceeds the curve's radius (diffusion `editor.js`:318–338).

### F8. Shared buffers written through the queue (latent)

`fillColor`, `displayUniforms` and the uniform slots are written with `queue.writeBuffer` (JS:258, 526, 626), which
takes effect before anything in the encoder runs.

**Failure scenario:** not reachable from the pages today. A second `fill()` with another color in one solve, or one
renderer encoded twice into one command buffer with different gradients, would run both with the last values.

### F9. Texels are assumed square (latent)

Level sizes are rounded independently (JS:381–382, 396–397) and the stencils assume a square texel.

**Failure scenario:** a 2048 × 16 box has coarse levels 128 × 1 and below, whose texels are far from square. Only
convergence suffers, since coarse levels are corrections. On the finest level the error is under half a texel in the
short side.

### F10. No handling of allocation failure (latent)

Textures are created without an error scope (JS:403–425, 431–457). At 1024² with both models and influence views,
the page can ask for around a gigabyte. On a device that refuses, the solve silently draws nothing.

---

## 4. Literature comparison

Each entry: what it does, how this renderer differs, and whether adopting it helps. Status of each citation is in
the reference list.

**Orzan et al. 2008, diffusion curves.** Curves with a color per side and a blur value; one-pixel color sources
rasterized each side; a GPU multigrid; blur as a second diffused field driving a reblur. *Here:* thick bands, a
converged fine-level equation, blur as geometry. This renderer is more stable in time and its blur is exact for
parallel offsets, but it cannot draw thin features. *Adopt:* thin bands for the harmonic model, which does not need
the thick ones (they exist for the biharmonic, R4). Cost: small in the editor; the renderer already supports 1.5
texels.

**Jeschke, Cline and Wonka 2009, GPU Laplacian solver.** Robust rasterization of curves, a closest-point
initialization, and Jacobi with a stencil radius that grows with distance from the nearest curve, replacing
multigrid because the original strobed during editing. *Here:* multigrid kept, strobing avoided by converging the
fine equation. *Adopt:* not the solver. Its distance map would be useful for F2 (side from the nearest curve) and for
culling the constraint pass. Cost: one jump-flood pass per solve.

**Jeschke, Cline and Wonka 2009, surface details ("feature embedding").** Keeps curve edges crisp under
magnification by embedding the curve geometry in the texture lookup. *Here:* the edge strips do the same job as
geometry. Comparable in effect; strips are simpler but need F3, F5 and F6 fixed.

**Bezerra et al. 2010, diffusion constraints.** Diffusion barriers that block color without holding one, and control
of strength and direction. *Here:* no barrier, and strength as a per-texel penalty. *Adopt:* barriers, for the
harmonic model by zeroing the stencil links that cross the curve. They are the harmonic counterpart of a tear and
remove the need for a held band to separate two sides. Cost: moderate (a per-texel link mask in the smoother and
restriction).

**Finch, Snyder and Hoppe 2011, controlled thin-plate splines.** Thin-plate interpolation on a grid with tears (value
discontinuities), creases (slope discontinuities), value points and curves, and slope and contour curves, solved
hierarchically. *Here:* the same PDE without any of the controls; a jump is two clamped bands. This is the largest
gap (R4). My recollection, not re-verified because the PDF could not be fetched, is that they build the energy from
per-texel second-difference terms and drop or reweight the terms a tear or crease crosses, which also gives natural
conditions at the box's edges. *Adopt:* yes, for the biharmonic model. Cost: large; see R1.

**Boyé, Barla and Guennebaud 2012, vectorial solver.** Finite elements on a triangulation of the curves, harmonic and
biharmonic, giving a mesh that rasterizes at any size. *Here:* a grid tied to the view. *Adopt:* not for an editor.
For a CSS engine it is the strongest candidate for resolution-independent output, since curves are mesh edges and
discontinuities are exact. Cost: a constrained triangulator and a sparse solver in every engine.

**Pang et al. 2012; Prévost, Jarosz and Sorkine-Hornung 2015; Bowers, Leahey and Wang 2011.** Triangle meshes with
mean-value colors, and ray-traced gathering with no global solve. They approximate the harmonic solution (the
ray-traced ones are not the Laplace solution exactly) in exchange for independence between pixels. *Adopt:* no. They
do not extend to the biharmonic and would not match a PDE definition.

**Sun et al. 2012; Sun, Thamjaroenporn and Zheng 2014; Ilbery et al. 2013; Bang et al. 2023 (boundary elements).**
Solve for densities on the curves once, then evaluate any point in closed form: harmonic (Sun, Bang), biharmonic
with color and normal gradient set per side (Ilbery). Exact on an unbounded plane, exact at curves, resolution
independent; Sun 2012 integrates a pixel analytically. *Here:* open edges approximate the unbounded plane by a
doubled box. *Adopt:* as a **reference implementation** for tests, yes: it is the only family that defines the
picture without a grid. As the renderer, a dense solve in the number of curve elements is cubic, which is fine for
tens of curves and poor for hundreds without fast multipole. Ilbery et al. is also the model for per-side gradient
control, and was cited in an SVG working group proposal for advanced gradients.

**Jacobson, Weinkauf and Sorkine 2012.** Constrains biharmonic and higher interpolants so extrema occur only where
asked. *Here:* overshoot is shown (the gamut hatching) but not controlled. *Adopt:* it is a constrained optimization,
too slow for interactive use; relevant as the principled answer to "should biharmonic colors be allowed out of
range", which a specification must answer.

**Jeschke 2016, generalized diffusion curves.** Gets more control away from curves by blending Laplace solutions,
avoiding the bilaplacian's cost and oscillation. *Adopt:* worth a prototype as an alternative to the biharmonic model
altogether: two harmonic solves, no overshoot, the existing fast path. Cost: moderate.

**Sawhney and Crane 2020 and successors (walk on spheres, walk on stars, boundary value caching); Himmler and Günther
2026 (Monte Carlo for biharmonic diffusion curves).** Grid-free pointwise estimators. *Adopt:* not for display
(noise, and costly near open ends). Useful as a second independent reference, and the 2026 paper extends it to the
biharmonic case.

**McCann and Pollard 2008; Szeliski 2006; Krishnan and Szeliski 2011.** GPU multigrid for gradient-domain painting,
and hierarchical-basis against multigrid preconditioners for problems with irregular weights. Krishnan and Szeliski
find adapted hierarchical bases usually win on cost. *Here:* Galerkin multigrid, which is their robust but expensive
end. *Adopt:* nothing now; relevant if the biharmonic cost has to come down (R7).

**Not found.** No published description of Illustrator's freeform gradient, and no paper dedicated to crossing
curves. The literature either lets the later curve win at rasterization or avoids the question with exact methods.
This renderer's averaged overlap is, as far as I found, its own rule.

---

## 5. Design-level recommendations

Ranked by value for cost.

**R1. Make soft holds a property of the continuous problem (fixes F1, L2).** Scale the penalty by texel², and take
`ω` and `ω_b/20` out of the equation. Small change, removes the cube, makes Strength mean the same on every grid.
Cost: hours, plus retuning the Strength slider.

**R2. Fix side assignment at joints (F2) and antialias in output space (F3).** Both are local shader changes. Cost:
hours each.

**R3. Write down the continuous problem.** For a specification, state per model: the PDE, the condition on a curve
(value only, or value and slope), the condition at the box, what a soft hold is as a penalty density, and what
overlapping holds mean. Then test engines against a grid-free reference (boundary elements, with Monte Carlo as a
cross-check) with a tolerance. Without this, engines can only match by copying this discretization, including its
grid size. Cost: design work, and a reference solver of a few hundred lines for the harmonic case.

**R4. Give the biharmonic a tear.** Build `B` from per-texel energy terms and drop the terms a two-sided curve
crosses, holding each side's value on the texels beside it. Then a jump needs no thick band, bands need not clamp the
slope, thin features work, and the same construction at the box's edge gives natural conditions and linear ramps.
The Galerkin machinery already handles a spatially varying operator, since it builds every coarse row from the fine
one. Cost: large. The fine operator becomes per-texel (a link mask or coefficients), `ownEntry` and the background
shortcut change, and near-singular configurations (a region enclosed by tears with no value) need a rule.

**R5. Open edges without halving the resolution.** Solve the doubled box only on the coarse levels, then solve the
view at full resolution with its boundary values taken from that. Cost: moderate for the harmonic model (a Dirichlet
edge mode); more for the biharmonic, which needs two boundary rows.

**R6. Storage buffers and in-place red-black relaxation for the harmonic model.** Halves the ping-pong memory and
roughly halves the sweeps for the same smoothing. If Jacobi stays, 0.8 is the better damping once R1 has decoupled it
from the picture (L1). Cost: moderate, mechanical.

**R7. Cull the constraint pass.** Bin segments to tiles, or rasterize the bands as geometry. Matters only with
hundreds of segments or at 1024 and above. Cost: moderate.

**R8. Measure before tuning the biharmonic.** Three checks would settle L3, L5 and L7: CG residual against step count
at 256, 512 and 1024; the same solve against an f64 CPU solve; and a timing of the 240 passes. I could not run these
here.

---

## 6. References

Status: **C** = title, authors, year and venue confirmed on a publisher, author or archive page in this session.
A DOI is given only where such a page showed it.

- Orzan, Bousseau, Winnemöller, Barla, Thollot, Salesin. 2008. Diffusion Curves: A Vector Representation for
  Smooth-Shaded Images. ACM TOG 27(3) (SIGGRAPH 2008). doi:10.1145/1399504.1360691. **C**
- Finch, Snyder, Hoppe. 2011. Freeform Vector Graphics with Controlled Thin-Plate Splines. ACM TOG 30(6) (SIGGRAPH
  Asia 2011). **C**. The author's PDF prints doi:10.1145/2024156.2024200; the task's 10.1145/2070781.2024200 was not
  confirmed. Content beyond the abstract not re-read in this session.
- Jeschke, Cline, Wonka. 2009. A GPU Laplacian Solver for Diffusion Curves and Poisson Image Editing. ACM TOG 28(5)
  (SIGGRAPH Asia 2009). **C** (DOI not confirmed)
- Jeschke, Cline, Wonka. 2009. Rendering Surface Details with Diffusion Curves. ACM TOG 28(5). **C**
- Bezerra, Eisemann, DeCarlo, Thollot. 2010. Diffusion Constraints for Vector Graphics. NPAR 2010, 35–42.
  doi:10.1145/1809939.1809944. **C**
- Boyé, Barla, Guennebaud. 2012. A Vectorial Solver for Free-Form Vector Gradients. ACM TOG 31(6) (SIGGRAPH Asia
  2012). **C** (DOI not confirmed; element order not confirmed)
- Pang, Qin, Cohen, Heng, Choi. 2012. Fast Rendering of Diffusion Curves with Triangles. IEEE CG&A 32(4), 68–78. **C**
- Bowers, Leahey, Wang. 2011. A Ray Tracing Approach to Diffusion Curves. CGF 30(4), 1345–1352.
  doi:10.1111/j.1467-8659.2011.01994.x. **C**
- Prévost, Jarosz, Sorkine-Hornung. 2015. A Vectorial Framework for Ray Traced Diffusion Curves. CGF 34(1), 253–264.
  doi:10.1111/cgf.12510. **C**
- Sun, Xie, Dong, Lin, Xu, Wang, Tong, Guo. 2012. Diffusion Curve Textures for Resolution Independent Texture
  Mapping. ACM TOG 31(4) (SIGGRAPH 2012). **C** (DOI not confirmed)
- Sun, Thamjaroenporn, Zheng. 2014. Fast Multipole Representation of Diffusion Curves and Points. ACM TOG 33(4).
  doi:10.1145/2601097.2601187. **C**
- Ilbery, Kendall, Concolato, McCosker. 2013. Biharmonic Diffusion Curve Images from Boundary Elements. ACM TOG 32(6)
  (SIGGRAPH Asia 2013). **C** (no DOI seen)
- Bang, Serkh, Stein, Jacobson. 2023. An Adaptive Fast-Multipole-Accelerated Hybrid Boundary Integral Equation Method
  for Accurate Diffusion Curves. ACM TOG 42(6). doi:10.1145/3618374. **C**
- Jacobson, Weinkauf, Sorkine. 2012. Smooth Shape-Aware Functions with Controlled Extrema. CGF 31(5) (SGP 2012),
  1577–1586. doi:10.1111/j.1467-8659.2012.03163.x. **C**
- Jeschke. 2016. Generalized Diffusion Curves: An Improved Vector Representation for Smooth-Shaded Images. CGF 35(2).
  doi:10.1111/cgf.12812. **C**
- Sawhney, Crane. 2020. Monte Carlo Geometry Processing: A Grid-Free Approach to PDE-Based Methods on Volumetric
  Domains. ACM TOG 39(4). doi:10.1145/3386569.3392374. **C**
- Sawhney, Miller, Gkioulekas, Crane. 2023. Walk on Stars: A Grid-Free Monte Carlo Method for PDEs with Neumann
  Boundary Conditions. ACM TOG 42(4). doi:10.1145/3592398. **C**
- Miller, Sawhney, Crane, Gkioulekas. 2023. Boundary Value Caching for Walk on Spheres. ACM TOG 42(4). **C**
- Himmler, Günther. 2026. Monte Carlo Rendering of Biharmonic Diffusion Curves. ACM TOG 45(4) (SIGGRAPH 2026).
  doi:10.1145/3811397. **C** (publication page only; paper not read)
- McCann, Pollard. 2008. Real-Time Gradient-Domain Painting. ACM TOG 27(3). doi:10.1145/1360612.1360692. **C**
- Szeliski. 2006. Locally Adapted Hierarchical Basis Preconditioning. ACM TOG 25(3) (SIGGRAPH 2006). **C** (DOI not
  confirmed)
- Krishnan, Szeliski. 2011. Multigrid and Multilevel Preconditioners for Computational Photography. ACM TOG 30(6).
  doi:10.1145/2070781.2024211. **C**
- Unverified, quoted from memory: the rule on transfer-operator orders in L3 (Hemker).

Also turned up but not used above: Lieng et al. 2015 (shading curves); Hou et al. 2020 (Poisson vector graphics);
Xie et al. 2014 (hierarchical diffusion curves); Zhao, Durand and Zheng 2018 (inverse diffusion curves); Takayama et
al. 2010 (diffusion surfaces). Xia, Liao and Yu 2009 is image vectorization, not a diffusion solve.
