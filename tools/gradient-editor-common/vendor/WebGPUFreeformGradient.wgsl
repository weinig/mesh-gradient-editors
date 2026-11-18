// A freeform gradient with WebGPU: a port of MetalFreeformGradient.metal's
// harmonic solve and its display. The points and lines are rasterized into
// each level of a pyramid as color sources, the harmonic, ∆u = 0, is solved by
// full multigrid, and the finest level is filtered up to the view in sRGB.
// Each kernel does what the Metal one of the same name does; see there for
// why.

// Must match the points WebGPUFreeformGradient.js packs.
struct FreeformPoint {
    // Premultiplied, in the interpolation space.
    color: vec4<f32>,
    // 0 to 1 across and down the gradient box.
    position: vec2<f32>,
    // In units of the box's shorter side.
    radius: f32,
    padding: f32,
}

// A straight piece of a line. Must match the segments WebGPUFreeformGradient.js
// packs.
struct FreeformSegment {
    startLeft: vec4<f32>,
    endLeft: vec4<f32>,
    startRight: vec4<f32>,
    endRight: vec4<f32>,
    start: vec2<f32>,
    end: vec2<f32>,
    startRadius: f32,
    endRadius: f32,
    isTwoSided: u32,
    startDistance: f32,
    endDistance: f32,
    // How firmly the segment holds its colors, 0 to 1: its weight where it
    // covers a texel fully.
    strength: f32,
}

// Must match the uniforms WebGPUFreeformGradient.js writes for a level.
struct Level {
    size: vec2<u32>,
    // The size of one texel, in units of the box's shorter side.
    texelSize: vec2<f32>,
    // The box's size in units of its shorter side.
    boxScale: vec2<f32>,
    pointCount: u32,
    segmentCount: u32,
    // The Jacobi damping factor.
    omega: f32,
    // How much coarser this level is than the one whose equation is being
    // solved, squared. 1 on that level itself.
    scale: f32,
    // Smoothing steps, for freeformSmoothSmall.
    iterations: u32,
    padding0: u32,
    // The level below, for freeformRestrict.
    coarseSize: vec2<u32>,
    padding1: vec2<u32>,
}

// MARK: - Color sources

@group(0) @binding(0) var<uniform> constraintsLevel: Level;
@group(0) @binding(1) var<storage, read> points: array<FreeformPoint>;
@group(0) @binding(2) var<storage, read> segments: array<FreeformSegment>;
@group(0) @binding(3) var constraintColorOut: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var constraintWeightOut: texture_storage_2d<r32float, write>;
@group(0) @binding(5) var rightHandSideOut: texture_storage_2d<rgba32float, write>;

fn segmentCrossesBox(a: vec2<f32>, b: vec2<f32>, center: vec2<f32>, halfSize: vec2<f32>) -> bool {
    let d = b - a;
    let p = a - center;
    var enter = 0.0;
    var leave = 1.0;
    for (var axis = 0; axis < 2; axis++) {
        if (abs(d[axis]) < 1e-12) {
            if (abs(p[axis]) > halfSize[axis]) {
                return false;
            }
            continue;
        }
        let t0 = (-halfSize[axis] - p[axis]) / d[axis];
        let t1 = (halfSize[axis] - p[axis]) / d[axis];
        enter = max(enter, min(t0, t1));
        leave = min(leave, max(t0, t1));
    }
    return enter <= leave;
}

const openEndFan = 2.0;
const openEndLead = 2.0;
const openEndFade = 4.0;

@compute @workgroup_size(8, 8)
fn freeformConstraints(@builtin(global_invocation_id) id: vec3<u32>) {
    let level = constraintsLevel;
    let gid = id.xy;
    if (any(gid >= level.size)) {
        return;
    }

    let position = (vec2<f32>(gid) + 0.5) * level.texelSize;
    let texel = max(level.texelSize.x, level.texelSize.y);

    var colorSum = vec4<f32>(0.0);
    var coverageSum = 0.0;
    var weight = 0.0;
    for (var i = 0u; i < level.pointCount; i++) {
        let point = points[i];
        let delta = position - point.position * level.boxScale;
        var coverage = saturate((point.radius - length(delta)) / texel + 0.5);
        if (all(abs(delta) <= 0.5 * level.texelSize)) {
            coverage = 1.0;
        }
        colorSum += coverage * point.color;
        coverageSum += coverage;
        weight = max(weight, coverage);
    }
    for (var i = 0u; i < level.segmentCount; i++) {
        let segment = segments[i];
        let a = segment.start * level.boxScale;
        let b = segment.end * level.boxScale;
        let along = b - a;
        let lengthSquared = dot(along, along);
        var t = 0.0;
        if (lengthSquared > 0.0) {
            t = saturate(dot(position - a, along) / lengthSquared);
        }
        let radius = mix(segment.startRadius, segment.endRadius, t);
        var coverage = saturate((radius - distance(position, a + t * along)) / texel + 0.5);
        if (segmentCrossesBox(a, b, position, 0.5 * level.texelSize)) {
            coverage = 1.0;
        }
        let offset = position - a;
        let segmentLength = sqrt(lengthSquared);
        var across = 0.0;
        var distanceAlong = 0.0;
        if (lengthSquared > 0.0) {
            across = -(along.x * offset.y - along.y * offset.x) / segmentLength;
            distanceAlong = dot(offset, along) / segmentLength;
        }
        let past = max(-(segment.startDistance + distanceAlong),
                       distanceAlong - segmentLength - segment.endDistance);
        let blend = texel + openEndFan * max(0.0, past + openEndLead * texel);
        let left = saturate(0.5 + across / blend);
        if (segment.isTwoSided != 0u) {
            coverage *= saturate(1.0 - max(0.0, past) / (openEndFade * texel));
        }
        let color = mix(mix(segment.startRight, segment.endRight, t), mix(segment.startLeft, segment.endLeft, t), left);
        colorSum += coverage * color;
        coverageSum += coverage;
        weight = max(weight, coverage * segment.strength);
    }

    var color = vec4<f32>(0.0);
    if (coverageSum > 0.0) {
        color = colorSum / coverageSum;
    }
    textureStore(constraintColorOut, gid, color);
    textureStore(constraintWeightOut, gid, vec4<f32>(weight));
    textureStore(rightHandSideOut, gid, weight * color);
}

// MARK: - Starting a level

@group(0) @binding(0) var<uniform> fillLevel: Level;
@group(0) @binding(1) var<uniform> fillColor: vec4<f32>;
@group(0) @binding(2) var fillOut: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(8, 8)
fn freeformFill(@builtin(global_invocation_id) id: vec3<u32>) {
    if (any(id.xy >= fillLevel.size)) {
        return;
    }
    textureStore(fillOut, id.xy, fillColor);
}

// Bilinear filtering by hand: 32-bit float textures are not filterable.
fn bilinearRead(t: texture_2d<f32>, position: vec2<f32>) -> vec4<f32> {
    let size = vec2<i32>(textureDimensions(t));
    let base = floor(position);
    let f = position - base;
    let p0 = clamp(vec2<i32>(base), vec2<i32>(0), size - 1);
    let p1 = clamp(vec2<i32>(base) + 1, vec2<i32>(0), size - 1);
    let top = mix(textureLoad(t, vec2<i32>(p0.x, p0.y), 0), textureLoad(t, vec2<i32>(p1.x, p0.y), 0), f.x);
    let bottom = mix(textureLoad(t, vec2<i32>(p0.x, p1.y), 0), textureLoad(t, vec2<i32>(p1.x, p1.y), 0), f.x);
    return mix(top, bottom, f.y);
}

