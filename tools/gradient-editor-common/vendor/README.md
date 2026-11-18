These are MeshShader2's WebGPU freeform gradient renderer and its shader, from
FreeformGradient/Sources/FreeformGradient/WebGPU/ at MeshShader2 commit cf95dc0, with three changes.

First, a gradient may give `strengths`, one number from 0 to 1 for each segment, how firmly the segment holds its
colors. The shader multiplies the segment's weight by it, in the padding after `endDistance`, and a segment less than
fully held has no edge strips. Without `strengths`, every segment is held fully, as before.

Second, the display takes colors back to sRGB through the page's own conversions rather than its three: the page
appends the mesh-gradient() editor's color code to the shader, and toSRGB() calls its hueComponent() and
toPremultipliedColor(). So a gradient may be in any of CSS's interpolation spaces, its `space` the space's index in the
page's SPACES, with the hue of a polar space not premultiplied. The display's uniforms carry the gradient's
`outputIsDisplayP3` and `gamutMapping`, 0 if it has none, for toPremultipliedColor() to read.

Third, a gradient may give `window`, the part of the solved box to draw: its origin and size, 0 to 1 across and
down the box, [0, 0, 1, 1] if it has none. The display samples the solution through it, and the edge strips are
placed through it, so a page can solve a box bigger than the view, for edges far from its stops, and show the middle.

The builder inlines both into the diffusion and points and lines gradient editors, dropping the module's `export`.
