__COMMON_HEAD__

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

const influenceAvailable = () => selection !== null && !!state.stops[selection];

// What the shared code needs from this editor: which state a preset sets, which preset to start from, what to reset
// when a preset is chosen, and which links it can read.
const PRESET_KEYS = ["stops", "lines"];
const DEFAULT_PRESET = 0;

function resetEditing() {
    selection = null;
    drawing = null;
}

function acceptsState(data) {
    return Array.isArray(data.stops) && Array.isArray(data.lines);
}

function presetState(index) {
    return {
        ...commonState(),
        showStops: state?.showStops ?? true,
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

// How far a stop or line holds its color, in units of the box's shorter side, at a spread of 0: MeshShader2's
// default point radius.
const STOP_RADIUS = 0.01;
// How far a point holds its color at a spread of 100%.
const FULL_SPREAD = 0.35;

const spreadRadius = stop => STOP_RADIUS + (FULL_SPREAD - STOP_RADIUS) * stop.spread / 100;

// The gradient as MeshShader2's renderer takes it: each stop on no line a point, held out to its spread, and each
// line's pieces one-sided segments, their colors blended from stop to stop.
function gradientData(model, influence = false) {
    // A stop's opacity scales its color's own alpha.
    // For the influence, the selected stop is 1 and the others 0, in srgb-linear.
    const colors = influence ? state.stops.map((_, i) => [...Array(3).fill(i === selection ? 1 : 0), 1]) : rendererColors(state.stops.map(stop => {
        const components = interpolationComponents(stop.color);
        components[3] *= stop.opacity / 100;
        return components;
    }));
    const points = [], segments = [], lines = [];
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
        space: influence ? spaceIndex("srgb-linear") : spaceIndex(state.space), resolution: (drag && drag.kind !== "section") || adjusting ? Math.min(state.resolution, 256) : state.resolution, model,
        isEmpty: !points.length && !segments.length, average, points, segments, lines, hasTwoSidedLines: false,
        isOpaque: colors.every(c => c[3] >= 1),
    };
}

__COMMON_PAGE__
// MARK: - About the models

const MODEL_ABOUT = {
    biharmonic: {
        note: "A stiff sheet (∆²u = 0) held at the stops. Each point holds its color across a disc out to its spread, each line along a thin band, and between them the sheet bends as little as it can. It's solved on a grid, coarse to fine, by MeshShader2's solver.",
        pros: ["Smooth everywhere, its slope too", "Close to the thin-plate spline freeform-gradient() draws, but it stops at the box's edges", "Single points are enough to hold it"],
        cons: ["Overshoots between and past the stops, most of all near the box's edges", "Needs a solver, so engines would only match approximately", "Solves again whenever a stop moves or the box changes size"],
        source: "Finch, Snyder and Hoppe, <a href=\"https://hhoppe.com/proj/freeform/\" target=\"_blank\" rel=\"noopener\">“Freeform Vector Graphics with Controlled Thin-Plate Splines”</a> (2011, <a href=\"https://doi.org/10.1145/2070781.2024200\" target=\"_blank\" rel=\"noopener\">DOI</a>). They hold the sheet at points and along curves in the same way.",
        spec: "A spec would define how big a point is and what its spread does, how wide a line is, what happens at the box's edges, and how accurate the solve has to be.",
    },
    harmonic: {
        note: "A stretched membrane (∆u = 0) held at the stops. It forms a tent at each point and a ridge along each line, and never goes past the stops' colors. It's solved on a grid, coarse to fine, by MeshShader2's solver.",
        pros: ["Never overshoots", "Each stop's influence stays between 0 and 1", "A line reads clearly as a ridge of color"],
        cons: ["Peaks at every point and creases along every line", "A point needs a size: without one, its color shrinks to a dot as the grid gets finer", "Can look flat between stops"],
        source: "Orzan et al., <a href=\"https://inria.hal.science/inria-00274768\" target=\"_blank\" rel=\"noopener\">“Diffusion Curves: A Vector Representation for Smooth-Shaded Images”</a> (2008, <a href=\"https://doi.org/10.1145/1399504.1360691\" target=\"_blank\" rel=\"noopener\">DOI</a>), which spreads colors out from curves the same way.",
        spec: "As for the biharmonic model, and a size for every stop, which it can't do without.",
    },
};

// MARK: - View notes

const VIEW_NOTES = {
    gradient: "The gradient each model draws from the same stops.",
    holds: "Every texel of the grid is worked out from the texels the stops hold, shown here in the colors they're held to, over the faded gradient. A point holds a disc out to its spread, at least 1% of the box's shorter side; a line holds a band 1% either side of it, its color running from stop to stop. Set Grid to 128 to see the texels.",
    gamut: "Hatching marks where the solved colors fall outside the chosen gamut, where they're clipped or gamut mapped to draw them. The harmonic model makes each texel the average of its neighbors, so it can't go past the colors it's held to. The biharmonic model keeps the slope smooth through each stop, so past a stop it keeps going, and overshoots, most of all near the box's edges. In oklab, a mix of two colors inside sRGB can also fall outside it, in either model.",
    isolines: "Lines of equal lightness, every 0.025 of Oklab L. The harmonic model is a membrane: its lines ring each point tightly and kink around it, since it's continuous there but not smooth. The biharmonic model is a stiff sheet: its lines bend smoothly through and around the stops, since its slope is continuous too.",
    influence: "Each model mixes the stops' colors in fixed proportions, so each point's color is a weighted sum of them. This shows the selected stop's weight: orange where it adds its color, white where it adds none, blue where it takes color away, and dark red above 1. The harmonic model's stays between 0 and 1. The biharmonic model's has negative patches and can go above 1, but it ends at the box's edges. A stop on a line shares its weight along the line with its neighbors.",
    difference: "White where the two models agree, purple where they differ, darkest at a difference of 0.15 in Oklab (ΔE OK) or more. Both boxes show the same difference.",
    level: "The solve runs on a pyramid of grids, each half the size of the one above it. The coarsest is solved outright, and each finer level starts from the one below, scaled up, so it only has to fix the detail. This shows one level's texels as they are, unfiltered, with the texels the stops hold marked. Level 0 is the finest, the one that's drawn.",
    relaxation: "The harmonic model's finest grid, started from the stops' average color and relaxed without the pyramid: each step moves every texel toward the average of its four neighbors. The colors creep out from the stops a texel or two a step, so a fine grid would take hundreds of thousands of steps to settle. That's why the solve starts coarse. The biharmonic box shows its gradient.",
};

// MARK: - Overlay

const ACCENT = "#0a84ff";

// Whether a stop has been dragged out of the box, and goes when it's let go.
const outside = ([x, y]) => x < -0.02 || x > 1.02 || y < -0.02 || y > 1.02;

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
        ctx.fillStyle = swatchColor(stop.color, stop.opacity / 100);
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

const MODE_NOTES = {
    points: "Points: click to add a stop, in the color around it, and drag stops to move them. Drag a stop out of the box to remove it. Drag the dashed circle around a selected stop to change its spread.",
    lines: "Lines: click to add stops along a line; it curves through them once it has three. Double-click or press Finish line to end it. Click a stop at the end of a line to carry on from it, the first stop to close the line, another line's end to join them, or a line to add a stop on it.",
};

function updateControls() {
    updateCommonControls();
    $("showStops").checked = state.showStops;
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
        button.firstChild.style.background = swatchColor(stop.color, stop.opacity / 100);
        button.title = `${stop.color}${stop.opacity < 100 ? `, ${stop.opacity}%` : ""}`;
        button.classList.toggle("selected", Number(button.dataset.stop) === selection);
    }
    for (const row of list.children)
        row.classList.toggle("drawing", row.dataset.line !== "" && Number(row.dataset.line) === drawing);
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
$("showStops").addEventListener("change", () => {
    state.showStops = $("showStops").checked;
    changed();
});

__COMMON_CONTROLS__

// MARK: - CSS

// A made-up freeform-gradient() with lines:
//
//   freeform-gradient( [ harmonic || in <space> ]? , [ <stop> | line( <stop># [ , close ]? ) ]# )
//   <stop> = <color> <position> [ spread <percentage> ]? [ opacity <percentage> ]?

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

function cssText() {
    const prelude = [state.models.length === 1 && state.models[0] === "harmonic" ? "harmonic" : "", `in ${state.space}`].filter(Boolean).join(" ");
    const points = state.stops.filter((_, i) => !linesThrough(i).length).map(stop => stopText(stop, true));
    const lines = state.lines.map(line => {
        const stops = line.stops.map(i => stopText(state.stops[i], false));
        return `line(${[...stops, ...(line.closed && line.stops.length > 2 ? ["close"] : [])].join(", ")})`;
    });
    return `background-image: freeform-gradient(${[prelude, ...points, ...lines].join(",\n    ")});`;
}

__COMMON_FRAGMENT__
