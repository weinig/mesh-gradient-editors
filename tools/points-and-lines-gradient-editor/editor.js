"use strict";

__COLORS__

// MARK: - Renderer

// MeshShader2's WebGPU freeform gradient renderer: its constraint rasterizer, harmonic and biharmonic multigrids,
// with its points and one-sided lines. See tools/diffusion-gradient-editor/vendor/README.md.
__RENDERER__

const SHADER = __SHADER__;

// MARK: - State

// Stops hold colors: on their own as points, or along lines. A stop's position is a fraction of the box, 0 to 1
// across and down; its opacity and spread are percentages. A line is the stops it runs through, in order, by index,
// and a stop at a line's end may also end another, joining them.
let state = null;

const stop = (x, y, color, spread = 0, opacity = 100) => ({ p: [x, y], color, opacity, spread });

// A stop of each color in a ring around (cx, cy), going clockwise from the top. The radius is a fraction of the box,
// so the ring is round only in a square box.
function ring(cx, cy, r, colors) {
    return colors.map((color, i) => {
        const angle = -Math.PI / 2 + 2 * Math.PI * i / colors.length;
        return stop(cx + r * Math.cos(angle), cy + r * Math.sin(angle), color);
    });
}

const PRESETS = [
    {
        name: "Four points",
        note: "Four points, one toward each corner. Out past them, toward the box's edges, the biharmonic model keeps going and the corners come out deeper than any stop. The harmonic model never leaves the stops' colors, but rings each point.",
        state: {
            width: 600, height: 400,
            stops: [stop(0.2, 0.25, "#ff5f6d"), stop(0.8, 0.22, "#ffc371"), stop(0.25, 0.78, "#2193b0"), stop(0.78, 0.75, "#6dd5ed")],
            lines: [],
        },
    },
    {
        name: "A line",
        note: "Four stops along a line, which curves through them. The color runs along the line from stop to stop, and spreads out from it to either side, the same both ways.",
        state: {
            width: 600, height: 400,
            stops: [stop(0.12, 0.7, "#2b5876"), stop(0.38, 0.3, "#f7b733"), stop(0.62, 0.68, "#fc4a1a"), stop(0.88, 0.3, "#4e4376")],
            lines: [{ stops: [0, 1, 2, 3], closed: false }],
        },
    },
    {
        name: "A highlight on a sphere",
        note: "A blue point with a wide spread, dark points in the corners, and a short line of light along the top left, as a highlight.",
        state: {
            width: 500, height: 500,
            stops: [
                stop(0.5, 0.5, "#1f6fd1", 30), stop(0.08, 0.1, "#0b1f4a"), stop(0.92, 0.12, "#0b1f4a"),
                stop(0.1, 0.9, "#0b1f4a"), stop(0.9, 0.9, "#0b1f4a"),
                stop(0.3, 0.42, "#ffffff"), stop(0.36, 0.3, "#d7ecff"), stop(0.48, 0.24, "#9cc8ff"),
            ],
            lines: [{ stops: [5, 6, 7], closed: false }],
        },
    },
    {
        name: "Two stops close together",
        note: "A black and a white point a short way apart. The biharmonic model carries the steep slope between them out past each one, darker than black beyond the black and brighter than white beyond the white: try Where it leaves sRGB, or a cross-section through both. The harmonic model stays between them.",
        state: {
            width: 600, height: 400,
            stops: [stop(0.45, 0.5, "#000000"), stop(0.55, 0.5, "#ffffff"), stop(0.1, 0.15, "#808080"), stop(0.9, 0.85, "#808080")],
            lines: [],
        },
    },
    {
        name: "Spread",
        note: "The same two colors, with no spread on the left and 60% on the right. Spread holds a stop's color across a disc, the dashed circle when it's selected, so the color is flat out to there before it starts to blend.",
        state: {
            width: 600, height: 400,
            stops: [
                stop(0.25, 0.3, "#e63946"), stop(0.25, 0.72, "#457b9d"),
                stop(0.75, 0.3, "#e63946", 60), stop(0.75, 0.72, "#457b9d", 60),
            ],
            lines: [],
        },
    },
    {
        name: "Opacity",
        note: "Points that fade out: opacity is blended along with the color, premultiplied, so a color fades without going gray or dark on its way to transparent.",
        state: {
            width: 600, height: 400,
            stops: [
                stop(0.15, 0.5, "#ff006e"), stop(0.5, 0.2, "#3a86ff"), stop(0.85, 0.5, "#ffbe0b"),
                stop(0.5, 0.8, "#3a86ff", 0, 0), stop(0.5, 0.5, "#ffffff", 0, 0),
            ],
            lines: [],
        },
    },
    {
        name: "A color wheel",
        note: "A closed line of six stops around a white point. Along the ring the color runs from hue to hue; inside, the line's colors blend into the white.",
        state: {
            width: 500, height: 500,
            stops: [
                ...ring(0.5, 0.5, 0.36, ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff"]),
                stop(0.5, 0.5, "#ffffff"),
            ],
            lines: [{ stops: [0, 1, 2, 3, 4, 5], closed: true }],
        },
    },
    {
        name: "Joined lines",
        note: "Three lines that meet at one stop. A stop at the end of one line can start another, so lines join without a gap in their color.",
        state: {
            width: 600, height: 400,
            stops: [
                stop(0.5, 0.5, "#ffd166"),
                stop(0.12, 0.15, "#06d6a0"), stop(0.3, 0.32, "#118ab2"),
                stop(0.9, 0.2, "#ef476f"), stop(0.72, 0.36, "#9b5de5"),
                stop(0.5, 0.92, "#073b4c"), stop(0.48, 0.72, "#f15bb5"),
            ],
            lines: [{ stops: [1, 2, 0], closed: false }, { stops: [3, 4, 0], closed: false }, { stops: [5, 6, 0], closed: false }],
        },
    },
    {
        name: "A sunset",
        note: "A horizon line, warm in the middle and cooler at its ends, with the sky's colors above it as points and the sea's below.",
        state: {
            width: 600, height: 400,
            stops: [
                stop(0.0, 0.58, "#c94b4b"), stop(0.35, 0.56, "#ff9a3c"), stop(0.5, 0.55, "#ffe29a"), stop(0.65, 0.56, "#ff9a3c"), stop(1.0, 0.58, "#c94b4b"),
                stop(0.2, 0.08, "#1d2b64", 20), stop(0.8, 0.1, "#3a1c71", 20), stop(0.5, 0.3, "#f8b195"),
                stop(0.25, 0.9, "#0f2027", 20), stop(0.75, 0.92, "#203a43", 20), stop(0.5, 0.7, "#c06c84"),
            ],
            lines: [{ stops: [0, 1, 2, 3, 4], closed: false }],
        },
    },
];

function presetState(index) {
    return {
        space: state?.space ?? 2,
        resolution: state?.resolution ?? 512,
        models: state?.models ?? ["biharmonic", "harmonic"],
        showStops: state?.showStops ?? true,
        view: state?.view ?? "gradient",
        level: state?.level ?? 2,
        steps: state?.steps ?? 6,
        crossSection: state?.crossSection ?? false,
        section: state?.section ?? [[0.1, 0.5], [0.9, 0.5]],
        sheet: state?.sheet ?? false,
        sheetHeight: state?.sheetHeight ?? "L",
        numbers: state?.numbers ?? false,
        ...structuredClone(PRESETS[index].state),
    };
}

// MARK: - Stops and lines to the renderer

const boxScale = () => {
    const shorter = Math.min(state.width, state.height);
    return [state.width / shorter, state.height / shorter];
};

// The lines each stop is on.
function linesThrough(index) {
    return state.lines.filter(line => line.stops.includes(index));
}

// A line's stretches from stop to stop, as their four Bézier points and the stops at either end. Two stops make a
// straight line; with more, it curves through them as a Catmull-Rom spline does, in the box's own proportions.
function lineStretches(line) {
    const [sx, sy] = boxScale();
    const points = line.stops.map(i => [state.stops[i].p[0] * sx, state.stops[i].p[1] * sy]);
    const count = points.length;
    const stretchCount = line.closed && count > 2 ? count : count - 1;
    const at = i => line.closed && count > 2 ? points[(i + count) % count] : points[clamp(i, 0, count - 1)];
    const toFraction = ([x, y]) => [x / sx, y / sy];
    const result = [];
    for (let i = 0; i < stretchCount; ++i) {
        const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
        const curved = count > 2;
        const c1 = curved ? [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6] : p1;
        const c2 = curved ? [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6] : p2;
        result.push({
            bezier: [p1, c1, c2, p2].map(toFraction),
            from: line.stops[i],
            to: line.stops[(i + 1) % count],
        });
    }
    return result;
}

function bezier([p0, p1, p2, p3], t) {
    const u = 1 - t;
    return [0, 1].map(k => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
}

// A stretch flattened into straight pieces, each with where along the stretch, 0 to 1, its ends are. As MeshShader2
// does, a curved stretch takes a piece for each 0.01 of its control polygon's length, in units of the box's shorter
// side, from 4 to 64.
function stretchPieces({ bezier: points }) {
    const [sx, sy] = boxScale();
    const length = (a, b) => Math.hypot((b[0] - a[0]) * sx, (b[1] - a[1]) * sy);
    const [p0, p1, p2, p3] = points;
    const straight = p1[0] === p0[0] && p1[1] === p0[1] && p2[0] === p3[0] && p2[1] === p3[1];
    const count = straight ? 1 : Math.min(64, Math.max(4, Math.ceil((length(p0, p1) + length(p1, p2) + length(p2, p3)) / 0.01)));
    const result = [];
    let previous = p0;
    for (let i = 1; i <= count; ++i) {
        const next = bezier(points, i / count);
        result.push({ ends: [...previous, ...next], t: [(i - 1) / count, i / count] });
        previous = next;
    }
    return result;
}

// The interpolation spaces the renderer's shader knows.
const SHADER_SPACES = ["srgb", "srgb-linear", "oklab"];

// A stop's color in the interpolation space with its opacity, premultiplied, as the renderer takes it.
function premultiplied(stop) {
    const color = parseColor(stop.color) ?? parseColor("black");
    const alpha = (Number.isNaN(color.alpha) ? 0 : color.alpha) * stop.opacity / 100;
    const c = fromXYZ(SHADER_SPACES[state.space], toXYZ(color.space, color.c.map(v => Number.isNaN(v) ? 0 : v)));
    return [c[0] * alpha, c[1] * alpha, c[2] * alpha, alpha];
}

// How far a stop or line holds its color, in units of the box's shorter side, at a spread of 0: MeshShader2's
// default point radius.
const STOP_RADIUS = 0.01;
// How far a point holds its color at a spread of 100%.
const FULL_SPREAD = 0.35;

const spreadRadius = stop => STOP_RADIUS + (FULL_SPREAD - STOP_RADIUS) * stop.spread / 100;

// The gradient as MeshShader2's renderer takes it: each stop on no line a point, held out to its spread, and each
// line's pieces one-sided segments, their colors blended from stop to stop.
function gradientData(model) {
    const points = [], segments = [], lines = [], colors = state.stops.map(premultiplied);
    state.stops.forEach((stop, i) => {
        if (!linesThrough(i).length)
            points.push(...colors[i], stop.p[0], stop.p[1], spreadRadius(stop), 0);
    });
    const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
    for (const line of state.lines) {
        const flat = [];
        for (const stretch of lineStretches(line)) {
            for (const { ends, t } of stretchPieces(stretch)) {
                const start = mix(colors[stretch.from], colors[stretch.to], t[0]), end = mix(colors[stretch.from], colors[stretch.to], t[1]);
                segments.push(...start, ...end, ...start, ...end, ...ends, STOP_RADIUS, STOP_RADIUS, 0);
                flat.push(...ends);
            }
        }
        if (flat.length)
            lines.push({ ends: flat, closed: line.closed && line.stops.length > 2 });
    }
    const average = [0, 1, 2, 3].map(k => colors.length ? colors.reduce((sum, c) => sum + c[k], 0) / colors.length : 0);
    return {
        space: state.space, resolution: (drag && drag.kind !== "section") || adjusting ? Math.min(state.resolution, 256) : state.resolution, model,
        isEmpty: !points.length && !segments.length, average, points, segments, lines, hasTwoSidedLines: false,
        isOpaque: colors.every(c => c[3] >= 1),
    };
}

// MARK: - Page

const $ = id => document.getElementById(id);
const views = [...document.querySelectorAll(".view")].map(figure => ({
    model: figure.dataset.model,
    figure,
    stage: figure.querySelector(".stage"),
    gpu: figure.querySelector(".gpu"),
    overlay: figure.querySelector(".overlay"),
    plot: figure.querySelector(".plot"),
    sheet: figure.querySelector(".sheet"),
    numbers: figure.querySelector(".numbers"),
    context: null,
    renderer: null,
    gradientKey: null,
    // The box the relaxation was last run for.
    relaxedSize: null,
    // What was last solved, and what was last read back from it.
    solveKey: null,
    readKey: null,
    reading: false,
    readAgain: false,
    readout: null,
    // The texture drawn into this frame, and the visualization's uniforms.
    target: null,
    uniforms: null,
}));

let device = null;
let gpuError = null;

async function setUpGPU() {
    if (!navigator.gpu)
        throw new Error("WebGPU isn't available in this browser.");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter)
        throw new Error("No WebGPU adapter.");
    // The adapter's own limits, rather than the defaults, which are too small for the solver's workgroups and the
    // biharmonic's coefficients.
    const requiredLimits = {};
    for (const name of ["maxComputeInvocationsPerWorkgroup", "maxComputeWorkgroupSizeX", "maxComputeWorkgroupStorageSize", "maxStorageBufferBindingSize", "maxBufferSize"])
        requiredLimits[name] = adapter.limits[name];
    device = await adapter.requestDevice({ requiredLimits });
    device.addEventListener("uncapturederror", event => {
        gpuError = event.error.message;
        console.error(gpuError);
        scheduleRender();
    });
    device.lost.then(info => {
        gpuError = `The GPU device was lost: ${info.message}`;
        scheduleRender();
    });
    // The renderer writes encoded sRGB into a unorm format.
    const format = navigator.gpu.getPreferredCanvasFormat();
    for (const view of views) {
        view.context = view.gpu.getContext("webgpu");
        view.context.configure({ device, format, alphaMode: "premultiplied" });
        view.renderer = new WebGPUFreeformGradientRenderer(device, { shader: SHADER, format });
        view.uniforms = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    }
    const module = device.createShaderModule({ code: VISUALIZE_SHADER });
    visualizePipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "visualizeVertex" },
        fragment: { module, entryPoint: "visualizeFragment", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
    });
    readPipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "readSolution" } });
}

