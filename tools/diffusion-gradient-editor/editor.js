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
        state: {
            width: 600, height: 400,
            curves: [{ closed: false, nodes: [node(0.15, 0.5), node(0.85, 0.5)], left: "#ff6b3d", right: "#3d7bff" }],
        },
    },
    {
        name: "A circle",
        state: {
            width: 600, height: 400,
            curves: [{ closed: true, nodes: ellipse(0.5, 0.5, 0.2, 0.3), inside: "#d93a2b", outside: "#1e88ff" }],
        },
    },
    {
        name: "Overlapping shapes",
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
];

function presetState(index) {
    return {
        space: state?.space ?? 2,
        resolution: state?.resolution ?? 512,
        models: state?.models ?? ["biharmonic", "harmonic"],
        showCurves: state?.showCurves ?? true,
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
        space: state.space, resolution: drag || adjusting ? Math.min(state.resolution, 256) : state.resolution, model,
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
    context: null,
    renderer: null,
    gradientKey: null,
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
    }
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

function render() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
        if (view.renderer && !gpuError) {
            const data = gradientData(view.model);
            const key = JSON.stringify(data);
            if (key !== view.gradientKey) {
                view.renderer.setGradient(data);
                view.gradientKey = key;
            }
            const encoder = device.createCommandEncoder();
            view.renderer.encode(encoder, view.context.getCurrentTexture().createView(), width, height);
            device.queue.submit([encoder.finish()]);
        }
        drawOverlay(view, dpr);
    }
    $("gpuStatus").hidden = !!device && !gpuError;
    $("gpuStatus").textContent = gpuError ? `WebGPU: ${gpuError}` : "WebGPU: starting…";
    $("gpuStatus").className = gpuError ? "status error" : "status";
    updateControls();
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
    if (!state.showCurves && tool === "select" && !selection)
        return;
    const scale = canvas.width / (canvas.clientWidth || 1);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const size = [canvas.clientWidth, canvas.clientHeight];
    const toPixels = ([x, y]) => [x * size[0], y * size[1]];
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
        changed();
    });
}

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
