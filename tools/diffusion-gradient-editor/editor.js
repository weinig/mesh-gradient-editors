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

const node = (x, y, inX = 0, inY = 0, outX = -inX, outY = -inY) => ({ p: [x, y], in: [inX, inY], out: [outX, outY] });

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

// The gradient as MeshShader2's renderer takes it: each piece of each curve a segment with its two sides' colors,
// and each curve's own pieces, so it knows where open ends are.
function gradientData(model) {
    const segments = [], lines = [], colors = [];
    for (const curve of state.curves) {
        const flat = pieces(curve);
        if (!flat.length)
            continue;
        const [left, right] = sideColors(curve, flat).map(premultiplied);
        colors.push(left, right);
        for (const [x0, y0, x1, y1] of flat)
            segments.push(...left, ...left, ...right, ...right, x0, y0, x1, y1, CURVE_RADIUS, CURVE_RADIUS, 1);
        lines.push({ ends: flat.flat(), closed: curve.closed });
    }
    const average = [0, 1, 2, 3].map(k => colors.length ? colors.reduce((sum, c) => sum + c[k], 0) / colors.length : 0);
    return {
        space: state.space, resolution: state.resolution, model, isEmpty: !segments.length, average,
        points: [], segments, lines, hasTwoSidedLines: segments.length > 0, isOpaque: colors.every(c => c[3] >= 1),
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

// The curves, and a pair of swatches on each showing its two sides' colors.
function drawOverlay(view, dpr) {
    const canvas = view.overlay;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!state.showCurves)
        return;
    const toCanvas = ([x, y]) => [x * canvas.width, y * canvas.height];
    for (const curve of state.curves) {
        ctx.beginPath();
        stretches(curve).forEach(([p0, p1, p2, p3], i) => {
            if (i === 0)
                ctx.moveTo(...toCanvas(p0));
            ctx.bezierCurveTo(...toCanvas(p1), ...toCanvas(p2), ...toCanvas(p3));
        });
        if (curve.closed)
            ctx.closePath();
        for (const [style, width] of [["rgba(0, 0, 0, 0.45)", 3 * dpr], ["rgba(255, 255, 255, 0.9)", 1.25 * dpr]]) {
            ctx.strokeStyle = style;
            ctx.lineWidth = width;
            ctx.stroke();
        }
        // The swatches sit either side of the middle of the first stretch.
        const stretch = stretches(curve)[0];
        if (!stretch)
            continue;
        const middle = toCanvas(bezier(stretch, 0.5));
        const ahead = toCanvas(bezier(stretch, 0.51)), behind = toCanvas(bezier(stretch, 0.49));
        const tangent = [ahead[0] - behind[0], ahead[1] - behind[1]];
        const length = Math.hypot(...tangent) || 1;
        // Left of the direction of travel, with y down.
        const leftward = [tangent[1] / length, -tangent[0] / length];
        const [left, right] = sideColors(curve, pieces(curve));
        for (const [color, sign] of [[left, 1], [right, -1]]) {
            const size = 9 * dpr, offset = 11 * dpr;
            const x = middle[0] + leftward[0] * offset * sign, y = middle[1] + leftward[1] * offset * sign;
            ctx.fillStyle = color;
            ctx.fillRect(x - size / 2, y - size / 2, size, size);
            ctx.lineWidth = 1.5 * dpr;
            ctx.strokeStyle = "#fff";
            ctx.strokeRect(x - size / 2, y - size / 2, size, size);
            ctx.lineWidth = 0.75 * dpr;
            ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
            ctx.strokeRect(x - size / 2 - 1.2 * dpr, y - size / 2 - 1.2 * dpr, size + 2.4 * dpr, size + 2.4 * dpr);
        }
    }
}

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

    const list = $("curveList");
    if (list.children.length !== state.curves.length)
        list.replaceChildren(...state.curves.map(curveRow));
    state.curves.forEach((curve, i) => {
        const [first, second] = curve.closed ? ["inside", "outside"] : ["left", "right"];
        const row = list.children[i];
        row.querySelector("span").textContent = `${curve.closed ? "Closed" : "Open"} curve ${i + 1}`;
        for (const [input, side] of [[row.querySelector(".first"), first], [row.querySelector(".second"), second]]) {
            input.title = side[0].toUpperCase() + side.slice(1);
            if (document.activeElement !== input)
                input.value = curve[side];
        }
    });
}

function curveRow(_, index) {
    const row = document.createElement("div");
    row.className = "curve";
    row.append(document.createElement("span"));
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
    return row;
}

$("preset").addEventListener("change", () => {
    if ($("preset").value === "")
        return updateControls();
    state = presetState(Number($("preset").value));
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
