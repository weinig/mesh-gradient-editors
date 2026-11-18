// MARK: - Colors

// The interpolation space's names are SPACES, from the shared color code; the renderer and the shaders take a space
// as its index there.
const spaceIndex = space => SPACES.indexOf(space);

// A CSS color's components in the interpolation space, and its alpha. As WebKit does for now, missing (none)
// components are 0, rather than taking their value from the other colors.
function interpolationComponents(text) {
    const color = parseColor(text) ?? parseColor("black");
    const components = convertColor(color.space, color.c, state.space, false).map(v => Number.isNaN(v) ? 0 : v);
    return [...components, Number.isNaN(color.alpha) ? 0 : color.alpha];
}

// Colors as the renderer takes them, from their components in the interpolation space and alpha: in a polar space,
// each hue moved by whole turns to within half a turn of the hues' circular mean, so the solve takes the shorter way
// between them; then premultiplied, but for the hue.
function rendererColors(colors) {
    const hue = HUE_INDEX[state.space];
    colors = colors.map(color => color.slice());
    if (hue !== undefined && colors.length) {
        let sine = 0, cosine = 0;
        for (const color of colors) {
            sine += Math.sin(color[hue] * Math.PI / 180);
            cosine += Math.cos(color[hue] * Math.PI / 180);
        }
        const mean = Math.atan2(sine, cosine) * 180 / Math.PI;
        for (const color of colors)
            color[hue] = mean + (((color[hue] - mean) % 360 + 540) % 360 - 180);
    }
    for (const color of colors) {
        for (let k = 0; k < 3; ++k) {
            if (k !== hue)
                color[k] *= color[3];
        }
    }
    return colors;
}

// A CSS color in sRGB, clipped, as a color well's hex, without alpha.
function hexColor(text) {
    const color = parseColor(text) ?? parseColor("black");
    const srgb = fromXYZ("srgb", toXYZ(color.space, color.c.map(v => Number.isNaN(v) ? 0 : v)));
    return "#" + srgb.map(v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, "0")).join("");
}

// A CSS color as a swatch draws it: in sRGB, clipped, with its alpha, missing components as 0.
function swatchColor(text, opacity = 1) {
    const color = parseColor(text) ?? parseColor("black");
    const srgb = fromXYZ("srgb", toXYZ(color.space, color.c.map(v => Number.isNaN(v) ? 0 : v)));
    const alpha = (Number.isNaN(color.alpha) ? 0 : color.alpha) * opacity;
    return `rgb(${srgb.map(v => Math.round(clamp(v, 0, 1) * 255)).join(" ")} / ${clamp(alpha, 0, 1)})`;
}

// MARK: - Editing

// How much smaller the grid is while something's dragged or a slider moved.
const EDITING = { full: 1, half: 2, quarter: 4 };
// Whether a slider is being moved.
let adjusting = false;

// The grid's longest side: the chosen one, or less while editing, if the page asks for that.
function solveResolution() {
    const editing = (drag && drag.kind !== "section") || adjusting;
    return editing ? Math.max(32, state.resolution / EDITING[state.editing]) : state.resolution;
}

// MARK: - Edges

// With mirrored edges the grid is the box. With open edges it reaches half the box's size past each side, so its edges
// are far from the stops: the renderer solves a box twice the size, with the gradient in its middle, and shows the
// middle. Its texels are bigger as a result.
const EDGES = ["mirrored", "open"];
const openEdges = () => state.edges === "open";

// The part of the solved box the view shows: its origin and size, 0 to 1 across and down the box.
const viewWindow = () => openEdges() ? [0.25, 0.25, 0.5, 0.5] : [0, 0, 1, 1];