@group(0) @binding(0) var<uniform> prolongLevel: Level;
@group(0) @binding(1) var prolongCoarse: texture_2d<f32>;
@group(0) @binding(2) var prolongOut: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(8, 8)
fn freeformProlong(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = prolongLevel.size;
    if (any(id.xy >= size)) {
        return;
    }
    let coarseSize = vec2<f32>(textureDimensions(prolongCoarse));
    let position = (vec2<f32>(id.xy) + 0.5) * coarseSize / vec2<f32>(size) - 0.5;
    textureStore(prolongOut, id.xy, bilinearRead(prolongCoarse, position));
}

// MARK: - Multigrid

// Neumann boundaries: the grid is mirrored about its edges, half a texel out.
fn mirrored(position: vec2<i32>, size: vec2<i32>) -> vec2<i32> {
    var p = select(position, -position - 1, position < vec2<i32>(0));
    p = select(p, 2 * size - p - 1, p >= size);
    return clamp(p, vec2<i32>(0), size - 1);
}

fn neighborAverage(x: texture_2d<f32>, p: vec2<i32>, size: vec2<i32>) -> vec4<f32> {
    return 0.25 * (textureLoad(x, mirrored(p + vec2<i32>(-1, 0), size), 0)
                   + textureLoad(x, mirrored(p + vec2<i32>(1, 0), size), 0)
                   + textureLoad(x, mirrored(p + vec2<i32>(0, -1), size), 0)
                   + textureLoad(x, mirrored(p + vec2<i32>(0, 1), size), 0));
}

fn residual(x: vec4<f32>, n: vec4<f32>, b: vec4<f32>, w: f32, level: Level) -> vec4<f32> {
    return b - (w * x + (1.0 - w) * (level.omega / level.scale) * (x - n));
}

fn smoothed(x: vec4<f32>, n: vec4<f32>, b: vec4<f32>, w: f32, level: Level) -> vec4<f32> {
    return x + residual(x, n, b, w, level) / (w + (1.0 - w) / level.scale);
}

@group(0) @binding(0) var<uniform> smoothLevel: Level;
@group(0) @binding(1) var smoothSource: texture_2d<f32>;
@group(0) @binding(2) var smoothOut: texture_storage_2d<rgba32float, write>;
@group(0) @binding(3) var smoothRightHandSide: texture_2d<f32>;
@group(0) @binding(4) var smoothWeight: texture_2d<f32>;

@compute @workgroup_size(8, 8)
fn freeformSmooth(@builtin(global_invocation_id) id: vec3<u32>) {
    let level = smoothLevel;
    if (any(id.xy >= level.size)) {
        return;
    }
    let p = vec2<i32>(id.xy);
    let x = textureLoad(smoothSource, p, 0);
    let n = neighborAverage(smoothSource, p, vec2<i32>(level.size));
    let b = textureLoad(smoothRightHandSide, p, 0);
    let w = textureLoad(smoothWeight, p, 0).r;
    textureStore(smoothOut, id.xy, smoothed(x, n, b, w, level));
}

// A level of no more than this many texels takes all its smoothing steps in
// one dispatch, in workgroup memory: as many as the device's limits allow, up
// to 1024. Set when the pipeline is made.
override smallLevelTexels: u32 = 256;

// Two copies of the level, one after the other, so a step reads one and
// writes the other.
var<workgroup> smallLevel: array<vec4<f32>, 2 * smallLevelTexels>;

fn smallAverage(base: u32, p: vec2<i32>, size: vec2<i32>) -> vec4<f32> {
    let a = mirrored(p + vec2<i32>(-1, 0), size);
    let b = mirrored(p + vec2<i32>(1, 0), size);
    let c = mirrored(p + vec2<i32>(0, -1), size);
    let d = mirrored(p + vec2<i32>(0, 1), size);
    let width = size.x;
    return 0.25 * (smallLevel[base + u32(a.y * width + a.x)] + smallLevel[base + u32(b.y * width + b.x)]
                   + smallLevel[base + u32(c.y * width + c.x)] + smallLevel[base + u32(d.y * width + d.x)]);
}

@compute @workgroup_size(smallLevelTexels)
fn freeformSmoothSmall(@builtin(local_invocation_index) index: u32) {
    let level = smoothLevel;
    let size = vec2<i32>(level.size);
    let count = level.size.x * level.size.y;
    let inside = index < count;
    let p = vec2<i32>(i32(index % level.size.x), i32(index / level.size.x));
    var b = vec4<f32>(0.0);
    var w = 0.0;
    if (inside) {
        smallLevel[index] = textureLoad(smoothSource, p, 0);
        b = textureLoad(smoothRightHandSide, p, 0);
        w = textureLoad(smoothWeight, p, 0).r;
    }
    workgroupBarrier();

    for (var i = 0u; i < level.iterations; i++) {
        let reading = (i % 2u) * smallLevelTexels;
        let writing = smallLevelTexels - reading;
        if (inside) {
            smallLevel[writing + index] = smoothed(smallLevel[reading + index], smallAverage(reading, p, size), b, w, level);
        }
        workgroupBarrier();
    }

    if (inside) {
        textureStore(smoothOut, vec2<u32>(p), smallLevel[(level.iterations % 2u) * smallLevelTexels + index]);
    }
}

@group(0) @binding(0) var<uniform> restrictLevel: Level;
@group(0) @binding(1) var restrictX: texture_2d<f32>;
@group(0) @binding(2) var restrictRightHandSide: texture_2d<f32>;
@group(0) @binding(3) var restrictWeight: texture_2d<f32>;
@group(0) @binding(4) var restrictCoarseRightHandSide: texture_storage_2d<rgba32float, write>;
@group(0) @binding(5) var restrictCoarseCorrection: texture_storage_2d<rgba32float, write>;

// A level's residual, averaged over each 2×2 block, as the right-hand side of
// the correction one level down — and that correction started at zero. One
// thread a coarse texel; the uniforms are the fine level's.
@compute @workgroup_size(8, 8)
fn freeformRestrict(@builtin(global_invocation_id) id: vec3<u32>) {
    let level = restrictLevel;
    if (any(id.xy >= level.coarseSize)) {
        return;
    }
    let size = vec2<i32>(level.size);
    var sum = vec4<f32>(0.0);
    var count = 0.0;
    for (var dy = 0; dy < 2; dy++) {
        for (var dx = 0; dx < 2; dx++) {
            let p = vec2<i32>(id.xy) * 2 + vec2<i32>(dx, dy);
            if (any(p >= size)) {
                continue;
            }
            sum += residual(textureLoad(restrictX, p, 0), neighborAverage(restrictX, p, size),
                            textureLoad(restrictRightHandSide, p, 0), textureLoad(restrictWeight, p, 0).r, level);
            count += 1.0;
        }
    }
    textureStore(restrictCoarseRightHandSide, id.xy, sum / count);
    textureStore(restrictCoarseCorrection, id.xy, vec4<f32>(0.0));
}

@group(0) @binding(0) var<uniform> correctLevel: Level;
@group(0) @binding(1) var correctCoarse: texture_2d<f32>;
@group(0) @binding(2) var correctSource: texture_2d<f32>;
@group(0) @binding(3) var correctOut: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var correctWeight: texture_2d<f32>;

// Adds the correction from the level below, filtered up as freeformProlong
// filters a solution, except where a texel is held.
@compute @workgroup_size(8, 8)
fn freeformCorrect(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = correctLevel.size;
    if (any(id.xy >= size)) {
        return;
    }
    let coarseSize = vec2<f32>(textureDimensions(correctCoarse));
    let position = (vec2<f32>(id.xy) + 0.5) * coarseSize / vec2<f32>(size) - 0.5;
    let correction = bilinearRead(correctCoarse, position);
    let p = vec2<i32>(id.xy);
    textureStore(correctOut, id.xy, textureLoad(correctSource, p, 0) + (1.0 - textureLoad(correctWeight, p, 0).r) * correction);
}