let renderScheduled = false;
function scheduleRender() {
    if (renderScheduled)
        return;
    renderScheduled = true;
    requestAnimationFrame(() => {
        renderScheduled = false;
        render();
    });
}

function changed() {
    scheduleRender();
    scheduleHashWrite();
}

// Every box is solved and drawn first, then the visualizations drawn over them, since the difference reads the other
// box's solution.
function render() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const encoder = device && !gpuError ? device.createCommandEncoder() : null;
    const drawn = [];
    for (const view of views) {
        view.figure.hidden = !state.models.includes(view.model);
        if (view.figure.hidden)
            continue;
        view.stage.style.aspectRatio = `${state.width} / ${state.height}`;
        const width = Math.max(1, Math.round(view.stage.clientWidth * dpr)), height = Math.max(1, Math.round(view.stage.clientHeight * dpr));
        for (const canvas of [view.gpu, view.overlay]) {
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }
        }
        if (encoder && view.renderer) {
            encodeView(view, encoder, width, height);
            drawn.push(view);
        }
        drawOverlay(view, dpr);
    }
    for (const view of drawn)
        encodeVisualization(view, encoder);
    if (encoder)
        device.queue.submit([encoder.finish()]);
    $("gpuStatus").hidden = !!device && !gpuError;
    $("gpuStatus").textContent = gpuError ? `WebGPU: ${gpuError}` : "WebGPU: starting…";
    $("gpuStatus").className = gpuError ? "status error" : "status";
    updateControls();
    requestReadbacks();
    drawPanels();
}

// Solves the view's gradient if it changed, or relaxes it for the relaxation view, and draws it.
function encodeView(view, encoder, width, height) {
    const data = gradientData(view.model);
    const relaxing = state.view === "relaxation" && view.model === "harmonic";
    const key = JSON.stringify(data) + (relaxing ? `:relaxed ${2 ** state.steps}` : "");
    if (key !== view.gradientKey) {
        view.renderer.setGradient(data);
        view.gradientKey = key;
        view.relaxedSize = null;
    }
    if (relaxing && !data.isEmpty && (view.relaxedSize?.[0] !== width || view.relaxedSize?.[1] !== height)) {
        if (view.renderer.prepare(width, height)) {
            encodeRelaxation(view.renderer, encoder, 2 ** state.steps);
            view.renderer.solvedSize = [width, height];
        }
        view.relaxedSize = [width, height];
    }
    view.target = view.context.getCurrentTexture().createView();
    view.renderer.encode(encoder, view.target, width, height);
    view.solveKey = `${key} ${width}x${height}`;
}

// MARK: - Visualizations

