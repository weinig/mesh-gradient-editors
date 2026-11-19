__COMMON_HEAD__

// MARK: - State

// Stops hold colors at points. A stop's position is a fraction of the box, 0 to 1 across and down; its opacity and
// spread are percentages.
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
        name: "Four stops",
        note: "Four stops, one toward each corner. The thin plate spline and the biharmonic model nearly agree between them. Out past them the spline keeps its slope, and the biharmonic model's is turned flat at the box's edges unless Edges is Natural. The harmonic model never leaves the stops' colors, but rings each one.",
        state: {
            width: 600, height: 400,
            stops: [stop(0.2, 0.25, "#ff5f6d"), stop(0.8, 0.22, "#ffc371"), stop(0.25, 0.78, "#2193b0"), stop(0.78, 0.75, "#6dd5ed")],
        },
    },
    {
        name: "Three stops",
        note: "With three stops the thin plate spline is a plane through them. Set Edges to Natural and Stops hold to One texel, and the biharmonic model is the same plane.",
        state: {
            width: 600, height: 400,
            stops: [stop(0.2, 0.25, "#f94144"), stop(0.8, 0.3, "#f9c74f"), stop(0.45, 0.8, "#277da1")],
        },
    },
    {
        name: "Six stops",
        note: "Six stops spread around the box. The thin plate spline overshoots a little between them, and the grid models less.",
        state: {
            width: 600, height: 400,
            stops: [
                stop(0.12, 0.2, "#264653"), stop(0.5, 0.12, "#2a9d8f"), stop(0.88, 0.25, "#e9c46a"),
                stop(0.15, 0.8, "#f4a261"), stop(0.55, 0.88, "#e76f51"), stop(0.9, 0.75, "#9b5de5"),
            ],
        },
    },
    {
        name: "Two stops close together",
        note: "A black and a white stop a short way apart. The thin plate spline carries the steep slope between them across the whole box, far darker than black on one side and brighter than white on the other: try Where it leaves the gamut, or a cross-section through both. The biharmonic model does less of that, and the harmonic model stays between them.",
        state: {
            width: 600, height: 400,
            stops: [stop(0.45, 0.5, "#000000"), stop(0.55, 0.5, "#ffffff"), stop(0.1, 0.15, "#808080"), stop(0.9, 0.85, "#808080")],
        },
    },
    {
        name: "Stops on a line",
        note: "Every stop is on one line, so nothing says how the colors should tilt across it. The thin plate spline doesn't tilt them at all: it's the same on both sides of the line. The grid models are too, but for the box's edges, which aren't.",
        state: {
            width: 600, height: 400,
            stops: [stop(0.15, 0.7, "#3a0ca3"), stop(0.4, 0.55, "#f72585"), stop(0.65, 0.4, "#ffba08"), stop(0.9, 0.25, "#2ec4b6")],
        },
    },
    {
        name: "Stops in one corner",
        note: "All the stops are in one corner. Past them the thin plate spline keeps going in straight lines, and is far out of gamut by the opposite corner. The grid models end at the box.",
        state: {
            width: 600, height: 400,
            stops: [stop(0.08, 0.12, "#ef476f"), stop(0.3, 0.1, "#ffd166"), stop(0.1, 0.4, "#06d6a0"), stop(0.3, 0.38, "#118ab2")],
        },
    },
    {
        name: "Spread",
        note: "The same two colors, with no spread on the left and 60% on the right. Spread holds a stop's color across a disc in the grid models, the dashed circle when it's selected. The thin plate spline has only the stop's point, so its box is the same on both sides.",
        state: {
            width: 600, height: 400,
            stops: [
                stop(0.25, 0.3, "#e63946"), stop(0.25, 0.72, "#457b9d"),
                stop(0.75, 0.3, "#e63946", 60), stop(0.75, 0.72, "#457b9d", 60),
            ],
        },
    },
    {
        name: "Opacity",
        note: "Stops that fade out: opacity is blended along with the color, premultiplied, so a color fades without going gray or dark on its way to transparent. Where a model's alpha overshoots past 0 or 1, it's clipped.",
        state: {
            width: 600, height: 400,
            stops: [
                stop(0.15, 0.5, "#ff006e"), stop(0.5, 0.2, "#3a86ff"), stop(0.85, 0.5, "#ffbe0b"),
                stop(0.5, 0.8, "#3a86ff", 0, 0), stop(0.5, 0.5, "#ffffff", 0, 0),
            ],
        },
    },
    {
        name: "A color wheel",
        note: "Six hues in a ring around a white stop. Try Interpolate in oklch: each hue is moved by whole turns to within half a turn of the hues' mean, and where a model overshoots, the hue keeps turning.",
        state: {
            width: 500, height: 500,
            stops: [
                ...ring(0.5, 0.5, 0.36, ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff"]),
                stop(0.5, 0.5, "#ffffff"),
            ],
        },
    },
];

