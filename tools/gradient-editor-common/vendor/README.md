These are MeshShader2's WebGPU freeform gradient renderer and its shader, from
FreeformGradient/Sources/FreeformGradient/WebGPU/ at MeshShader2 commit cf95dc0, with four changes and a fix.

First, a gradient may give `strengths`, one number from 0 to 1 for each segment, how firmly the segment holds its
colors. The shader multiplies the segment's weight, and its share of a texel's held color, by it, in the padding after `endDistance`, and a segment less than
fully held has no edge strips. Without `strengths`, every segment is held fully, as before.

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
grid is at most 2048 texels a side, as the biharmonic's dot products need.

The builder inlines both into the diffusion and points and lines gradient editors, dropping the module's `export`.