// Draws a box's solution as one of the views under Visualize, reading the renderer's textures for one level: its
// solution, the colors its stops hold and how firmly, and for the difference, the other box's solution. Also reads a
// level back for the cross-section, 3D and numbers.
const VISUALIZE_SHADER = `
struct Visualize {
    mode: u32,
    space: u32,
    padding0: u32,
    padding1: u32,
}

@group(0) @binding(0) var<uniform> visualize: Visualize;
@group(0) @binding(1) var solution: texture_2d<f32>;
@group(0) @binding(2) var heldColor: texture_2d<f32>;
@group(0) @binding(3) var heldWeight: texture_2d<f32>;
@group(0) @binding(4) var otherSolution: texture_2d<f32>;

struct VisualizeVertex {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn visualizeVertex(@builtin(vertex_index) vid: u32) -> VisualizeVertex {
    let uv = vec2<f32>(f32((vid << 1u) & 2u), f32(vid & 2u));
    var out: VisualizeVertex;
    out.position = vec4<f32>(uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
    out.uv = uv;
    return out;
}

fn bilinear(t: texture_2d<f32>, position: vec2<f32>) -> vec4<f32> {
    let size = vec2<i32>(textureDimensions(t));
    let base = floor(position);
    let f = position - base;
    let p0 = clamp(vec2<i32>(base), vec2<i32>(0), size - 1);
    let p1 = clamp(vec2<i32>(base) + 1, vec2<i32>(0), size - 1);
    let top = mix(textureLoad(t, vec2<i32>(p0.x, p0.y), 0), textureLoad(t, vec2<i32>(p1.x, p0.y), 0), f.x);
    let bottom = mix(textureLoad(t, vec2<i32>(p0.x, p1.y), 0), textureLoad(t, vec2<i32>(p1.x, p1.y), 0), f.x);
    return mix(top, bottom, f.y);
}

fn decodeSigned(c: vec3<f32>) -> vec3<f32> {
    let a = abs(c);
    return sign(c) * select(pow((a + 0.055) / 1.055, vec3<f32>(2.4)), a / 12.92, a <= vec3<f32>(0.04045));
}

fn encodeSigned(c: vec3<f32>) -> vec3<f32> {
    let a = abs(c);
    return sign(c) * select(1.055 * pow(a, vec3<f32>(1.0 / 2.4)) - 0.055, a * 12.92, a <= vec3<f32>(0.0031308));
}

fn oklabToLinear(lab: vec3<f32>) -> vec3<f32> {
    let l = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
    let m = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
    let s = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
    let lms = vec3<f32>(l * l * l, m * m * m, s * s * s);
    return vec3<f32>(
        4.0767416621 * lms.x - 3.3077115913 * lms.y + 0.2309699292 * lms.z,
        -1.2684380046 * lms.x + 2.6097574011 * lms.y - 0.3413193965 * lms.z,
        -0.0041960863 * lms.x - 0.7034186147 * lms.y + 1.7076147010 * lms.z);
}

fn linearToOklab(c: vec3<f32>) -> vec3<f32> {
    let lms = vec3<f32>(
        0.4122214708 * c.x + 0.5363325363 * c.y + 0.0514459929 * c.z,
        0.2119034982 * c.x + 0.6806995451 * c.y + 0.1073969566 * c.z,
        0.0883024619 * c.x + 0.2817188376 * c.y + 0.6299787005 * c.z);
    let r = sign(lms) * pow(abs(lms), vec3<f32>(1.0 / 3.0));
    return vec3<f32>(
        0.2104542553 * r.x + 0.7936177850 * r.y - 0.0040720468 * r.z,
        1.9779984951 * r.x - 2.4285922050 * r.y + 0.4505937099 * r.z,
        0.0259040371 * r.x + 0.7827717662 * r.y - 0.8086757660 * r.z);
}

// A premultiplied color in the interpolation space as linear sRGB, unclamped, with straight alpha.
fn linearOf(premultiplied: vec4<f32>) -> vec4<f32> {
    if (premultiplied.a <= 1e-6) {
        return vec4<f32>(0.0);
    }
    let c = premultiplied.rgb / premultiplied.a;
    var result: vec3<f32>;
    switch (visualize.space) {
        case 0u: { result = decodeSigned(c); }
        case 1u: { result = c; }
        default: { result = oklabToLinear(c); }
    }
    return vec4<f32>(result, premultiplied.a);
}

// As the gradient shows a color: encoded sRGB, clamped, with straight alpha.
fn shown(c: vec4<f32>) -> vec4<f32> {
    return vec4<f32>(encodeSigned(saturate(c.rgb)), saturate(c.a));
}

// How far a color's encoded components, or its alpha, go past 0 to 1.
fn excess(c: vec4<f32>) -> f32 {
    let e = encodeSigned(c.rgb);
    let over = max(-e, e - 1.0);
    return max(max(max(over.r, over.g), over.b), max(max(-c.a, c.a - 1.0), 0.0));
}

// Black on light colors, white on dark ones.
fn contrast(c: vec3<f32>) -> vec3<f32> {
    return select(vec3<f32>(1.0), vec3<f32>(0.0), dot(c, vec3<f32>(0.299, 0.587, 0.114)) > 0.55);
}

fn dither(position: vec2<f32>) -> f32 {
    return fract(52.9829189 * fract(dot(position, vec2<f32>(0.06711056, 0.00583715))));
}

// Modes: 1 what the stops hold, 2 where it leaves sRGB, 3 lines of equal lightness, 4 the difference from the other
// box, 5 one level's texels.
@fragment
fn visualizeFragment(input: VisualizeVertex) -> @location(0) vec4<f32> {
    let size = vec2<f32>(textureDimensions(solution));
    let texelPosition = input.uv * size;
    // Device pixels a texel spans.
    let texelPixels = 1.0 / max(fwidth(texelPosition.x), 1e-6);
    let value = linearOf(bilinear(solution, texelPosition - 0.5));
    let lightness = linearToOklab(value.rgb).x / 0.025;
    let lightnessWidth = max(fwidth(lightness), 1e-6);
    let texel = clamp(vec2<i32>(floor(texelPosition)), vec2<i32>(0), vec2<i32>(size) - 1);
    // How far this pixel is from the nearest side of its texel, in device pixels.
    let within = fract(texelPosition) * texelPixels;
    let fromEdge = min(min(within.x, within.y), min(texelPixels - within.x, texelPixels - within.y));
    let weight = textureLoad(heldWeight, texel, 0).r;
    let stripes = fract((input.position.x + input.position.y) / 10.0) < 0.5;
    var color = shown(value);
    switch (visualize.mode) {
        case 1u: {
            let held = shown(linearOf(textureLoad(heldColor, texel, 0)));
            let faded = mix(vec3<f32>(1.0), mix(vec3<f32>(1.0), color.rgb, color.a), 0.3);
            var rgb = mix(faded, mix(vec3<f32>(1.0), held.rgb, held.a), weight);
            if (texelPixels >= 6.0) {
                rgb = mix(rgb, vec3<f32>(0.0), 0.15 * saturate(1.0 - fromEdge));
            }
            color = vec4<f32>(rgb, 1.0);
        }
        case 2u: {
            let e = excess(value);
            let amount = select(0.0, 0.35 + 0.65 * saturate(e / 0.2), e > 1.0 / 512.0 && stripes);
            color = vec4<f32>(mix(color.rgb, contrast(color.rgb), amount), max(color.a, amount));
        }
        case 3u: {
            let onLine = saturate(1.5 - abs(fract(lightness + 0.5) - 0.5) / lightnessWidth);
            color = vec4<f32>(mix(color.rgb, contrast(color.rgb), 0.8 * onLine), max(color.a, onLine));
        }
        case 4u: {
            let other = shown(linearOf(bilinear(otherSolution, input.uv * vec2<f32>(textureDimensions(otherSolution)) - 0.5)));
            let a = linearToOklab(decodeSigned(color.rgb)) * color.a;
            let b = linearToOklab(decodeSigned(other.rgb)) * other.a;
            let difference = length(vec4<f32>(a - b, color.a - other.a));
            color = vec4<f32>(mix(vec3<f32>(1.0), vec3<f32>(0.42, 0.1, 0.62), saturate(difference / 0.15)), 1.0);
        }
        default: {
            let nearest = shown(linearOf(textureLoad(solution, texel, 0)));
            var rgb = nearest.rgb;
            var alpha = nearest.a;
            let ink = contrast(rgb);
            if (texelPixels >= 5.0) {
                rgb = mix(rgb, ink, 0.25 * saturate(1.0 - fromEdge));
            }
            // A held texel is ringed inside its edges if it's big enough, and hatched if not.
            let mark = select(select(0.0, 0.6, stripes), saturate(1.0 - abs(fromEdge - 2.5)), texelPixels >= 10.0) * min(weight * 2.0, 1.0);
            rgb = mix(rgb, ink, mark);
            alpha = max(alpha, mark);
            color = vec4<f32>(rgb, alpha);
        }
    }
    let encoded = saturate(color.rgb + (dither(input.position.xy) - 0.5) / 255.0);
    return vec4<f32>(encoded * color.a, color.a);
}

@group(0) @binding(10) var readValues: texture_2d<f32>;
@group(0) @binding(11) var readWeight: texture_2d<f32>;
@group(0) @binding(12) var<storage, read_write> readValuesOut: array<vec4<f32>>;
@group(0) @binding(13) var<storage, read_write> readWeightOut: array<f32>;

// Copies a level's solution and constraint weights into buffers, a row at a time from the top.
@compute @workgroup_size(8, 8)
fn readSolution(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = textureDimensions(readValues);
    if (id.x >= size.x || id.y >= size.y) {
        return;
    }
    let index = id.y * size.x + id.x;
    readValuesOut[index] = textureLoad(readValues, vec2<i32>(id.xy), 0);
    readWeightOut[index] = textureLoad(readWeight, vec2<i32>(id.xy), 0).r;
}
`;

let visualizePipeline = null;
let readPipeline = null;

const VIEW_MODES = { holds: 1, gamut: 2, isolines: 3, difference: 4, level: 5 };