const influenceAvailable = () => selection !== null && !!state.stops[selection];

// What the shared code needs from this editor: which state a preset sets, which preset to start from, what to reset
// when a preset is chosen, and which links it can read.
const PRESET_KEYS = ["stops"];
const TWO_SIDED_LINES = false;
const DEFAULT_PRESET = 0;

function resetEditing() {
    selection = null;
}

// After undo or redo, the selection stays if its stop is still there.
function restoredEditing() {
    if (selection !== null && !state.stops[selection])
        selection = null;
}

function deleteSelection() {
    if (selection === null || !state.stops[selection])
        return false;
    deleteStop(selection);
    return true;
}

// Moves the selected stop by fractions of the box.
function nudgeSelection(dx, dy) {
    const stop = selection !== null && state.stops[selection];
    if (!stop)
        return false;
    stop.p = [stop.p[0] + dx, stop.p[1] + dy];
    return true;
}

function cancelEditing() {
    selection = null;
}

// A link's stops, made sound: each with a position and a color.
function acceptsState(data) {
    if (!Array.isArray(data.stops))
        return false;
    const finite = v => typeof v === "number" && Number.isFinite(v);
    data.stops = data.stops.filter(stop => !!stop && Array.isArray(stop.p) && finite(stop.p[0]) && finite(stop.p[1]) && typeof stop.color === "string").map(stop => ({
        p: stop.p.slice(0, 2), color: stop.color,
        opacity: finite(stop.opacity) ? clamp(stop.opacity, 0, 100) : 100,
        spread: finite(stop.spread) ? clamp(stop.spread, 0, 100) : 0,
    }));
    if (!STOP_SIZES.includes(data.stopSize))
        data.stopSize = "disc";
    return true;
}

function presetState(index) {
    return {
        ...commonState(),
        showStops: state?.showStops ?? true,
        stopSize: state?.stopSize ?? "disc",
        ...structuredClone(PRESETS[index].state),
    };
}

// MARK: - Thin plate spline

const boxScale = () => {
    const shorter = Math.min(state.width, state.height);
    return [state.width / shorter, state.height / shorter];
};

// U(r) = r² log(r), from the square of r, and 0 at 0, its limit.
const radialBasis = squaredDistance => squaredDistance > 0 ? 0.5 * squaredDistance * Math.log(squaredDistance) : 0;

// Solves `matrix * x = values` for each of the 4 columns of values, by Gaussian elimination with partial pivoting.
// Returns null if the matrix is singular.
function solveLinear(matrix, values, size) {
    const element = (row, column) => matrix[row * size + column];
    for (let column = 0; column < size; ++column) {
        let pivot = column;
        for (let row = column + 1; row < size; ++row) {
            if (Math.abs(element(row, column)) > Math.abs(element(pivot, column)))
                pivot = row;
        }
        if (Math.abs(element(pivot, column)) < 1e-12)
            return null;
        if (pivot !== column) {
            for (let i = 0; i < size; ++i)
                [matrix[pivot * size + i], matrix[column * size + i]] = [matrix[column * size + i], matrix[pivot * size + i]];
            [values[pivot], values[column]] = [values[column], values[pivot]];
        }
        for (let row = column + 1; row < size; ++row) {
            const factor = element(row, column) / element(column, column);
            if (!factor)
                continue;
            for (let i = column; i < size; ++i)
                matrix[row * size + i] -= factor * element(column, i);
            for (let component = 0; component < 4; ++component)
                values[row][component] -= factor * values[column][component];
        }
    }
    for (let row = size; row--;) {
        for (let i = row + 1; i < size; ++i) {
            for (let component = 0; component < 4; ++component)
                values[row][component] -= element(row, i) * values[i][component];
        }
        for (let component = 0; component < 4; ++component)
            values[row][component] /= element(row, row);
    }
    return values;
}