// MARK: - Display

struct DisplayUniforms {
    space: u32,
    // Read by the page's toPremultipliedColor().
    outputIsDisplayP3: u32,
    gamutMapping: u32,
    padding: u32,
}

@group(0) @binding(0) var<uniform> display: DisplayUniforms;
@group(0) @binding(1) var displaySolution: texture_2d<f32>;

struct DisplayVertex {
    @builtin(position) position: vec4<f32>,
    // 0 to 1 across and down the gradient box.
    @location(0) uv: vec2<f32>,
}

// One triangle that covers the view.
@vertex
fn freeformDisplayVertex(@builtin(vertex_index) vid: u32) -> DisplayVertex {
    let uv = vec2<f32>(f32((vid << 1u) & 2u), f32(vid & 2u));
    var out: DisplayVertex;
    out.position = vec4<f32>(uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
    out.uv = uv;
    return out;
}

// Interleaved gradient noise, to dither away the banding a smooth gradient
// shows in 8 bits.
fn ditherNoise(position: vec2<f32>) -> f32 {
    return fract(52.9829189 * fract(dot(position, vec2<f32>(0.06711056, 0.00583715))));
}

// A premultiplied color in the interpolation space, taken back to sRGB:
// encoded components, clamped or gamut mapped, and straight alpha. In a
// polar space the hue isn't premultiplied. The conversion is the page's own:
// hueComponent() and toPremultipliedColor(), which the page appends to this
// shader, reading display.space, display.outputIsDisplayP3 and
// display.gamutMapping.
fn toSRGB(premultiplied: vec4<f32>, space: u32) -> vec4<f32> {
    let alpha = saturate(premultiplied.a);
    if (alpha <= 0.0) {
        return vec4<f32>(0.0);
    }
    var color = premultiplied.rgb / alpha;
    let hue = hueComponent(space);
    if (hue >= 0) {
        color[hue] = premultiplied[hue];
    }
    let shown = toPremultipliedColor(vec4<f32>(color, alpha));
    return vec4<f32>(shown.rgb / alpha, alpha);
}

// Filters the solution up to the view, and writes it premultiplied, encoded
// sRGB for a unorm target, dithered.
@fragment
fn freeformDisplayFragment(input: DisplayVertex) -> @location(0) vec4<f32> {
    let size = vec2<f32>(textureDimensions(displaySolution));
    let color = toSRGB(bilinearRead(displaySolution, input.uv * size - 0.5), display.space);
    let encoded = saturate(color.rgb + (ditherNoise(input.position.xy) - 0.5) / 255.0);
    return vec4<f32>(encoded * color.a, color.a);
}

// MARK: - Sharp edges

// A corner of the strips either side of a two-sided line, drawn over the
// solution so the jump from one side's colors to the other's stays sharp
// however the solution is filtered. Must match the vertices
// WebGPUFreeformGradient.js packs from its edge quads.
struct EdgeVertex {
    // Premultiplied, in the interpolation space.
    color: vec4<f32>,
    // The color on the line: halfway between the two sides'.
    edgeColor: vec4<f32>,
    // 0 to 1 across and down the gradient box.
    position: vec2<f32>,
    // How far the corner is from the line, in units of the box's shorter side.
    across: f32,
    // Whether its color is the solution's there, rather than `color`.
    samplesSolution: u32,
}

@group(0) @binding(2) var<storage, read> edgeVertices: array<EdgeVertex>;

struct EdgeFragment {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) edgeColor: vec4<f32>,
    @location(2) across: f32,
}

