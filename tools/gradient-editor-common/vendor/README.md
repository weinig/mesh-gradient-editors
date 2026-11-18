These are MeshShader2's WebGPU freeform gradient renderer and its shader, from
FreeformGradient/Sources/FreeformGradient/WebGPU/ at MeshShader2 commit cf95dc0, with four changes and a fix.

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

Fixes: edgeQuads() gives each segment's first and last pieces the segment's own ends, so pieces meet exactly and a
line's strips aren't broken into runs at joints that rounding put a unit apart; it skips segments of no length, and
a hairpin or a vector of no length no longer makes a NaN; and a run that ends where it starts is mitered at its seam
and blends all the way round. Strengths are clamped to 0 to 1, a box of no size forgets that it was solved, and the
grid is at most 2048 texels a side, as the biharmonic's dot products need. Past its end, a segment's share of a
texel's held color gives way to the segments the texel is beside, so the outside of a two-sided corner isn't held to
a mix of both sides. And the edge strips antialias the line by mixing the two sides' colors as drawn, not in the
interpolation space.

The builder inlines both into the diffusion and points and lines gradient editors, dropping the module's `export`.