// The thin plate spline through the stops, as the freeform-gradient() editor and WebKit's FreeformGradient fit it:
// for each component, a + b x + c y plus a weight for each stop times U of the distance to it, the weights such that
// the spline has each stop's color at the stop and bends as little as it can.
//
// `colors` are the stops' as the renderer takes them: premultiplied, a polar space's hues moved to within half a turn
// of their mean. Positions are in units of the box's shorter side, then moved by -origin and divided by scale, so
// the stops' centroid is at 0 and the farthest stop at a distance of 1.
function fitSpline(colors) {
    const [sx, sy] = boxScale();
    // Where stops share a position, the last one is used.
    const points = [];
    state.stops.forEach((stop, i) => {
        const position = [stop.p[0] * sx, stop.p[1] * sy];
        const existing = points.findIndex(point => point.position[0] === position[0] && point.position[1] === position[1]);
        if (existing >= 0)
            points.splice(existing, 1);
        points.push({ position, color: colors[i] });
    });
    if (!points.length)
        return { boxScale: [sx, sy], origin: [0, 0], scale: 1, polynomial: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], centers: [] };

    const origin = [0, 0];
    for (const point of points) {
        origin[0] += point.position[0] / points.length;
        origin[1] += point.position[1] / points.length;
    }
    let farthest = 0;
    for (const point of points)
        farthest = Math.max(farthest, Math.hypot(point.position[0] - origin[0], point.position[1] - origin[1]));
    const scale = farthest > 0 ? farthest : 1;
    for (const point of points)
        point.position = [(point.position[0] - origin[0]) / scale, (point.position[1] - origin[1]) / scale];

    // The linear part: a for one stop, a + b t along the line for stops all on a line, so the spline is the same
    // either side of it, and a + b x + c y otherwise.
    const terms = [[1, 0, 0]];
    if (points.length > 1) {
        let xx = 0, xy = 0, yy = 0;
        for (const { position: [x, y] } of points) {
            xx += x * x;
            xy += x * y;
            yy += y * y;
        }
        const halfTrace = (xx + yy) / 2;
        const discriminant = Math.sqrt(((xx - yy) / 2) ** 2 + xy * xy);
        const largerEigenvalue = halfTrace + discriminant;
        const smallerEigenvalue = halfTrace - discriminant;
        if (smallerEigenvalue > 1e-9 * largerEigenvalue) {
            terms.push([0, 1, 0], [0, 0, 1]);
        } else {
            let directionX = xy;
            let directionY = largerEigenvalue - xx;
            if (Math.abs(directionX) + Math.abs(directionY) < 1e-12) {
                directionX = xx >= yy ? 1 : 0;
                directionY = xx >= yy ? 0 : 1;
            }
            const length = Math.hypot(directionX, directionY);
            terms.push([0, directionX / length, directionY / length]);
        }
    }

    //     [ K   Q ] [ w ]   [ v ]
    //     [ Q^T 0 ] [ a ] = [ 0 ]
    const count = points.length;
    const size = count + terms.length;
    const term = (k, [x, y]) => terms[k][0] + terms[k][1] * x + terms[k][2] * y;
    const matrix = new Float64Array(size * size);
    const values = Array.from({ length: size }, () => [0, 0, 0, 0]);
    for (let i = 0; i < count; ++i) {
        for (let j = 0; j < count; ++j) {
            const dx = points[i].position[0] - points[j].position[0], dy = points[i].position[1] - points[j].position[1];
            matrix[i * size + j] = radialBasis(dx * dx + dy * dy);
        }
        for (let k = 0; k < terms.length; ++k) {
            matrix[i * size + count + k] = term(k, points[i].position);
            matrix[(count + k) * size + i] = term(k, points[i].position);
        }
        values[i] = points[i].color.slice();
    }
    const solution = solveLinear(matrix, values, size);
    // Distinct positions make the system solvable, so this is only reached through rounding: the first color.
    if (!solution)
        return { boxScale: [sx, sy], origin, scale, polynomial: [...points[0].color, 0, 0, 0, 0, 0, 0, 0, 0], centers: [] };

    // The coefficients of 1, x and y, four components each.
    const polynomial = Array(12).fill(0);
    for (let k = 0; k < terms.length; ++k) {
        for (let coefficient = 0; coefficient < 3; ++coefficient) {
            for (let component = 0; component < 4; ++component)
                polynomial[coefficient * 4 + component] += terms[k][coefficient] * solution[count + k][component];
        }
    }
    return { boxScale: [sx, sy], origin, scale, polynomial, centers: points.map((point, i) => [...point.position, ...solution[i]]) };
}