@vertex
fn freeformEdgeVertex(@builtin(vertex_index) vid: u32) -> EdgeFragment {
    let corner = edgeVertices[vid];
    let size = vec2<f32>(textureDimensions(displaySolution));
    var out: EdgeFragment;
    out.position = vec4<f32>(corner.position * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
    out.color = corner.color;
    if (corner.samplesSolution != 0u) {
        out.color = bilinearRead(displaySolution, corner.position * size - 0.5);
    }
    out.edgeColor = corner.edgeColor;
    out.across = corner.across;
    return out;
}

// The strip's color, blended within half a pixel of the line toward the color
// halfway between the sides, so the edge is antialiased as the strips on
// either side of it meet.
@fragment
fn freeformEdgeFragment(input: EdgeFragment) -> @location(0) vec4<f32> {
    let edge = saturate(2.0 * input.across / max(fwidth(input.across), 1e-7));
    let color = toSRGB(mix(input.edgeColor, input.color, edge), display.space);
    let encoded = saturate(color.rgb + (ditherNoise(input.position.xy) - 0.5) / 255.0);
    return vec4<f32>(encoded * color.a, color.a);
}

// MARK: - Biharmonic multigrid

// The biharmonic's own multigrid, a port of MetalFreeformGradient.metal's: see
// there for the method and why. In short, a level's own equation, where
// texels with w < 1 are free, is
//
//     K x = D x + B x = D c,   D = w / ((1 - w) k),   k = omega / 20,
//
// B the 13-point stencil with mirrored edges, and held texels at their
// colors. The levels below it are Galerkin's, Pᵀ K P / 4, each row's 25
// coefficients and after them whether it is free, its magnitude, its sum and
// whether it is the background; each level is smoothed by Chebyshev steps;
// the coarsest is solved by its inverse; and the finest by conjugate
// gradients, V-cycles their preconditioner.
//
// A level's coefficients are a storage buffer here, slice by slice, rather
// than a texture array: 32-bit float storage textures cannot be read and
// written at once. For the same reason the steps that Metal does in place —
// holding colors, the conjugate gradients' direction and step — write a
// texture of their own instead.

// What every biharmonic kernel is given. Must match what
// WebGPUFreeformGradient.js writes.
struct Biharmonic {
    // The level's size; for a kernel between two levels, the finer's.
    size: vec2<u32>,
    // The coarser level's; a level's own coefficients are written at its own.
    coarseSize: vec2<u32>,
    // The color the coarsest level starts from.
    fill: vec4<f32>,
    // The penalty's damping factor, as the Metal solver's uniforms have it.
    omega: f32,
    // The Chebyshev step.
    stepOmega: f32,
    stepGamma: f32,
    // Which background row, for the background kernels; whether to write K e,
    // for the correction's residual; whether it is alpha, for the scalars.
    flag: u32,
    // How many partial sums there are.
    count: u32,
    padding0: u32,
    padding1: u32,
    padding2: u32,
}

struct ConjugateGradientState {
    // r · z of the last step.
    rz: vec4<f32>,
    alpha: vec4<f32>,
    beta: vec4<f32>,
    // Whether the next step is the first.
    first: u32,
}

@group(0) @binding(20) var<uniform> bh: Biharmonic;
// What a kernel reads: the values or correction a step starts from, and
// whatever else it reads besides.
@group(0) @binding(21) var bX: texture_2d<f32>;
@group(0) @binding(22) var bPrevious: texture_2d<f32>;
@group(0) @binding(23) var bOut: texture_storage_2d<rgba32float, write>;
@group(0) @binding(24) var bColor: texture_2d<f32>;
@group(0) @binding(25) var bWeight: texture_2d<f32>;
@group(0) @binding(26) var bRightHandSide: texture_2d<f32>;
// A level's coefficients, read; the coarser level's, written.
@group(0) @binding(27) var<storage, read> bCoefficients: array<f32>;
@group(0) @binding(28) var<storage, read_write> bCoarseCoefficients: array<f32>;
// The background rows, 25 numbers each, the first a level's below.
@group(0) @binding(29) var<storage, read> bBackground: array<f32>;
@group(0) @binding(30) var bOut2: texture_storage_2d<rgba32float, write>;
// The coarsest level's inverse, n × n, then the scale of each row.
@group(0) @binding(31) var<storage, read_write> bInverse: array<f32>;
@group(0) @binding(32) var<storage, read_write> bPartials: array<vec4<f32>>;
@group(0) @binding(33) var<storage, read_write> bState: ConjugateGradientState;
@group(0) @binding(34) var bY: texture_2d<f32>;
@group(0) @binding(35) var bZ: texture_2d<f32>;

const coefficientFree = 25u;
const coefficientMagnitude = 26u;
const coefficientSum = 27u;
const coefficientBackground = 28u;

var<private> biharmonicOffsets: array<vec2<i32>, 13> = array<vec2<i32>, 13>(
    vec2<i32>(0, 0),
    vec2<i32>(-1, 0), vec2<i32>(1, 0), vec2<i32>(0, -1), vec2<i32>(0, 1),
    vec2<i32>(-1, -1), vec2<i32>(1, -1), vec2<i32>(-1, 1), vec2<i32>(1, 1),
    vec2<i32>(-2, 0), vec2<i32>(2, 0), vec2<i32>(0, -2), vec2<i32>(0, 2));
var<private> biharmonicCoefficients: array<f32, 13> = array<f32, 13>(
    20.0, -8.0, -8.0, -8.0, -8.0, 2.0, 2.0, 2.0, 2.0, 1.0, 1.0, 1.0, 1.0);

fn penalty(w: f32) -> f32 {
    return w / ((1.0 - w) * (bh.omega / 20.0));
}

// The stencil sums to zero, so it is applied to differences from the center.
fn biharmonicStencil(p: vec2<i32>, size: vec2<i32>) -> vec4<f32> {
    let center = textureLoad(bX, p, 0);
    var sum = vec4<f32>(0.0);
    for (var o = 1; o < 13; o++) {
        sum += biharmonicCoefficients[o] * (textureLoad(bX, mirrored(p + biharmonicOffsets[o], size), 0) - center);
    }
    return sum;
}

// The residual of a level's own equation, D c - K x; zero where it is held.
fn ownResidual(p: vec2<i32>, size: vec2<i32>) -> vec4<f32> {
    let w = textureLoad(bWeight, p, 0).r;
    if (w >= 1.0) {
        return vec4<f32>(0.0);
    }
    return penalty(w) * (textureLoad(bColor, p, 0) - textureLoad(bX, p, 0)) - biharmonicStencil(p, size);
}

// K e of the level's own equation, for a correction e.
fn ownProduct(p: vec2<i32>, size: vec2<i32>, w: f32) -> vec4<f32> {
    return penalty(w) * textureLoad(bX, p, 0) + biharmonicStencil(p, size);
}

// The weight fine texel i has from coarse texel I in cell-centred bilinear
// interpolation at exactly twice the resolution, clamped at the edges.
fn prolongWeight(i: i32, I: i32, coarseSize: i32) -> f32 {
    let x = 0.5 * f32(i) - 0.25;
    let base = floor(x);
    let f = x - base;
    let lo = clamp(i32(base), 0, coarseSize - 1);
    let hi = clamp(i32(base) + 1, 0, coarseSize - 1);
    return select(0.0, 1.0 - f, lo == I) + select(0.0, f, hi == I);
}

struct Corners {
    lo: vec2<i32>,
    hi: vec2<i32>,
    f: vec2<f32>,
}

// The coarse texels fine texel p is interpolated from, and their weights.
fn prolongCorners(p: vec2<i32>, coarseSize: vec2<i32>) -> Corners {
    let x = 0.5 * vec2<f32>(p) - 0.25;
    let base = floor(x);
    var c: Corners;
    c.f = x - base;
    c.lo = clamp(vec2<i32>(base), vec2<i32>(0), coarseSize - 1);
    c.hi = clamp(vec2<i32>(base) + 1, vec2<i32>(0), coarseSize - 1);
    return c;
}

// The coarse correction, bY, interpolated by P at fine texel p.
fn prolongRead(p: vec2<i32>) -> vec4<f32> {
    let c = prolongCorners(p, vec2<i32>(textureDimensions(bY)));
    let top = mix(textureLoad(bY, vec2<i32>(c.lo.x, c.lo.y), 0), textureLoad(bY, vec2<i32>(c.hi.x, c.lo.y), 0), c.f.x);
    let bottom = mix(textureLoad(bY, vec2<i32>(c.lo.x, c.hi.y), 0), textureLoad(bY, vec2<i32>(c.hi.x, c.hi.y), 0), c.f.x);
    return mix(top, bottom, c.f.y);
}

fn coefficientSlice(offset: vec2<i32>) -> u32 {
    return u32((offset.y + 2) * 5 + offset.x + 2);
}

// A coefficient of the level's rows, at its size.
fn coefficient(slice: u32, p: vec2<i32>) -> f32 {
    return bCoefficients[(slice * bh.size.y + u32(p.y)) * bh.size.x + u32(p.x)];
}

fn coarseIndex(slice: u32, p: vec2<i32>) -> u32 {
    return (slice * bh.coarseSize.y + u32(p.y)) * bh.coarseSize.x + u32(p.x);
}

fn readCoarse(slice: u32, p: vec2<i32>) -> f32 {
    return bCoarseCoefficients[coarseIndex(slice, p)];
}

fn writeCoarse(slice: u32, p: vec2<i32>, value: f32) {
    bCoarseCoefficients[coarseIndex(slice, p)] = value;
}

// A Galerkin level's row applied to the correction bX at p.
fn galerkinApply(p: vec2<i32>, size: vec2<i32>) -> vec4<f32> {
    let center = textureLoad(bX, p, 0);
    var sum = coefficient(coefficientSum, p) * center;
    for (var dy = -2; dy <= 2; dy++) {
        for (var dx = -2; dx <= 2; dx++) {
            let q = p + vec2<i32>(dx, dy);
            if ((dx == 0 && dy == 0) || any(q < vec2<i32>(0)) || any(q >= size)) {
                continue;
            }
            let c = coefficient(coefficientSlice(vec2<i32>(dx, dy)), p);
            if (c != 0.0) {
                sum += c * (textureLoad(bX, q, 0) - center);
            }
        }
    }
    return sum;
}

// Writes a row of the coarser level's coefficients, with its diagonal made to
// give the row the sum gathered apart; or the identity where nothing was
// gathered.
fn writeCoefficients(p: vec2<i32>, row: ptr<function, array<f32, 25>>, rowSum: f32, background: bool) {
    writeCoarse(coefficientBackground, p, select(0.0, 1.0, background));
    let free = (*row)[12] > 0.0;
    if (free) {
        var offDiagonal = 0.0;
        for (var o = 0; o < 25; o++) {
            offDiagonal += select((*row)[o], 0.0, o == 12);
        }
        (*row)[12] = rowSum - offDiagonal;
    }
    var magnitude = 0.0;
    for (var o = 0; o < 25; o++) {
        let c = select(select(0.0, 1.0, o == 12), (*row)[o], free);
        magnitude += abs(c);
        writeCoarse(u32(o), p, c);
    }
    writeCoarse(coefficientFree, p, select(0.0, 1.0, free));
    writeCoarse(coefficientMagnitude, p, magnitude);
    writeCoarse(coefficientSum, p, select(1.0, rowSum, free));
}

// A level's own equation as coefficients, for when it is the coarsest, at its
// own size: held texels are the identity, and the free ones do not reach them.
@compute @workgroup_size(8, 8)
fn bhOwnCoefficients(@builtin(global_invocation_id) id: vec3<u32>) {
    if (any(id.xy >= bh.size)) {
        return;
    }
    let size = vec2<i32>(bh.size);
    let p = vec2<i32>(id.xy);
    var row: array<f32, 25>;
    var rowSum = 0.0;
    let w = textureLoad(bWeight, p, 0).r;
    if (w < 1.0) {
        row[12] = penalty(w);
        rowSum = row[12];
        for (var o = 0; o < 13; o++) {
            let j = mirrored(p + biharmonicOffsets[o], size);
            if (textureLoad(bWeight, j, 0).r < 1.0) {
                row[coefficientSlice(j - p)] += biharmonicCoefficients[o];
            } else {
                rowSum -= biharmonicCoefficients[o];
            }
        }
    }
    writeCoefficients(p, &row, rowSum, false);
}

fn backgroundRow(index: u32) -> array<f32, 25> {
    var row: array<f32, 25>;
    for (var o = 0u; o < 25u; o++) {
        row[o] = bBackground[index * 25u + o];
    }
    return row;
}

// Which rows of the Galerkin level below a level's own equation are the
// background, written as such.
@compute @workgroup_size(8, 8)
fn bhBackgroundFromOwn(@builtin(global_invocation_id) id: vec3<u32>) {
    if (any(id.xy >= bh.coarseSize)) {
        return;
    }
    let size = vec2<i32>(bh.size);
    let I = vec2<i32>(id.xy);
    var background = all(2 * I - 3 >= vec2<i32>(0)) && all(2 * I + 4 < size);
    for (var fy = 2 * I.y - 3; background && fy <= 2 * I.y + 4; fy++) {
        for (var fx = 2 * I.x - 3; fx <= 2 * I.x + 4; fx++) {
            background = background && textureLoad(bWeight, vec2<i32>(fx, fy), 0).r == 0.0;
        }
    }
    if (background) {
        var row = backgroundRow(bh.flag);
        writeCoefficients(I, &row, 0.0, true);
    } else {
        writeCoarse(coefficientBackground, I, 0.0);
    }
}

// As bhBackgroundFromOwn, below a Galerkin level.
@compute @workgroup_size(8, 8)
fn bhBackgroundFromGalerkin(@builtin(global_invocation_id) id: vec3<u32>) {
    if (any(id.xy >= bh.coarseSize)) {
        return;
    }
    let size = vec2<i32>(bh.size);
    let I = vec2<i32>(id.xy);
    var background = all(2 * I - 3 >= vec2<i32>(0)) && all(2 * I + 4 < size);
    for (var fy = 2 * I.y - 3; background && fy <= 2 * I.y + 4; fy++) {
        for (var fx = 2 * I.x - 3; fx <= 2 * I.x + 4; fx++) {
            background = background && coefficient(coefficientBackground, vec2<i32>(fx, fy)) != 0.0;
        }
    }
    if (background) {
        var row = backgroundRow(bh.flag);
        writeCoefficients(I, &row, 0.0, true);
    } else {
        writeCoarse(coefficientBackground, I, 0.0);
    }
}

// The fine texels P interpolates from coarse texel I, in one dimension.
fn prolongRange(I: i32, size: i32) -> vec2<i32> {
    return vec2<i32>(max(2 * I - 1, 0), min(2 * I + 2, size - 1));
}

// K(i, j) of a level's own equation, between two texels P keeps.
fn ownEntry(i: vec2<i32>, j: vec2<i32>, size: vec2<i32>, d: f32) -> f32 {
    let s = j - i;
    if (any(abs(s) > vec2<i32>(2))) {
        return 0.0;
    }
    let nearEdge = any(i < vec2<i32>(2)) || any(i + 2 >= size);
    if (!nearEdge) {
        let a = abs(s.x) + abs(s.y);
        var c = 0.0;
        if (a == 0) {
            c = 20.0;
        } else if (a == 1) {
            c = -8.0;
        } else if (a == 2) {
            c = select(1.0, 2.0, abs(s.x) == 1);
        }
        return c + select(0.0, d, a == 0);
    }
    var c = select(0.0, d, all(s == vec2<i32>(0)));
    for (var o = 0; o < 13; o++) {
        if (all(mirrored(i + biharmonicOffsets[o], size) == j)) {
            c += biharmonicCoefficients[o];
        }
    }
    return c;
}

// The Galerkin levels' entries, a thread each: the diagonal and those after it.
@compute @workgroup_size(8, 8, 1)
fn bhEntriesFromOwn(@builtin(global_invocation_id) id: vec3<u32>) {
    let I = vec2<i32>(id.xy);
    if (any(id.xy >= bh.coarseSize) || readCoarse(coefficientBackground, I) != 0.0) {
        return;
    }
    let size = vec2<i32>(bh.size);
    let coarse = vec2<i32>(bh.coarseSize);
    let slice = 12u + id.z;
    let J = I + vec2<i32>(i32(slice) % 5 - 2, i32(slice) / 5 - 2);
    var sum = 0.0;
    if (all(J >= vec2<i32>(0)) && all(J < coarse)) {
        let rangeX = prolongRange(I.x, size.x);
        let rangeY = prolongRange(I.y, size.y);
        let rangeJX = prolongRange(J.x, size.x);
        let rangeJY = prolongRange(J.y, size.y);
        for (var iy = rangeY.x; iy <= rangeY.y; iy++) {
            for (var ix = rangeX.x; ix <= rangeX.y; ix++) {
                let pi = prolongWeight(ix, I.x, coarse.x) * prolongWeight(iy, I.y, coarse.y);
                let wi = textureLoad(bWeight, vec2<i32>(ix, iy), 0).r;
                if (pi == 0.0 || wi >= 0.5) {
                    continue;
                }
                let d = penalty(wi);
                for (var jy = max(rangeJY.x, iy - 2); jy <= min(rangeJY.y, iy + 2); jy++) {
                    for (var jx = max(rangeJX.x, ix - 2); jx <= min(rangeJX.y, ix + 2); jx++) {
                        let pj = prolongWeight(jx, J.x, coarse.x) * prolongWeight(jy, J.y, coarse.y);
                        if (pj == 0.0 || textureLoad(bWeight, vec2<i32>(jx, jy), 0).r >= 0.5) {
                            continue;
                        }
                        sum += pi * ownEntry(vec2<i32>(ix, iy), vec2<i32>(jx, jy), size, d) * pj;
                    }
                }
            }
        }
    }
    writeCoarse(slice, I, 0.25 * sum);
}

@compute @workgroup_size(8, 8, 1)
fn bhEntriesFromGalerkin(@builtin(global_invocation_id) id: vec3<u32>) {
    let I = vec2<i32>(id.xy);
    if (any(id.xy >= bh.coarseSize) || readCoarse(coefficientBackground, I) != 0.0) {
        return;
    }
    let size = vec2<i32>(bh.size);
    let coarse = vec2<i32>(bh.coarseSize);
    let slice = 12u + id.z;
    let J = I + vec2<i32>(i32(slice) % 5 - 2, i32(slice) / 5 - 2);
    var sum = 0.0;
    if (all(J >= vec2<i32>(0)) && all(J < coarse)) {
        let rangeX = prolongRange(I.x, size.x);
        let rangeY = prolongRange(I.y, size.y);
        let rangeJX = prolongRange(J.x, size.x);
        let rangeJY = prolongRange(J.y, size.y);
        for (var iy = rangeY.x; iy <= rangeY.y; iy++) {
            for (var ix = rangeX.x; ix <= rangeX.y; ix++) {
                let pi = prolongWeight(ix, I.x, coarse.x) * prolongWeight(iy, I.y, coarse.y);
                // Identity rows are left out of P; their columns are zero.
                if (pi == 0.0 || coefficient(coefficientFree, vec2<i32>(ix, iy)) == 0.0) {
                    continue;
                }
                for (var jy = max(rangeJY.x, iy - 2); jy <= min(rangeJY.y, iy + 2); jy++) {
                    for (var jx = max(rangeJX.x, ix - 2); jx <= min(rangeJX.y, ix + 2); jx++) {
                        let pj = prolongWeight(jx, J.x, coarse.x) * prolongWeight(jy, J.y, coarse.y);
                        if (pj != 0.0) {
                            sum += pi * coefficient(coefficientSlice(vec2<i32>(jx - ix, jy - iy)), vec2<i32>(ix, iy)) * pj;
                        }
                    }
                }
            }
        }
    }
    writeCoarse(slice, I, 0.25 * sum);
}

// A row's entries before its diagonal, from its neighbors' after theirs, and
// its sum and the rest.
fn finishRow(I: vec2<i32>, rowSum: f32) {
    let size = vec2<i32>(bh.coarseSize);
    var row: array<f32, 25>;
    for (var o = 0; o < 12; o++) {
        let neighbor = I + vec2<i32>(o % 5 - 2, o / 5 - 2);
        if (all(neighbor >= vec2<i32>(0)) && all(neighbor < size)) {
            row[o] = readCoarse(u32(24 - o), neighbor);
        }
    }
    for (var o = 12; o < 25; o++) {
        row[o] = readCoarse(u32(o), I);
    }
    let free = row[12] > 0.0;
    var offDiagonal = 0.0;
    for (var o = 0; o < 25; o++) {
        offDiagonal += select(row[o], 0.0, o == 12);
    }
    let diagonal = select(1.0, rowSum - offDiagonal, free);
    var magnitude = abs(diagonal);
    for (var o = 0; o < 25; o++) {
        magnitude += select(0.0, abs(row[o]), free && o != 12);
    }
    for (var o = 0; o < 12; o++) {
        writeCoarse(u32(o), I, select(0.0, row[o], free));
    }
    writeCoarse(12u, I, diagonal);
    writeCoarse(coefficientFree, I, select(0.0, 1.0, free));
    writeCoarse(coefficientMagnitude, I, magnitude);
    writeCoarse(coefficientSum, I, select(1.0, rowSum, free));
}

@compute @workgroup_size(8, 8)
fn bhRowsFromOwn(@builtin(global_invocation_id) id: vec3<u32>) {
    let I = vec2<i32>(id.xy);
    if (any(id.xy >= bh.coarseSize) || readCoarse(coefficientBackground, I) != 0.0) {
        return;
    }
    let size = vec2<i32>(bh.size);
    let coarse = vec2<i32>(bh.coarseSize);
    let rangeX = prolongRange(I.x, size.x);
    let rangeY = prolongRange(I.y, size.y);
    var rowSum = 0.0;
    for (var iy = rangeY.x; iy <= rangeY.y; iy++) {
        for (var ix = rangeX.x; ix <= rangeX.y; ix++) {
            let pi = prolongWeight(ix, I.x, coarse.x) * prolongWeight(iy, I.y, coarse.y);
            let i = vec2<i32>(ix, iy);
            let wi = textureLoad(bWeight, i, 0).r;
            if (pi == 0.0 || wi >= 0.5) {
                continue;
            }
            var iSum = penalty(wi);
            for (var o = 0; o < 13; o++) {
                if (textureLoad(bWeight, mirrored(i + biharmonicOffsets[o], size), 0).r >= 0.5) {
                    iSum -= biharmonicCoefficients[o];
                }
            }
            rowSum += pi * iSum;
        }
    }
    finishRow(I, 0.25 * rowSum);
}

@compute @workgroup_size(8, 8)
fn bhRowsFromGalerkin(@builtin(global_invocation_id) id: vec3<u32>) {
    let I = vec2<i32>(id.xy);
    if (any(id.xy >= bh.coarseSize) || readCoarse(coefficientBackground, I) != 0.0) {
        return;
    }
    let size = vec2<i32>(bh.size);
    let coarse = vec2<i32>(bh.coarseSize);
    let rangeX = prolongRange(I.x, size.x);
    let rangeY = prolongRange(I.y, size.y);
    var rowSum = 0.0;
    for (var iy = rangeY.x; iy <= rangeY.y; iy++) {
        for (var ix = rangeX.x; ix <= rangeX.y; ix++) {
            let pi = prolongWeight(ix, I.x, coarse.x) * prolongWeight(iy, I.y, coarse.y);
            if (pi != 0.0 && coefficient(coefficientFree, vec2<i32>(ix, iy)) != 0.0) {
                rowSum += pi * coefficient(coefficientSum, vec2<i32>(ix, iy));
            }
        }
    }
    finishRow(I, 0.25 * rowSum);
}

// One Chebyshev step of a level's own equation, held texels at their colors.
@compute @workgroup_size(8, 8)
fn bhChebyshevOwn(@builtin(global_invocation_id) id: vec3<u32>) {
    if (any(id.xy >= bh.size)) {
        return;
    }
    let p = vec2<i32>(id.xy);
    let w = textureLoad(bWeight, p, 0).r;
    if (w >= 1.0) {
        textureStore(bOut, id.xy, textureLoad(bColor, p, 0));
        return;
    }
    let r = ownResidual(p, vec2<i32>(bh.size));
    let center = textureLoad(bX, p, 0);
    let last = textureLoad(bPrevious, p, 0);
    textureStore(bOut, id.xy, last + bh.stepOmega * (bh.stepGamma * r / (penalty(w) + 64.0) + center - last));
}

// One Chebyshev step of a Galerkin level's correction toward its right-hand side.
@compute @workgroup_size(8, 8)
fn bhChebyshevGalerkin(@builtin(global_invocation_id) id: vec3<u32>) {
    if (any(id.xy >= bh.size)) {
        return;
    }
    let p = vec2<i32>(id.xy);
    let r = textureLoad(bRightHandSide, p, 0) - galerkinApply(p, vec2<i32>(bh.size));
    let magnitude = coefficient(coefficientMagnitude, p);
    let center = textureLoad(bX, p, 0);
    let last = textureLoad(bPrevious, p, 0);
    textureStore(bOut, id.xy, last + bh.stepOmega * (bh.stepGamma * r / magnitude + center - last));
}

@compute @workgroup_size(8, 8)
fn bhResidualOwn(@builtin(global_invocation_id) id: vec3<u32>) {
    if (any(id.xy >= bh.size)) {
        return;
    }
    textureStore(bOut, id.xy, ownResidual(vec2<i32>(id.xy), vec2<i32>(bh.size)));
}

@compute @workgroup_size(8, 8)
fn bhResidualGalerkin(@builtin(global_invocation_id) id: vec3<u32>) {
    if (any(id.xy >= bh.size)) {
        return;
    }
    let p = vec2<i32>(id.xy);
    textureStore(bOut, id.xy, textureLoad(bRightHandSide, p, 0) - galerkinApply(p, vec2<i32>(bh.size)));
}

// A residual, bX, restricted by Pᵀ / 4 as the right-hand side of the
// correction below, bOut, and that correction, bOut2, started at zero; the
// fine texels held at least half left out.
@compute @workgroup_size(8, 8)
fn bhRestrictOwn(@builtin(global_invocation_id) id: vec3<u32>) {
    if (any(id.xy >= bh.coarseSize)) {
        return;
    }
    let size = vec2<i32>(bh.size);
    let coarse = vec2<i32>(bh.coarseSize);
    let I = vec2<i32>(id.xy);
    var sum = vec4<f32>(0.0);
    for (var fy = 2 * I.y - 1; fy <= 2 * I.y + 2; fy++) {
        var wy = 0.0;
        if (fy >= 0 && fy < size.y) {
            wy = prolongWeight(fy, I.y, coarse.y);
        }
        if (wy == 0.0) {
            continue;
        }
        for (var fx = 2 * I.x - 1; fx <= 2 * I.x + 2; fx++) {
            var wx = 0.0;
            if (fx >= 0 && fx < size.x) {
                wx = prolongWeight(fx, I.x, coarse.x);
            }
            let i = vec2<i32>(fx, fy);
            if (wx == 0.0 || textureLoad(bWeight, i, 0).r >= 0.5) {
                continue;
            }
            sum += wx * wy * textureLoad(bX, i, 0);
        }
    }
    textureStore(bOut, id.xy, 0.25 * sum);
    textureStore(bOut2, id.xy, vec4<f32>(0.0));
}

// As bhRestrictOwn, below a Galerkin level: its identity rows left out.
@compute @workgroup_size(8, 8)
fn bhRestrictGalerkin(@builtin(global_invocation_id) id: vec3<u32>) {
    if (any(id.xy >= bh.coarseSize)) {
        return;
    }
    let size = vec2<i32>(bh.size);
    let coarse = vec2<i32>(bh.coarseSize);
    let I = vec2<i32>(id.xy);
    var sum = vec4<f32>(0.0);
    for (var fy = 2 * I.y - 1; fy <= 2 * I.y + 2; fy++) {
        var wy = 0.0;
        if (fy >= 0 && fy < size.y) {
            wy = prolongWeight(fy, I.y, coarse.y);
        }
        if (wy == 0.0) {
            continue;
        }
        for (var fx = 2 * I.x - 1; fx <= 2 * I.x + 2; fx++) {
            var wx = 0.0;
            if (fx >= 0 && fx < size.x) {
                wx = prolongWeight(fx, I.x, coarse.x);
            }
            let i = vec2<i32>(fx, fy);
            if (wx == 0.0 || coefficient(coefficientFree, i) == 0.0) {
                continue;
            }
            sum += wx * wy * textureLoad(bX, i, 0);
        }
    }
    textureStore(bOut, id.xy, 0.25 * sum);
    textureStore(bOut2, id.xy, vec4<f32>(0.0));
}

// Adds the correction from the level below, bY, interpolated by P, except
// where a texel is held at least half.
@compute @workgroup_size(8, 8)
fn bhCorrectOwn(@builtin(global_invocation_id) id: vec3<u32>) {
    if (any(id.xy >= bh.size)) {
        return;
    }
    let p = vec2<i32>(id.xy);
    var correction = vec4<f32>(0.0);
    if (textureLoad(bWeight, p, 0).r < 0.5) {
        correction = prolongRead(p);
    }
    textureStore(bOut, id.xy, textureLoad(bX, p, 0) + correction);
}

@compute @workgroup_size(8, 8)
fn bhCorrectGalerkin(@builtin(global_invocation_id) id: vec3<u32>) {
    if (any(id.xy >= bh.size)) {
        return;
    }
    let p = vec2<i32>(id.xy);
    var correction = vec4<f32>(0.0);
    if (coefficient(coefficientFree, p) != 0.0) {
        correction = prolongRead(p);
    }
    textureStore(bOut, id.xy, textureLoad(bX, p, 0) + correction);
}

// The coarsest level's matrix, inverted by Gauss–Jordan elimination, without
// pivoting, since it is symmetric positive definite. One workgroup, each
// thread keeping the same entries throughout, every 256th; the result the
// same whatever the number of threads.
const coarsestTexels = 64;
const inverseThreads = 256;
const inversePerThread = 16;

var<workgroup> inverseMatrix: array<f32, 4096>;

@compute @workgroup_size(256)
fn bhCoarsestInverse(@builtin(local_invocation_index) lane: u32) {
    let width = i32(bh.size.x);
    let n = width * i32(bh.size.y);
    let scales = u32(coarsestTexels * coarsestTexels);

    for (var t = 0; t < inversePerThread; t++) {
        let e = i32(lane) + inverseThreads * t;
        let i = e / coarsestTexels;
        let j = e % coarsestTexels;
        if (i < n && j < n) {
            let p = vec2<i32>(i % width, i / width);
            let offset = vec2<i32>(j % width, j / width) - p;
            var value = 0.0;
            if (all(abs(offset) <= vec2<i32>(2))) {
                value = coefficient(coefficientSlice(offset), p);
            }
            inverseMatrix[i * coarsestTexels + j] = value;
        }
    }
    workgroupBarrier();
    if (i32(lane) < n) {
        bInverse[scales + lane] = inverseSqrt(inverseMatrix[i32(lane) * coarsestTexels + i32(lane)]);
    }
    storageBarrier();
    workgroupBarrier();

    // Scaled by its diagonal on both sides first: rows held to a point by a
    // penalty can be ten million times the others, more than 32 bits hold.
    for (var t = 0; t < inversePerThread; t++) {
        let e = i32(lane) + inverseThreads * t;
        let i = e / coarsestTexels;
        let j = e % coarsestTexels;
        if (i < n && j < n) {
            inverseMatrix[i * coarsestTexels + j] *= bInverse[scales + u32(i)] * bInverse[scales + u32(j)];
        }
    }
    workgroupBarrier();

    for (var k = 0; k < n; k++) {
        let reciprocal = 1.0 / inverseMatrix[k * coarsestTexels + k];
        var values: array<f32, inversePerThread>;
        for (var t = 0; t < inversePerThread; t++) {
            let e = i32(lane) + inverseThreads * t;
            let i = e / coarsestTexels;
            let j = e % coarsestTexels;
            values[t] = 0.0;
            if (i < n && j < n) {
                let factor = inverseMatrix[i * coarsestTexels + k];
                let pivotEntry = inverseMatrix[k * coarsestTexels + j];
                if (i == k) {
                    values[t] = select(pivotEntry * reciprocal, reciprocal, j == k);
                } else {
                    values[t] = select(inverseMatrix[i * coarsestTexels + j] - factor * pivotEntry * reciprocal,
                                       -factor * reciprocal, j == k);
                }
            }
        }
        workgroupBarrier();
        for (var t = 0; t < inversePerThread; t++) {
            let e = i32(lane) + inverseThreads * t;
            let i = e / coarsestTexels;
            let j = e % coarsestTexels;
            if (i < n && j < n) {
                inverseMatrix[i * coarsestTexels + j] = values[t];
            }
        }
        workgroupBarrier();
    }

    for (var t = 0; t < inversePerThread; t++) {
        let e = i32(lane) + inverseThreads * t;
        let i = e / coarsestTexels;
        let j = e % coarsestTexels;
        if (i < n && j < n) {
            bInverse[i * n + j] = inverseMatrix[i * coarsestTexels + j] * bInverse[scales + u32(i)] * bInverse[scales + u32(j)];
        }
    }
}

var<workgroup> coarsestValues: array<vec4<f32>, 64>;

// The coarsest correction, solved outright: x = K⁻¹ b. A thread a texel.
@compute @workgroup_size(8, 8)
fn bhCoarsestSolve(@builtin(local_invocation_id) lid: vec3<u32>) {
    let size = vec2<i32>(bh.size);
    let g = vec2<i32>(lid.xy);
    let n = size.x * size.y;
    let inside = all(g < size);
    let row = g.y * size.x + g.x;
    if (inside) {
        coarsestValues[row] = textureLoad(bRightHandSide, g, 0);
    }
    workgroupBarrier();
    if (!inside) {
        return;
    }
    var sum = vec4<f32>(0.0);
    for (var column = 0; column < n; column++) {
        sum += bInverse[row * n + column] * coarsestValues[column];
    }
    textureStore(bOut, lid.xy, sum);
}

// The coarsest level's own equation solved outright, from x: x + K⁻¹ r.
@compute @workgroup_size(8, 8)
fn bhCoarsestSolveOwn(@builtin(local_invocation_id) lid: vec3<u32>) {
    let size = vec2<i32>(bh.size);
    let g = vec2<i32>(lid.xy);
    let n = size.x * size.y;
    let inside = all(g < size);
    let row = g.y * size.x + g.x;
    if (inside) {
        coarsestValues[row] = ownResidual(g, size);
    }
    workgroupBarrier();
    if (!inside) {
        return;
    }
    var sum = vec4<f32>(0.0);
    for (var column = 0; column < n; column++) {
        sum += bInverse[row * n + column] * coarsestValues[column];
    }
    let w = textureLoad(bWeight, g, 0).r;
    textureStore(bOut, lid.xy, select(textureLoad(bX, g, 0) + sum, textureLoad(bColor, g, 0), w >= 1.0));
}

// One Chebyshev step of a correction e, bX, of the level's own equation
// toward K e = b, held texels at zero.
@compute @workgroup_size(8, 8)
fn bhChebyshevOwnCorrection(@builtin(global_invocation_id) id: vec3<u32>) {
    if (any(id.xy >= bh.size)) {
        return;
    }
    let p = vec2<i32>(id.xy);
    let w = textureLoad(bWeight, p, 0).r;
    if (w >= 1.0) {
        textureStore(bOut, id.xy, vec4<f32>(0.0));
        return;
    }
    let r = textureLoad(bRightHandSide, p, 0) - ownProduct(p, vec2<i32>(bh.size), w);
    let center = textureLoad(bX, p, 0);
    let last = textureLoad(bPrevious, p, 0);
    textureStore(bOut, id.xy, last + bh.stepOmega * (bh.stepGamma * r / (penalty(w) + 64.0) + center - last));
}

// b - K e, or with the flag, K e; zero where held.
@compute @workgroup_size(8, 8)
fn bhResidualOwnCorrection(@builtin(global_invocation_id) id: vec3<u32>) {
    if (any(id.xy >= bh.size)) {
        return;
    }
    let p = vec2<i32>(id.xy);
    let w = textureLoad(bWeight, p, 0).r;
    if (w >= 1.0) {
        textureStore(bOut, id.xy, vec4<f32>(0.0));
        return;
    }
    let ke = ownProduct(p, vec2<i32>(bh.size), w);
    if (bh.flag != 0u) {
        textureStore(bOut, id.xy, ke);
    } else {
        textureStore(bOut, id.xy, textureLoad(bRightHandSide, p, 0) - ke);
    }
}

@compute @workgroup_size(8, 8)
fn bhClear(@builtin(global_invocation_id) id: vec3<u32>) {
    if (any(id.xy >= bh.size)) {
        return;
    }
    textureStore(bOut, id.xy, vec4<f32>(0.0));
}

var<workgroup> dotSums: array<vec4<f32>, 256>;

// bX · bY over each workgroup of 16×16 texels, one sum a channel.
@compute @workgroup_size(16, 16)
fn bhDot(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) lane: u32,
         @builtin(workgroup_id) group: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
    let inside = all(gid.xy < textureDimensions(bX));
    var product = vec4<f32>(0.0);
    if (inside) {
        product = textureLoad(bX, gid.xy, 0) * textureLoad(bY, gid.xy, 0);
    }
    dotSums[lane] = product;
    workgroupBarrier();
    for (var stride = 128u; stride > 0u; stride /= 2u) {
        if (lane < stride) {
            dotSums[lane] += dotSums[lane + stride];
        }
        workgroupBarrier();
    }
    if (lane == 0u) {
        bPartials[group.y * groups.x + group.x] = dotSums[0];
    }
}