const VIEW_NOTES = {
    gradient: "The gradient each model draws from the same stops.",
    holds: "Every texel of the grid is worked out from the texels the stops hold, shown here in the colors they're held to, over the faded gradient. A point holds a disc out to its spread, at least 1% of the box's shorter side; a line holds a band 1% either side of it, its color running from stop to stop. Set Grid to 128 to see the texels.",
    gamut: "Hatching marks where the solved colors fall outside sRGB, so they're clipped to draw them. The harmonic model makes each texel the average of its neighbors, so it can't go past the colors it's held to. The biharmonic model keeps the slope smooth through each stop, so past a stop it keeps going, and overshoots, most of all near the box's edges. In oklab, a mix of two colors inside sRGB can also fall outside it, in either model.",
    isolines: "Lines of equal lightness, every 0.025 of Oklab L. The harmonic model is a membrane: its lines ring each point tightly and kink around it, since it's continuous there but not smooth. The biharmonic model is a stiff sheet: its lines bend smoothly through and around the stops, since its slope is continuous too.",
    difference: "White where the two models agree, purple where they differ, darkest at a difference of 0.15 in Oklab (ΔE OK) or more. Both boxes show the same difference.",
    level: "The solve runs on a pyramid of grids, each half the size of the one above it. The coarsest is solved outright, and each finer level starts from the one below, scaled up, so it only has to fix the detail. This shows one level's texels as they are, unfiltered, with the texels the stops hold marked. Level 0 is the finest, the one that's drawn.",
    relaxation: "The harmonic model's finest grid, started from the stops' average color and relaxed without the pyramid: each step moves every texel toward the average of its four neighbors. The colors creep out from the stops a texel or two a step, so a fine grid would take hundreds of thousands of steps to settle. That's why the solve starts coarse. The biharmonic box shows its gradient.",
};

function viewAvailable(name) {
    if (name === "difference")
        return state.models.length > 1;
    if (name === "relaxation")
        return state.models.includes("harmonic");
    return true;
}

const shownLevel = view => Math.min(state.level, view.renderer.levels.length - 1);

function encodeVisualization(view, encoder) {
    const mode = VIEW_MODES[state.view];
    const levels = view.renderer.levels;
    if (!mode || !levels.length || !view.renderer.gradient)
        return;
    const level = levels[state.view === "level" ? shownLevel(view) : 0];
    let other = level.values.texture;
    if (state.view === "difference") {
        const pair = views.find(other => other !== view && !other.figure.hidden && other.renderer?.levels.length);
        if (!pair)
            return;
        other = pair.renderer.levels[0].values.texture;
    }
    device.queue.writeBuffer(view.uniforms, 0, new Uint32Array([mode, state.space, 0, 0]));
    const bindGroup = device.createBindGroup({
        layout: visualizePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: view.uniforms } },
            { binding: 1, resource: level.values.texture.createView() },
            { binding: 2, resource: level.constraintColor.createView() },
            { binding: 3, resource: level.constraintWeight.createView() },
            { binding: 4, resource: other.createView() },
        ],
    });
    const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: view.target, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
    });
    pass.setPipeline(visualizePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
}

// The harmonic model's finest grid started from the stops' average color and smoothed `steps` times, without the
// coarser levels, through the renderer's own kernels, as its encodeSolve() does.
function encodeRelaxation(renderer, encoder, steps) {
    renderer.slots = new Map();
    renderer.slotData = new ArrayBuffer(uniformSlotBytes * uniformSlots);
    renderer.packSources();
    renderer.pass = encoder.beginComputePass();
    const finest = renderer.levels[0];
    renderer.dispatch("constraints", finest, [
        renderer.uniformEntry(0, 0),
        { binding: 1, resource: { buffer: renderer.pointBuffer } },
        { binding: 2, resource: { buffer: renderer.segmentBuffer } },
        { binding: 3, resource: renderer.view(finest.constraintColor) },
        { binding: 4, resource: renderer.view(finest.constraintWeight) },
        { binding: 5, resource: renderer.view(finest.rightHandSide) },
    ]);
    renderer.fill(finest, renderer.gradient.average);
    renderer.smooth(0, finest.values, finest.rightHandSide, steps, 0);
    renderer.pass.end();
    renderer.pass = null;
    device.queue.writeBuffer(renderer.uniforms, 0, renderer.slotData, 0, uniformSlotBytes * Math.max(renderer.slots.size, 1));
    renderer.makeEdges();
}

// MARK: - Reading the solve back

// Reads back what each box shows, when something under the boxes needs it and it's changed since it was last read.
function requestReadbacks() {
    if (!device || gpuError || !(state.crossSection || state.sheet || state.numbers))
        return;
    for (const view of views) {
        if (view.figure.hidden || !view.renderer?.levels.length || !view.solveKey)
            continue;
        const level = state.view === "level" ? shownLevel(view) : 0;
        const key = `${view.solveKey} ${level}`;
        if (key === view.readKey)
            continue;
        if (view.reading) {
            view.readAgain = true;
            continue;
        }
        view.readKey = key;
        readBack(view, level);
    }
}

async function readBack(view, index) {
    view.reading = true;
    const level = view.renderer.levels[index];
    const { width, height } = level;
    const buffer = (size, usage) => device.createBuffer({ size: Math.max(16, size), usage });
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, mappable = GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST;
    const values = buffer(width * height * 16, storage), weights = buffer(width * height * 4, storage);
    const valuesRead = buffer(values.size, mappable), weightsRead = buffer(weights.size, mappable);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(readPipeline);
    pass.setBindGroup(0, device.createBindGroup({
        layout: readPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 10, resource: level.values.texture.createView() },
            { binding: 11, resource: level.constraintWeight.createView() },
            { binding: 12, resource: { buffer: values } },
            { binding: 13, resource: { buffer: weights } },
        ],
    }));
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    pass.end();
    encoder.copyBufferToBuffer(values, 0, valuesRead, 0, values.size);
    encoder.copyBufferToBuffer(weights, 0, weightsRead, 0, weights.size);
    device.queue.submit([encoder.finish()]);
    const space = state.space;
    try {
        await Promise.all([valuesRead.mapAsync(GPUMapMode.READ), weightsRead.mapAsync(GPUMapMode.READ)]);
        view.readout = {
            width, height, space, level: index, stats: null,
            values: new Float32Array(valuesRead.getMappedRange()).slice(0, width * height * 4),
            weights: new Float32Array(weightsRead.getMappedRange()).slice(0, width * height),
        };
    } catch (error) {
        console.error(error);
    }
    for (const b of [values, weights, valuesRead, weightsRead])
        b.destroy();
    view.reading = false;
    if (view.readAgain) {
        view.readAgain = false;
        view.readKey = null;
        requestReadbacks();
    }
    drawPanels();
}

const decodeSigned = c => Math.sign(c) * (Math.abs(c) <= 0.04045 ? Math.abs(c) / 12.92 : ((Math.abs(c) + 0.055) / 1.055) ** 2.4);
const encodeSigned = c => Math.sign(c) * (Math.abs(c) <= 0.0031308 ? Math.abs(c) * 12.92 : 1.055 * Math.abs(c) ** (1 / 2.4) - 0.055);

function oklabToLinear([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
}

function oklabLightness([r, g, b]) {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
}

// A premultiplied color in the interpolation space as the gradient shows it before clipping: encoded sRGB with
// straight alpha, and its Oklab lightness.
function appearance(p, space) {
    const alpha = p[3];
    if (alpha <= 1e-6)
        return { rgb: [0, 0, 0], alpha: 0, L: 0 };
    const c = [p[0] / alpha, p[1] / alpha, p[2] / alpha];
    const linear = space === 0 ? c.map(decodeSigned) : space === 1 ? c : oklabToLinear(c);
    return { rgb: linear.map(encodeSigned), alpha, L: oklabLightness(linear) };
}

const excessOf = ({ rgb, alpha }) => Math.max(0, ...rgb.map(v => Math.max(-v, v - 1)), -alpha, alpha - 1);

// The readout's premultiplied color at a point, 0 to 1 across and down the box, filtered as the gradient is.
function sampleReadout({ width, height, values }, [u, v]) {
    const x = clamp(u * width - 0.5, 0, width - 1), y = clamp(v * height - 0.5, 0, height - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
    const fx = x - x0, fy = y - y0;
    const at = (i, j, k) => values[(j * width + i) * 4 + k];
    return [0, 1, 2, 3].map(k => (at(x0, y0, k) * (1 - fx) + at(x1, y0, k) * fx) * (1 - fy) + (at(x0, y1, k) * (1 - fx) + at(x1, y1, k) * fx) * fy);
}

const weightAt = ({ width, height, weights }, [u, v]) =>
    weights[clamp(Math.floor(v * height), 0, height - 1) * width + clamp(Math.floor(u * width), 0, width - 1)];

// MARK: - Under each box

const PLOT_COLORS = ["#e5484d", "#30a46c", "#0090ff"];
const isDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
const cssColor = ({ rgb, alpha }) => {
    const [r, g, b] = rgb.map(v => Math.round(255 * (1 - alpha + alpha * clamp(v, 0, 1))));
    return `rgb(${r}, ${g}, ${b})`;
};

function sizeCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = "11px -apple-system, system-ui, sans-serif";
    return { ctx, width, height };
}

function drawPanels() {
    for (const view of views) {
        const visible = !view.figure.hidden;
        view.plot.hidden = !(visible && state.crossSection);
        view.sheet.hidden = !(visible && state.sheet);
        view.numbers.hidden = !(visible && state.numbers);
        if (!visible)
            continue;
        if (state.crossSection)
            drawPlot(view);
        if (state.sheet)
            drawSheet(view);
        if (state.numbers)
            view.numbers.textContent = numbersText(view);
    }
}

// The components along the cross-section from A to B, as encoded sRGB before clipping, under a strip of the colors
// there, over bars of how firmly the stops hold each point.
function drawPlot(view) {
    const { ctx, width, height } = sizeCanvas(view.plot);
    const ink = isDark() ? "255, 255, 255" : "0, 0, 0";
    const readout = view.readout;
    if (!readout) {
        ctx.fillStyle = `rgba(${ink}, 0.5)`;
        ctx.fillText("Reading the solve…", 8, 16);
        return;
    }
    const count = 240;
    const [a, b] = state.section;
    const samples = [];
    for (let i = 0; i <= count; ++i) {
        const t = i / count, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        samples.push({ ...appearance(sampleReadout(readout, p), readout.space), weight: weightAt(readout, p) });
    }
    const all = samples.flatMap(s => s.rgb);
    const lo = Math.min(0, ...all) - 0.05, hi = Math.max(1, ...all) + 0.05;
    const left = 24, right = 24, top = 24, bottom = 18;
    const plotWidth = width - left - right, plotHeight = height - top - bottom;
    const x = t => left + t * plotWidth, y = v => top + (hi - v) / (hi - lo) * plotHeight;

    samples.forEach((sample, i) => {
        ctx.fillStyle = cssColor(sample);
        ctx.fillRect(x((i - 0.5) / count), 4, plotWidth / count + 0.6, 12);
    });
    ctx.fillStyle = `rgba(${ink}, 0.6)`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText("A", left / 2, 10);
    ctx.fillText("B", width - right / 2, 10);

    // Past 0 or 1, the color is clipped.
    ctx.fillStyle = `rgba(${ink}, 0.07)`;
    ctx.fillRect(left, top, plotWidth, y(1) - top);
    ctx.fillRect(left, y(0), plotWidth, top + plotHeight - y(0));
    ctx.strokeStyle = `rgba(${ink}, 0.3)`;
    ctx.fillStyle = `rgba(${ink}, 0.6)`;
    ctx.lineWidth = 1;
    for (const v of [0, 1]) {
        ctx.beginPath();
        ctx.moveTo(left, Math.round(y(v)) + 0.5);
        ctx.lineTo(left + plotWidth, Math.round(y(v)) + 0.5);
        ctx.stroke();
        ctx.fillText(String(v), left / 2, y(v));
    }

    ctx.fillStyle = `rgba(${ink}, 0.3)`;
    samples.forEach((sample, i) => {
        const h = sample.weight * 10;
        if (h > 0)
            ctx.fillRect(x((i - 0.5) / count), height - 3 - h, plotWidth / count + 0.6, h);
    });
    ctx.fillStyle = `rgba(${ink}, 0.5)`;
    ctx.textAlign = "right";
    ctx.fillText("held", left - 2, height - 8);

    const line = (values, color, dash = []) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash(dash);
        ctx.beginPath();
        values.forEach((v, i) => i ? ctx.lineTo(x(i / count), y(v)) : ctx.moveTo(x(0), y(v)));
        ctx.stroke();
        ctx.setLineDash([]);
    };
    [0, 1, 2].forEach(k => line(samples.map(s => s.rgb[k]), PLOT_COLORS[k]));
    if (samples.some(s => s.alpha < 0.999))
        line(samples.map(s => s.alpha), `rgba(${ink}, 0.6)`, [4, 3]);
}