// The spline's color at a point, 0 to 1 across and down the box: premultiplied, in the interpolation space.
function splineColor(spline, p) {
    const [sx, sy] = spline.boxScale;
    const x = (p[0] * sx - spline.origin[0]) / spline.scale, y = (p[1] * sy - spline.origin[1]) / spline.scale;
    const color = [0, 1, 2, 3].map(k => spline.polynomial[k] + spline.polynomial[4 + k] * x + spline.polynomial[8 + k] * y);
    for (const [cx, cy, ...weight] of spline.centers) {
        const basis = radialBasis((x - cx) ** 2 + (y - cy) ** 2);
        for (let k = 0; k < 4; ++k)
            color[k] += weight[k] * basis;
    }
    return color;
}

// Writes the spline's color into each texel of a grid, at the texel's center. The window is the part of the grid
// the box takes up, which is all of it unless the edges are open.
const SPLINE_SHADER = `
struct Spline {
    window: vec4f,
    boxScale: vec2f,
    origin: vec2f,
    scale: f32,
    count: u32,
    polynomial: array<vec4f, 3>,
}
struct Center {
    position: vec2f,
    weight: vec4f,
}
@group(0) @binding(0) var<uniform> spline: Spline;
@group(0) @binding(1) var<storage, read> centers: array<Center>;
@group(0) @binding(2) var splineOut: texture_storage_2d<rgba32float, write>;

@compute @workgroup_size(8, 8)
fn splineEvaluate(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = textureDimensions(splineOut);
    if (id.x >= size.x || id.y >= size.y) {
        return;
    }
    let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
    let p = ((uv - spline.window.xy) / spline.window.zw * spline.boxScale - spline.origin) / spline.scale;
    var color = spline.polynomial[0] + spline.polynomial[1] * p.x + spline.polynomial[2] * p.y;
    for (var i = 0u; i < spline.count; i++) {
        let offset = p - centers[i].position;
        let squaredDistance = dot(offset, offset);
        if (squaredDistance > 0.0) {
            color += centers[i].weight * (0.5 * squaredDistance * log(squaredDistance));
        }
    }
    textureStore(splineOut, vec2<i32>(id.xy), color);
}
`;