// The partial sums added up, and from them: without the flag, r · z, and
// beta, the ratio to the last r · z, zero on the first step; with it, alpha,
// r · z over p · K p.
@compute @workgroup_size(256)
fn bhScalars(@builtin(local_invocation_index) lane: u32) {
    var sum = vec4<f32>(0.0);
    for (var i = lane; i < bh.count; i += 256u) {
        sum += bPartials[i];
    }
    dotSums[lane] = sum;
    workgroupBarrier();
    for (var stride = 128u; stride > 0u; stride /= 2u) {
        if (lane < stride) {
            dotSums[lane] += dotSums[lane + stride];
        }
        workgroupBarrier();
    }
    if (lane != 0u) {
        return;
    }
    let total = dotSums[0];
    // A channel with nothing left to solve — alpha, say, which is 1
    // everywhere — has sums of zero, and takes no step.
    if (bh.flag != 0u) {
        bState.alpha = select(vec4<f32>(0.0), bState.rz / total, total > vec4<f32>(1e-30));
    } else {
        let beta = select(vec4<f32>(0.0), total / bState.rz, bState.rz > vec4<f32>(1e-30));
        bState.beta = select(beta, vec4<f32>(0.0), bState.first != 0u);
        bState.rz = total;
        bState.first = 0u;
    }
}

