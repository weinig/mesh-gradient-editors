"use strict";

__PUPPY__

__COLORS__

// MARK: - Renderer

// MeshShader2's WebGPU freeform gradient renderer: its constraint rasterizer, harmonic and biharmonic multigrids,
// and the sharp edges drawn along two-sided lines. See tools/gradient-editor-common/vendor/README.md.
__RENDERER__

__SHADER_HELPERS__

// The mesh-gradient() editor's color conversions, which the renderer's display and the visualizations take colors back
// to sRGB through, in any interpolation space. Their uniforms are each shader's own: COLOR_SHADER(name) reads
// name.space, name.outputIsDisplayP3 and name.gamutMapping.
const COLOR_SHADER = uniforms => `
__SHADER_MATRICES__
${wgslMatrix("xyzToLinRec2020", M.xyzToLinRec2020)}

// Which component is the hue, in a polar space, or -1.
fn hueComponent(space: u32) -> i32 {
    switch space {
        case 12u, 13u: { return 0; }
        case 9u, 11u: { return 2; }
        default: { return -1; }
    }
}

__SHADER_COLOR__
`.replaceAll("uniforms.", `${uniforms}.`);

const SHADER = __SHADER__ + COLOR_SHADER("display");

// An editor's own models, by name, each solved by a renderer of its own in place of this one.
const MODEL_RENDERERS = {};