// The thin plate spline as a model beside the grid ones. It has nothing to solve on the grid: the spline is fit to
// the stops on the CPU, a small system, and each texel of every level takes the spline's color at its center. From
// there it's drawn, visualized and read back as the grid models' solutions are, so the grid only samples it.
class SplineRenderer extends WebGPUFreeformGradientRenderer {
    constructor(device, options) {
        super(device, options);
        const module = device.createShaderModule({ code: SPLINE_SHADER });
        this.splinePipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "splineEvaluate" } });
        this.splineUniforms = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.centerBuffer = null;
    }

    encodeSolve(encoder) {
        const { device, gradient, levels } = this;
        this.slots = new Map();
        this.slotData = new ArrayBuffer(uniformSlotBytes * uniformSlots);
        this.packSources();
        this.pass = encoder.beginComputePass();
        const finest = levels[0];
        if (gradient.isEmpty) {
            this.fill(finest, [0, 0, 0, 0]);
        } else {
            // The box's proportions are the gradient's own: the renderer's are of the canvas, in whole pixels.
            const { boxScale, origin, scale, polynomial, centers } = gradient.spline;
            const uniforms = new ArrayBuffer(96);
            new Float32Array(uniforms, 0, 9).set([...(gradient.window ?? [0, 0, 1, 1]), ...boxScale, ...origin, scale]);
            new Uint32Array(uniforms, 36, 1)[0] = centers.length;
            new Float32Array(uniforms, 48, 12).set(polynomial);
            device.queue.writeBuffer(this.splineUniforms, 0, uniforms);
            // A center is its position, then its weights from a multiple of 16 bytes.
            const packed = new Float32Array(Math.max(1, centers.length) * 8);
            centers.forEach(([x, y, ...weight], i) => packed.set([x, y, 0, 0, ...weight], i * 8));
            this.centerBuffer = this.storageBuffer(this.centerBuffer, packed);
            for (let index = 0; index < levels.length; index++) {
                const level = levels[index];
                // What the stops hold, for the visualizations: the texel each is in.
                this.dispatch("constraints", level, [
                    this.uniformEntry(index, index, 0, [0, 0], 0),
                    { binding: 1, resource: { buffer: this.pointBuffer } },
                    { binding: 2, resource: { buffer: this.segmentBuffer } },
                    { binding: 3, resource: this.view(level.constraintColor) },
                    { binding: 4, resource: this.view(level.constraintWeight) },
                    { binding: 5, resource: this.view(level.rightHandSide) },
                    { binding: 6, resource: this.view(finest.correctionRightHandSide) },
                    { binding: 7, resource: this.view(level.tears) },
                ]);
                level.values.current = 0;
                this.pass.setPipeline(this.splinePipeline);
                this.pass.setBindGroup(0, this.bindGroup(this.splinePipeline, [
                    { binding: 0, resource: { buffer: this.splineUniforms } },
                    { binding: 1, resource: { buffer: this.centerBuffer } },
                    { binding: 2, resource: this.view(level.values.textures[0]) },
                ]));
                this.pass.dispatchWorkgroups(Math.ceil(level.width / 8), Math.ceil(level.height / 8));
            }
        }
        this.pass.end();
        this.pass = null;
        device.queue.writeBuffer(this.uniforms, 0, this.slotData, 0, uniformSlotBytes * Math.max(this.slots.size, 1));
        this.makeEdges();
    }
}
MODEL_RENDERERS.spline = SplineRenderer;

// MARK: - Stops to the renderer

// How far a stop holds its color in the grid models, in units of the box's shorter side, at a spread of 0:
// MeshShader2's default point radius.
const STOP_RADIUS = 0.01;
// How far it holds its color at a spread of 100%.
const FULL_SPREAD = 0.35;

// In the grid models a stop holds a disc, which also holds the surface flat there, or with a spread of 0 just the
// texel it's in, which holds its color and leaves its slope free.
const STOP_SIZES = ["disc", "texel"];
const spreadRadius = stop => {
    const least = state.stopSize === "texel" ? 0 : STOP_RADIUS;
    return least + (FULL_SPREAD - least) * stop.spread / 100;
};

// The gradient as MeshShader2's renderer takes it: each stop a point, held out to its spread. The thin plate spline
// has the stops' points alone, and the spline fit to them.
function gradientData(model, influence = false) {
    // A stop's opacity scales its color's own alpha.
    // For the influence, the selected stop is 1 and the others 0, in srgb-linear.
    const colors = influence ? state.stops.map((_, i) => [...Array(3).fill(i === selection ? 1 : 0), 1]) : rendererColors(state.stops.map(stop => {
        const components = interpolationComponents(stop.color);
        components[3] *= stop.opacity / 100;
        return components;
    }));
    const points = [];
    state.stops.forEach((stop, i) => points.push(...colors[i], stop.p[0], stop.p[1], model === "spline" ? 0 : spreadRadius(stop), 0));
    const average = [0, 1, 2, 3].map(k => colors.length ? colors.reduce((sum, c) => sum + c[k], 0) / colors.length : 0);
    return {
        space: influence ? spaceIndex("srgb-linear") : spaceIndex(state.space), resolution: solveResolution(), model,
        isEmpty: !points.length, average, points, segments: [], lines: [], hasTwoSidedLines: false,
        isOpaque: colors.every(c => c[3] >= 1),
        ...(model === "spline" ? { spline: fitSpline(colors) } : {}),
    };
}

