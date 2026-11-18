These are MeshShader2's WebGPU freeform gradient renderer and its shader, from
FreeformGradient/Sources/FreeformGradient/WebGPU/ at MeshShader2 commit cf95dc0, with one change: a gradient may give
`strengths`, one number from 0 to 1 for each segment, how firmly the segment holds its colors. The shader multiplies
the segment's weight by it, in the padding after `endDistance`, and a segment less than fully held has no edge strips.
Without `strengths`, every segment is held fully, as before. The builder inlines both into
diffusion-gradient-editor.html, dropping the module's `export`.
