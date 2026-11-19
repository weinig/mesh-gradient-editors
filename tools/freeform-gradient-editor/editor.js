__COMMON_HEAD__

// MARK: - State

// Stops hold colors at points. A stop's position is a fraction of the box, 0 to 1 across and down, and can be outside
// it; its spread is a percentage. Its weight is the optional number CSS has after a stop's position,
// which nothing uses yet.
let state = null;

const stop = (x, y, color, spread = 0) => ({ p: [x, y], color, spread, weight: null });

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
        note: "Stops that fade out: alpha is blended along with the color, premultiplied, so a color fades without going gray or dark on its way to transparent. Where a model's alpha overshoots past 0 or 1, it's clipped.",
        state: {
            width: 600, height: 400,
            stops: [
                stop(0.15, 0.5, "#ff006e"), stop(0.5, 0.2, "#3a86ff"), stop(0.85, 0.5, "#ffbe0b"),
                stop(0.5, 0.8, "#3a86ff00"), stop(0.5, 0.5, "#ffffff00"),
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
    {
        name: "Stops just outside the box",
        note: "The magenta and green stops are just outside the box, which CSS allows. The thin plate spline uses them wherever they are. With Mirrored or Natural edges the grid models end at the box, so a stop outside it holds nothing unless its disc reaches in. With Open or Free edges the grid reaches past the box and takes them in.",
        state: {
            width: 600, height: 400,
            stops: [stop(0.2, 0.3, "#ff3b30"), stop(0.7, 0.25, "#0a84ff"), stop(0.45, 0.78, "#ffd60a"), stop(1.04, 0.55, "#e040fb"), stop(-0.06, 0.92, "#30d158")],
        },
    },
    {
        name: "Thin box",
        note: "A wide, short box, so the grid models' edges are close to every stop. Try each of Edges: this is where they differ most.",
        state: {
            width: 800, height: 120,
            stops: [stop(0.12, 0.5, "#ff375f"), stop(0.4, 0.2, "#0a84ff"), stop(0.65, 0.8, "#ffd60a"), stop(0.9, 0.4, "#30d158")],
        },
    },
    {
        name: "Missing components",
        note: "Stops with missing (none) components. For now these are 0, as they are in WebKit.",
        state: {
            width: 600, height: 400,
            stops: [stop(0.15, 0.2, "rgb(none 255 0)"), stop(0.85, 0.2, "rgb(255 0 none)"), stop(0.5, 0.85, "rgb(0 none 255)")],
        },
    },
    {
        name: "One stop",
        note: "A single stop. Every model draws its color everywhere.",
        state: {
            width: 600, height: 400,
            stops: [stop(0.5, 0.5, "#5e5ce6")],
        },
    },
    {
        name: "Finch et al., Figure 8: two points make a ramp",
        note: "After Figure 8 of the thin-plate spline paper, without its curve: two points alone give a straight ramp across the whole box. The thin plate spline is that ramp exactly. This sets Edges to Natural and Stops hold to One texel, as the paper has them, so the biharmonic model is the same ramp; they stay set when you choose another preset. With Mirrored edges or discs its ramp flattens toward the sides. The harmonic model only rings each stop.",
        state: {
            width: 500, height: 500,
            stops: [stop(0.3, 0.5, "#4d4d4d"), stop(0.8, 0.5, "#f2f2f2")],
            edges: "natural", stopSize: "texel",
        },
    },
];

const influenceAvailable = () => selection !== null && !!state.stops[selection];

// What the shared code needs from this editor: which state a preset sets, which preset to start from, what to reset
// when a preset is chosen, and which links it can read.
const PRESET_KEYS = ["stops"];
const TWO_SIDED_LINES = false;
const DEFAULT_PRESET = 0;

// A preset, and the page as it opens, start with the first stop selected.
function resetEditing() {
    selection = state.stops.length ? 0 : null;
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

// A link from the freeform-gradient() editor as it was before it took this one's place: short names, positions in
// percent, and a stop's spread the radius of its disc as a fraction of half the box's shorter side. Rewritten as
// this editor's own.
function fromOldLink(data) {
    const finite = v => typeof v === "number" && Number.isFinite(v);
    const old = { ...data };
    for (const key of Object.keys(data)) {
        if (key !== "v")
            delete data[key];
    }
    const discs = old.ho !== "points";
    const defaultSpread = finite(old.ds) ? old.ds : 0.02;
    const spreads = Array.isArray(old.sp) ? old.sp : [];
    data.stops = old.p.filter(Array.isArray).map((entry, i) => {
        const radius = discs ? clamp(finite(spreads[i]) ? spreads[i] : defaultSpread, 0, 1) / 2 : 0;
        return {
            color: String(entry[0]), p: [entry[1] / 100, entry[2] / 100], weight: finite(entry[3]) ? entry[3] : null,
            spread: Math.round(clamp((radius - STOP_RADIUS) / (FULL_SPREAD - STOP_RADIUS), 0, 1) * 100),
        };
    });
    const views = { influence: "influence", difference: "difference", grid: "holds", plane: "plane", term: "term", basis: "basis" };
    Object.assign(data, {
        width: old.w, height: old.h, space: old.s, showStops: old.o !== 0, backdrop: old.k,
        gamutMapping: old.gmap, gamut: old.gm ?? "display-p3",
        edges: old.ed, stopSize: discs ? "disc" : "texel",
        view: views[old.vw] ?? (old.cl === 1 ? "gamut" : "gradient"),
        normalization: old.n === 1,
        crossSection: old.x === 1, sectionKind: old.xk === 1 ? "line" : "row", sectionRow: finite(old.r) ? old.r / 100 : 0.5,
        sample: old.m === 1, sheet: old.d === 1, numbers: old.nb === 1, about: old.ab === 1, otherCurves: old.oc === 1,
    });
    if (Array.isArray(old.ms))
        data.models = old.ms;
    if (Array.isArray(old.xs) && old.xs.length === 4 && old.xs.every(finite))
        data.section = [[old.xs[0] / 100, old.xs[1] / 100], [old.xs[2] / 100, old.xs[3] / 100]];
    if (Number.isInteger(old.dc) && old.dc >= 0 && old.dc < 4)
        data.sheetHeight = `c${old.dc}`;
}

// A link's stops, made sound: each with a position and a color.
function acceptsState(data) {
    if (!Array.isArray(data.stops) && Array.isArray(data.p))
        fromOldLink(data);
    if (!Array.isArray(data.stops))
        return false;
    const finite = v => typeof v === "number" && Number.isFinite(v);
    data.stops = data.stops.filter(stop => !!stop && Array.isArray(stop.p) && finite(stop.p[0]) && finite(stop.p[1]) && typeof stop.color === "string").map(stop => ({
        p: stop.p.slice(0, 2), color: fadedColor(stop.color, finite(stop.opacity) ? clamp(stop.opacity, 0, 100) : 100),
        spread: finite(stop.spread) ? clamp(stop.spread, 0, 100) : 0,
        weight: finite(stop.weight) ? stop.weight : null,
    }));
    if (!STOP_SIZES.includes(data.stopSize))
        data.stopSize = "disc";
    if (!SPLINE_DRAWINGS.includes(data.splineDrawing))
        data.splineDrawing = "pixel";
    data.normalization = !!data.normalization;
    return true;
}

function presetState(index) {
    return {
        ...commonState(),
        showStops: state?.showStops ?? true,
        stopSize: state?.stopSize ?? "disc",
        splineDrawing: state?.splineDrawing ?? "pixel",
        normalization: state?.normalization ?? false,
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

// The thin plate spline through the stops, as WebKit's FreeformGradient fits it:
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
        points.push({ position, color: colors[i], stop: i });
    });
    if (!points.length)
        return { boxScale: [sx, sy], origin: [0, 0], scale: 1, polynomial: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], centers: [], stops: [], line: null };

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
        return { boxScale: [sx, sy], origin, scale, polynomial: [...points[0].color, 0, 0, 0, 0, 0, 0, 0, 0], centers: [], stops: [], line: null };

    // The coefficients of 1, x and y, four components each.
    const polynomial = Array(12).fill(0);
    for (let k = 0; k < terms.length; ++k) {
        for (let coefficient = 0; coefficient < 3; ++coefficient) {
            for (let component = 0; component < 4; ++component)
                polynomial[coefficient * 4 + component] += terms[k][coefficient] * solution[count + k][component];
        }
    }
    // Each center is its position and its weights; `stops` has the stop each is for, and `line` the direction of the
    // line the stops are all on, if they are.
    return {
        boxScale: [sx, sy], origin, scale, polynomial, centers: points.map((point, i) => [...point.position, ...solution[i]]),
        stops: points.map(point => point.stop), line: terms.length === 2 ? terms[1].slice(1) : null,
    };
}