__COMMON_PAGE__
// MARK: - About the models

const MODEL_ABOUT = {
    spline: {
        note: "A stiff sheet laid over thin pegs on an endless plane. It passes exactly through every stop, bends as little as it can between them, and beyond them keeps going in a straight line. It's a formula of the stops, worked out here at each texel of the grid the other models solve on, which only samples it.",
        pros: ["Exact, so every engine can match", "The smoothest possible blend", "Nothing to tune: no grid, no stop size, no edges", "Cheap to draw, and what freeform-gradient() draws in WebKit", "Stops can go anywhere, even outside the box"],
        cons: ["Overshoots, often far", "Runs away in straight lines past the stops", "Every stop affects the whole box", "Needs special cases for one stop, stops on a line, and stops in the same place", "Cost grows with the number of stops", "No room for a spread, or for lines"],
        source: "Duchon's <a href=\"https://doi.org/10.1007/BFb0086566\" target=\"_blank\" rel=\"noopener\">thin-plate splines</a> (1977), brought to graphics by Bookstein in <a href=\"https://doi.org/10.1109/34.24792\" target=\"_blank\" rel=\"noopener\">“Principal Warps”</a> (1989). It's a closed-form formula over the whole plane.",
        spec: "A spec would define the formula, how positions are normalized, and what happens when stops share a position or sit on a line. Nothing depends on resolution, so engines can match each other apart from rounding.",
    },
    biharmonic: {
        note: "The same stiff sheet as the thin plate spline (∆²u = 0), cut to the box and solved on a grid, coarse to fine. Each stop holds its color across a disc out to its spread, or with One texel and no spread, at its point alone. With that and Natural edges it's as close as it comes to the spline: a sheet held only at the stops, but one that ends at the box where the spline's runs on.",
        pros: ["As smooth as the spline", "Ends at the box's edges, so it overshoots less", "Single points are enough to hold it", "A stop can have a spread, and there's room for lines and curves", "Drawing cost doesn't grow with the number of stops"],
        cons: ["Still overshoots between and past the stops, most of all near the box's edges", "Needs a solver, so engines would only match approximately", "What happens at the box's edges changes the result", "Solves again whenever a stop moves or the box changes size"],
        source: "Finch, Snyder and Hoppe, <a href=\"https://hhoppe.com/proj/freeform/\" target=\"_blank\" rel=\"noopener\">“Freeform Vector Graphics with Controlled Thin-Plate Splines”</a> (2011, <a href=\"https://doi.org/10.1145/2070781.2024200\" target=\"_blank\" rel=\"noopener\">DOI</a>). They minimize the thin plate's energy on a pixel grid, holding each stop at a single point and leaving the grid's edges free.",
        spec: "On top of the spline's, a spec would define how big a stop is and what its spread does, what happens at the box's edges, and how accurate the solve has to be.",
    },
    harmonic: {
        note: "A stretched membrane (∆u = 0) held at the stops. It forms a tent at each one, and never goes past the stops' colors. It's solved on a grid, coarse to fine.",
        pros: ["Never overshoots", "Each stop's influence stays between 0 and 1", "Simple, with fast solvers that suit the GPU"],
        cons: ["Peaks at every stop", "A stop needs a size: without one, its color shrinks to a dot as the grid gets finer", "Can look flat between stops"],
        source: "Orzan et al., <a href=\"https://inria.hal.science/inria-00274768\" target=\"_blank\" rel=\"noopener\">“Diffusion Curves: A Vector Representation for Smooth-Shaded Images”</a> (2008, <a href=\"https://doi.org/10.1145/1399504.1360691\" target=\"_blank\" rel=\"noopener\">DOI</a>), which spreads colors out from curves the same way.",
        spec: "As for the biharmonic model, and a size for every stop, which it can't do without.",
    },
};

// MARK: - View notes