@compute @workgroup_size(1)
fn bhReset() {
    bState.rz = vec4<f32>(0.0);
    bState.alpha = vec4<f32>(0.0);
    bState.beta = vec4<f32>(0.0);
    bState.first = 1u;
}

// The held texels at their colors: from the last solution, a point or line
// that moved holds texels the solution has other colors in.
@compute @workgroup_size(8, 8)
fn bhHoldColors(@builtin(global_invocation_id) id: vec3<u32>) {
    if (any(id.xy >= bh.size)) {
        return;
    }
    let p = vec2<i32>(id.xy);
    textureStore(bOut, id.xy, select(textureLoad(bX, p, 0), textureLoad(bColor, p, 0), textureLoad(bWeight, p, 0).r >= 1.0));
}

// p = z + beta p: z bX, the last p bY.
@compute @workgroup_size(8, 8)
fn bhDirection(@builtin(global_invocation_id) id: vec3<u32>) {
    if (any(id.xy >= bh.size)) {
        return;
    }
    // On the first step beta is zero, and p holds whatever it did, perhaps
    // not a number, which zero times would keep.
    let direction = textureLoad(bX, id.xy, 0);
    let beta = bState.beta;
    textureStore(bOut, id.xy, select(direction + beta * textureLoad(bY, id.xy, 0), direction, beta == vec4<f32>(0.0)));
}