let sheetYaw = -0.6;
let sheetTilt = 0.8;

// What the 3D view can raise the surface by: each of the interpolation space's components, as the solve has them,
// straight rather than premultiplied, and for the sRGB spaces Oklab lightness too. Each has the range its box spans.
function sheetHeights(space) {
    const rgb = space === 0 ? "encoded" : "linear";
    const heights = space === 2
        ? [{ value: "c0", label: "L (Oklab)", short: "L", range: [0, 1] }, { value: "c1", label: "a (Oklab)", short: "a", range: [-0.4, 0.4] }, { value: "c2", label: "b (Oklab)", short: "b", range: [-0.4, 0.4] }]
        : ["Red", "Green", "Blue"].map((label, k) => ({ value: `c${k}`, label: `${label} (${rgb})`, short: label[0], range: [0, 1] }));
    if (space !== 2)
        heights.push({ value: "L", label: "Lightness (Oklab L)", short: "L", range: [0, 1] });
    return heights;
}

// The height the 3D view shows: the one chosen, or for a link from before, the component it named.
function sheetHeight(space) {
    const heights = sheetHeights(space);
    const legacy = { r: "c0", g: "c1", b: "c2", L: space === 2 ? "c0" : "L" };
    const value = legacy[state.sheetHeight] ?? state.sheetHeight;
    return heights.find(height => height.value === value) ?? heights[0];
}