const VIEW_NOTES = {
    gradient: "The gradient each model draws from the same stops.",
    holds: "What each model is held to, in the stops' colors, over the faded gradient. In the grid models a stop holds a disc out to its spread, at least 1% of the box's shorter side, or with One texel and no spread, the one texel it's in. The thin plate spline has each stop's point alone, marked by the texel it's in. Set Grid to 128 to see the texels.",
    gamut: "Hatching marks where the colors fall outside the chosen gamut, where they're clipped or gamut mapped to draw them. The thin plate spline keeps its slope past the stops, across the whole plane, so it goes furthest. The biharmonic model does the same but ends at the box. The harmonic model makes each texel the average of its neighbors, so it can't go past the colors it's held to. In oklab, a mix of two colors inside sRGB can also fall outside it, in any model.",
    isolines: "Lines of equal lightness, every 0.025 of Oklab L. The thin plate spline's and the biharmonic model's bend smoothly through and around the stops, since their slopes are continuous; the spline's run on past the box as they are, and the biharmonic model's turn to meet a mirrored edge squarely. The harmonic model's ring each stop tightly and kink around it.",
    influence: "Each model mixes the stops' colors in fixed proportions, so each point's color is a weighted sum of them. This shows the selected stop's weight: orange where it adds its color, white where it adds none, blue where it takes color away, and dark red above 1. The harmonic model's stays between 0 and 1. The biharmonic model's has negative patches and can go above 1, but it ends at the box's edges. The thin plate spline's grows without limit away from the stops.",
    difference: "White where two models agree, purple where they differ, darkest at a difference of 0.15 in Oklab (ΔE OK) or more. Each box shows its difference from the first other box shown: the grid models' from the thin plate spline, and the spline's from the biharmonic model.",
    level: "The grid models solve on a pyramid of grids, each half the size of the one above it. The coarsest is solved outright, and each finer level starts from the one below, scaled up, so it only has to fix the detail. This shows one level's texels as they are, unfiltered, with the texels the stops hold marked. Level 0 is the finest, the one that's drawn. The thin plate spline has nothing to solve, so each of its levels is the spline at that level's texels.",
    relaxation: "The harmonic model's finest grid, started from the stops' average color and relaxed without the pyramid: each step moves every texel toward the average of its four neighbors. The colors creep out from the stops a texel or two a step, so a fine grid would take hundreds of thousands of steps to settle. That's why the solve starts coarse. The other boxes show their gradients.",
};

// MARK: - Overlay

const ACCENT = "#0a84ff";

// Whether a stop has been dragged out of the box, and goes when it's let go.
const outside = ([x, y]) => x < -0.02 || x > 1.02 || y < -0.02 || y > 1.02;

// Whether a box's model has a use for a stop's spread.
const hasSpread = view => view.model !== "spline";

// Each stop as a swatch of its color, and the selected stop's spread as a dashed circle.
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

    const selected = selection !== null ? state.stops[selection] : null;
    if (selected && hasSpread(view)) {
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
        ctx.fillStyle = swatchColor(stop.color, stop.opacity / 100);
        ctx.fill();
        ctx.globalAlpha = 1;
    });
}

// MARK: - Editing

// The selected stop, by index.
let selection = null;
let drag = null;

const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];