// The spline through the stops as they are, for the overlay, the numbers and a new stop's color: fit once for each
// change to the stops, the box or the space.
let fittedSpline = null;
function currentSpline() {
    const key = JSON.stringify([state.stops, state.width, state.height, state.space]);
    if (fittedSpline?.key !== key)
        fittedSpline = { key, spline: fitSpline(stopColors()) };
    return fittedSpline.spline;
}

// The part of a spline the chosen view shows: all of it, its linear part, or its linear part and the selected stop's
// term.
function viewSpline(spline) {
    if (state.view !== "plane" && state.view !== "term")
        return spline;
    const center = state.view === "term" ? spline.stops.indexOf(selection) : -1;
    return { ...spline, centers: center < 0 ? [] : [spline.centers[center]], stops: center < 0 ? [] : [selection] };
}

// U(r) around the selected stop alone, as a gray the influence's colors show: 0 at the stop and at r = 1.
function basisSpline(spline) {
    const center = spline.stops.indexOf(selection);
    return {
        ...spline, polynomial: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
        centers: center < 0 ? [] : [[...spline.centers[center].slice(0, 2), 1, 1, 1, 0]], stops: center < 0 ? [] : [selection],
    };
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

// Draws the spline itself: each fragment evaluates it at its pixel's center, as WebKit's
// FreeformGradientRendererMetal does, and takes the color to the screen as the renderer's own display does. Appended
// to the renderer's shader, for its vertex stage, toSRGB() and ditherNoise().
const SPLINE_PIXEL_SHADER = `
struct SplinePixel {
    boxScale: vec2f,
    origin: vec2f,
    scale: f32,
    count: u32,
    polynomial: array<vec4f, 3>,
}
struct SplinePixelCenter {
    position: vec2f,
    weight: vec4f,
}
@group(0) @binding(30) var<uniform> splinePixel: SplinePixel;
@group(0) @binding(31) var<storage, read> splinePixelCenters: array<SplinePixelCenter>;

@fragment
fn splinePixelFragment(input: DisplayVertex) -> @location(0) vec4<f32> {
    let p = (input.uv * splinePixel.boxScale - splinePixel.origin) / splinePixel.scale;
    var value = splinePixel.polynomial[0] + splinePixel.polynomial[1] * p.x + splinePixel.polynomial[2] * p.y;
    for (var i = 0u; i < splinePixel.count; i++) {
        let offset = p - splinePixelCenters[i].position;
        let squaredDistance = dot(offset, offset);
        if (squaredDistance > 0.0) {
            value += splinePixelCenters[i].weight * (0.5 * squaredDistance * log(squaredDistance));
        }
    }
    let color = toSRGB(value, display.space);
    let encoded = saturate(color.rgb + (ditherNoise(input.position.xy) - 0.5) / 255.0);
    return vec4<f32>(encoded * color.a, color.a);
}
`;

// How the thin plate spline's gradient is drawn: at every pixel, or from the grid the other models solve on.
const SPLINE_DRAWINGS = ["pixel", "grid"];

// The thin plate spline as a model beside the grid ones. It has nothing to solve on the grid: the spline is fit to
// the stops on the CPU, a small system, and each texel of every level takes the spline's color at its center. From
// there it's visualized and read back as the grid models' solutions are, so the grid only samples it. The gradient
// itself is drawn from the grid too, or with `perPixel`, from the spline at every pixel.
class SplineRenderer extends WebGPUFreeformGradientRenderer {
    constructor(device, options) {
        super(device, options);
        const module = device.createShaderModule({ code: SPLINE_SHADER });
        this.splinePipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "splineEvaluate" } });
        this.splineUniforms = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.centerBuffer = null;
        const pixelModule = device.createShaderModule({ code: options.shader + SPLINE_PIXEL_SHADER });
        this.pixelPipeline = device.createRenderPipeline({
            layout: "auto",
            vertex: { module: pixelModule, entryPoint: "freeformDisplayVertex" },
            fragment: { module: pixelModule, entryPoint: "splinePixelFragment", targets: [{ format: options.format }] },
            primitive: { topology: "triangle-list" },
        });
        this.pixelUniforms = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    }

    encode(encoder, view, width, height) {
        const { device, gradient } = this;
        // The centers are packed when the grid is filled, so the grid comes first.
        if (!gradient?.perPixel || gradient.isEmpty || !this.centerBuffer || !this.solvedSize)
            return super.encode(encoder, view, width, height);
        const display = new ArrayBuffer(32);
        new Uint32Array(display, 0, 4).set([gradient.space, gradient.outputIsDisplayP3 ?? 0, gradient.gamutMapping ?? 0, 0]);
        new Float32Array(display, 16, 4).set(gradient.window ?? [0, 0, 1, 1]);
        device.queue.writeBuffer(this.displayUniforms, 0, display);
        const { boxScale, origin, scale, polynomial, centers } = gradient.spline;
        const uniforms = new ArrayBuffer(80);
        new Float32Array(uniforms, 0, 5).set([...boxScale, ...origin, scale]);
        new Uint32Array(uniforms, 20, 1)[0] = centers.length;
        new Float32Array(uniforms, 32, 12).set(polynomial);
        device.queue.writeBuffer(this.pixelUniforms, 0, uniforms);
        const pass = encoder.beginRenderPass({
            colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
        });
        pass.setPipeline(this.pixelPipeline);
        pass.setBindGroup(0, this.bindGroup(this.pixelPipeline, [
            { binding: 0, resource: { buffer: this.displayUniforms } },
            { binding: 30, resource: { buffer: this.pixelUniforms } },
            { binding: 31, resource: { buffer: this.centerBuffer } },
        ]));
        pass.draw(3);
        pass.end();
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

// The stops' colors as the renderer takes them.
const stopColors = () => rendererColors(state.stops.map(stop => interpolationComponents(stop.color)));

// The spline a box's renderer takes: for the gradient, the part of it the view shows; for its second renderer, the
// selected stop's influence, or U(r) around it.
function rendererSpline(colors, scalar) {
    const spline = fitSpline(colors);
    if (scalar)
        return state.view === "basis" ? basisSpline(spline) : spline;
    return viewSpline(spline);
}

// The gradient as MeshShader2's renderer takes it: each stop a point, held out to its spread. The thin plate spline
// has the stops' points alone, and the spline fit to them.
function gradientData(model, influence = false) {
    // For the influence, the selected stop is 1 and the others 0, in srgb-linear.
    const colors = influence ? state.stops.map((_, i) => [...Array(3).fill(i === selection ? 1 : 0), 1]) : stopColors();
    const points = [];
    state.stops.forEach((stop, i) => points.push(...colors[i], stop.p[0], stop.p[1], model === "spline" ? 0 : spreadRadius(stop), 0));
    const average = [0, 1, 2, 3].map(k => colors.length ? colors.reduce((sum, c) => sum + c[k], 0) / colors.length : 0);
    return {
        space: influence ? spaceIndex("srgb-linear") : spaceIndex(state.space), resolution: solveResolution(), model,
        isEmpty: !points.length, average, points, segments: [], lines: [], hasTwoSidedLines: false,
        isOpaque: colors.every(c => c[3] >= 1),
        ...(model === "spline" ? { spline: rendererSpline(colors, influence), perPixel: !influence && state.splineDrawing === "pixel" } : {}),
    };
}

__COMMON_PAGE__
// MARK: - About the models

const MODEL_ABOUT = {
    spline: {
        note: "A stiff sheet laid over thin pegs on an endless plane. It passes exactly through every stop, bends as little as it can between them, and beyond them keeps going in a straight line. It's a formula of the stops, worked out here at every pixel, as WebKit draws it, or at each texel of the grid the other models solve on.",
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
    plane: "The thin plate spline is f(p) = a + b·x + c·y + Σ wᵢ·U(|p − pᵢ|) for each component. The weights wᵢ and a, b and c are solved together, so f has each stop's color at the stop. This shows only the linear part, a + b·x + c·y: the tilt the stops' terms are added to, which on its own reaches few of the stops' colors. The other boxes show their gradients.",
    term: "The thin plate spline's linear part plus only the selected stop's term, wᵢ·U(r). Where the weight is positive the term lowers that component near the stop and raises it far away, and where it's negative, the other way. It changes sign at r = 1, the dashed circle, since U(1) = 0. The other boxes show their gradients.",
    basis: "U(r) = r²·log r is the shape a thin plate takes when it's pushed at one point. Every stop's term is this shape, centered on the stop and scaled by its weights. It's 0 at the stop and at r = 1, the dashed circle, dips below 0 in between, in blue, and grows past r = 1, in orange. r is in the spline's own units, in which the farthest stop is 1 from the stops' center. The other boxes show their gradients.",
    relaxation: "The harmonic model's finest grid, started from the stops' average color and relaxed without the pyramid: each step moves every texel toward the average of its four neighbors. The colors creep out from the stops a texel or two a step, so a fine grid would take hundreds of thousands of steps to settle. That's why the solve starts coarse. The other boxes show their gradients.",
};

// MARK: - Overlay

const ACCENT = "#0a84ff";

// A stop can be outside the box, which CSS allows, so each box's overlay reaches this many CSS pixels past it on
// every side: editor.css has the same number.
const REACH = 28;
const boxSize = view => [view.stage.clientWidth, view.stage.clientHeight];

// Whether a stop has been dragged out past what the overlay shows, and goes when it's let go.
function outside(view, [x, y]) {
    const [width, height] = boxSize(view);
    const limit = REACH - 4;
    return x * width < -limit || x * width > width + limit || y * height < -limit || y * height > height + limit;
}

// A line that shows on light and dark colors: white over dark.
function strokeTwice(ctx, path, dash = []) {
    for (const [style, width] of [["rgba(0, 0, 0, 0.55)", 3], ["#fff", 1.5]]) {
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.setLineDash(width < 2 ? dash : []);
        ctx.beginPath();
        path();
        ctx.stroke();
    }
    ctx.setLineDash([]);
}

function drawLabel(ctx, text, x, y) {
    ctx.font = "600 10px -apple-system, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = "#fff";
    ctx.fillText(text, x, y);
}

// What the spline's box shows of the spline itself: how its stops are normalized, and the circle where the selected
// stop's U(r) is 0. And for every box with Numbers on, a ring where its colors go furthest past the stops'.
function drawSplineParts(view, ctx, size) {
    const spline = currentSpline();
    const shorter = Math.min(...size);
    // From the spline's own units to the box's pixels.
    const toPixels = ([x, y]) => [(x * spline.scale + spline.origin[0]) * shorter, (y * spline.scale + spline.origin[1]) * shorter];
    const radius = spline.scale * shorter;
    if (view.model === "spline" && state.normalization && spline.centers.length) {
        const middle = toPixels([0, 0]);
        for (const center of spline.centers) {
            strokeTwice(ctx, () => {
                ctx.moveTo(...middle);
                ctx.lineTo(...toPixels(center));
            }, [2, 3]);
        }
        strokeTwice(ctx, () => ctx.arc(...middle, radius, 0, 2 * Math.PI), [6, 4]);
        if (spline.line) {
            // Stops on a line: the linear part only changes along it.
            const reach = Math.hypot(...size) + 2 * REACH;
            strokeTwice(ctx, () => {
                ctx.moveTo(middle[0] - spline.line[0] * reach, middle[1] - spline.line[1] * reach);
                ctx.lineTo(middle[0] + spline.line[0] * reach, middle[1] + spline.line[1] * reach);
            });
        }
        ctx.beginPath();
        ctx.arc(...middle, 4, 0, 2 * Math.PI);
        ctx.fillStyle = "#000";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
        drawLabel(ctx, "(0, 0)", middle[0], middle[1] + 16);
        drawLabel(ctx, "distance 1", middle[0], middle[1] - radius);
    }
    const center = spline.centers[spline.stops.indexOf(selection)];
    if (view.model === "spline" && center && (state.view === "term" || state.view === "basis")) {
        const at = toPixels(center);
        strokeTwice(ctx, () => ctx.arc(...at, radius, 0, 2 * Math.PI), [3, 3]);
        drawLabel(ctx, "r = 1, where U(r) = 0", at[0], at[1] + radius);
    }
    if (state.numbers && view.worst) {
        const [x, y] = [view.worst[0] * size[0], view.worst[1] * size[1]];
        strokeTwice(ctx, () => {
            ctx.arc(x, y, 7, 0, 2 * Math.PI);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                ctx.moveTo(x + dx * 4, y + dy * 4);
                ctx.lineTo(x + dx * 11, y + dy * 11);
            }
        });
    }
}

// Whether a box's model has a use for a stop's spread.
const hasSpread = view => view.model !== "spline";

// Each stop as a swatch of its color, and the selected stop's spread as a dashed circle.
function drawOverlay(view) {
    const canvas = view.overlay;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Drawn in the box's own pixels, from its top left corner, which is REACH into the overlay.
    const scale = canvas.width / (canvas.clientWidth || 1);
    ctx.setTransform(scale, 0, 0, scale, REACH * scale, REACH * scale);
    const size = boxSize(view);
    const toPixels = ([x, y]) => [x * size[0], y * size[1]];
    if (state.crossSection)
        drawSection(ctx, toPixels);
    drawSplineParts(view, ctx, size);
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
        ctx.globalAlpha = drag?.kind === "stop" && drag.index === i && outside(view, stop.p) ? 0.35 : 1;
        ctx.beginPath();
        ctx.arc(...at, radius + 2.5, 0, 2 * Math.PI);
        ctx.fillStyle = i === selection ? ACCENT : "#fff";
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(...at, radius, 0, 2 * Math.PI);
        ctx.fillStyle = swatchColor(stop.color);
        ctx.fill();
        ctx.globalAlpha = 1;
    });
}