// x += alpha p, r -= alpha K p: p bX, K p bY, x bZ and r bRightHandSide, the
// new ones bOut and bOut2.
@compute @workgroup_size(8, 8)
fn bhStep(@builtin(global_invocation_id) id: vec3<u32>) {
    if (any(id.xy >= bh.size)) {
        return;
    }
    let alpha = bState.alpha;
    textureStore(bOut, id.xy, textureLoad(bZ, id.xy, 0) + alpha * textureLoad(bX, id.xy, 0));
    textureStore(bOut2, id.xy, textureLoad(bRightHandSide, id.xy, 0) - alpha * textureLoad(bY, id.xy, 0));
}

// Starts a level from the one below, bY, as freeformProlong does, with its
// held texels at their colors.
@compute @workgroup_size(8, 8)
fn bhProlongHeld(@builtin(global_invocation_id) id: vec3<u32>) {
    if (any(id.xy >= bh.size)) {
        return;
    }
    let p = vec2<i32>(id.xy);
    let coarseSize = vec2<f32>(textureDimensions(bY));
    let position = (vec2<f32>(id.xy) + 0.5) * coarseSize / vec2<f32>(bh.size) - 0.5;
    textureStore(bOut, id.xy, select(bilinearRead(bY, position), textureLoad(bColor, p, 0), textureLoad(bWeight, p, 0).r >= 1.0));
}

// Starts the coarsest level from one color, with its held texels at theirs.
@compute @workgroup_size(8, 8)
fn bhFillHeld(@builtin(global_invocation_id) id: vec3<u32>) {
    if (any(id.xy >= bh.size)) {
        return;
    }
    let p = vec2<i32>(id.xy);
    textureStore(bOut, id.xy, select(bh.fill, textureLoad(bColor, p, 0), textureLoad(bWeight, p, 0).r >= 1.0));
}