// What's under a point in CSS pixels of `view`'s box: an end of the cross-section, a stop, or the selected stop's
// spread circle, in that order.
function hitTest(view, point) {
    const size = [view.overlay.clientWidth, view.overlay.clientHeight];
    const toPixels = ([x, y]) => [x * size[0], y * size[1]];
    const distance = at => Math.hypot(at[0] - point[0], at[1] - point[1]);
    // A row lies under everything else, so it's tried last.
    const end = state.sectionKind === "line" ? sectionHit(point, toPixels) : null;
    if (end)
        return end;
    for (let i = state.stops.length - 1; i >= 0; --i) {
        if (distance(toPixels(state.stops[i].p)) <= 9)
            return { kind: "stop", index: i };
    }
    if (selection !== null && state.stops[selection] && hasSpread(view)) {
        const stop = state.stops[selection];
        const [sx, sy] = boxScale();
        const radius = spreadRadius(stop);
        const offset = subtract(point, toPixels(stop.p));
        // How far out the point is, as a fraction of the circle's radius in that direction.
        const reach = Math.hypot(offset[0] / (radius / sx * size[0]), offset[1] / (radius / sy * size[1]));
        if (Math.abs(reach - 1) * Math.hypot(...offset) / Math.max(reach, 1e-6) <= 5)
            return { kind: "spread", index: selection };
    }
    return sectionHit(point, toPixels);
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
        const color = parseColor(stop.color) ?? parseColor("black");
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

function deleteStop(index) {
    state.stops.splice(index, 1);
    selection = null;
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
            selection = hit.index;
            drag = { kind: "stop", index: hit.index, start: at, origin: state.stops[hit.index].p.slice() };
        } else {
            selection = addStop(at);
            drag = { kind: "stop", index: selection, start: at, origin: at.slice() };
        }
        changed();
    });

    overlay.addEventListener("pointermove", event => {
        const at = fraction(event);
        if (!drag) {
            const hit = hitTest(view, point(event));
            overlay.style.cursor = !hit ? "crosshair" : hit.kind === "section" ? (hit.end === "row" ? "ns-resize" : "move") : hit.kind === "spread" ? "ew-resize" : "grab";
            return;
        }
        if (drag.kind === "section") {
            dragSection(drag.end, at);
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
}

// MARK: - Controls

function updateControls() {
    updateCommonControls();
    $("showStops").checked = state.showStops;
    $("stopSize").value = state.stopSize;
    $("countNote").textContent = `${state.stops.length} stop${state.stops.length === 1 ? "" : "s"}.`;

    updateStopList();

    const selected = selection !== null ? state.stops[selection] : null;
    $("stopFields").hidden = !selected;
    $("deleteStop").hidden = !selected;
    $("stopTitle").textContent = selected ? `Stop ${selection + 1}` : "Stops";
    if (selected) {
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
    }
}

// Each stop as a swatch that selects it.
function updateStopList() {
    const list = $("stopList");
    if (list.children.length !== state.stops.length) {
        list.replaceChildren(...state.stops.map((_, index) => {
            const button = document.createElement("button");
            button.append(document.createElement("span"));
            button.addEventListener("click", () => {
                selection = index;
                changed();
            });
            return button;
        }));
    }
    state.stops.forEach((stop, index) => {
        const button = list.children[index];
        button.firstChild.style.background = swatchColor(stop.color, stop.opacity / 100);
        button.title = `${stop.color}${stop.opacity < 100 ? `, ${stop.opacity}%` : ""}`;
        button.classList.toggle("selected", index === selection);
    });
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
$("stopSize").addEventListener("change", () => {
    state.stopSize = $("stopSize").value;
    changed();
});
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
$("clearStops").addEventListener("click", () => {
    state.stops = [];
    selection = null;
    changed();
});
$("showStops").addEventListener("change", () => {
    state.showStops = $("showStops").checked;
    changed();
});

__COMMON_CONTROLS__

// MARK: - CSS

// A made-up freeform-gradient():
//
//   freeform-gradient( [ [ biharmonic | harmonic ] || in <space> ]? , <stop># )
//   <stop> = <color> <position> [ spread <percentage> ]? [ opacity <percentage> ]?
//
// The thin plate spline is the default, and has no use for spread.

const number = v => String(Math.round(v * 100) / 100 || 0);
const percent = v => `${number(v * 100)}%`;

function stopText(stop, withSpread) {
    const parts = [stop.color.trim(), percent(stop.p[0]), percent(stop.p[1])];
    if (withSpread && stop.spread)
        parts.push(`spread ${stop.spread}%`);
    if (stop.opacity !== 100)
        parts.push(`opacity ${stop.opacity}%`);
    return parts.join(" ");
}

// The model is the one shown, or the first of several: the spline, unless it's hidden.
function cssText() {
    const model = state.models[0];
    const prelude = [model === "spline" ? "" : model, `in ${state.space}`].filter(Boolean).join(" ");
    return `background-image: freeform-gradient(${[prelude, ...state.stops.map(stop => stopText(stop, model !== "spline"))].join(",\n    ")});`;
}

__COMMON_FRAGMENT__
