"use strict";

__COLORS__

// MARK: - Renderer

// MeshShader2's WebGPU freeform gradient renderer: its constraint rasterizer, harmonic and biharmonic multigrids,
// and the sharp edges drawn along two-sided lines. See tools/diffusion-gradient-editor/vendor/README.md.
__RENDERER__

const SHADER = __SHADER__;

// MARK: - State

// A curve is a chain of Bézier nodes, open or closed, with a color on each side. Positions are fractions of the box,
// 0 to 1 across and down; a node's `in` and `out` handles are offsets from it, in the same units, and zero for none.
// An open curve's colors are `left` and `right`, as seen going from its first node to its last with y down. A closed
// curve's are `inside` and `outside`.
let state = null;

// A node is smooth when its handles are opposite, so moving one turns the other, and a corner otherwise.
const node = (x, y, inX = 0, inY = 0, outX = -inX, outY = -inY) => ({
    p: [x, y], in: [inX, inY], out: [outX, outY],
    kind: (inX || inY) && Math.abs(inX * outY - inY * outX) < 1e-9 && inX * outX + inY * outY < 0 ? "smooth" : "corner",
});

// An ellipse as four nodes, going clockwise on screen. Its center and radii are fractions of the box, so it's an
// ellipse in the box's own proportions; `angle` turns it, in degrees.
function ellipse(cx, cy, rx, ry, angle = 0) {
    const k = 0.5523;
    const turn = angle * Math.PI / 180, cos = Math.cos(turn), sin = Math.sin(turn);
    const rotate = ([x, y]) => [x * cos - y * sin, x * sin + y * cos];
    return [0, 1, 2, 3].map(i => {
        const phi = i * Math.PI / 2;
        const [px, py] = rotate([rx * Math.cos(phi), ry * Math.sin(phi)]);
        const [tx, ty] = rotate([-rx * Math.sin(phi) * k, ry * Math.cos(phi) * k]);
        return node(cx + px, cy + py, -tx, -ty, tx, ty);
    });
}

const PRESETS = [
    {
        name: "A line between two colors",
        note: "One open curve, orange above and blue below. Past its ends the two sides meet, and the jump fades out. Show the lines of equal lightness to see how differently the two models round its ends.",
        state: {
            width: 600, height: 400,
            curves: [{ closed: false, nodes: [node(0.15, 0.5), node(0.85, 0.5)], left: "#ff6b3d", right: "#3d7bff" }],
        },
    },
    {
        name: "A circle",
        note: "One closed curve, red inside and blue outside. Show where it leaves sRGB: the biharmonic model overshoots on both sides of the jump.",
        state: {
            width: 600, height: 400,
            curves: [{ closed: true, nodes: ellipse(0.5, 0.5, 0.2, 0.3), inside: "#d93a2b", outside: "#1e88ff" }],
        },
    },
    {
        name: "Overlapping shapes",
        note: "Shapes over shapes, and two open curves the same light gray on both sides, which hold the color like strokes.",
        state: {
            width: 500, height: 500,
            curves: [
                { closed: true, nodes: ellipse(0.45, 0.4, 0.12, 0.12), inside: "#d33b2c", outside: "#1e88ff" },
                { closed: true, nodes: ellipse(0.36, 0.45, 0.08, 0.36, 18), inside: "#d7f20a", outside: "#ebebeb" },
                { closed: false, nodes: [node(0.28, 0.78, 0, 0, 0.08, 0.16), node(0.52, 0.86, -0.08, 0.02, 0.06, -0.02), node(0.52, 0.62, 0, 0.1, 0.06, -0.08), node(0.66, 0.56)], left: "#ebebeb", right: "#ebebeb" },
                { closed: false, nodes: [node(0.64, 0.38, 0, 0, 0.14, 0.02), node(0.74, 0.62, 0.04, -0.12)], left: "#ebebeb", right: "#ebebeb" },
            ],
        },
    },
    {
        name: "Two jumps close together",
        note: "A black stripe between two white fields. The biharmonic model keeps each jump's slope going, so it goes whiter than white outside the stripe and blacker than black inside it, and both are clipped. The harmonic model can't go past the colors it holds. Turn on the cross-section to see it.",
        state: {
            width: 600, height: 400,
            curves: [
                { closed: false, nodes: [node(0.15, 0.45), node(0.85, 0.45)], left: "#ffffff", right: "#000000" },
                { closed: false, nodes: [node(0.15, 0.55), node(0.85, 0.55)], left: "#000000", right: "#ffffff" },
            ],
        },
    },
    {
        name: "Strength",
        note: "Three lines with the same colors, held at 100%, 60% and 30%. A weaker hold lets the colors around a line bleed into it. Only the harmonic model takes strength for now. Show what the curves hold to see the weaker lines' texels held only in part.",
        state: {
            width: 600, height: 400,
            curves: [0.25, 0.5, 0.75].map((x, i) => ({
                closed: false, nodes: [node(x, 0.2), node(x, 0.8)], left: "#7a2cff", right: "#ffc400", strength: [100, 60, 30][i],
            })),
        },
    },
    {
        name: "Blur",
        note: "Three circles, blurred 0, 20 and 60 px. A blurred curve is held as two one-sided copies, moved apart by the blur, and the solve fills the band between them. Show what the curves hold to see the copies.",
        state: {
            width: 600, height: 300,
            curves: [0.2, 0.5, 0.8].map((x, i) => ({
                closed: true, nodes: ellipse(x, 0.5, 0.1, 0.2), inside: "#ff3d7f", outside: "#1b1f3b", blur: [0, 20, 60][i],
            })),
        },
    },
    {
        name: "Rings",
        note: "Circles inside circles, each the same color on both sides. With no jumps, they're like the stops of a gradient, and the colors diffuse between them. The harmonic model is creased along each ring, and the biharmonic one bends smoothly through them. Turn on 3D to see the shapes.",
        state: {
            width: 500, height: 500,
            curves: [[0.08, "#fff1a8"], [0.22, "#ff9a1f"], [0.36, "#c4204f"], [0.48, "#2b1055"]].map(([radius, color]) => ({
                closed: true, nodes: ellipse(0.5, 0.5, radius, radius), inside: color, outside: color,
            })),
        },
    },
    {
        name: "A leaf",
        note: "A closed curve with two corner nodes, and a vein the same green on both sides.",
        state: {
            width: 600, height: 400,
            curves: [
                { closed: true, nodes: [node(0.2, 0.62, 0.1, 0.04, 0.06, -0.14), node(0.48, 0.34, -0.14, 0.03), node(0.8, 0.38, -0.1, -0.04, -0.06, 0.14), node(0.52, 0.66, 0.14, -0.03)], inside: "#82cf6c", outside: "#f4f1e6" },
                { closed: false, nodes: [node(0.24, 0.6, 0, 0, 0.2, -0.04), node(0.76, 0.4, -0.2, 0.04)], left: "#2f7a32", right: "#2f7a32" },
            ],
        },
    },
    {
        name: "Sunset",
        note: "A sky, a sun blurred into it, and two hills: a few curves make a whole picture.",
        state: {
            width: 600, height: 400,
            curves: [
                { closed: false, nodes: [node(0, 0.06), node(1, 0.06)], left: "#1c2a6b", right: "#3a4fb0" },
                { closed: true, nodes: ellipse(0.64, 0.44, 0.07, 0.105), inside: "#fff5c2", outside: "#ffb15e", blur: 36 },
                { closed: false, nodes: [node(0, 0.62, 0, 0, 0.14, -0.06), node(0.38, 0.54, -0.12, 0, 0.14, 0), node(0.72, 0.6, -0.1, 0, 0.12, 0), node(1, 0.52, -0.1, 0.02)], left: "#ff9757", right: "#3f6b3c" },
                { closed: false, nodes: [node(0, 0.84, 0, 0, 0.2, -0.08), node(0.52, 0.76, -0.18, 0, 0.18, 0), node(1, 0.9, -0.18, -0.04)], left: "#4a7d42", right: "#1f3b22" },
            ],
        },
    },
];