// The gradient moved into the bigger box: positions into its middle, and lengths, which are in units of the box's
// shorter side, halved.
function windowed(data) {
    if (!openEdges())
        return data;
    const inside = v => 0.25 + v / 2;
    const points = data.points.slice(), segments = data.segments.slice();
    for (let i = 0; i < points.length; i += 8) {
        points[i + 4] = inside(points[i + 4]);
        points[i + 5] = inside(points[i + 5]);
        points[i + 6] /= 2;
    }
    for (let i = 0; i < segments.length; i += 23) {
        for (let k = 16; k < 20; ++k)
            segments[i + k] = inside(segments[i + k]);
        segments[i + 20] /= 2;
        segments[i + 21] /= 2;
    }
    const lines = data.lines.map(line => ({ ...line, ends: line.ends.map(inside) }));
    return { ...data, points, segments, lines, window: viewWindow() };
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
    // A second renderer, which solves the selected curve's or stop's influence.
    influence: null,
    influenceKey: null,
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
        view.influence = new WebGPUFreeformGradientRenderer(device, { shader: SHADER, format });
        view.uniforms = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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
function encodeView(view, encoder, viewWidth, viewHeight) {
    const data = { ...windowed(gradientData(view.model)), gamutMapping: state.gamutMapping === "map" ? 1 : 0, edgeStrips: state.edgeStrips };
    // The box the renderer solves: the view's, or twice it for open edges.
    const width = openEdges() ? 2 * viewWidth : viewWidth, height = openEdges() ? 2 * viewHeight : viewHeight;
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
    // What a readback of this solve decodes it with.
    view.solveSpace = state.space;
    view.solveWindow = viewWindow();
    // The influence is solved as a gradient of its own, drawn over by the visualization.
    if (state.view === "influence" && influenceAvailable()) {
        const influence = windowed(gradientData(view.model, true));
        const influenceKey = JSON.stringify(influence);
        if (influenceKey !== view.influenceKey) {
            view.influence.setGradient(influence);
            view.influenceKey = influenceKey;
        }
        view.influence.encode(encoder, view.target, width, height);
    }
}

// MARK: - Visualizations

// Draws a box's solution as one of the views under Visualize, reading the renderer's textures for one level: its
// solution, the colors its curves or stops hold and how firmly, and for the difference, the other box's solution. Also reads a
// level back for the cross-section, 3D and numbers.
const VISUALIZE_SHADER = `
struct Visualize {
    mode: u32,
    space: u32,
    // Read by toPremultipliedColor(), which the visualizations don't call, but which reads them.
    outputIsDisplayP3: u32,
    gamutMapping: u32,
    // The gamut the hatching measures against: 0 sRGB, 1 Display P3, 2 Rec. 2020.
    gamut: u32,
    padding0: u32,
    padding1: u32,
    padding2: u32,
    // The part of the solved box the view shows: its origin and size, 0 to 1 across and down it.
    window: vec4<f32>,
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

// A premultiplied color in the interpolation space as linear sRGB, unclamped, with straight alpha. In a polar space
// the hue isn't premultiplied.
// Unpremultiplied by the solve's own alpha, as the display does, which is returned as it is, so overshoot can be
// measured.
fn linearOf(premultiplied: vec4<f32>) -> vec4<f32> {
    if (premultiplied.a <= 1e-6) {
        return vec4<f32>(0.0);
    }
    var c = premultiplied.rgb / premultiplied.a;
    let hue = hueComponent(visualize.space);
    if (hue >= 0) {
        c[hue] = normalizeHue(premultiplied[hue]);
    }
    return vec4<f32>(transform(xyzToLinSRGB, toXYZ(visualize.space, c)), premultiplied.a);
}

// As the gradient shows a color: encoded sRGB, clamped, with straight alpha.
fn shown(c: vec4<f32>) -> vec4<f32> {
    return vec4<f32>(encodeSigned(saturate(c.rgb)), saturate(c.a));
}

// How far a color's encoded components in the chosen gamut, or its alpha, go past 0 to 1, from linear sRGB.
fn excess(c: vec4<f32>) -> f32 {
    var e: vec3<f32>;
    switch (visualize.gamut) {
        case 1u: { e = encodeSigned(transform(xyzToLinP3, transform(linSRGBToXYZ, c.rgb))); }
        case 2u: {
            let linear = transform(xyzToLinRec2020, transform(linSRGBToXYZ, c.rgb));
            e = sign(linear) * pow(abs(linear), vec3<f32>(1.0 / 2.4));
        }
        default: { e = encodeSigned(c.rgb); }
    }
    let over = max(-e, e - 1.0);
    return max(max(max(over.r, over.g), over.b), max(max(-c.a, c.a - 1.0), 0.0));
}

// An influence, solved in srgb-linear as a gray from 0 to 1: white at 0, orange at 1, dark red past it, and blue
// below 0, as the freeform-gradient() editor shows it.
fn influenceColor(value: f32) -> vec4<f32> {
    if (value < 0.0) {
        return vec4<f32>(mix(vec3<f32>(1.0), vec3<f32>(0.16, 0.42, 0.95), saturate(-value * 4.0)), 1.0);
    }
    if (value <= 1.0) {
        return vec4<f32>(mix(vec3<f32>(1.0), vec3<f32>(0.95, 0.45, 0.1), value), 1.0);
    }
    return vec4<f32>(mix(vec3<f32>(0.95, 0.45, 0.1), vec3<f32>(0.45, 0.05, 0.05), saturate((value - 1.0) * 4.0)), 1.0);
}

// Black on light colors, white on dark ones.
fn contrast(c: vec3<f32>) -> vec3<f32> {
    return select(vec3<f32>(1.0), vec3<f32>(0.0), dot(c, vec3<f32>(0.299, 0.587, 0.114)) > 0.55);
}

fn dither(position: vec2<f32>) -> f32 {
    return fract(52.9829189 * fract(dot(position, vec2<f32>(0.06711056, 0.00583715))));
}

// Modes: 1 what the curves or stops hold, 2 where it leaves the gamut, 3 lines of equal lightness, 4 the difference from
// the other box, 5 one level's texels, 6 the selected curve's or stop's influence.
@fragment
fn visualizeFragment(input: VisualizeVertex) -> @location(0) vec4<f32> {
    let size = vec2<f32>(textureDimensions(solution));
    let uv = visualize.window.xy + input.uv * visualize.window.zw;
    let texelPosition = uv * size;
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
            let other = shown(linearOf(bilinear(otherSolution, uv * vec2<f32>(textureDimensions(otherSolution)) - 0.5)));
            let a = linearToOklab(decodeSigned(color.rgb)) * color.a;
            let b = linearToOklab(decodeSigned(other.rgb)) * other.a;
            let difference = length(vec4<f32>(a - b, color.a - other.a));
            color = vec4<f32>(mix(vec3<f32>(1.0), vec3<f32>(0.42, 0.1, 0.62), saturate(difference / 0.15)), 1.0);
        }
        case 6u: {
            color = influenceColor(bilinear(solution, texelPosition - 0.5).r);
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
` + COLOR_SHADER("visualize");

let visualizePipeline = null;
let readPipeline = null;

const VIEW_MODES = { holds: 1, gamut: 2, isolines: 3, difference: 4, level: 5, influence: 6 };

function viewAvailable(name) {
    if (name === "influence")
        return influenceAvailable();
    if (name === "difference")
        return state.models.length > 1;
    if (name === "relaxation")
        return state.models.includes("harmonic");
    return true;
}

const shownLevel = view => Math.min(state.level, view.renderer.levels.length - 1);

function encodeVisualization(view, encoder) {
    const mode = VIEW_MODES[state.view];
    if (!mode || !viewAvailable(state.view))
        return;
    const renderer = state.view === "influence" ? view.influence : view.renderer;
    const levels = renderer.levels;
    if (!levels.length || !renderer.gradient)
        return;
    const level = levels[state.view === "level" ? shownLevel(view) : 0];
    let other = level.values.texture;
    if (state.view === "difference") {
        const pair = views.find(other => other !== view && !other.figure.hidden && other.renderer?.levels.length);
        if (!pair)
            return;
        other = pair.renderer.levels[0].values.texture;
    }
    const uniforms = new ArrayBuffer(48);
    new Uint32Array(uniforms, 0, 8).set([mode, spaceIndex(state.space), 0, 0, GAMUTS.indexOf(state.gamut), 0, 0, 0]);
    new Float32Array(uniforms, 32, 4).set(viewWindow());
    device.queue.writeBuffer(view.uniforms, 0, uniforms);
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

// The harmonic model's finest grid started from the average held color and smoothed `steps` times, without the
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
        // Read only by the biharmonic's second hold; any texture the kernel doesn't write.
        { binding: 6, resource: renderer.view(finest.correctionRightHandSide) },
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
    if (!device || gpuError || !(state.crossSection || state.sheet || state.numbers || state.sample))
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
    const space = view.solveSpace, crop = view.solveWindow;
    try {
        await Promise.all([valuesRead.mapAsync(GPUMapMode.READ), weightsRead.mapAsync(GPUMapMode.READ)]);
        view.readout = {
            width, height, space, level: index, stats: null, window: crop,
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

// A hue moved by whole turns to between 0 and 360. The solve's hues can be up to a turn either way of that.
const normalizedHue = h => ((h % 360) + 360) % 360;

// A component of a premultiplied color as the gradient shows it: alpha and a polar space's hue as the solve has them,
// the hue normalized, and the others unpremultiplied, as the display does.
function straightComponent(color, k, space) {
    if (k === 3)
        return color[3];
    if (k === HUE_INDEX[space])
        return normalizedHue(color[k]);
    return color[3] > 1e-6 ? color[k] / color[3] : 0;
}

// A premultiplied color in the interpolation space as the gradient shows it before clipping: encoded sRGB with
// straight alpha, and its Oklab lightness. In a polar space the hue isn't premultiplied.
function appearance(p, space) {
    const alpha = p[3];
    if (alpha <= 1e-6)
        return { rgb: [0, 0, 0], linear: [0, 0, 0], alpha: 0, L: 0 };
    const hue = HUE_INDEX[space];
    const c = [0, 1, 2].map(k => k === hue ? normalizedHue(p[k]) : p[k] / alpha);
    const linear = fromXYZ("srgb-linear", toXYZ(space, c));
    return { rgb: linear.map(encodeSigned), linear, alpha, L: oklabLightness(linear) };
}

// The gamuts the hatching, the numbers and the sample measure against.
const GAMUTS = ["srgb", "display-p3", "rec2020"];
const GAMUT_NAMES = { srgb: "sRGB", "display-p3": "Display P3", rec2020: "Rec. 2020" };

// How far a color's encoded components in the chosen gamut, or its alpha, go past 0 to 1.
function excessOf({ linear, alpha }) {
    const encoded = fromXYZ(state.gamut, toXYZ("srgb-linear", linear));
    return Math.max(0, ...encoded.map(v => Math.max(-v, v - 1)), -alpha, alpha - 1);
}

// Where a point of the view is in the readout's grid, 0 to 1 across and down it.
const inReadout = ({ window }, [u, v]) => [window[0] + u * window[2], window[1] + v * window[3]];

// The readout's premultiplied color at a point, 0 to 1 across and down the view's box, filtered as the gradient is.
function sampleReadout(readout, p) {
    const { width, height, values } = readout;
    const [u, v] = inReadout(readout, p);
    const x = clamp(u * width - 0.5, 0, width - 1), y = clamp(v * height - 0.5, 0, height - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
    const fx = x - x0, fy = y - y0;
    const at = (i, j, k) => values[(j * width + i) * 4 + k];
    return [0, 1, 2, 3].map(k => (at(x0, y0, k) * (1 - fx) + at(x1, y0, k) * fx) * (1 - fy) + (at(x0, y1, k) * (1 - fx) + at(x1, y1, k) * fx) * fy);
}

function weightAt(readout, p) {
    const { width, height, weights } = readout;
    const [u, v] = inReadout(readout, p);
    return weights[clamp(Math.floor(v * height), 0, height - 1) * width + clamp(Math.floor(u * width), 0, width - 1)];
}

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
// there, over bars of how firmly each point is held.
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
    const [a, b] = sectionEnds();
    const samples = [];
    for (let i = 0; i <= count; ++i) {
        const t = i / count, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        samples.push({ ...appearance(sampleReadout(readout, p), readout.space), weight: weightAt(readout, p) });
    }
    // The other box's colors along the same line, to draw dashed.
    const other = state.otherCurves ? views.find(other => other !== view && !other.figure.hidden && other.readout)?.readout : null;
    const otherSamples = other ? samples.map((_, i) => {
        const t = i / count, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        return appearance(sampleReadout(other, p), other.space);
    }) : [];
    const all = [...samples, ...otherSamples].flatMap(s => s.rgb);
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
    if (otherSamples.length) {
        ctx.globalAlpha = 0.6;
        [0, 1, 2].forEach(k => line(otherSamples.map(s => s.rgb[k]), PLOT_COLORS[k], [3, 3]));
        ctx.globalAlpha = 1;
    }
    [0, 1, 2].forEach(k => line(samples.map(s => s.rgb[k]), PLOT_COLORS[k]));
    if (samples.some(s => s.alpha < 0.999))
        line(samples.map(s => s.alpha), `rgba(${ink}, 0.6)`, [4, 3]);
}

let sheetYaw = -0.6;
let sheetTilt = 0.8;

// What the 3D view can raise the surface by: each of the interpolation space's components, as the solve has them,
// straight rather than premultiplied, over their usual range, then alpha, as the freeform-gradient() editor has them.
const COMPONENT_LABELS = {
    "xyz-d50": ["X", "Y", "Z"], "xyz-d65": ["X", "Y", "Z"],
    lab: ["L", "a", "b"], lch: ["L", "C", "h"], oklab: ["L", "a", "b"], oklch: ["L", "C", "h"],
    hsl: ["h", "s", "l"], hwb: ["h", "w", "b"],
};
const COMPONENT_RANGES = {
    lab: [[0, 100], [-125, 125], [-125, 125]], lch: [[0, 100], [0, 150], [0, 360]],
    oklab: [[0, 1], [-0.4, 0.4], [-0.4, 0.4]], oklch: [[0, 1], [0, 0.4], [0, 360]],
    hsl: [[0, 360], [0, 100], [0, 100]], hwb: [[0, 360], [0, 100], [0, 100]],
};

function sheetHeights(space) {
    const labels = COMPONENT_LABELS[space] ?? ["Red", "Green", "Blue"];
    const ranges = COMPONENT_RANGES[space] ?? [[0, 1], [0, 1], [0, 1]];
    return [
        ...labels.map((label, k) => ({ value: `c${k}`, label: `${label} (${space})`, short: label, range: ranges[k] })),
        { value: "c3", label: "Alpha", short: "alpha", range: [0, 1] },
    ];
}

// The height the 3D view shows: the one chosen, or for a link from before, the component it named.
function sheetHeight(space) {
    const heights = sheetHeights(space);
    const legacy = { r: "c0", g: "c1", b: "c2", L: "c0" };
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
    const component = Number(shown.value.slice(1));
    const heightAt = p => {
        const color = sampleReadout(readout, p);
        const value = straightComponent(color, component, readout.space);
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
        const [a, b] = sectionEnds();
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
    if (readout.stats?.gamut !== state.gamut) {
        let held = 0, outside = 0, furthest = 0, darkest = Infinity, lightest = -Infinity;
        const [x0, y0, x1, y1] = [readout.window[0] * readout.width, readout.window[1] * readout.height,
            (readout.window[0] + readout.window[2]) * readout.width, (readout.window[1] + readout.window[3]) * readout.height].map(Math.round);
        const shown = [];
        for (let y = y0; y < y1; ++y) {
            for (let x = x0; x < x1; ++x)
                shown.push(y * readout.width + x);
        }
        const count = shown.length;
        for (const i of shown) {
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
        readout.stats = { count, held, outside, furthest, darkest, lightest, gamut: state.gamut };
    }
    const { count, held, outside, furthest, darkest, lightest } = readout.stats;
    const levels = view.renderer.levels;
    const coarsest = levels[levels.length - 1];
    const grid = readout.level === 0
        ? `Grid ${readout.width} × ${readout.height} texels, in ${levels.length} levels down to ${coarsest.width} × ${coarsest.height}${readout.window[2] < 1 ? ", the middle half of it shown" : ""}.`
        : `Level ${readout.level}: ${readout.width} × ${readout.height} texels.`;
    const percent = value => `${(100 * value / count).toFixed(value && value < count / 1000 ? 2 : 1)}%`;
    return `${grid} ${held.toLocaleString()} held (${percent(held)}). ${percent(outside)} outside ${GAMUT_NAMES[state.gamut]}` +
        (outside ? `, up to ${furthest.toFixed(3)} past 0 to 1.` : ".") +
        ` Oklab L from ${darkest.toFixed(3)} to ${lightest.toFixed(3)}.`;
}

// MARK: - Cross-section

// The cross-section is a line from A to B, each end dragged anywhere, or a row across the whole box, dragged up and
// down.
const SECTION_KINDS = ["line", "row"];

// The cross-section's ends, 0 to 1 across and down the box.
const sectionEnds = () => state.sectionKind === "row" ? [[0, state.sectionRow], [1, state.sectionRow]] : state.section;

// Which part of the cross-section is under `point`, in pixels: an end, "row" for anywhere on the row, or null.
function sectionHit(point, toPixels) {
    if (!state.crossSection)
        return null;
    if (state.sectionKind === "row") {
        const [, y] = toPixels([0, state.sectionRow]);
        return Math.abs(point[1] - y) <= 6 ? { kind: "section", end: "row" } : null;
    }
    for (const end of [1, 0]) {
        const at = toPixels(state.section[end]);
        if (Math.hypot(at[0] - point[0], at[1] - point[1]) <= 9)
            return { kind: "section", end };
    }
    return null;
}

// Moves the cross-section's dragged part to `at`, 0 to 1 across and down the box.
function dragSection(end, at) {
    if (end === "row")
        state.sectionRow = clamp(at[1], 0, 1);
    else
        state.section[end] = [clamp(at[0], 0, 1), clamp(at[1], 0, 1)];
}

// The cross-section's line, dashed, with its ends A and B.
function drawSection(ctx, toPixels) {
    const ends = sectionEnds().map(toPixels);
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
    // A row's ends are at the box's sides, so they're drawn just inside it.
    const inset = state.sectionKind === "row" ? 9 : 0;
    ends.forEach(([x, y], i) => {
        const at = [x + (i ? -inset : inset), y];
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

// The settings every editor's state has: from the current state when a preset is chosen, so they stay as they were.
function commonState() {
    return {
        space: state?.space ?? "oklab",
        gamutMapping: state?.gamutMapping ?? "clip",
        backdrop: state?.backdrop ?? "checkerboard",
        resolution: state?.resolution ?? 512,
        models: state?.models ?? ["biharmonic", "harmonic"],
        view: state?.view ?? "gradient",
        level: state?.level ?? 2,
        steps: state?.steps ?? 6,
        crossSection: state?.crossSection ?? false,
        section: state?.section ?? [[0.1, 0.5], [0.9, 0.5]],
        sectionKind: state?.sectionKind ?? "line",
        sectionRow: state?.sectionRow ?? 0.5,
        sheet: state?.sheet ?? false,
        sheetHeight: state?.sheetHeight ?? "L",
        numbers: state?.numbers ?? false,
        about: state?.about ?? false,
        edges: state?.edges ?? "mirrored",
        editing: state?.editing ?? "full",
        gamut: state?.gamut ?? "srgb",
        sample: state?.sample ?? false,
        otherCurves: state?.otherCurves ?? false,
        edgeStrips: state?.edgeStrips ?? true,
    };
}

// MARK: - Sample

// The solved color under the pointer, read back from the solve: its components in the interpolation space, as encoded
// sRGB, and how far it's outside the chosen gamut.
const sample = Object.assign(document.createElement("div"), { id: "sampleReadout", hidden: true });
document.body.append(sample);

function showSample(view, event) {
    const readout = view.readout;
    if (!state.sample || !readout) {
        sample.hidden = true;
        return;
    }
    const rect = view.overlay.getBoundingClientRect();
    const p = [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
    if (p[0] < 0 || p[0] > 1 || p[1] < 0 || p[1] > 1) {
        sample.hidden = true;
        return;
    }
    const color = sampleReadout(readout, p);
    const shown = appearance(color, readout.space);
    const components = [0, 1, 2].map(k => straightComponent(color, k, readout.space));
    const excess = excessOf(shown);
    const lines = [
        `${readout.space} ${components.map(v => v.toFixed(3)).join(" ")} / ${shown.alpha.toFixed(3)}`,
        `sRGB ${shown.rgb.map(v => v.toFixed(3)).join(" ")}`,
        excess > 1 / 512 ? `${excess.toFixed(3)} outside ${GAMUT_NAMES[state.gamut]}` : `Inside ${GAMUT_NAMES[state.gamut]}`,
    ];
    const swatch = Object.assign(document.createElement("span"), { className: "sampleSwatch" });
    swatch.style.background = `rgb(${shown.rgb.map(v => Math.round(clamp(v, 0, 1) * 255)).join(" ")} / ${clamp(shown.alpha, 0, 1)})`;
    sample.replaceChildren(swatch, ...lines.map(text => Object.assign(document.createElement("div"), { textContent: text })));
    sample.hidden = false;
    sample.style.left = `${event.clientX + 14}px`;
    sample.style.top = `${event.clientY + 14}px`;
}

for (const view of views) {
    view.overlay.addEventListener("pointermove", event => showSample(view, event));
    view.overlay.addEventListener("pointerleave", () => sample.hidden = true);
}