// One component of the solution as a height over the box, colored as the gradient is: the colors as a surface.
function drawSheet(view) {
    const { ctx, width, height } = sizeCanvas(view.sheet);
    const ink = isDark() ? "255, 255, 255" : "0, 0, 0";
    const readout = view.readout;
    if (!readout) {
        ctx.fillStyle = `rgba(${ink}, 0.5)`;
        ctx.fillText("Reading the solve…", 8, 16);
        return;
    }
    const longest = Math.max(state.width, state.height);
    const extentX = state.width / longest, extentY = state.height / longest;
    const columns = Math.max(2, Math.round(56 * extentX)), rows = Math.max(2, Math.round(56 * extentY));
    const shown = sheetHeight(readout.space);
    const [low, high] = shown.range;
    const component = shown.value === "L" ? -1 : Number(shown.value.slice(1));
    const heightAt = p => {
        const color = sampleReadout(readout, p);
        const value = component < 0 ? appearance(color, readout.space).L : color[3] > 1e-6 ? color[component] / color[3] : 0;
        return (value - low) / (high - low);
    };
    const heights = [];
    for (let j = 0; j <= rows; ++j) {
        heights.push([]);
        for (let i = 0; i <= columns; ++i)
            heights[j].push(heightAt([i / columns, j / rows]));
    }
    const zScale = 0.4;
    const fit = Math.min(width, height * 1.3) * 0.56;
    const project = (u, v, z) => {
        const x0 = (u - 0.5) * extentX, y0 = (v - 0.5) * extentY, z0 = z * zScale;
        const cosYaw = Math.cos(sheetYaw), sinYaw = Math.sin(sheetYaw);
        const xr = x0 * cosYaw - y0 * sinYaw, yr = x0 * sinYaw + y0 * cosYaw;
        const cosTilt = Math.cos(sheetTilt), sinTilt = Math.sin(sheetTilt);
        return [width / 2 + xr * fit, height / 2 + 30 + (yr * sinTilt - z0 * cosTilt) * fit, yr * cosTilt + z0 * sinTilt];
    };
    const outline = (z, dash, alpha) => {
        const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => project(u, v, z));
        ctx.setLineDash(dash);
        ctx.strokeStyle = `rgba(${ink}, ${alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        corners.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py));
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
        return corners;
    };
    const floor = outline(0, [], 0.35);
    ctx.fillStyle = `rgba(${ink}, 0.05)`;
    ctx.beginPath();
    floor.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py));
    ctx.fill();
    const top = outline(1, [4, 4], 0.3);
    ctx.fillStyle = `rgba(${ink}, 0.6)`;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`${shown.short} = ${high}`, top[0][0] + 6, top[0][1] - 4);
    ctx.fillText(`${shown.short} = ${low}`, floor[0][0] + 6, floor[0][1] + 14);

    const items = [];
    for (let j = 0; j < rows; ++j) {
        for (let i = 0; i < columns; ++i) {
            const quad = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => project(a / columns, b / rows, heights[b][a]));
            const depth = quad.reduce((sum, p) => sum + p[2], 0) / 4;
            const fill = cssColor(appearance(sampleReadout(readout, [(i + 0.5) / columns, (j + 0.5) / rows]), readout.space));
            items.push({ depth, draw: () => {
                ctx.beginPath();
                quad.forEach(([px, py], k) => k ? ctx.lineTo(px, py) : ctx.moveTo(px, py));
                ctx.closePath();
                ctx.fillStyle = fill;
                ctx.fill();
                ctx.strokeStyle = `rgba(${ink}, 0.12)`;
                ctx.lineWidth = 0.5;
                ctx.stroke();
            } });
        }
    }
    if (state.crossSection) {
        // Where the cross-section cuts the surface: the lines the plot draws.
        const [a, b] = state.section;
        const points = [];
        for (let i = 0; i <= 80; ++i) {
            const t = i / 80, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            points.push(project(p[0], p[1], heightAt(p)));
        }
        for (let i = 0; i + 1 < points.length; ++i) {
            const [p, q] = [points[i], points[i + 1]];
            items.push({ depth: (p[2] + q[2]) / 2 + 0.01, draw: () => {
                ctx.strokeStyle = `rgba(${ink}, 0.9)`;
                ctx.lineWidth = 2;
                ctx.lineCap = "round";
                ctx.beginPath();
                ctx.moveTo(p[0], p[1]);
                ctx.lineTo(q[0], q[1]);
                ctx.stroke();
                ctx.lineCap = "butt";
            } });
        }
    }
    items.sort((p, q) => p.depth - q.depth);
    for (const item of items)
        item.draw();
}

for (const view of views) {
    let rotating = null;
    view.sheet.addEventListener("pointerdown", event => {
        rotating = { x: event.clientX, y: event.clientY };
        view.sheet.setPointerCapture(event.pointerId);
        view.sheet.style.cursor = "grabbing";
    });
    view.sheet.addEventListener("pointermove", event => {
        if (!rotating)
            return;
        sheetYaw += (event.clientX - rotating.x) * 0.01;
        sheetTilt = clamp(sheetTilt + (event.clientY - rotating.y) * 0.006, 0.15, 1.5);
        rotating = { x: event.clientX, y: event.clientY };
        drawPanels();
    });
    const stop = () => {
        rotating = null;
        view.sheet.style.cursor = "";
    };
    view.sheet.addEventListener("pointerup", stop);
    view.sheet.addEventListener("pointercancel", stop);
}

function numbersText(view) {
    const readout = view.readout;
    if (!readout)
        return "Reading the solve…";
    if (!readout.stats) {
        let held = 0, outside = 0, furthest = 0, darkest = Infinity, lightest = -Infinity;
        const count = readout.width * readout.height;
        for (let i = 0; i < count; ++i) {
            if (readout.weights[i] > 0)
                ++held;
            const color = appearance(readout.values.subarray(i * 4, i * 4 + 4), readout.space);
            const e = excessOf(color);
            if (e > 1 / 512)
                ++outside;
            furthest = Math.max(furthest, e);
            darkest = Math.min(darkest, color.L);
            lightest = Math.max(lightest, color.L);
        }
        readout.stats = { count, held, outside, furthest, darkest, lightest };
    }
    const { count, held, outside, furthest, darkest, lightest } = readout.stats;
    const levels = view.renderer.levels;
    const coarsest = levels[levels.length - 1];
    const grid = readout.level === 0
        ? `Grid ${readout.width} × ${readout.height} texels, in ${levels.length} levels down to ${coarsest.width} × ${coarsest.height}.`
        : `Level ${readout.level}: ${readout.width} × ${readout.height} texels.`;
    const percent = value => `${(100 * value / count).toFixed(value && value < count / 1000 ? 2 : 1)}%`;
    return `${grid} ${held.toLocaleString()} held (${percent(held)}). ${percent(outside)} outside sRGB` +
        (outside ? `, up to ${furthest.toFixed(3)} past 0 to 1.` : ".") +
        ` Oklab L from ${darkest.toFixed(3)} to ${lightest.toFixed(3)}.`;
}

// MARK: - Overlay

const ACCENT = "#0a84ff";

// Whether a stop has been dragged out of the box, and goes when it's let go.
const outside = ([x, y]) => x < -0.02 || x > 1.02 || y < -0.02 || y > 1.02;

// The cross-section's line, dashed, with its ends A and B.
function drawSection(ctx, toPixels) {
    const ends = state.section.map(toPixels);
    for (const [style, width] of [["rgba(0, 0, 0, 0.55)", 3], ["#fff", 1.5]]) {
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.setLineDash(width < 2 ? [6, 4] : []);
        ctx.beginPath();
        ctx.moveTo(...ends[0]);
        ctx.lineTo(...ends[1]);
        ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.font = "600 10px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ends.forEach((at, i) => {
        ctx.beginPath();
        ctx.arc(...at, 7, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(29, 29, 31, 0.85)";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.fillText(i ? "B" : "A", at[0], at[1] + 0.5);
    });
}

// The lines, each stop as a swatch of its color, and the selected stop's spread as a dashed circle.
function drawOverlay(view) {
    const canvas = view.overlay;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = canvas.width / (canvas.clientWidth || 1);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const size = [canvas.clientWidth, canvas.clientHeight];
    const toPixels = ([x, y]) => [x * size[0], y * size[1]];
    if (state.crossSection)
        drawSection(ctx, toPixels);
    if (!state.showStops)
        return;

    for (const line of state.lines) {
        ctx.beginPath();
        lineStretches(line).forEach(({ bezier: [p0, p1, p2, p3] }, i) => {
            if (i === 0)
                ctx.moveTo(...toPixels(p0));
            ctx.bezierCurveTo(...toPixels(p1), ...toPixels(p2), ...toPixels(p3));
        });
        const current = drawing === state.lines.indexOf(line);
        for (const [style, width] of [["rgba(0, 0, 0, 0.45)", 3], [current ? ACCENT : "rgba(255, 255, 255, 0.95)", current ? 1.75 : 1.25]]) {
            ctx.strokeStyle = style;
            ctx.lineWidth = width;
            ctx.stroke();
        }
    }

    const selected = selection !== null ? state.stops[selection] : null;
    if (selected && !linesThrough(selection).length) {
        const [sx, sy] = boxScale();
        const at = toPixels(selected.p);
        const radius = spreadRadius(selected);
        ctx.beginPath();
        ctx.ellipse(...at, radius / sx * size[0], radius / sy * size[1], 0, 0, 2 * Math.PI);
        ctx.setLineDash([5, 4]);
        for (const [style, width] of [["rgba(0, 0, 0, 0.5)", 2.5], ["#fff", 1.25]]) {
            ctx.strokeStyle = style;
            ctx.lineWidth = width;
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    state.stops.forEach((stop, i) => {
        const at = toPixels(stop.p);
        const radius = i === selection ? 8 : 6.5;
        ctx.globalAlpha = drag?.kind === "stop" && drag.index === i && outside(stop.p) ? 0.35 : 1;
        ctx.beginPath();
        ctx.arc(...at, radius + 2.5, 0, 2 * Math.PI);
        ctx.fillStyle = i === selection ? ACCENT : "#fff";
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(...at, radius, 0, 2 * Math.PI);
        ctx.fillStyle = stop.color;
        ctx.fill();
        ctx.globalAlpha = 1;
    });
}

// MARK: - Editing

// Whether clicks add stops on their own or along lines.
let mode = "points";
// The selected stop, by index.
let selection = null;
// The line being drawn, by index, which clicks in Lines add stops to the end of.
let drawing = null;
let drag = null;
// Whether a slider is being moved.
let adjusting = false;

const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];

// What's under a point in CSS pixels of `view`'s box: an end of the cross-section, a stop, the selected point's spread
// circle, or a line, in that order.
function hitTest(view, point) {
    const size = [view.overlay.clientWidth, view.overlay.clientHeight];
    const toPixels = ([x, y]) => [x * size[0], y * size[1]];
    const distance = at => Math.hypot(at[0] - point[0], at[1] - point[1]);
    if (state.crossSection) {
        for (const end of [1, 0]) {
            if (distance(toPixels(state.section[end])) <= 9)
                return { kind: "section", end };
        }
    }
    for (let i = state.stops.length - 1; i >= 0; --i) {
        if (distance(toPixels(state.stops[i].p)) <= 9)
            return { kind: "stop", index: i };
    }
    if (selection !== null && !linesThrough(selection).length) {
        const stop = state.stops[selection];
        const [sx, sy] = boxScale();
        const radius = spreadRadius(stop);
        const offset = subtract(point, toPixels(stop.p));
        // How far out the point is, as a fraction of the circle's radius in that direction.
        const reach = Math.hypot(offset[0] / (radius / sx * size[0]), offset[1] / (radius / sy * size[1]));
        if (Math.abs(reach - 1) * Math.hypot(...offset) / Math.max(reach, 1e-6) <= 5)
            return { kind: "spread", index: selection };
    }
    for (let l = state.lines.length - 1; l >= 0; --l) {
        for (const stretch of lineStretches(state.lines[l])) {
            for (const { ends: [x0, y0, x1, y1], t } of stretchPieces(stretch)) {
                const a = toPixels([x0, y0]), b = toPixels([x1, y1]);
                const along = subtract(b, a), offset = subtract(point, a);
                const s = clamp((offset[0] * along[0] + offset[1] * along[1]) / ((along[0] ** 2 + along[1] ** 2) || 1), 0, 1);
                if (distance([a[0] + along[0] * s, a[1] + along[1] * s]) <= 6)
                    return { kind: "line", line: l, stretch, t: t[0] + (t[1] - t[0]) * s };
            }
        }
    }
    return null;
}

// The color a new stop takes: the stops' colors around it, weighted by the inverse square of how far each is.
function colorAt(p) {
    if (!state.stops.length)
        return { color: "#7f7f7f", opacity: 100 };
    const [sx, sy] = boxScale();
    let total = 0;
    const sum = [0, 0, 0, 0];
    for (const stop of state.stops) {
        const weight = 1 / Math.max(((stop.p[0] - p[0]) * sx) ** 2 + ((stop.p[1] - p[1]) * sy) ** 2, 1e-8);
        const color = parseColor(stop.color);
        const srgb = fromXYZ("srgb", toXYZ(color.space, color.c.map(v => Number.isNaN(v) ? 0 : v)));
        srgb.forEach((v, k) => sum[k] += weight * v);
        sum[3] += weight * stop.opacity;
        total += weight;
    }
    const hex = sum.slice(0, 3).map(v => Math.round(clamp(v / total, 0, 1) * 255).toString(16).padStart(2, "0")).join("");
    return { color: `#${hex}`, opacity: Math.round(sum[3] / total) };
}

function addStop(p) {
    const { color, opacity } = colorAt(p);
    state.stops.push({ p, color, opacity, spread: 0 });
    return state.stops.length - 1;
}

// Removes a stop, and any line left with fewer than two; their last stop becomes a point.
function deleteStop(index) {
    state.stops.splice(index, 1);
    const drawn = drawing !== null ? state.lines[drawing] : null;
    for (const line of state.lines)
        line.stops = line.stops.filter(i => i !== index).map(i => i > index ? i - 1 : i);
    state.lines = state.lines.filter(line => line.stops.length > 1 || line === drawn && line.stops.length);
    for (const line of state.lines) {
        if (line.stops.length < 3)
            line.closed = false;
    }
    drawing = drawn && state.lines.includes(drawn) ? state.lines.indexOf(drawn) : null;
    selection = null;
}

// Ends the line being drawn. A line of one stop is no line, and its stop is a point.
function finishLine() {
    if (drawing === null)
        return;
    if (state.lines[drawing].stops.length < 2)
        state.lines.splice(drawing, 1);
    drawing = null;
    changed();
}

