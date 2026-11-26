__COMMON_HEAD__

// MARK: - State

// Stops hold colors: on their own as points, or along lines. A stop's position is a fraction of the box, 0 to 1
// across and down; its spread is a percentage. A line is the stops it runs through, in order, by index,
// and a stop at a line's end may also end another, joining them. A line curves through its stops on its own, or, once
// it has `handles`, as they say: for each of its stops an `in` and an `out` Bézier handle, offsets from the stop in
// fractions of the box.
let state = null;

const stop = (x, y, color, spread = 0) => ({ p: [x, y], color, spread });

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
        name: "Scattered sunset",
        note: "Six points from dark blue through pink and orange to yellow, some near the box's edges, where the models differ most.",
        state: {
            width: 600, height: 400,
            stops: [
                stop(0.1, 0.08, "#1a1446"), stop(0.7, 0.12, "#5b2a86"), stop(0.3, 0.5, "#e0457b"),
                stop(0.8, 0.6, "#ff8a3d"), stop(0.45, 0.92, "#ffd166"), stop(0.95, 0.95, "#2e1760"),
            ],
            lines: [],
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
        note: "Points that fade out: alpha is blended along with the color, premultiplied, so a color fades without going gray or dark on its way to transparent.",
        state: {
            width: 600, height: 400,
            stops: [
                stop(0.15, 0.5, "#ff006e"), stop(0.5, 0.2, "#3a86ff"), stop(0.85, 0.5, "#ffbe0b"),
                stop(0.5, 0.8, "#3a86ff00"), stop(0.5, 0.5, "#ffffff00"),
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
    {
        name: "A line shaped by its handles",
        note: "A line of three stops, shaped by hand. Select a stop to see its handles and drag one to bend the line; hold Option to move a handle alone, or Option-drag a stop to pull new handles out of it. Reset handles lets the line curve through its stops on its own again.",
        state: {
            width: 600, height: 400,
            stops: [stop(0.12, 0.3, "#7209b7"), stop(0.5, 0.6, "#f72585"), stop(0.88, 0.3, "#ffb703"), stop(0.5, 0.12, "#023047"), stop(0.5, 0.92, "#8ecae6")],
            lines: [{ stops: [0, 1, 2], closed: false, handles: [
                { in: [0, 0], out: [0.02, 0.3] }, { in: [-0.16, 0.12], out: [0.16, -0.12] }, { in: [-0.02, 0.3], out: [0, 0] },
            ] }],
        },
    },
    {
        name: "Finch et al., Figure 5: a bright point in a dark rim",
        note: "After Figure 5 of the thin-plate spline paper, before any curve is added to it: a bright point in the middle of a dark rim. The biharmonic model, the paper's thin-plate spline, fades smoothly from one to the other; the harmonic model makes a tent at the point. The rim is a closed line whose handles make it a circle. In the paper the rim is also a tear, with white outside it; a line here is one color on both sides, so the box is dark outside too.",
        state: {
            width: 500, height: 500,
            stops: [stop(0.5, 0.14, "#262626"), stop(0.86, 0.5, "#262626"), stop(0.5, 0.86, "#262626"), stop(0.14, 0.5, "#262626"), stop(0.5, 0.5, "#f5f5f5")],
            lines: [{ stops: [0, 1, 2, 3], closed: true, handles: [
                { in: [-0.1988, 0], out: [0.1988, 0] }, { in: [0, -0.1988], out: [0, 0.1988] }, { in: [0.1988, 0], out: [-0.1988, 0] }, { in: [0, 0.1988], out: [0, -0.1988] },
            ] }],
        },
    },
    {
        name: "Finch et al., Figure 8: two points make a ramp",
        note: "After Figure 8 of the thin-plate spline paper, without its curve: two points alone give a straight ramp across the whole box, since a thin plate held at two points has nothing to bend it. This sets Edges to Natural and Points hold to One texel, as the paper has them, and they stay set when you choose another preset. With Mirrored edges or discs the ramp flattens toward the sides. The harmonic model only rings each point.",
        state: {
            width: 500, height: 500,
            stops: [stop(0.3, 0.5, "#4d4d4d"), stop(0.8, 0.5, "#f2f2f2")],
            lines: [],
            edges: "natural", stopSize: "texel",
        },
    },
];

const influenceAvailable = () => selection !== null && !!state.stops[selection];

// What the shared code needs from this editor: which state a preset sets, which preset to start from, what to reset
// when a preset is chosen, and which links it can read.
const PRESET_KEYS = ["stops", "lines"];
const TWO_SIDED_LINES = false;
const DEFAULT_PRESET = 1;

function resetEditing() {
    selection = null;
    drawing = null;
}

// After undo or redo: the line being drawn is over, and the selection stays if its stop is still there.
function restoredEditing() {
    drawing = null;
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

// Escape ends the line being drawn, or else selects nothing.
function cancelEditing() {
    if (drawing !== null)
        finishLine();
    else
        selection = null;
}

// A link's stops and lines, made sound: stops with a position and a color, and lines of two stops or more that are in
// range.
function acceptsState(data) {
    if (!Array.isArray(data.stops) || !Array.isArray(data.lines))
        return false;
    const finite = v => typeof v === "number" && Number.isFinite(v);
    const kept = data.stops.map(stop => !!stop && Array.isArray(stop.p) && finite(stop.p[0]) && finite(stop.p[1]) && typeof stop.color === "string");
    const index = [];
    let next = 0;
    kept.forEach((keep, i) => index[i] = keep ? next++ : -1);
    data.stops = data.stops.filter((_, i) => kept[i]).map(stop => ({
        p: stop.p.slice(0, 2), color: fadedColor(stop.color, finite(stop.opacity) ? clamp(stop.opacity, 0, 100) : 100),
        spread: finite(stop.spread) ? clamp(stop.spread, 0, 100) : 0,
    }));
    if (!STOP_SIZES.includes(data.stopSize))
        data.stopSize = "disc";
    data.lines = data.lines.filter(line => line && Array.isArray(line.stops)).map(line => {
        const stops = line.stops.filter(i => Number.isInteger(i) && index[i] >= 0).map(i => index[i]);
        const offset = v => Array.isArray(v) && v.length === 2 && v.every(finite);
        // Handles are kept only if there's a sound pair for every stop.
        const handles = Array.isArray(line.handles) && stops.length === line.stops.length && line.handles.length === stops.length
            && line.handles.every(handle => handle && offset(handle.in) && offset(handle.out))
            ? { handles: line.handles.map(handle => ({ in: handle.in.slice(), out: handle.out.slice() })) } : {};
        return { stops, closed: !!line.closed && stops.length > 2, ...handles };
    }).filter(line => line.stops.length > 1);
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

// MARK: - Stops and lines to the renderer

const boxScale = () => {
    const shorter = Math.min(state.width, state.height);
    return [state.width / shorter, state.height / shorter];
};

// The lines each stop is on.
// The lines each stop is on. A line being drawn isn't one until it has two stops, so its first stop is still a point.
function linesThrough(index) {
    return state.lines.filter(line => line.stops.length > 1 && line.stops.includes(index));
}

// Drops the lines left with fewer than two stops, but for the one being drawn.
function pruneLines() {
    const drawn = drawing !== null ? state.lines[drawing] : null;
    state.lines = state.lines.filter(line => line.stops.length > 1 || line === drawn);
    for (const line of state.lines) {
        if (line.stops.length < 3)
            line.closed = false;
    }
    drawing = drawn ? state.lines.indexOf(drawn) : null;
}

// The handles a line has on its own, for each of its stops. Two stops make a straight line; with more, it curves
// through them as a Catmull-Rom spline does.
function automaticHandles(line) {
    const points = line.stops.map(i => state.stops[i].p);
    const count = points.length;
    const at = i => line.closed && count > 2 ? points[(i + count) % count] : points[clamp(i, 0, count - 1)];
    return points.map((_, i) => {
        const out = count > 2 ? [(at(i + 1)[0] - at(i - 1)[0]) / 6, (at(i + 1)[1] - at(i - 1)[1]) / 6] : [0, 0];
        return { in: [-out[0], -out[1]], out };
    });
}

// A line's handles: its own, or the automatic ones.
const lineHandles = line => line.handles?.length === line.stops.length ? line.handles : automaticHandles(line);

// Gives a line handles of its own, as they are now, to be moved.
function ownHandles(line) {
    if (line.handles?.length !== line.stops.length)
        line.handles = automaticHandles(line);
    return line.handles;
}

// Whether the stop at `position` along a line has a stretch before it, for its `in` handle, or after it, for `out`.
function hasStretch(line, position, which) {
    const count = line.stops.length;
    if (count < 2)
        return false;
    return line.closed && count > 2 || (which === "in" ? position > 0 : position < count - 1);
}

// A line's stretches from stop to stop, as their four Bézier points and the stops at either end.
function lineStretches(line) {
    const points = line.stops.map(i => state.stops[i].p);
    const handles = lineHandles(line);
    const count = points.length;
    const stretchCount = line.closed && count > 2 ? count : count - 1;
    const result = [];
    for (let i = 0; i < stretchCount; ++i) {
        const next = (i + 1) % count;
        const p1 = points[i], p2 = points[next];
        result.push({
            bezier: [p1, [p1[0] + handles[i].out[0], p1[1] + handles[i].out[1]], [p2[0] + handles[next].in[0], p2[1] + handles[next].in[1]], p2],
            from: line.stops[i],
            to: line.stops[next],
            position: i,
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

// A point holds a disc, which also holds the surface flat there, or with a spread of 0 just the texel it's in, which
// holds its color and leaves its slope free.
const STOP_SIZES = ["disc", "texel"];
const spreadRadius = stop => {
    const least = state.stopSize === "texel" ? 0 : STOP_RADIUS;
    return least + (FULL_SPREAD - least) * stop.spread / 100;
};

// The gradient as MeshShader2's renderer takes it: each stop on no line a point, held out to its spread, and each
// line's pieces one-sided segments, their colors blended from stop to stop.
function gradientData(model, influence = false) {
    // For the influence, the selected stop is 1 and the others 0, in srgb-linear.
    const colors = influence ? state.stops.map((_, i) => [...Array(3).fill(i === selection ? 1 : 0), 1]) : rendererColors(state.stops.map(stop => interpolationComponents(stop.color)));
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
        space: influence ? spaceIndex("srgb-linear") : spaceIndex(state.space), resolution: solveResolution(), model,
        isEmpty: !points.length && !segments.length, average, points, segments, lines, hasTwoSidedLines: false,
        isOpaque: colors.every(c => c[3] >= 1),
    };
}

__COMMON_PAGE__
// MARK: - About the models

const MODEL_ABOUT = {
    biharmonic: {
        note: "A stiff sheet (∆²u = 0) held at the stops. Each point holds its color across a disc out to its spread, each line along a thin band, and between them the sheet bends as little as it can. It's solved on a grid, coarse to fine.",
        pros: ["Smooth everywhere, its slope too", "Close to the thin-plate spline freeform-gradient() draws, but it stops at the box's edges", "Single points are enough to hold it"],
        cons: ["Overshoots between and past the stops, most of all near the box's edges", "Needs a solver, so engines would only match approximately", "Solves again whenever a stop moves or the box changes size"],
        source: "Finch, Snyder and Hoppe, <a href=\"https://hhoppe.com/proj/freeform/\" target=\"_blank\" rel=\"noopener\">“Freeform Vector Graphics with Controlled Thin-Plate Splines”</a> (2011, <a href=\"https://doi.org/10.1145/2070781.2024200\" target=\"_blank\" rel=\"noopener\">DOI</a>). They hold the sheet at points and along curves in the same way.",
        spec: "A spec would define how big a point is and what its spread does, how wide a line is, what happens at the box's edges, and how accurate the solve has to be.",
    },
    harmonic: {
        note: "A stretched membrane (∆u = 0) held at the stops. It forms a tent at each point and a ridge along each line, and never goes past the stops' colors. It's solved on a grid, coarse to fine.",
        pros: ["Never overshoots", "Each stop's influence stays between 0 and 1", "A line reads clearly as a ridge of color"],
        cons: ["Peaks at every point and creases along every line", "A point needs a size: without one, its color shrinks to a dot as the grid gets finer", "Can look flat between stops"],
        source: "Orzan et al., <a href=\"https://inria.hal.science/inria-00274768\" target=\"_blank\" rel=\"noopener\">“Diffusion Curves: A Vector Representation for Smooth-Shaded Images”</a> (2008, <a href=\"https://doi.org/10.1145/1399504.1360691\" target=\"_blank\" rel=\"noopener\">DOI</a>), which spreads colors out from curves the same way.",
        spec: "As for the biharmonic model, and a size for every stop, which it can't do without.",
    },
};

// MARK: - View notes

const VIEW_NOTES = {
    gradient: "The gradient each model draws from the same stops.",
    holds: "Every texel of the grid is worked out from the texels the stops hold, shown here in the colors they're held to, over the faded gradient. A point holds a disc out to its spread, at least 1% of the box's shorter side, or with One texel and no spread, the one texel it's in; a line holds a band 1% either side of it, its color running from stop to stop. Set Grid to 128 to see the texels.",
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

    for (const { at, from } of selected ? stopHandles(selection) : []) {
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(...toPixels(from));
        ctx.lineTo(...toPixels(at));
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(...toPixels(at), 4, 0, 2 * Math.PI);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.stroke();
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
        ctx.fillStyle = swatchColor(stop.color);
        ctx.fill();
        ctx.globalAlpha = 1;
    });
}

// MARK: - Editing

// Whether clicks add stops on their own or along lines.
let mode = "select";
// The selected stop, by index.
let selection = null;
// The line being drawn, by index, which clicks in Lines add stops to the end of.
let drawing = null;
let drag = null;

const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];

// A stop's handles on the lines through it, the ones that bend a stretch and aren't on the stop itself: each with
// its line and the stop's position along it, where it is, and the stop it's from.
function stopHandles(index) {
    const result = [];
    state.lines.forEach((line, l) => {
        const position = line.stops.length > 1 ? line.stops.indexOf(index) : -1;
        if (position < 0)
            return;
        const handle = lineHandles(line)[position];
        const from = state.stops[index].p;
        for (const which of ["in", "out"]) {
            if (hasStretch(line, position, which) && (handle[which][0] || handle[which][1]))
                result.push({ line: l, position, which, from, at: [from[0] + handle[which][0], from[1] + handle[which][1]] });
        }
    });
    return result;
}

// Moves a stop's handle on a line to an offset from the stop. The stop's other handle stays opposite it, at its own
// length, unless `alone`.
function moveHandle(line, position, which, offset, alone) {
    const handle = ownHandles(line)[position];
    handle[which] = offset;
    if (alone)
        return;
    const other = which === "in" ? "out" : "in";
    const [sx, sy] = boxScale();
    const length = Math.hypot(offset[0] * sx, offset[1] * sy) || 1;
    const otherLength = Math.hypot(handle[other][0] * sx, handle[other][1] * sy);
    handle[other] = [-offset[0] / length * otherLength, -offset[1] / length * otherLength];
}

// Pulls both of a stop's handles out of it on every line through it, `offset` one way and its opposite the other.
function pullHandles(index, offset) {
    for (const line of linesThrough(index)) {
        const handle = ownHandles(line)[line.stops.indexOf(index)];
        handle.out = offset.slice();
        handle.in = [-offset[0], -offset[1]];
    }
}

// What's under a point in CSS pixels of `view`'s box: an end of the cross-section, one of the selected stop's
// handles, a stop, the selected point's spread circle, or a line, in that order.
function hitTest(view, point) {
    const size = [view.overlay.clientWidth, view.overlay.clientHeight];
    const toPixels = ([x, y]) => [x * size[0], y * size[1]];
    const distance = at => Math.hypot(at[0] - point[0], at[1] - point[1]);
    // A row lies under everything else, so it's tried last.
    const end = state.sectionKind === "line" ? sectionHit(point, toPixels) : null;
    if (end)
        return end;
    for (const handle of selection !== null && state.stops[selection] ? stopHandles(selection) : []) {
        if (distance(toPixels(handle.at)) <= 7)
            return { kind: "handle", line: handle.line, position: handle.position, which: handle.which };
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
    return sectionHit(point, toPixels);
}

// The color a new stop takes: the stops' colors around it, weighted by the inverse square of how far each is.
function colorAt(p) {
    if (!state.stops.length)
        return "#7f7f7f";
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
    state.stops.push({ p, color: colorAt(p), spread: 0 });
    return state.stops.length - 1;
}

// Removes a stop, and any line left with fewer than two; their last stop becomes a point.
function deleteStop(index) {
    state.stops.splice(index, 1);
    const drawn = drawing !== null ? state.lines[drawing] : null;
    for (const line of state.lines) {
        const kept = line.stops.map((_, position) => position).filter(position => line.stops[position] !== index);
        if (line.handles?.length === line.stops.length)
            line.handles = kept.map(position => line.handles[position]);
        else
            delete line.handles;
        line.stops = kept.map(position => line.stops[position]).map(i => i > index ? i - 1 : i);
    }
    state.lines = state.lines.filter(line => line.stops.length > 1 || line === drawn && line.stops.length);
    for (const line of state.lines) {
        if (line.stops.length < 3)
            line.closed = false;
    }
    drawing = drawn && state.lines.includes(drawn) ? state.lines.indexOf(drawn) : null;
    selection = null;
}

// Adds a stop to the end of a line. If the line has handles of its own, the stop gets the ones it would have had.
function appendStop(line, index) {
    line.stops.push(index);
    if (line.handles)
        line.handles.push(automaticHandles(line).at(-1));
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
            // Backwards, each stop's handles change places.
            line.handles = line.handles?.reverse().map(handle => ({ in: handle.out, out: handle.in }));
            if (!line.handles)
                delete line.handles;
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
        } else if (hit?.kind === "handle") {
            drag = { kind: "handle", line: hit.line, position: hit.position, which: hit.which };
        } else if (hit?.kind === "stop" && event.altKey && linesThrough(hit.index).length) {
            // Option-dragging a stop on a line pulls its handles out of it.
            selection = hit.index;
            drag = { kind: "pull", index: hit.index, start: at };
        } else if (hit?.kind === "stop") {
            if (mode === "lines") {
                const line = drawing !== null ? state.lines[drawing] : null;
                if (line && hit.index !== line.stops.at(-1)) {
                    // Clicking the line's first stop closes it; any other stop joins the line to it.
                    if (hit.index === line.stops[0] && line.stops.length > 2) {
                        line.closed = true;
                        drawing = null;
                    } else if (!line.stops.includes(hit.index)) {
                        appendStop(line, hit.index);
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
            state.stops.push({ p, color, spread: 0 });
            const index = state.stops.length - 1;
            const position = hit.stretch.position + 1;
            line.stops.splice(position, 0, index);
            if (line.handles) {
                // The stretch is split where the stop goes, so a line with handles of its own keeps its shape.
                const [p0, p1, p2, p3] = hit.stretch.bezier;
                const mix = (a, b) => [a[0] + (b[0] - a[0]) * hit.t, a[1] + (b[1] - a[1]) * hit.t];
                const a = mix(p0, p1), b = mix(p1, p2), c = mix(p2, p3), d = mix(a, b), e = mix(b, c);
                const next = position % line.handles.length;
                line.handles[position - 1].out = subtract(a, p0);
                line.handles[next].in = subtract(c, p3);
                line.handles.splice(position, 0, { in: subtract(d, p), out: subtract(e, p) });
            }
            selection = index;
            drag = { kind: "stop", index, start: at, origin: p.slice(), moved: false };
        } else if (mode === "lines") {
            const index = addStop(at);
            if (drawing === null) {
                state.lines.push({ stops: [index], closed: false });
                drawing = state.lines.length - 1;
            } else {
                appendStop(state.lines[drawing], index);
            }
            selection = index;
            // Dragging on from a new stop pulls its handles out, as a pen does.
            drag = { kind: "pen", index, line: drawing, start: at };
        } else if (mode === "select") {
            selection = null;
        } else {
            selection = addStop(at);
            drag = { kind: "stop", index: selection, start: at, origin: at.slice(), moved: false };
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
            overlay.style.cursor = !hit ? "crosshair" : hit.kind === "section" ? (hit.end === "row" ? "ns-resize" : "move") : hit.kind === "spread" ? "ew-resize" : hit.kind === "stop" || hit.kind === "handle" ? "grab" : mode === "select" ? "default" : mode === "lines" ? "copy" : "crosshair";
            return;
        }
        if (drag.kind === "section") {
            dragSection(drag.end, at);
            changed();
            return;
        }
        if (drag.kind === "handle") {
            const line = state.lines[drag.line];
            const stop = line && state.stops[line.stops[drag.position]];
            if (stop)
                moveHandle(line, drag.position, drag.which, subtract(at, stop.p), event.altKey);
            changed();
            return;
        }
        const stop = state.stops[drag.index];
        if (!stop)
            return;
        if (drag.kind === "pull" || drag.kind === "pen") {
            const delta = subtract(at, drag.start);
            // Under a few pixels it's still a click.
            if (Math.hypot(delta[0] * overlay.clientWidth, delta[1] * overlay.clientHeight) >= 3) {
                if (drag.kind === "pull") {
                    pullHandles(drag.index, delta);
                } else if (state.lines[drag.line]) {
                    const line = state.lines[drag.line];
                    const handle = ownHandles(line)[line.stops.indexOf(drag.index)];
                    handle.out = delta;
                    handle.in = [-delta[0], -delta[1]];
                }
            }
        } else if (drag.kind === "spread") {
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

// Two colors mixed as the line between them mixes them: in the interpolation space, with straight components, a hue
// the shorter way around, and alpha mixed too. The mix is written in that space's own CSS syntax.
function colorMix(a, b, t) {
    const [ca, cb] = [a, b].map(interpolationComponents);
    const hue = HUE_INDEX[state.space];
    if (hue !== undefined)
        cb[hue] = ca[hue] + (((cb[hue] - ca[hue]) % 360 + 540) % 360 - 180);
    const mixed = ca.map((v, k) => v + (cb[k] - v) * t);
    if (hue !== undefined)
        mixed[hue] = ((mixed[hue] % 360) + 360) % 360;
    return cssColorIn(state.space, mixed.slice(0, 3), mixed[3]);
}

// Components in a space, as a CSS color in that space's syntax.
function cssColorIn(space, c, alpha) {
    const n = v => String(Math.round(v * 10000) / 10000);
    const tail = alpha < 1 ? ` / ${n(clamp(alpha, 0, 1))}` : "";
    switch (space) {
    case "lab": case "oklab": case "lch": case "oklch":
        return `${space}(${c.map(n).join(" ")}${tail})`;
    case "hsl": case "hwb":
        return `${space}(${n(c[0])} ${n(c[1])}% ${n(c[2])}%${tail})`;
    default:
        return `color(${space} ${c.map(n).join(" ")}${tail})`;
    }
}

// MARK: - Controls

const MODE_NOTES = {
    select: "Select: click a stop to select it, and drag stops and handles to move them. Clicking anything else selects nothing, and adds no stop. The arrow keys nudge the selected stop, Delete removes it, and Escape selects nothing.",
    points: "Points: click to add a stop, in the color around it, and drag stops to move them. The arrow keys nudge the selected stop, Delete removes it, and Escape selects nothing. Drag a stop out of the box to remove it. Drag the dashed circle around a selected stop to change its spread.",
    lines: "Lines: click to add stops along a line; it curves through them once it has three. Drag as you add a stop to pull out its handles and shape the curve yourself, as a pen does. Double-click, or press Finish line beside the line's stops, to end it. Click a stop at the end of a line to carry on from it, the first stop to close the line, another line's end to join them, or a line to add a stop on it. A selected stop on a line shows its handles: drag one to bend the line, with Option to move it alone, or Option-drag the stop to pull new ones out.",
};

function updateControls() {
    updateCommonControls();
    $("showStops").checked = state.showStops;
    $("stopSize").value = state.stopSize;
    for (const button of document.querySelectorAll("#toolbar button[data-mode]"))
        button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    $("modeNote").textContent = MODE_NOTES[mode];
    updateStopList();

    const selected = selection !== null ? state.stops[selection] : null;
    const lines = selected ? linesThrough(selection).map(line => state.lines.indexOf(line) + 1) : [];
    const onLine = lines.length > 0;
    $("stopFields").disabled = !selected;
    $("deleteStop").disabled = !selected;
    $("finishLine").hidden = drawing === null;
    $("clearStops").disabled = !state.stops.length;
    $("resetHandles").disabled = !(selected && linesThrough(selection).some(line => line.handles));
    $("removeLine").disabled = !onLine;
    $("stopHeading").classList.toggle("none", !selected);
    $("stopTitle").textContent = selected ? `Stop ${selection + 1}` : state.stops.length ? "No stop selected" : "No stops";
    $("stopKind").textContent = !selected ? "" : onLine ? `on line${lines.length > 1 ? "s" : ""} ${lines.join(" and ")}` : "a point";
    if (!selected) {
        for (const id of ["stopText", "stopX", "stopY"])
            $(id).value = "";
        $("spreadValue").textContent = "";
        return;
    }
    if (document.activeElement !== $("stopText"))
        $("stopText").value = selected.color;
    $("stopPicker").value = hexColor(selected.color);
    for (const [id, axis] of [["stopX", 0], ["stopY", 1]]) {
        if (document.activeElement !== $(id))
            $(id).value = Math.round(selected.p[axis] * 1000) / 10;
    }
    $("spread").disabled = onLine;
    $("spread").value = onLine ? 0 : selected.spread;
    $("spreadValue").textContent = onLine ? "none" : selected.spread + "%";
}

// The points, then each line as its stops in order, joined; each stop a chip that selects it.
let stopListKey = null;
function updateStopList() {
    const list = $("stopList");
    const points = state.stops.map((_, i) => i).filter(i => !linesThrough(i).length);
    const lines = state.lines.map((line, l) => ({ stops: line.stops, closed: line.closed && line.stops.length > 2, line: l })).filter(group => group.stops.length > 1 || group.line === drawing);
    const key = JSON.stringify([points, lines]);
    const chip = index => {
        const button = document.createElement("button");
        button.className = "chip";
        button.dataset.stop = index;
        button.append(document.createElement("span"));
        button.addEventListener("click", () => {
            selection = index;
            changed();
        });
        return button;
    };
    if (key !== stopListKey) {
        stopListKey = key;
        list.replaceChildren(...points.map(chip), ...lines.map(group => {
            const pill = document.createElement("div");
            pill.className = "lineChips";
            pill.dataset.line = group.line;
            pill.title = `Line ${group.line + 1}`;
            group.stops.forEach((index, k) => {
                if (k)
                    pill.append(Object.assign(document.createElement("span"), { className: "bar" }));
                pill.append(chip(index));
            });
            if (group.closed)
                pill.append(Object.assign(document.createElement("span"), { className: "joint", textContent: "↺", title: "Closed: the line runs back to its first stop" }));
            return pill;
        }));
    }
    for (const button of list.querySelectorAll("button[data-stop]")) {
        const index = Number(button.dataset.stop);
        const stop = state.stops[index];
        button.firstChild.style.background = swatchColor(stop.color);
        button.title = `Stop ${index + 1}: ${stop.color}`;
        button.classList.toggle("selected", index === selection);
    }
    for (const pill of list.querySelectorAll(".lineChips"))
        pill.classList.toggle("drawing", Number(pill.dataset.line) === drawing);
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
            state.stops[selection].p[axis] = clamp(value, 0, 100) / 100;
        changed();
    });
}
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
$("finishLine").addEventListener("click", finishLine);
// The selected stop's lines go, and their stops, but not one that joins them to another line.
$("removeLine").addEventListener("click", () => {
    for (const line of selection !== null ? linesThrough(selection) : [])
        removeLine(line);
    changed();
});
function removeLine(line) {
    const drawn = drawing !== null ? state.lines[drawing] : null;
    state.lines.splice(state.lines.indexOf(line), 1);
    drawing = drawn && drawn !== line ? state.lines.indexOf(drawn) : null;
    for (const index of line.stops.filter(i => !state.lines.some(other => other.stops.includes(i))).sort((a, b) => b - a))
        deleteStop(index);
    pruneLines();
}
// A new line of two stops goes across the middle of the box, or below the selected stop, in the colors there.
$("addLine").addEventListener("click", () => {
    finishLine();
    const near = selection !== null ? state.stops[selection].p : null;
    const y = near ? clamp(near[1] + 0.1, 0.05, 0.95) : 0.5;
    const x = near ? clamp(near[0], 0.2, 0.8) : 0.5;
    const first = addStop([x - 0.15, y]), second = addStop([x + 0.15, y]);
    state.lines.push({ stops: [first, second], closed: false });
    selection = second;
    changed();
});
// The lines through the selected stop go back to curving through their stops on their own.
$("resetHandles").addEventListener("click", () => {
    for (const line of selection !== null ? linesThrough(selection) : [])
        delete line.handles;
    changed();
});
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
//   freeform-gradient( [ harmonic || in <space> ]? , [ <stop> | line( <line-stop># [ , close ]? ) ]# )
//   <stop> = <color> <position> [ spread <percentage> ]?
//   <line-stop> = <color> <position> [ handles <percentage>{4} ]?
//
// A line's stops have handles if the line has its own: the in handle's offset, then the out handle's.

const number = v => String(Math.round(v * 100) / 100 || 0);
const percent = v => `${number(v * 100)}%`;

function stopText(stop, withSpread, handle = null) {
    const parts = [stop.color.trim(), percent(stop.p[0]), percent(stop.p[1])];
    if (withSpread && stop.spread)
        parts.push(`spread ${stop.spread}%`);
    if (handle)
        parts.push(`handles ${[...handle.in, ...handle.out].map(percent).join(" ")}`);
    return parts.join(" ");
}

function cssText() {
    const prelude = [state.models.length === 1 && state.models[0] === "harmonic" ? "harmonic" : "", `in ${state.space}`].filter(Boolean).join(" ");
    const points = state.stops.filter((_, i) => !linesThrough(i).length).map(stop => stopText(stop, true));
    const lines = state.lines.filter(line => line.stops.length > 1).map(line => {
        const stops = line.stops.map((i, position) => stopText(state.stops[i], false, line.handles?.[position]));
        return `line(${[...stops, ...(line.closed && line.stops.length > 2 ? ["close"] : [])].join(", ")})`;
    });
    return `background-image: freeform-gradient(${[prelude, ...points, ...lines].join(",\n    ")});`;
}

__COMMON_FRAGMENT__