// MARK: - Editing

// The selected stop, by index.
let selection = null;
let drag = null;

const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];

// What's under a point in CSS pixels of `view`'s box, from its top left corner: an end of the cross-section, a stop,
// or the selected stop's spread circle, in that order.
function hitTest(view, point) {
    const size = boxSize(view);
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

// The color a new stop takes. While the thin plate spline is shown it's the spline's color there, so the spline
// changes as little as it can; otherwise the stops' colors around it, weighted by the inverse square of how far each
// is.
function colorAt(p) {
    if (!state.stops.length)
        return "#7f7f7f";
    if (state.models.includes("spline")) {
        const { rgb, alpha } = appearance(splineColor(currentSpline(), p), state.space);
        if (alpha > 1 / 255)
            return hexWithAlpha({ space: "srgb", c: rgb.map(v => clamp(v, 0, 1)), alpha: clamp(alpha, 0, 1) });
    }
    const [sx, sy] = boxScale();
    let total = 0;
    const sum = [0, 0, 0, 0];
    for (const stop of state.stops) {
        const weight = 1 / Math.max(((stop.p[0] - p[0]) * sx) ** 2 + ((stop.p[1] - p[1]) * sy) ** 2, 1e-8);
        const color = parseColor(stop.color) ?? parseColor("black");
        const srgb = fromXYZ("srgb", toXYZ(color.space, color.c.map(v => Number.isNaN(v) ? 0 : v)));
        srgb.forEach((v, k) => sum[k] += weight * v);
        sum[3] += weight * (Number.isNaN(color.alpha) ? 0 : color.alpha);
        total += weight;
    }
    return hexWithAlpha({ space: "srgb", c: sum.slice(0, 3).map(v => clamp(v / total, 0, 1)), alpha: sum[3] / total });
}

function addStop(p) {
    state.stops.push({ p, color: colorAt(p), spread: 0, weight: null });
    return state.stops.length - 1;
}

function deleteStop(index) {
    state.stops.splice(index, 1);
    selection = null;
}

for (const view of views) {
    const overlay = view.overlay;
    // Places are the box's, though the events are the overlay's, which reaches past it.
    const point = event => {
        const rect = view.stage.getBoundingClientRect();
        return [event.clientX - rect.left, event.clientY - rect.top];
    };
    const fraction = event => {
        const rect = view.stage.getBoundingClientRect();
        return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
    };
    const inBox = ([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1;

    const press = event => {
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
        } else if (inBox(at)) {
            selection = addStop(at);
            drag = { kind: "stop", index: selection, start: at, origin: at.slice() };
        }
        changed();
    };
    overlay.addEventListener("pointerdown", event => {
        if (event.button === 0)
            press(event);
    });

    overlay.addEventListener("pointermove", event => {
        // After a menu closes, WebKit sends the next press as a move with the button newly held.
        if (!drag && pressedWithoutDown(event)) {
            press(event);
            return;
        }
        const at = fraction(event);
        if (!drag) {
            const hit = hitTest(view, point(event));
            overlay.style.cursor = !hit ? (inBox(at) ? "crosshair" : "") : hit.kind === "section" ? (hit.end === "row" ? "ns-resize" : "move") : hit.kind === "spread" ? "ew-resize" : "grab";
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
        // A stop dragged out past the overlay goes.
        if (finished.kind === "stop" && outside(view, state.stops[finished.index]?.p ?? [0, 0]))
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
    $("splineDrawing").value = state.splineDrawing;
    $("splineDrawingRow").hidden = !state.models.includes("spline");
    $("splineHeading").hidden = !state.models.includes("spline");
    $("normalization").checked = state.normalization;
    $("normalizationRow").hidden = !state.models.includes("spline");
    // The note is the info button's to show, whether or not the normalization is drawn.
    if (state.models.includes("spline")) {
        const spline = currentSpline();
        let text = `The spline is fit after moving the stops so their center is at (0, 0), and scaling them so the farthest is at a distance of 1: here ${(spline.scale * 100).toFixed(1)}% of the box's shorter side. This doesn't change the result. It keeps the numbers in the solve a similar size.`;
        if (spline.line)
            text += " The stops are on a line, so the linear part is a + b·t along that line: nothing says how it should tilt across it.";
        else if (spline.centers.length === 1)
            text += " With one stop, the linear part is a constant, a.";
        $("normalizationNote").textContent = text;
    }
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
        $("spread").value = selected.spread;
        $("spreadValue").textContent = selected.spread + "%";
        if (document.activeElement !== $("stopWeight"))
            $("stopWeight").value = selected.weight ?? "";
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
        button.firstChild.style.background = swatchColor(stop.color);
        button.title = stop.color;
        button.classList.toggle("selected", index === selection);
    });
}

$("stopPicker").addEventListener("input", () => {
    if (selection === null)
        return;
    state.stops[selection].color = pickedColor($("stopPicker"));
    $("stopText").value = state.stops[selection].color;
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
            state.stops[selection].p[axis] = clamp(value, -100, 200) / 100;
        changed();
    });
}
$("stopWeight").addEventListener("change", () => {
    const value = parseFloat($("stopWeight").value);
    if (selection !== null)
        state.stops[selection].weight = Number.isFinite(value) ? value : null;
    changed();
});
$("splineDrawing").addEventListener("change", () => {
    state.splineDrawing = $("splineDrawing").value;
    changed();
});
$("normalization").addEventListener("change", () => {
    state.normalization = $("normalization").checked;
    changed();
});
$("edges").closest(".row").title += " Free: both at once, the bigger grid with nothing holding the surface at its sides, as Finch et al. have it. It takes in stops outside the box.";
$("stopSize").addEventListener("change", () => {
    state.stopSize = $("stopSize").value;
    changed();
});
for (const id of ["spread"]) {
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

// With the thin plate spline first among the boxes, the freeform-gradient() WebKit takes:
//
//   freeform-gradient( <color-interpolation-method>? , <freeform-color-stop># )
//   <freeform-color-stop> = <color> <position> [ / <number> ]?
//
// With a grid model first, a made-up one:
//
//   freeform-gradient( [ biharmonic | harmonic ] in <space> , <stop># )
//   <stop> = <color> <position> [ spread <percentage> ]?

const number = v => String(Math.round(v * 100) / 100 || 0);
const percent = v => `${number(v * 100)}%`;

// How WebCore stores a color, which decides the default interpolation method: 8-bit sRGB means sRGB, anything else
// OKLab. (consumeFreeformGradient() in CSSPropertyParserConsumer+Image.cpp)
function colorPrecision(stop) {
    const color = parseColor(stop.color);
    if (!color || color.resolvedByBrowser)
        return "unknown";
    return color.eightBit ? "8bit" : "float";
}

// The interpolation method, unless it's the one WebKit would choose from the stops' colors.
function splinePrelude() {
    const precisions = state.stops.map(colorPrecision);
    if (precisions.length && !precisions.includes("unknown") && state.space === (precisions.includes("float") ? "oklab" : "srgb"))
        return "";
    return `in ${state.space}`;
}

function splineCSS() {
    const stops = state.stops.map(stop => `${stop.color.trim()} ${percent(stop.p[0])} ${percent(stop.p[1])}${stop.weight === null ? "" : ` / ${stop.weight}`}`);
    return `background-image: freeform-gradient(${[splinePrelude(), ...stops].filter(Boolean).join(",\n    ")});`;
}

function stopText(stop, withSpread) {
    const parts = [stop.color.trim(), percent(stop.p[0]), percent(stop.p[1])];
    if (withSpread && stop.spread)
        parts.push(`spread ${stop.spread}%`);
    return parts.join(" ");
}

// The model is the one shown, or the first of several: the spline, unless it's hidden.
function cssText() {
    const model = state.models[0];
    if (model === "spline")
        return splineCSS();
    return `background-image: freeform-gradient(${[`${model} in ${state.space}`, ...state.stops.map(stop => stopText(stop, true))].join(",\n    ")});`;
}

// MARK: - More under each box and the pointer

SCALAR_VIEWS.basis = "spline";

// The spline's own views need its box, and all but its linear part a selected stop.
EXTRA.viewAvailable = name => {
    if (name === "plane")
        return state.models.includes("spline");
    if (name === "term" || name === "basis")
        return state.models.includes("spline") && influenceAvailable();
    return undefined;
};

const oklabOf = linear => fromXYZ("oklab", toXYZ("srgb-linear", linear));

// How far a box's colors go past the stops' colors, in Oklab: lighter than the lightest stop, darker than the
// darkest, or more colorful than the most colorful. Nearly transparent texels, whose colors barely show, are left
// out. Less than 0.005 is too little to see.
function pastStops(view, readout) {
    const stops = stopColors().map(color => appearance(color, state.space)).filter(color => color.alpha > 1e-6).map(color => oklabOf(color.linear));
    if (!stops.length)
        return null;
    const lightest = Math.max(...stops.map(c => c[0])), darkest = Math.min(...stops.map(c => c[0]));
    const mostColorful = Math.max(...stops.map(c => Math.hypot(c[1], c[2])));
    const [x0, y0, x1, y1] = [readout.window[0] * readout.width, readout.window[1] * readout.height,
        (readout.window[0] + readout.window[2]) * readout.width, (readout.window[1] + readout.window[3]) * readout.height].map(Math.round);
    const past = { lighter: 0, darker: 0, moreColorful: 0, worst: 0, at: null };
    for (let y = y0; y < y1; ++y) {
        for (let x = x0; x < x1; ++x) {
            const color = appearance(readout.values.subarray((y * readout.width + x) * 4, (y * readout.width + x) * 4 + 4), readout.space);
            if (color.alpha < 0.05)
                continue;
            const [L, a, b] = oklabOf(color.linear);
            const each = [L - lightest, darkest - L, Math.hypot(a, b) - mostColorful];
            past.lighter = Math.max(past.lighter, each[0]);
            past.darker = Math.max(past.darker, each[1]);
            past.moreColorful = Math.max(past.moreColorful, each[2]);
            if (Math.max(...each) > past.worst) {
                past.worst = Math.max(...each);
                past.at = [(x + 0.5 - x0) / (x1 - x0), (y + 0.5 - y0) / (y1 - y0)];
            }
        }
    }
    return past;
}

// The spline's fitted numbers, a column for each component.
function coefficientsText(spline) {
    const labels = sheetHeights(state.space).map(height => height.short);
    // Three decimals, or fewer for a component that runs to 100 or more.
    const digits = value => Math.abs(value) >= 100 ? 1 : Math.abs(value) >= 10 ? 2 : 3;
    const row = (name, values) => [name, ...values.map(value => (value < 0 ? "−" : "") + Math.abs(value).toFixed(digits(value)))].join("\t");
    const center = spline.origin.map((v, axis) => `${(100 * v / spline.boxScale[axis]).toFixed(1)}%`).join(" ");
    return [
        `The spline's coefficients, with the stops' center at ${center} and the farthest stop ${(100 * spline.scale).toFixed(1)}% of the shorter side from it:`,
        ["", ...labels].join("\t"),
        ...["a", "b", "c"].map((name, i) => row(name, spline.polynomial.slice(i * 4, i * 4 + 4))),
        ...spline.centers.map((center, i) => row(`w${spline.stops[i] + 1}`, center.slice(2))),
    ].join("\n");
}

EXTRA.numbers = (view, readout) => {
    if (readout.level !== 0 || state.view === "basis" && view.model === "spline")
        return "";
    if (readout.past === undefined) {
        readout.past = pastStops(view, readout);
        const worst = readout.past && readout.past.worst >= 0.005 ? readout.past.at : null;
        if (JSON.stringify(worst) !== JSON.stringify(view.worst ?? null)) {
            view.worst = worst;
            scheduleRender();
        }
    }
    const past = readout.past;
    let text = "";
    if (past) {
        const parts = [["lighter", past.lighter], ["darker", past.darker], ["more colorful", past.moreColorful]].filter(([, value]) => value >= 0.005);
        text = parts.length
            ? ` Past the stops' colors, in Oklab: ${parts.map(([name, value]) => `${value.toFixed(3)} ${name}`).join(", ")}; the ring marks where it's furthest.`
            : " Within the stops' colors.";
    }
    if (view.model === "spline" && state.stops.length)
        text += "\n\n" + coefficientsText(viewSpline(currentSpline()));
    return text;
};

// Each stop's share of the spline's color anywhere: the spline fit to 1 at that stop and 0 at the others, four stops
// to a fit. The shares add up to 1.
let fittedShares = null;
function shareSplines() {
    const key = JSON.stringify([state.stops.map(stop => stop.p), state.width, state.height]);
    if (fittedShares?.key !== key) {
        const splines = [];
        for (let first = 0; first < state.stops.length; first += 4)
            splines.push(fitSpline(state.stops.map((_, i) => [0, 1, 2, 3].map(k => i === first + k ? 1 : 0))));
        fittedShares = { key, splines };
    }
    return fittedShares.splines;
}

EXTRA.sample = (view, p) => {
    if (view.model !== "spline" || state.stops.length < 2 || state.view === "plane" || state.view === "term" || state.view === "basis")
        return [];
    const shares = shareSplines().flatMap(spline => splineColor(spline, p)).slice(0, state.stops.length);
    return [`Each stop's share: ${shares.map((share, i) => `${i + 1}: ${Math.round(share * 100)}%`).join(", ")}`];
};

__COMMON_FRAGMENT__