function setMode(name) {
    if (mode !== name)
        finishLine();
    mode = name;
    changed();
}

// In Lines, clicking a stop at the end of a line carries on drawing that line from it.
function continueFrom(index) {
    for (let l = 0; l < state.lines.length; ++l) {
        const line = state.lines[l];
        if (line.closed)
            continue;
        if (line.stops.at(-1) === index)
            return l;
        if (line.stops[0] === index) {
            line.stops.reverse();
            return l;
        }
    }
    // Otherwise a new line starts from it.
    state.lines.push({ stops: [index], closed: false });
    return state.lines.length - 1;
}

for (const view of views) {
    const overlay = view.overlay;
    const point = event => {
        const rect = overlay.getBoundingClientRect();
        return [event.clientX - rect.left, event.clientY - rect.top];
    };
    const fraction = event => {
        const rect = overlay.getBoundingClientRect();
        return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
    };

    overlay.addEventListener("pointerdown", event => {
        if (event.button !== 0)
            return;
        event.preventDefault();
        try {
            overlay.setPointerCapture(event.pointerId);
        } catch { }
        const at = fraction(event);
        const hit = hitTest(view, point(event));
        if (hit?.kind === "section") {
            drag = { kind: "section", end: hit.end };
        } else if (hit?.kind === "spread") {
            drag = { kind: "spread", index: hit.index };
        } else if (hit?.kind === "stop") {
            if (mode === "lines") {
                const line = drawing !== null ? state.lines[drawing] : null;
                if (line && hit.index !== line.stops.at(-1)) {
                    // Clicking the line's first stop closes it; any other stop joins the line to it.
                    if (hit.index === line.stops[0] && line.stops.length > 2) {
                        line.closed = true;
                        drawing = null;
                    } else if (!line.stops.includes(hit.index)) {
                        line.stops.push(hit.index);
                    }
                } else if (!line) {
                    drawing = continueFrom(hit.index);
                }
            }
            selection = hit.index;
            drag = { kind: "stop", index: hit.index, start: at, origin: state.stops[hit.index].p.slice(), moved: false };
        } else if (hit?.kind === "line" && mode === "lines" && drawing === null) {
            // A click on a line adds a stop there, in the color the line has there.
            const line = state.lines[hit.line];
            const p = bezier(hit.stretch.bezier, hit.t);
            const from = state.stops[hit.stretch.from], to = state.stops[hit.stretch.to];
            const color = colorMix(from.color, to.color, hit.t);
            state.stops.push({ p, color, opacity: Math.round(from.opacity + (to.opacity - from.opacity) * hit.t), spread: 0 });
            const index = state.stops.length - 1;
            line.stops.splice(line.stops.indexOf(hit.stretch.from) + 1, 0, index);
            selection = index;
            drag = { kind: "stop", index, start: at, origin: p.slice(), moved: false };
        } else if (mode === "lines") {
            const index = addStop(at);
            if (drawing === null) {
                state.lines.push({ stops: [index], closed: false });
                drawing = state.lines.length - 1;
            } else {
                state.lines[drawing].stops.push(index);
            }
            selection = index;
            drag = { kind: "stop", index, start: at, origin: at.slice(), moved: false };
        } else {
            selection = addStop(at);
            drag = { kind: "stop", index: selection, start: at, origin: at.slice(), moved: false };
        }
        changed();
    });

    overlay.addEventListener("pointermove", event => {
        const at = fraction(event);
        if (!drag) {
            const hit = hitTest(view, point(event));
            overlay.style.cursor = !hit ? "crosshair" : hit.kind === "section" ? "move" : hit.kind === "spread" ? "ew-resize" : hit.kind === "stop" ? "grab" : mode === "lines" ? "copy" : "crosshair";
            return;
        }
        if (drag.kind === "section") {
            state.section[drag.end] = [clamp(at[0], 0, 1), clamp(at[1], 0, 1)];
            changed();
            return;
        }
        const stop = state.stops[drag.index];
        if (!stop)
            return;
        if (drag.kind === "spread") {
            const [sx, sy] = boxScale();
            const reach = Math.hypot((at[0] - stop.p[0]) * sx, (at[1] - stop.p[1]) * sy);
            stop.spread = Math.round(clamp((reach - STOP_RADIUS) / (FULL_SPREAD - STOP_RADIUS), 0, 1) * 100);
        } else {
            const delta = subtract(at, drag.start);
            drag.moved ||= Math.hypot(delta[0] * overlay.clientWidth, delta[1] * overlay.clientHeight) > 2;
            stop.p = [drag.origin[0] + delta[0], drag.origin[1] + delta[1]];
        }
        changed();
    });

    const endDrag = () => {
        if (!drag)
            return;
        const finished = drag;
        drag = null;
        // A stop dragged out of the box goes.
        if (finished.kind === "stop" && outside(state.stops[finished.index]?.p ?? [0, 0]))
            deleteStop(finished.index);
        changed();
    };
    overlay.addEventListener("pointerup", endDrag);
    overlay.addEventListener("pointercancel", endDrag);

    // A double-click ends the line being drawn.
    overlay.addEventListener("dblclick", () => finishLine());
}

for (const button of document.querySelectorAll("#toolbar button[data-mode]"))
    button.addEventListener("click", () => setMode(button.dataset.mode));

// Two colors mixed in sRGB, as a new stop on a line takes them.
function colorMix(a, b, t) {
    const toSRGB = text => {
        const color = parseColor(text);
        return fromXYZ("srgb", toXYZ(color.space, color.c.map(v => Number.isNaN(v) ? 0 : v)));
    };
    const ca = toSRGB(a), cb = toSRGB(b);
    return "#" + ca.map((v, k) => Math.round(clamp(v + (cb[k] - v) * t, 0, 1) * 255).toString(16).padStart(2, "0")).join("");
}

// MARK: - Controls

$("preset").add(new Option("Custom", ""));
PRESETS.forEach((preset, index) => $("preset").add(new Option(preset.name, String(index))));

function matchingPreset() {
    const describe = ({ width, height, stops, lines }) => JSON.stringify([width, height, stops, lines]);
    const current = describe(state);
    return PRESETS.findIndex(preset => describe(preset.state) === current);
}

const MODE_NOTES = {
    points: "Points: click to add a stop, in the color around it, and drag stops to move them. Drag a stop out of the box to remove it. Drag the dashed circle around a selected stop to change its spread.",
    lines: "Lines: click to add stops along a line; it curves through them once it has three. Double-click or press Finish line to end it. Click a stop at the end of a line to carry on from it, the first stop to close the line, another line's end to join them, or a line to add a stop on it.",
};

function updateControls() {
    const preset = matchingPreset();
    $("preset").value = preset < 0 ? "" : String(preset);
    $("presetNote").textContent = PRESETS[preset]?.note ?? "";
    $("presetNote").hidden = !PRESETS[preset]?.note;

    $("view").value = state.view;
    for (const option of $("view").options)
        option.disabled = !viewAvailable(option.value);
    $("viewNote").textContent = VIEW_NOTES[state.view];
    $("levelRow").hidden = state.view !== "level";
    $("stepsRow").hidden = state.view !== "relaxation";
    const levels = views.find(view => !view.figure.hidden)?.renderer?.levels ?? [];
    $("level").max = String(Math.max(0, levels.length - 1));
    $("level").value = String(state.level);
    const level = levels[Math.min(state.level, levels.length - 1)];
    $("levelValue").textContent = level ? `${Math.min(state.level, levels.length - 1)}: ${level.width} × ${level.height}` : String(state.level);
    $("steps").value = String(state.steps);
    $("stepsValue").textContent = (2 ** state.steps).toLocaleString();
    $("playSteps").textContent = playing ? "Stop" : "Play";
    for (const id of ["crossSection", "sheet", "numbers"]) {
        $(id).checked = state[id];
        $(id + "Note").hidden = !state[id];
    }
    $("sheetRow").hidden = !state.sheet;
    const heights = sheetHeights(state.space);
    if ($("sheetHeight").dataset.space !== String(state.space)) {
        $("sheetHeight").replaceChildren(...heights.map(height => new Option(height.label, height.value)));
        $("sheetHeight").dataset.space = String(state.space);
    }
    $("sheetHeight").value = sheetHeight(state.space).value;
    for (const id of ["width", "height"]) {
        if (document.activeElement !== $(id))
            $(id).value = state[id];
    }
    $("space").value = String(state.space);
    $("resolution").value = String(state.resolution);
    $("showStops").checked = state.showStops;
    for (const button of document.querySelectorAll("#modelBar button"))
        button.setAttribute("aria-pressed", String(state.models.includes(button.dataset.model)));
    for (const button of document.querySelectorAll("#toolbar button[data-mode]"))
        button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    $("modeNote").textContent = MODE_NOTES[mode];
    const onLines = state.stops.filter((_, i) => linesThrough(i).length).length;
    $("countNote").textContent = `${state.stops.length} stop${state.stops.length === 1 ? "" : "s"}: ${state.stops.length - onLines} point${state.stops.length - onLines === 1 ? "" : "s"}, ${onLines} on ${state.lines.length} line${state.lines.length === 1 ? "" : "s"}.`;

    updateStopList();

    const selected = selection !== null ? state.stops[selection] : null;
    $("stopFields").hidden = !selected;
    $("deleteStop").hidden = !selected;
    $("finishLine").hidden = drawing === null;
    if (!selected)
        $("stopTitle").textContent = "Stops";
    if (selected) {
        const lines = linesThrough(selection).map(line => state.lines.indexOf(line) + 1);
        const onLine = lines.length > 0;
        $("stopTitle").textContent = `Stop ${selection + 1}${onLine ? `, on line${lines.length > 1 ? "s" : ""} ${lines.join(" and ")}` : ", a point"}`;
        if (document.activeElement !== $("stopText"))
            $("stopText").value = selected.color;
        $("stopPicker").value = hexColor(selected.color);
        for (const [id, axis] of [["stopX", 0], ["stopY", 1]]) {
            if (document.activeElement !== $(id))
                $(id).value = Math.round(selected.p[axis] * 1000) / 10;
        }
        for (const [id, value] of [["opacity", selected.opacity], ["spread", selected.spread]]) {
            $(id).value = value;
            $(id + "Value").textContent = value + "%";
        }
        $("spreadRow").hidden = onLine;
        $("spreadNote").hidden = !onLine;
    }
}