function presetState(index) {
    return {
        space: state?.space ?? 2,
        resolution: state?.resolution ?? 512,
        models: state?.models ?? ["biharmonic", "harmonic"],
        showCurves: state?.showCurves ?? true,
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

// MARK: - Curves to segments

const boxScale = () => {
    const shorter = Math.min(state.width, state.height);
    return [state.width / shorter, state.height / shorter];
};

// Each stretch of a curve, as its four Bézier points.
function stretches(curve) {
    const { nodes } = curve;
    const count = curve.closed && nodes.length > 2 ? nodes.length : nodes.length - 1;
    const result = [];
    for (let i = 0; i < count; ++i) {
        const a = nodes[i], b = nodes[(i + 1) % nodes.length];
        result.push([a.p, [a.p[0] + a.out[0], a.p[1] + a.out[1]], [b.p[0] + b.in[0], b.p[1] + b.in[1]], b.p]);
    }
    return result;
}

function bezier([p0, p1, p2, p3], t) {
    const u = 1 - t;
    return [0, 1].map(k => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
}

// A curve flattened into straight pieces, [x0, y0, x1, y1] in fractions of the box. As MeshShader2 does, a curved
// stretch takes a piece for each 0.01 of its control polygon's length, in units of the box's shorter side, from 4 to 64.
function pieces(curve) {
    const [sx, sy] = boxScale();
    const length = (a, b) => Math.hypot((b[0] - a[0]) * sx, (b[1] - a[1]) * sy);
    const result = [];
    for (const stretch of stretches(curve)) {
        const [p0, p1, p2, p3] = stretch;
        const straight = p1[0] === p0[0] && p1[1] === p0[1] && p2[0] === p3[0] && p2[1] === p3[1];
        const count = straight ? 1 : Math.min(64, Math.max(4, Math.ceil((length(p0, p1) + length(p1, p2) + length(p2, p3)) / 0.01)));
        let previous = p0;
        for (let i = 1; i <= count; ++i) {
            const next = bezier(stretch, i / count);
            result.push([previous[0], previous[1], next[0], next[1]]);
            previous = next;
        }
    }
    return result;
}

// A closed curve's inside is on its right when it goes clockwise on screen, which is a positive signed area with y
// down.
function sideColors(curve, flat) {
    if (!curve.closed)
        return [curve.left, curve.right];
    const [sx, sy] = boxScale();
    const area = flat.reduce((sum, [x0, y0, x1, y1]) => sum + (x0 * sx) * (y1 * sy) - (x1 * sx) * (y0 * sy), 0);
    return area > 0 ? [curve.outside, curve.inside] : [curve.inside, curve.outside];
}

// The interpolation spaces the renderer's shader knows.
const SHADER_SPACES = ["srgb", "srgb-linear", "oklab"];

// A color's components in the interpolation space, premultiplied, as the renderer takes them.
function premultiplied(text) {
    const color = parseColor(text) ?? parseColor("black");
    const alpha = Number.isNaN(color.alpha) ? 0 : color.alpha;
    const c = fromXYZ(SHADER_SPACES[state.space], toXYZ(color.space, color.c.map(v => Number.isNaN(v) ? 0 : v)));
    return [c[0] * alpha, c[1] * alpha, c[2] * alpha, alpha];
}

// How far either side of a curve its colors are held, in units of the box's shorter side: MeshShader2's default
// point radius. The renderer would hold a two-sided line across at least 1.5 texels, but a band that thin stops the
// biharmonic solve from settling, more so the finer the grid: a circle red inside and blue outside comes out
// overshooting far past both colors.
const CURVE_RADIUS = 0.01;

// A curve's pieces moved `distance` to its left, or right if negative, in units of the box's shorter side: each joint
// along the mitre of its two pieces' normals.
function offsetPieces(flat, distance, closed) {
    const [sx, sy] = boxScale();
    const normals = flat.map(([x0, y0, x1, y1]) => {
        const dx = (x1 - x0) * sx, dy = (y1 - y0) * sy;
        const length = Math.hypot(dx, dy) || 1;
        return [dy / length, -dx / length];
    });
    const count = flat.length;
    const joints = [];
    for (let i = 0; i <= count; ++i) {
        const before = normals[i > 0 ? i - 1 : closed ? count - 1 : 0];
        const after = normals[i < count ? i : closed ? 0 : count - 1];
        const mitre = [(before[0] + after[0]) / 2, (before[1] + after[1]) / 2];
        const scale = distance / Math.max(mitre[0] ** 2 + mitre[1] ** 2, 0.25);
        const [x, y] = i < count ? flat[i] : flat[count - 1].slice(2);
        joints.push([x + mitre[0] * scale / sx, y + mitre[1] * scale / sy]);
    }
    return flat.map((_, i) => [...joints[i], ...joints[i + 1]]);
}

// The gradient as MeshShader2's renderer takes it: each piece of each curve a segment with its two sides' colors,
// and each curve's own pieces, so it knows where open ends are. While something's being dragged, the grid is at most
// 256 texels across, to keep up.
//
// A curve's strength is how firmly its segments hold their colors, its cube, since the solve barely gives at all above
// a weight of 0.3. FIXME: Only the harmonic model takes it. Held less than fully, a curve's jump makes the biharmonic
// solve overshoot far out of gamut, and not more so the weaker the hold, so it isn't just the model.
//
// A blurred curve is two one-sided copies of it
// instead, each holding one side's color, moved apart by the blur, so the solve fills the band between them.
function gradientData(model) {
    const segments = [], strengths = [], lines = [], colors = [];
    const add = (flat, left, right, twoSided, strength, closed) => {
        for (const [x0, y0, x1, y1] of flat) {
            segments.push(...left, ...left, ...right, ...right, x0, y0, x1, y1, CURVE_RADIUS, CURVE_RADIUS, twoSided ? 1 : 0);
            strengths.push(strength);
        }
        lines.push({ ends: flat.flat(), closed });
    };
    for (const curve of state.curves) {
        const flat = pieces(curve);
        if (!flat.length)
            continue;
        const [left, right] = sideColors(curve, flat).map(premultiplied);
        colors.push(left, right);
        const strength = model === "harmonic" ? ((curve.strength ?? 100) / 100) ** 3 : 1;
        const blur = (curve.blur ?? 0) / Math.min(state.width, state.height);
        if (blur > 0) {
            const distance = blur / 2 + CURVE_RADIUS;
            add(offsetPieces(flat, distance, curve.closed), left, left, false, strength, curve.closed);
            add(offsetPieces(flat, -distance, curve.closed), right, right, false, strength, curve.closed);
        } else {
            add(flat, left, right, true, strength, curve.closed);
        }
    }
    const average = [0, 1, 2, 3].map(k => colors.length ? colors.reduce((sum, c) => sum + c[k], 0) / colors.length : 0);
    return {
        space: state.space, resolution: (drag && drag.kind !== "section") || adjusting ? Math.min(state.resolution, 256) : state.resolution, model,
        isEmpty: !segments.length, average, points: [], segments, strengths, lines,
        hasTwoSidedLines: segments.some((_, i) => i % 23 === 22 && segments[i] !== 0), isOpaque: colors.every(c => c[3] >= 1),
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
// solution, the colors its curves hold and how firmly, and for the difference, the other box's solution. Also reads a
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

// Modes: 1 what the curves hold, 2 where it leaves sRGB, 3 lines of equal lightness, 4 the difference from the other
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
    gradient: "The gradient each model draws from the same curves.",
    holds: "Every texel of the grid is worked out from the texels the curves hold, shown here in the colors they're held to, over the faded gradient. A curve holds a band 1% of the box's shorter side either side of it, each side its own color. Below 100% strength, its texels are held only in part, so the colors around them bleed in. A blurred curve is held as two one-sided copies, moved apart by the blur, and the solve fills the band between them. Set Grid to 128 to see the texels.",
    gamut: "Hatching marks where the solved colors fall outside sRGB, so they're clipped to draw them. The harmonic model makes each texel the average of its neighbors, so it can't go past the colors it's held to. The biharmonic model keeps the slope smooth through each curve, so past a jump it keeps going, and overshoots. In oklab, a mix of two colors inside sRGB can also fall outside it, in either model.",
    isolines: "Lines of equal lightness, every 0.025 of Oklab L. The harmonic model is a membrane: its lines bunch up at the curves and kink where they end, since it's continuous there but not smooth. The biharmonic model is a stiff sheet: its lines bend smoothly around a curve's end, since its slope is continuous too.",
    difference: "White where the two models agree, purple where they differ, darkest at a difference of 0.15 in Oklab (ΔE OK) or more. Both boxes show the same difference.",
    level: "The solve runs on a pyramid of grids, each half the size of the one above it. The coarsest is solved outright, and each finer level starts from the one below, scaled up, so it only has to fix the detail. This shows one level's texels as they are, unfiltered, with the texels the curves hold marked. Level 0 is the finest, the one that's drawn.",
    relaxation: "The harmonic model's finest grid, started from the curves' average color and relaxed without the pyramid: each step moves every texel toward the average of its four neighbors. The colors creep out from the curves a texel or two a step, so a fine grid would take hundreds of thousands of steps to settle. That's why the solve starts coarse. The biharmonic box shows its gradient.",
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

// The harmonic model's finest grid started from the curves' average color and smoothed `steps` times, without the
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
// there, over bars of how firmly the curves hold each point.
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
    const component = state.sheetHeight === "L" ? -1 : "rgb".indexOf(state.sheetHeight);
    const heightOf = color => component < 0 ? color.L : color.rgb[component];
    const heights = [];
    for (let j = 0; j <= rows; ++j) {
        heights.push([]);
        for (let i = 0; i <= columns; ++i)
            heights[j].push(heightOf(appearance(sampleReadout(readout, [i / columns, j / rows]), readout.space)));
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
    const label = component < 0 ? "L" : state.sheetHeight;
    ctx.fillStyle = `rgba(${ink}, 0.6)`;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`${label} = 1`, top[0][0] + 6, top[0][1] - 4);
    ctx.fillText(`${label} = 0`, floor[0][0] + 6, floor[0][1] + 14);

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
        // Where the cross-section cuts the surface: the curves the plot draws.
        const [a, b] = state.section;
        const points = [];
        for (let i = 0; i <= 80; ++i) {
            const t = i / 80, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            points.push(project(p[0], p[1], heightOf(appearance(sampleReadout(readout, p), readout.space))));
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

// Where a curve's two swatches sit, in CSS pixels of a box `size` across and down: either side of the middle of its
// first stretch, left of the direction of travel first. Each comes with the name of the color it shows.
function swatches(curve, size) {
    const stretch = stretches(curve)[0];
    if (!stretch)
        return [];
    const toPixels = ([x, y]) => [x * size[0], y * size[1]];
    const middle = toPixels(bezier(stretch, 0.5));
    const ahead = toPixels(bezier(stretch, 0.51)), behind = toPixels(bezier(stretch, 0.49));
    const tangent = [ahead[0] - behind[0], ahead[1] - behind[1]];
    const length = Math.hypot(...tangent) || 1;
    // Left of the direction of travel, with y down.
    const leftward = [tangent[1] / length, -tangent[0] / length];
    const names = sideNames(curve);
    return [1, -1].map((sign, i) => ({ side: names[i], at: [middle[0] + leftward[0] * 12 * sign, middle[1] + leftward[1] * 12 * sign] }));
}

// The names of the colors on a curve's left and right, going along it with y down.
function sideNames(curve) {
    if (!curve.closed)
        return ["left", "right"];
    const [left] = sideColors({ ...curve, inside: "inside", outside: "outside" }, pieces(curve));
    return left === "inside" ? ["inside", "outside"] : ["outside", "inside"];
}

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

function curvePath(ctx, curve, toPixels) {
    ctx.beginPath();
    stretches(curve).forEach(([p0, p1, p2, p3], i) => {
        if (i === 0)
            ctx.moveTo(...toPixels(p0));
        ctx.bezierCurveTo(...toPixels(p1), ...toPixels(p2), ...toPixels(p3));
    });
    if (curve.closed && curve.nodes.length > 2)
        ctx.closePath();
}

// The curves, a pair of swatches on each showing its two sides' colors, and the selected curve's nodes and handles.
function drawOverlay(view, dpr) {
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
    if (!state.showCurves && tool === "select" && !selection)
        return;
    state.curves.forEach((curve, index) => {
        const selected = selection?.curve === index;
        curvePath(ctx, curve, toPixels);
        for (const [style, width] of [["rgba(0, 0, 0, 0.45)", 3], [selected ? ACCENT : "rgba(255, 255, 255, 0.9)", selected ? 1.75 : 1.25]]) {
            ctx.strokeStyle = style;
            ctx.lineWidth = width;
            ctx.stroke();
        }
        for (const { side, at } of swatches(curve, size)) {
            const half = 4.5;
            ctx.fillStyle = curve[side];
            ctx.fillRect(at[0] - half, at[1] - half, 2 * half, 2 * half);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = "#fff";
            ctx.strokeRect(at[0] - half, at[1] - half, 2 * half, 2 * half);
            ctx.lineWidth = 0.75;
            ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
            ctx.strokeRect(at[0] - half - 1.2, at[1] - half - 1.2, 2 * half + 2.4, 2 * half + 2.4);
        }
        if (!selected)
            return;
        curve.nodes.forEach((node, n) => {
            const at = toPixels(node.p);
            for (const which of ["in", "out"]) {
                if (!node[which][0] && !node[which][1])
                    continue;
                const handle = toPixels([node.p[0] + node[which][0], node.p[1] + node[which][1]]);
                ctx.strokeStyle = ACCENT;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(...at);
                ctx.lineTo(...handle);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(...handle, 4, 0, 2 * Math.PI);
                ctx.fillStyle = "#fff";
                ctx.fill();
                ctx.stroke();
            }
            // Corner nodes are squares, smooth ones circles; the selected node is filled.
            ctx.beginPath();
            if (node.kind === "smooth")
                ctx.arc(...at, 5, 0, 2 * Math.PI);
            else
                ctx.rect(at[0] - 4.5, at[1] - 4.5, 9, 9);
            ctx.fillStyle = selection.node === n ? ACCENT : "#fff";
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = ACCENT;
            ctx.stroke();
        });
    });
}

// MARK: - Editing

let tool = "select";
// The selected curve, by index, and its selected node, if any.
let selection = null;
let drag = null;
// Whether a slider is being moved.
let adjusting = false;
// The curve the pen is adding nodes to.
let penCurve = null;
// The colors new curves take: left, or inside, first.
let newColors = ["#ff6b3d", "#3d7bff"];

const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];

// What's under a point in CSS pixels of `view`'s box: one of the selected curve's handles or nodes, any curve's
// swatch, or any curve's line, in that order.
function hitTest(view, point) {
    const size = [view.overlay.clientWidth, view.overlay.clientHeight];
    const toPixels = ([x, y]) => [x * size[0], y * size[1]];
    const near = (at, radius) => Math.hypot(at[0] - point[0], at[1] - point[1]) <= radius;
    if (state.crossSection) {
        for (const end of [1, 0]) {
            if (near(toPixels(state.section[end]), 9))
                return { kind: "section", end };
        }
    }
    if (selection) {
        const curve = state.curves[selection.curve];
        for (let n = 0; n < curve.nodes.length; ++n) {
            const node = curve.nodes[n];
            for (const which of ["in", "out"]) {
                if ((node[which][0] || node[which][1]) && near(toPixels(add(node.p, node[which])), 7))
                    return { kind: "handle", curve: selection.curve, node: n, which };
            }
        }
        for (let n = 0; n < curve.nodes.length; ++n) {
            if (near(toPixels(curve.nodes[n].p), 8))
                return { kind: "node", curve: selection.curve, node: n };
        }
    }
    for (let index = state.curves.length - 1; index >= 0; --index) {
        for (const { side, at } of swatches(state.curves[index], size)) {
            if (near(at, 8))
                return { kind: "swatch", curve: index, side };
        }
    }
    for (let index = state.curves.length - 1; index >= 0; --index) {
        for (const [x0, y0, x1, y1] of pieces(state.curves[index])) {
            const a = toPixels([x0, y0]), b = toPixels([x1, y1]);
            const along = subtract(b, a), offset = subtract(point, a);
            const t = clamp((offset[0] * along[0] + offset[1] * along[1]) / ((along[0] ** 2 + along[1] ** 2) || 1), 0, 1);
            if (near(add(a, [along[0] * t, along[1] * t]), 6))
                return { kind: "curve", curve: index };
        }
    }
    return null;
}

// A new curve with the new-curve colors, selected.
function addCurve(closed, nodes) {
    const curve = closed ? { closed, nodes, inside: newColors[0], outside: newColors[1] } : { closed, nodes, left: newColors[0], right: newColors[1] };
    state.curves.push(curve);
    selection = { curve: state.curves.length - 1, node: null };
    return selection.curve;
}

// An arc from `start` to `end`, half a circle bulging to the left of the way from one to the other.
function arcNodes(start, end) {
    const [sx, sy] = boxScale();
    const a = [start[0] * sx, start[1] * sy], b = [end[0] * sx, end[1] * sy];
    const chord = subtract(b, a), length = Math.hypot(...chord) || 1e-6;
    const radius = length / 2, k = 0.5523 * radius;
    const along = [chord[0] / length, chord[1] / length], leftward = [along[1], -along[0]];
    const apex = [(a[0] + b[0]) / 2 + leftward[0] * radius, (a[1] + b[1]) / 2 + leftward[1] * radius];
    const toFraction = ([x, y]) => [x / sx, y / sy];
    const scaled = (v, s) => toFraction([v[0] * s, v[1] * s]);
    return [
        { p: start, in: [0, 0], out: scaled(leftward, k), kind: "corner" },
        { p: toFraction(apex), in: scaled(along, -k), out: scaled(along, k), kind: "smooth" },
        { p: end, in: scaled(leftward, k), out: [0, 0], kind: "corner" },
    ];
}

// A freehand stroke as smooth nodes: the points that matter, by Ramer–Douglas–Peucker, with Catmull-Rom handles.
function freehandNodes(points) {
    const [sx, sy] = boxScale();
    const distance = (p, a, b) => {
        const ab = [(b[0] - a[0]) * sx, (b[1] - a[1]) * sy], ap = [(p[0] - a[0]) * sx, (p[1] - a[1]) * sy];
        const length = Math.hypot(...ab);
        return length ? Math.abs(ab[0] * ap[1] - ab[1] * ap[0]) / length : Math.hypot(...ap);
    };
    const simplify = (from, to, keep) => {
        let farthest = -1, worst = 0.004;
        for (let i = from + 1; i < to; ++i) {
            const d = distance(points[i], points[from], points[to]);
            if (d > worst) {
                worst = d;
                farthest = i;
            }
        }
        if (farthest >= 0) {
            simplify(from, farthest, keep);
            keep.push(farthest);
            simplify(farthest, to, keep);
        }
    };
    const keep = [0];
    simplify(0, points.length - 1, keep);
    keep.push(points.length - 1);
    const kept = keep.map(i => points[i]);
    return kept.map((p, i) => {
        const previous = kept[Math.max(0, i - 1)], next = kept[Math.min(kept.length - 1, i + 1)];
        const tangent = [(next[0] - previous[0]) / 6, (next[1] - previous[1]) / 6];
        return {
            p,
            in: i === 0 ? [0, 0] : [-tangent[0], -tangent[1]],
            out: i === kept.length - 1 ? [0, 0] : tangent,
            kind: "smooth",
        };
    });
}

// Closing a curve keeps each side's color where it was: its left and right become inside and outside.
function closeCurve(index) {
    const curve = state.curves[index];
    const { left, right } = curve;
    curve.closed = true;
    delete curve.left;
    delete curve.right;
    const [leftName] = sideNames({ ...curve, inside: "", outside: "" });
    curve[leftName] = left;
    curve[leftName === "inside" ? "outside" : "inside"] = right;
}

function finishPen() {
    if (penCurve === null)
        return;
    const curve = state.curves[penCurve];
    if (curve && curve.nodes.length < 2) {
        state.curves.splice(penCurve, 1);
        selection = null;
    }
    penCurve = null;
    changed();
}

// Opens a color picker for one side of a curve, where the pointer is.
function pickColor(index, side, event) {
    const input = Object.assign(document.createElement("input"), { type: "color", value: state.curves[index][side] });
    Object.assign(input.style, { position: "fixed", left: `${event.clientX}px`, top: `${event.clientY}px`, width: "1px", height: "1px", opacity: "0" });
    document.body.append(input);
    input.addEventListener("input", () => {
        state.curves[index][side] = input.value;
        changed();
    });
    input.addEventListener("change", () => input.remove());
    input.addEventListener("blur", () => setTimeout(() => input.remove(), 0));
    input.click();
}

function setTool(name) {
    if (tool === "pen" && name !== "pen")
        finishPen();
    tool = name;
    changed();
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
        if (tool === "select") {
            const hit = hitTest(view, point(event));
            if (!hit) {
                selection = null;
            } else if (hit.kind === "section") {
                drag = { kind: "section", end: hit.end };
            } else if (hit.kind === "handle") {
                selection = { curve: hit.curve, node: hit.node };
                drag = { kind: "handle", ...hit };
            } else if (hit.kind === "node") {
                selection = { curve: hit.curve, node: hit.node };
                drag = { kind: "node", curve: hit.curve, node: hit.node, start: at, origin: state.curves[hit.curve].nodes[hit.node].p.slice() };
            } else if (hit.kind === "swatch") {
                selection = { curve: hit.curve, node: null };
                drag = { kind: "swatch", ...hit, start: point(event), moved: false };
            } else {
                selection = { curve: hit.curve, node: null };
                drag = { kind: "curve", curve: hit.curve, start: at, origin: state.curves[hit.curve].nodes.map(node => node.p.slice()) };
            }
        } else if (tool === "pen") {
            const curve = penCurve === null ? null : state.curves[penCurve];
            const first = curve && curve.nodes[0];
            const size = [overlay.clientWidth, overlay.clientHeight];
            if (curve && curve.nodes.length > 1 && Math.hypot((first.p[0] - at[0]) * size[0], (first.p[1] - at[1]) * size[1]) < 9) {
                closeCurve(penCurve);
                selection = { curve: penCurve, node: 0 };
                penCurve = null;
            } else {
                const node = { p: at, in: [0, 0], out: [0, 0], kind: "corner" };
                if (curve) {
                    curve.nodes.push(node);
                } else {
                    penCurve = addCurve(false, [node]);
                }
                selection = { curve: penCurve, node: state.curves[penCurve].nodes.length - 1 };
                drag = { kind: "pen", curve: penCurve, node: selection.node, start: at };
            }
        } else {
            const nodes = tool === "line" ? [{ p: at, in: [0, 0], out: [0, 0], kind: "corner" }, { p: at.slice(), in: [0, 0], out: [0, 0], kind: "corner" }]
                : tool === "ellipse" ? ellipse(at[0], at[1], 0, 0)
                : tool === "arc" ? arcNodes(at, at)
                : [{ p: at, in: [0, 0], out: [0, 0], kind: "smooth" }];
            const index = addCurve(tool === "ellipse", nodes);
            drag = { kind: tool, curve: index, start: at, points: [at] };
        }
        changed();
    });

    overlay.addEventListener("pointermove", event => {
        const at = fraction(event);
        if (!drag) {
            if (tool === "select") {
                const hit = hitTest(view, point(event));
                overlay.style.cursor = !hit ? "default" : hit.kind === "swatch" ? "pointer" : hit.kind === "curve" ? "move" : "grab";
            } else {
                overlay.style.cursor = "crosshair";
            }
            return;
        }
        if (drag.kind === "section") {
            state.section[drag.end] = [clamp(at[0], 0, 1), clamp(at[1], 0, 1)];
            changed();
            return;
        }
        const curve = state.curves[drag.curve];
        if (!curve)
            return;
        const delta = subtract(at, drag.start);
        switch (drag.kind) {
        case "node":
            curve.nodes[drag.node].p = add(drag.origin, delta);
            break;
        case "curve":
            curve.nodes.forEach((node, i) => node.p = add(drag.origin[i], delta));
            break;
        case "handle": {
            const node = curve.nodes[drag.node];
            node[drag.which] = subtract(at, node.p);
            // A smooth node keeps its other handle opposite, at its own length.
            if (node.kind === "smooth") {
                const other = drag.which === "in" ? "out" : "in";
                const [sx, sy] = boxScale();
                const moved = [node[drag.which][0] * sx, node[drag.which][1] * sy];
                const otherLength = Math.hypot(node[other][0] * sx, node[other][1] * sy);
                const length = Math.hypot(...moved) || 1;
                node[other] = [-moved[0] / length * otherLength / sx, -moved[1] / length * otherLength / sy];
            }
            break;
        }
        case "swatch":
            drag.moved ||= Math.hypot(...subtract(point(event), drag.start)) > 3;
            return;
        case "pen": {
            // Dragging out from a new node pulls its handles, making it smooth.
            const node = curve.nodes[drag.node];
            node.out = delta;
            node.in = [-delta[0], -delta[1]];
            node.kind = "smooth";
            break;
        }
        case "line":
            curve.nodes[1].p = at;
            break;
        case "ellipse": {
            let rx = Math.abs(delta[0]) / 2, ry = Math.abs(delta[1]) / 2;
            if (event.shiftKey) {
                // A circle, as wide as the drag's larger side, in the box's units.
                const [sx, sy] = boxScale();
                const radius = Math.max(rx * sx, ry * sy);
                rx = radius / sx;
                ry = radius / sy;
            }
            const cx = drag.start[0] + Math.sign(delta[0]) * rx, cy = drag.start[1] + Math.sign(delta[1]) * ry;
            curve.nodes = ellipse(cx, cy, rx, ry).map(node => ({ ...node, kind: "smooth" }));
            break;
        }
        case "arc":
            curve.nodes = arcNodes(drag.start, at);
            break;
        case "freehand":
            drag.points.push(at);
            curve.nodes = freehandNodes(drag.points);
            break;
        }
        changed();
    });

    const endDrag = event => {
        if (!drag)
            return;
        const finished = drag;
        drag = null;
        if (finished.kind === "swatch" && !finished.moved)
            pickColor(finished.curve, finished.side, event);
        // A shape too small to see was a click, not a drawing.
        if (["line", "ellipse", "arc", "freehand"].includes(finished.kind)) {
            const curve = state.curves[finished.curve];
            const size = [overlay.clientWidth, overlay.clientHeight];
            const span = Math.max(...curve.nodes.map(node => Math.hypot((node.p[0] - finished.start[0]) * size[0], (node.p[1] - finished.start[1]) * size[1])));
            if (span < 4) {
                state.curves.splice(finished.curve, 1);
                selection = null;
            }
        }
        changed();
    };
    overlay.addEventListener("pointerup", endDrag);
    overlay.addEventListener("pointercancel", endDrag);

    overlay.addEventListener("dblclick", event => {
        if (tool === "pen") {
            finishPen();
            return;
        }
        const hit = hitTest(view, point(event));
        if (tool !== "select" || hit?.kind !== "node")
            return;
        // Double-clicking a node switches it between corner and smooth.
        const node = state.curves[hit.curve].nodes[hit.node];
        node.kind = node.kind === "smooth" ? "corner" : "smooth";
        if (node.kind === "smooth" && (node.in[0] || node.in[1]) && (node.out[0] || node.out[1])) {
            const [sx, sy] = boxScale();
            const outLength = Math.hypot(node.out[0] * sx, node.out[1] * sy), inLength = Math.hypot(node.in[0] * sx, node.in[1] * sy);
            node.in = [-node.out[0] * inLength / outLength, -node.out[1] * inLength / outLength];
        }
        changed();
    });
}

for (const button of document.querySelectorAll("#toolbar button[data-tool]"))
    button.addEventListener("click", () => setTool(button.dataset.tool));
$("newFirst").addEventListener("input", () => newColors[0] = $("newFirst").value);
$("newSecond").addEventListener("input", () => newColors[1] = $("newSecond").value);
$("swapNewColors").addEventListener("click", () => {
    newColors = [newColors[1], newColors[0]];
    updateControls();
});

// MARK: - Controls

$("preset").add(new Option("Custom", ""));
PRESETS.forEach((preset, index) => $("preset").add(new Option(preset.name, String(index))));

function matchingPreset() {
    const describe = ({ width, height, curves }) => JSON.stringify([width, height, curves]);
    const current = describe(state);
    return PRESETS.findIndex(preset => describe(preset.state) === current);
}

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
    $("sheetHeight").value = state.sheetHeight;
    for (const id of ["width", "height"]) {
        if (document.activeElement !== $(id))
            $(id).value = state[id];
    }
    $("space").value = String(state.space);
    $("resolution").value = String(state.resolution);
    $("showCurves").checked = state.showCurves;
    for (const button of document.querySelectorAll("#modelBar button"))
        button.setAttribute("aria-pressed", String(state.models.includes(button.dataset.model)));
    for (const button of document.querySelectorAll("#toolbar button[data-tool]"))
        button.setAttribute("aria-pressed", String(button.dataset.tool === tool));
    $("newFirst").value = newColors[0];
    $("newSecond").value = newColors[1];
    $("toolNote").textContent = TOOL_NOTES[tool];

    const list = $("curveList");
    if (list.children.length !== state.curves.length)
        list.replaceChildren(...state.curves.map(curveRow));
    state.curves.forEach((curve, i) => {
        const [first, second] = curve.closed ? ["inside", "outside"] : ["left", "right"];
        const row = list.children[i];
        row.classList.toggle("selected", selection?.curve === i);
        row.querySelector("span").textContent = `${curve.closed ? "Closed" : "Open"} curve ${i + 1}`;
        for (const [input, side] of [[row.querySelector(".first"), first], [row.querySelector(".second"), second]]) {
            input.title = side[0].toUpperCase() + side.slice(1);
            if (document.activeElement !== input)
                input.value = curve[side];
        }
    });
    $("emptyNote").hidden = state.curves.length > 0;

    const selected = selection && state.curves[selection.curve];
    $("selectedCurve").hidden = !selected;
    if (selected) {
        $("selectedName").textContent = `${selected.closed ? "Closed" : "Open"} curve ${selection.curve + 1}`;
        for (const [id, value, unit] of [["strength", selected.strength ?? 100, "%"], ["blur", selected.blur ?? 0, " px"]]) {
            $(id).value = value;
            $(id + "Value").textContent = value + unit;
        }
    }
}

const TOOL_NOTES = {
    select: "Click a curve to select it, and drag it to move it. Drag its nodes and handles to shape it, and double-click a node to switch it between corner and smooth. Click a swatch to change that side's color.",
    pen: "Click to add corner nodes, or drag to add smooth ones. Click the first node to close the curve, or double-click to leave it open.",
    line: "Drag to draw a straight line.",
    ellipse: "Drag to draw an ellipse. Hold Shift for a circle.",
    arc: "Drag from one end of the arc to the other. It bulges to the left of the way you drag.",
    freehand: "Drag to draw. The stroke becomes smooth nodes.",
};

function curveRow(_, index) {
    const row = document.createElement("div");
    row.className = "curve";
    row.append(document.createElement("span"));
    row.addEventListener("click", event => {
        if (event.target.closest("input, button"))
            return;
        selection = { curve: index, node: null };
        changed();
    });
    for (const which of ["first", "second"]) {
        const input = Object.assign(document.createElement("input"), { type: "color", className: which });
        input.addEventListener("input", () => {
            const curve = state.curves[index];
            const sides = curve.closed ? ["inside", "outside"] : ["left", "right"];
            curve[sides[which === "first" ? 0 : 1]] = input.value;
            changed();
        });
        row.append(input);
    }
    const remove = Object.assign(document.createElement("button"), { className: "small", textContent: "×", title: "Delete this curve" });
    remove.addEventListener("click", () => {
        state.curves.splice(index, 1);
        selection = null;
        penCurve = null;
        changed();
    });
    row.append(remove);
    return row;
}

for (const id of ["strength", "blur"]) {
    $(id).addEventListener("input", () => {
        const curve = selection && state.curves[selection.curve];
        if (!curve)
            return;
        adjusting = true;
        curve[id] = Number($(id).value);
        changed();
    });
    $(id).addEventListener("change", () => {
        adjusting = false;
        changed();
    });
}

$("preset").addEventListener("change", () => {
    if ($("preset").value === "")
        return updateControls();
    state = { ...presetState(Number($("preset").value)) };
    selection = null;
    penCurve = null;
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
$("showCurves").addEventListener("change", () => {
    state.showCurves = $("showCurves").checked;
    changed();
});
$("clearCurves").addEventListener("click", () => {
    if (!state.curves.length)
        return;
    state.curves = [];
    selection = null;
    penCurve = null;
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
        if (data.v !== 1 || !Array.isArray(data.curves))
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
state = decodeState(location.hash.slice(1)) ?? presetState(2);
render();
setUpGPU().then(() => scheduleRender(), error => {
    gpuError = error.message;
    scheduleRender();
});
</script>
</body>
</html>
