These are MeshShader2's WebGPU freeform gradient renderer and its shader, from
FreeformGradient/Sources/FreeformGradient/WebGPU/ at MeshShader2 commit cf95dc0, with six changes and a fix.

First, a gradient may give `strengths`, one number from 0 to 1 for each segment, how firmly the segment holds its
colors, in the padding after `endDistance`. The harmonic multiplies the segment's weight by it, with the weight's
odds scaled by the finest texel's area over that of `strengthTexel`, the texel the strengths are given for (in units
of the box's shorter side; by default a 512th of the longer side), so a strength holds the same on every grid. The biharmonic,
which a partial hold makes overshoot badly, solves without the segments less than fully held, then again with them
held fully, each at its strength's mix from that solution's color to its own. A segment less than fully held has no
edge strips. Where segments overlap, each one's share of the held color is weighted by its strength too. Without
`strengths`, every segment is held fully, as before.

Second, the display takes colors back to sRGB through the page's own conversions rather than its three: the page
appends the mesh-gradient() editor's color code to the shader, and toSRGB() calls its hueComponent() and
toPremultipliedColor(). So a gradient may be in any of CSS's interpolation spaces, its `space` the space's index in the
page's SPACES, with the hue of a polar space not premultiplied. The display's uniforms carry the gradient's
`outputIsDisplayP3` and `gamutMapping`, 0 if it has none, for toPremultipliedColor() to read. Colors are
unpremultiplied by the solve's own alpha, as before, and only the alpha drawn with is clamped.

Third, a gradient may give `window`, the part of the solved box to draw: its origin and size, 0 to 1 across and
down the box, [0, 0, 1, 1] if it has none. The display samples the solution through it, and the edge strips are
placed through it, so a page can solve a box bigger than the view, for edges far from its stops, and show the middle.

Fourth, a gradient may give `edgeStrips: false`, to draw the solution without the strips along its two-sided lines.

Fifth, a gradient may give `naturalEdges: true`, for the biharmonic. Nothing then holds the surface at the box's
sides: a level's own equation is the thin plate's energy with the terms that would leave the grid left out, as Finch
et al.'s is, which is the mirrored 13-point stencil with the link between the outermost pair of texels in each row
and column 1 weaker. A weak membrane, scaled to weigh the same on every grid, decides what that leaves free, such as
the tilt of a plane held at fewer than three points. The finest level takes more steps of conjugate gradients, with
its residual formed afresh from the solution every ten: carried along in 32-bit floats, it loses a twist that only
the box's four corner texels resist. And a point of no radius holds exactly the one texel it's in, so nothing holds
the slope there, and with natural edges two such points make a linear ramp and three a plane. The texel is held at
its center, so the biharmonic is solved twice: the second time each center is held off its point's color by as much
as the first solution differs between the center and the point, which puts the point's color at the point itself.

Sixth, a segment's two-sidedness may be 2, for a tear, as Finch et al.'s: it holds its colors on the texel either side
of each edge of the grid it crosses, and the biharmonic leaves the slope across it free. freeformConstraints writes
where tears cross each level's grid, and near one a texel's row of the level's own equation is built from the thin
plate's energy term by term, leaving out the terms a tear crosses, rather than taken from the 13-point stencil. The
coarser levels, built from those rows, need nothing more. Tears are counted edge by edge and line by line: an edge one
line crosses an even number of times, as where a curve thinner than a texel passes, as at a sharp tip, is whole as far
as that line goes and holds nothing for it, while two lines crossing the same edge tear it. A line's segments are
packed together, so a segment that doesn't start where the last ended starts a new line. And a texel's side is the one
a step from it across the edge leaves, not its segment's line, which can't always tell near the segment's ends. Each
edge is crossed once where two segments meet on it. A tear's edge strips hold its colors one texel either side, and
with any tear the finest level is solved as with natural edges.

Seventh, it may be 3, for a flat tear: a tear with Finch et al.'s slope curve either side, a penalty, 50 times a thin
plate term, on the first difference away from the curve along its normal, so the surface is flat beside it. The tears
texture carries the curve's direction and how firmly it's held across each torn edge. Toward an open end, over 3% of
the box's shorter side or 4 texels, the two colors meet at their mean and the hold and the slope are let go, so the
jump fades out rather than wrapping round the end, and a line that ends against or just inside another's colors
doesn't fight them. Within 2 texels of a torn edge that runs more than half a radian another way, or isn't a flat
tear's, as where two curves cross or one turns sharply, the slope is let go too: held flat along both curves' normals,
it would pin texels a step apart to the two curves' colors. A firmer slope converges too slowly on fine grids. The
smoothing steps divide by a row's own size near a tear, since the slope terms make it more than the 13-point stencil's
64.

A two-sided segment holds at least 3 texels a side, not 1.5: with fewer than two whole texels a side the biharmonic
doesn't hold the slope across the line, and overshoots far past its colors on coarse grids.

Fixes: edgeQuads() gives each segment's first and last pieces the segment's own ends, so pieces meet exactly and a
line's strips aren't broken into runs at joints that rounding put a unit apart; it skips segments of no length, and a
hairpin or a vector of no length no longer makes a NaN; and a run that ends where it starts is mitered at its seam
and blends all the way round. Strengths are clamped to 0 to 1, a box of no size forgets that it was solved, and the
grid is at most 2048 texels a side, as the biharmonic's dot products need. Past its end, a segment's share of a
texel's held color gives way to the segments the texel is beside, so the outside of a two-sided corner isn't held to
a mix of both sides. Past a joint of a two-sided line, a texel past the next segment's start too is held to the
outside of the turn, since each segment's own line barely tells the sides apart there: at a sharp corner the band
held a mix of both colors just past the tip, and the biharmonic carried its slope out across the box. And the edge
strips antialias the line by mixing the two sides' colors as drawn, not in the interpolation space.

The builder inlines both into the diffusion and points and lines gradient editors, dropping the module's `export`.