// Each line with its stops in order, then the points, each stop a swatch that selects it.
let stopListKey = null;
function updateStopList() {
    const list = $("stopList");
    const points = state.stops.map((_, i) => i).filter(i => !linesThrough(i).length);
    const groups = [
        ...state.lines.map((line, l) => ({ label: `Line ${l + 1}`, stops: line.stops, closed: line.closed && line.stops.length > 2, line: l })),
        ...(points.length ? [{ label: "Points", stops: points, closed: false, line: null }] : []),
    ];
    const key = JSON.stringify(groups);
    if (key !== stopListKey) {
        stopListKey = key;
        list.replaceChildren(...groups.map(group => {
            const row = document.createElement("div");
            row.className = "group";
            row.dataset.line = group.line ?? "";
            const label = document.createElement("span");
            label.textContent = group.label;
            const swatches = document.createElement("div");
            swatches.className = "swatches";
            for (const index of group.stops) {
                const button = document.createElement("button");
                button.dataset.stop = index;
                button.append(document.createElement("span"));
                button.addEventListener("click", () => {
                    selection = index;
                    changed();
                });
                swatches.append(button);
            }
            if (group.closed)
                swatches.append(Object.assign(document.createElement("span"), { className: "joint", textContent: "↺", title: "Closed: the line runs back to its first stop" }));
            row.append(label, swatches);
            if (group.line !== null) {
                const remove = Object.assign(document.createElement("button"), { className: "small", textContent: "×", title: "Delete this line and its stops" });
                remove.addEventListener("click", () => {
                    // Its stops go too, but not one that joins it to another line.
                    const [line] = state.lines.splice(group.line, 1);
                    drawing = null;
                    for (const index of line.stops.filter(i => !linesThrough(i).length).sort((a, b) => b - a))
                        deleteStop(index);
                    changed();
                });
                row.append(remove);
            }
            return row;
        }));
    }
    for (const button of list.querySelectorAll("button[data-stop]")) {
        const stop = state.stops[Number(button.dataset.stop)];
        button.firstChild.style.background = stop.color;
        button.firstChild.style.opacity = stop.opacity / 100;
        button.title = `${stop.color}${stop.opacity < 100 ? `, ${stop.opacity}%` : ""}`;
        button.classList.toggle("selected", Number(button.dataset.stop) === selection);
    }
    for (const row of list.children)
        row.classList.toggle("drawing", row.dataset.line !== "" && Number(row.dataset.line) === drawing);
}

// A CSS color as the sRGB hex a color well takes, clipped.
function hexColor(text) {
    const color = parseColor(text) ?? parseColor("black");
    const srgb = fromXYZ("srgb", toXYZ(color.space, color.c.map(v => Number.isNaN(v) ? 0 : v)));
    return "#" + srgb.map(v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, "0")).join("");
}

$("stopPicker").addEventListener("input", () => {
    if (selection === null)
        return;
    state.stops[selection].color = $("stopPicker").value;
    $("stopText").value = $("stopPicker").value;
    changed();
});
$("stopText").addEventListener("input", () => {
    if (selection === null || !parseColor($("stopText").value.trim()))
        return;
    state.stops[selection].color = $("stopText").value.trim();
    changed();
});
$("stopText").addEventListener("change", () => updateControls());
// A new stop goes in the middle of the box, or beside the selected one, in the color there.
$("addStop").addEventListener("click", () => {
    const near = selection !== null ? state.stops[selection].p : null;
    const p = near ? [clamp(near[0] + 0.08, 0.02, 0.98), clamp(near[1] + 0.08, 0.02, 0.98)] : [0.5, 0.5];
    selection = addStop(p);
    changed();
});
for (const [id, axis] of [["stopX", 0], ["stopY", 1]]) {
    $(id).addEventListener("change", () => {
        const value = parseFloat($(id).value);
        if (selection !== null && Number.isFinite(value))
            state.stops[selection].p[axis] = clamp(value, 0, 100) / 100;
        changed();
    });
}
for (const id of ["opacity", "spread"]) {
    $(id).addEventListener("input", () => {
        if (selection === null)
            return;
        adjusting = true;
        state.stops[selection][id] = Number($(id).value);
        changed();
    });
    $(id).addEventListener("change", () => {
        adjusting = false;
        changed();
    });
}
$("deleteStop").addEventListener("click", () => {
    if (selection === null)
        return;
    deleteStop(selection);
    changed();
});
$("finishLine").addEventListener("click", finishLine);
$("clearStops").addEventListener("click", () => {
    state.stops = [];
    state.lines = [];
    selection = null;
    drawing = null;
    changed();
});
$("preset").addEventListener("change", () => {
    if ($("preset").value === "")
        return updateControls();
    state = { ...presetState(Number($("preset").value)) };
    selection = null;
    drawing = null;
    changed();
});
for (const id of ["width", "height"]) {
    $(id).addEventListener("change", () => {
        const value = parseInt($(id).value, 10);
        if (Number.isFinite(value))
            state[id] = clamp(value, 100, 2000);
        changed();
    });
}
$("space").addEventListener("change", () => {
    state.space = Number($("space").value);
    changed();
});
$("resolution").addEventListener("change", () => {
    state.resolution = Number($("resolution").value);
    changed();
});
$("showStops").addEventListener("change", () => {
    state.showStops = $("showStops").checked;
    changed();
});
// Either model, or both side by side, but at least one.
for (const button of document.querySelectorAll("#modelBar button")) {
    button.addEventListener("click", () => {
        const model = button.dataset.model;
        const on = state.models.includes(model);
        if (on && state.models.length === 1)
            return;
        state.models = ["biharmonic", "harmonic"].filter(other => other === model ? !on : state.models.includes(other));
        if (!viewAvailable(state.view))
            state.view = "gradient";
        changed();
    });
}

$("view").addEventListener("change", () => {
    state.view = $("view").value;
    changed();
});
$("level").addEventListener("input", () => {
    state.level = Number($("level").value);
    changed();
});
$("steps").addEventListener("input", () => {
    stopPlaying();
    state.steps = Number($("steps").value);
    changed();
});
for (const id of ["crossSection", "sheet", "numbers"]) {
    $(id).addEventListener("change", () => {
        state[id] = $(id).checked;
        changed();
    });
}
$("sheetHeight").addEventListener("change", () => {
    state.sheetHeight = $("sheetHeight").value;
    changed();
});

// Playing the relaxation doubles its steps twice a second, from 1 to 4,096, so the colors are seen spreading at every
// scale.
let playing = null;
function stopPlaying() {
    if (playing)
        cancelAnimationFrame(playing.frame);
    playing = null;
}
$("playSteps").addEventListener("click", () => {
    if (playing) {
        stopPlaying();
        updateControls();
        return;
    }
    playing = { start: performance.now(), frame: 0 };
    const tick = now => {
        const steps = Math.min(12, Math.floor((now - playing.start) / 500));
        if (steps !== state.steps) {
            state.steps = steps;
            changed();
        }
        if (steps >= 12) {
            stopPlaying();
            updateControls();
        } else {
            playing.frame = requestAnimationFrame(tick);
        }
    };
    state.steps = 0;
    changed();
    playing.frame = requestAnimationFrame(tick);
});

// MARK: - URL fragment

function encodeState() {
    const json = JSON.stringify({ v: 1, ...state });
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeState(text) {
    try {
        const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
        const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, ch => ch.charCodeAt(0))));
        if (data.v !== 1 || !Array.isArray(data.stops) || !Array.isArray(data.lines))
            return null;
        delete data.v;
        return { ...presetState(0), ...data };
    } catch {
        return null;
    }
}

// WebKit throws after 100 replaceState() calls in 10 seconds, so writes are throttled.
let hashTimer = null;
let lastWrittenHash = "";
function writeHash() {
    clearTimeout(hashTimer);
    hashTimer = null;
    const hash = "#" + encodeState();
    if (hash === lastWrittenHash)
        return;
    try {
        history.replaceState(null, "", hash);
        lastWrittenHash = hash;
    } catch {
        hashTimer = setTimeout(writeHash, 1000);
    }
}
function scheduleHashWrite() {
    if (hashTimer === null)
        hashTimer = setTimeout(writeHash, 250);
}

// MARK: - Start

new ResizeObserver(() => scheduleRender()).observe($("views"));
state = decodeState(location.hash.slice(1)) ?? presetState(0);
render();
setUpGPU().then(() => scheduleRender(), error => {
    gpuError = error.message;
    scheduleRender();
});
</script>
</body>
</html>
