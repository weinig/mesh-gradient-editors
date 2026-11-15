"use strict";

__MARGINS__

__COLORS__

const normalizeHue = h => ((h % 360) + 360) % 360;

// MARK: - State

// Positions are percentages of the box, rounded to hundredths, so they round-trip exactly.
// stop = { color: CSS text, pos: [x, y], weight: number | null, spread: 0 to 1 }
// The spread isn't in CSS: it sizes the stop's disc in the grid models.
let state = null;
let selected = 0;

const round2 = v => {
    const r = Math.round(v * 100) / 100;
    return r === 0 ? 0 : r;
};
const round2Point = p => [round2(p[0]), round2(p[1])];

function makeStop(color, x, y, weight = null, spread = null) {
    return { color, pos: [x, y], weight, spread };
}

// MARK: - CSS generation

const formatPercent = v => {
    v = round2(v);
    return v === 0 ? "0" : `${v}%`;
};

// How WebCore stores a color, which decides the default interpolation method: 8-bit sRGB means sRGB, anything else
// OKLab. (consumeFreeformGradient() in CSSPropertyParserConsumer+Image.cpp)
function colorPrecision(text) {
    const color = parseColor(text);
    if (!color || color.resolvedByBrowser)
        return "unknown";
    return color.eightBit ? "8bit" : "float";
}

function preludeText() {
    const precisions = state.stops.map(stop => colorPrecision(stop.color));
    if (!precisions.includes("unknown")) {
        const defaultSpace = precisions.includes("float") ? "oklab" : "srgb";
        if (state.space === defaultSpace)
            return "";
    }
    return `in ${state.space}`;
}

// freeform-gradient( <color-interpolation-method>? , <freeform-color-stop># )
// <freeform-color-stop> = <color> <position> [ / <number> ]?
function cssText() {
    const stops = state.stops.map(stop => {
        const weight = stop.weight === null ? "" : ` / ${stop.weight}`;
        return `${stop.color.trim()} ${formatPercent(stop.pos[0])} ${formatPercent(stop.pos[1])}${weight}`;
    });
    const prelude = preludeText();
    return `freeform-gradient(${prelude ? prelude + ", " : ""}${stops.join(", ")})`;
}

// What the box shows. Only "gradient" is what WebKit draws; the others draw parts of the spline.
const VIEWS = ["gradient", "influence", "difference", "grid", "plane", "term", "basis"];

const MODEL_NOTES = {
    spline: "Picture a stiff sheet laid over thin pegs on an endless plane. It passes exactly through every stop, and beyond them it keeps going in a straight line.",
    biharmonic: "The same kind of stiff sheet as the thin-plate spline (∆²u = 0), but cut to the size of the box. Each stop holds it at the texel the stop is in, or across a flat disc when Stop size is A disc. It's solved on a grid and then smoothed up to full size.",
    harmonic: "A stretched rubber membrane (∆u = 0), held at the stops the same way. It forms a tent with a crease at each stop, and it never goes past the stops' colors. It's solved on a grid and then smoothed up to full size.",
};
// What a spec would need to define for each model, for engines to agree.
const MODEL_SPECS = {
    spline: "A spec would define the formula, how positions are normalized, and what happens when stops share a position or sit on a line. Nothing depends on resolution, so engines can match each other apart from rounding.",
    biharmonic: "On top of that, a spec would define what happens at the box's edges, how big each stop is, and how accurate the solve has to be. Each engine would solve on its own grid, so they'd only match to within that accuracy.",
    harmonic: "A spec would need the same things as for the biharmonic grid, and it couldn't leave out the stop size. A membrane can't be held up by single points, so as stops shrink, the colors drift toward one flat average.",
};

// Where each model comes from, with links to the papers.
const MODEL_SOURCES = {
    spline: "Duchon's <a href=\"https://doi.org/10.1007/BFb0086566\" target=\"_blank\" rel=\"noopener\">thin-plate splines</a> (1977), brought to graphics by Bookstein in <a href=\"https://doi.org/10.1109/34.24792\" target=\"_blank\" rel=\"noopener\">“Principal Warps”</a> (1989). It's a closed-form formula over the whole plane.",
    biharmonic: "Finch, Snyder and Hoppe, <a href=\"https://hhoppe.com/proj/freeform/\" target=\"_blank\" rel=\"noopener\">“Freeform Vector Graphics with Controlled Thin-Plate Splines”</a> (2011, <a href=\"https://doi.org/10.1145/2070781.2024200\" target=\"_blank\" rel=\"noopener\">DOI</a>). They minimize the same thin-plate energy on a pixel grid, as this does. They hold each stop at a single point. Their grid grows past the view until it holds every stop, and its edge is left free.",
    harmonic: "Orzan et al., <a href=\"https://inria.hal.science/inria-00274768\" target=\"_blank\" rel=\"noopener\">“Diffusion Curves: A Vector Representation for Smooth-Shaded Images”</a> (2008, <a href=\"https://doi.org/10.1145/1399504.1360691\" target=\"_blank\" rel=\"noopener\">DOI</a>). There, colors spread out from curves by solving a Poisson equation. Away from the curves that's Laplace's equation, which is what this solves.",
};
const EDGE_NOTES = {
    mirrored: "The grid is exactly the box. The surface meets each side flat, as if a mirror stood there.",
    open: "The grid reaches half the box's size past each side, so its edges are far from the stops. Its texels are bigger as a result.",
    free: "This follows Finch et al. The grid grows until it holds every stop, plus a quarter of the box on each side, and nothing holds its edges. The biharmonic grid uses the full thin-plate energy, so it comes close to the thin-plate spline. For the harmonic grid this is the same as Mirrored.",
};
// What a stop's spread sets when each stop is one texel.
const SPREAD_MEANING_NOTES = {
    none: "Spread does nothing here. Each stop fixes its texel.",
    strength: "How firmly each stop holds. A spring pulls the stop's texel toward its color instead of fixing it. A spread of 1 fixes it outright. Less lets the surface pull away, so the color doesn't reach as far. This mostly matters for the harmonic grid. A stop without its own spread uses 0.5.",
    share: "Its share of the color. Each stop's influence is weighted by its spread, then scaled so they all add up to 1. A stop with more spread claims more of the space around it, and the place where two stops meet moves toward the one with less. A stop without its own spread uses 0.5.",
};

const HOLD_NOTES = {
    discs: "Every texel inside a stop's disc takes its color. The disc's radius is the stop's spread, or the default spread, times half the box's shorter side.",
    points: "Each stop fixes only the texel it's in, as Finch et al. do. Change Grid to see which model needs a stop size. The biharmonic grid barely changes, and the harmonic grid fades toward one color as the texels get smaller.",
};
// What's good and bad about each model, in short phrases.
const MODEL_PROS = {
    spline: ["Exact, so every engine can match", "The smoothest possible blend", "Nothing to tune", "Cheap to draw, and WebKit already has it", "Stops can go anywhere, even outside the box"],
    biharmonic: ["As smooth as the spline", "Overshoots much less", "Works with single-point stops", "Drawing cost doesn't grow with the number of stops", "Leaves room for curves and other controls later"],
    harmonic: ["Never overshoots", "Each stop's influence stays between 0 and 1", "Simple, with fast solvers that suit the GPU"],
};
const MODEL_CONS = {
    spline: ["Overshoots, often far", "Runs away in straight lines past the stops", "Every stop affects the whole box", "Needs special cases for one stop, stops on a line, and stops in the same place", "Cost grows with the number of stops"],
    biharmonic: ["Needs a solver, so engines only match approximately", "What happens at the edges changes the result", "Still overshoots somewhat", "Solves again whenever stops move or the box changes size"],
    harmonic: ["Makes a tent at each stop", "Needs a stop size that CSS doesn't have", "Depends on the grid, the solver and the edges", "Can look flat between stops"],
};

// What sets each model apart, in a line.
const MODEL_SUMMARIES = {
    spline: "Exact and smooth, but it overshoots between the stops and keeps going past them.",
    biharmonic: "As smooth as the spline, but it stops at the box's edges, so it overshoots less. It needs a solver.",
    harmonic: "Never overshoots, but it makes a tent at each stop and depends on the stops' size.",
};

// MARK: - URL fragment

function encodeState() {
    const data = {
        v: 1,
        w: state.width,
        h: state.height,
        s: state.space,
        o: state.overlay ? 1 : 0,
        k: state.backdrop,
        vw: state.view,
        n: state.normalization ? 1 : 0,
        x: state.crossSection ? 1 : 0,
        r: state.row,
        m: state.sample ? 1 : 0,
        d: state.sheet ? 1 : 0,
        dc: state.sheetComponent,
        md: state.model,
        ed: state.edges,
        ho: state.hold,
        sm: state.spreadMeaning,
        rf: state.reference,
        oc: state.otherCurves ? 1 : 0,
        gr: state.gridResolution,
        ds: state.defaultSpread,
        ms: state.models,
        nb: state.numbers ? 1 : 0,
        ab: state.about ? 1 : 0,
        cl: state.clipping ? 1 : 0,
        gm: state.gamut,
        gmap: state.gamutMapping,
        sp: state.stops.some(stop => stop.spread !== null) ? state.stops.map(stop => stop.spread) : undefined,
        p: state.stops.map(stop => stop.weight === null ? [stop.color, ...stop.pos] : [stop.color, ...stop.pos, stop.weight]),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    let binary = "";
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeState(text) {
    try {
        const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
        const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, ch => ch.charCodeAt(0))));
        const number = v => typeof v === "number" && Number.isFinite(v) ? v : null;
        if (data.v !== 1 || !Array.isArray(data.p) || !data.p.length || data.p.length > 64)
            return null;
        const spreads = Array.isArray(data.sp) ? data.sp : [];
        // Links from before Default spread had a disc radius, pr, in percent of the box's shorter side, that every stop's
        // spread was added to. A spread is a fraction of half that side, so the radius is twice as much in spread.
        const discRadius = data.ds === undefined ? number(data.pr) : null;
        const defaultSpread = discRadius !== null ? clamp(2 * discRadius / 100, 0, 1) : clamp(number(data.ds) ?? 0.02, 0, 1);
        const spreadOfEntry = i => {
            const spread = number(spreads[i]);
            if (discRadius !== null)
                return spread ? clamp(defaultSpread + spread, 0, 1) : null;
            return spread === null ? null : clamp(spread, 0, 1);
        };
        const stops = data.p.map((entry, i) => makeStop(String(entry[0] ?? "black"), number(entry[1]) ?? 50, number(entry[2]) ?? 50, number(entry[3]), spreadOfEntry(i)));
        return {
            width: clamp(number(data.w) ?? 600, 100, 2000),
            height: clamp(number(data.h) ?? 400, 100, 2000),
            space: SPACES.includes(data.s) ? data.s : "oklab",
            overlay: data.o !== 0,
            backdrop: BACKDROPS.includes(data.k) ? data.k : "checkerboard",
            numbers: data.nb === 1,
            about: data.ab === 1,
            clipping: data.cl === 1,
            gamut: ["srgb", "display-p3", "rec2020"].includes(data.gm) ? data.gm : "display-p3",
            gamutMapping: data.gmap === "clip" ? "clip" : "map",
            view: VIEWS.includes(data.vw) ? data.vw : "gradient",
            normalization: data.n === 1,
            crossSection: data.x === 1,
            row: clamp(Math.round(number(data.r) ?? 50), 0, 100),
            sample: data.m === 1,
            sheet: data.d === 1,
            sheetComponent: clamp(Math.round(number(data.dc) ?? 0), 0, 4),
            ...modelsFrom(data),
            edges: ["open", "free"].includes(data.ed) ? data.ed : "mirrored",
            // Links from before the choice existed had discs.
            hold: data.ho === "points" ? "points" : "discs",
            spreadMeaning: ["strength", "share"].includes(data.sm) ? data.sm : "none",
            reference: MODELS.includes(data.rf) ? data.rf : "spline",
            otherCurves: data.oc === 1,
            gridResolution: GRID_RESOLUTIONS.includes(data.gr) ? data.gr : 64,
            defaultSpread,
            stops,
        };
    } catch {
        return null;
    }
}

// WebKit throws after 100 replaceState() calls in 10 seconds, so writes are throttled.
let lastWrittenHash = "";
let hashTimer = null;
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

// MARK: - Presets

const PRESETS = [
    {
        name: "Four corners",
        note: "A stop in each corner. The thin-plate spline and the biharmonic grid nearly agree here. The harmonic grid sags toward the average color between the corners. Compare this with the presets below.",
        state: {
            width: 600, height: 400, space: "srgb",
            stops: [makeStop("#ff375f", 0, 0), makeStop("#ffd60a", 100, 0), makeStop("#0a84ff", 0, 100), makeStop("#30d158", 100, 100)],
        },
    },
    {
        name: "Three stops",
        note: "With three stops, the thin-plate spline is a plane plus three terms. Turn on the influence view to see how far each stop reaches in each model.",
        state: {
            width: 600, height: 400, space: "oklab",
            stops: [makeStop("#ff3b30", 20, 30), makeStop("#007aff", 75, 25), makeStop("#34c759", 50, 80)],
        },
    },
    {
        name: "Scattered sunset",
        note: "Six stops spread around the box, like a typical gradient. The thin-plate spline overshoots a little between them and clips. The grids do less of both.",
        state: {
            width: 600, height: 400, space: "oklab",
            stops: [
                makeStop("#1a1446", 10, 8), makeStop("#5b2a86", 70, 12), makeStop("#e0457b", 30, 50),
                makeStop("#ff8a3d", 80, 60), makeStop("#ffd166", 45, 92), makeStop("#2e1760", 95, 95),
            ],
        },
    },
    {
        name: "Overshoot",
        note: "Black and white, close together. The thin-plate spline overshoots far past both and clips most of the box. The biharmonic grid does less of that, and the harmonic grid can't do it at all.",
        state: {
            width: 600, height: 400, space: "oklab",
            stops: [makeStop("black", 44, 50), makeStop("white", 56, 50), makeStop("#808080", 10, 20), makeStop("#808080", 90, 80)],
        },
    },
    {
        name: "Hues around a circle (oklch)",
        note: "Six hues in a ring, mixed in oklch. Each hue is moved by whole turns to within half a turn of the average hue. Where a model overshoots, the hue keeps turning.",
        state: {
            width: 400, height: 400, space: "oklch",
            stops: [0, 60, 120, 180, 240, 300].map((hue, i) => {
                const angle = (i / 6) * 2 * Math.PI - Math.PI / 2;
                return makeStop(`oklch(0.75 0.15 ${hue})`, round2(50 + 35 * Math.cos(angle)), round2(50 + 35 * Math.sin(angle)));
            }),
        },
    },
    {
        name: "Translucent",
        note: "Stops with different alphas. Colors are premultiplied, so a nearly transparent stop adds little color. Alpha below 0 or above 1 is clipped.",
        state: {
            width: 600, height: 400, space: "oklab",
            stops: [makeStop("rgb(255 59 48 / 0.9)", 15, 20), makeStop("rgb(0 122 255 / 0.1)", 85, 25), makeStop("rgb(52 199 89 / 0.8)", 50, 85)],
        },
    },
    {
        name: "Missing components",
        note: "Stops with missing (none) components. For now these are treated as 0.",
        state: {
            width: 600, height: 400, space: "srgb",
            stops: [makeStop("rgb(none 255 0)", 15, 20), makeStop("rgb(255 0 none)", 85, 20), makeStop("rgb(0 none 255)", 50, 85)],
        },
    },
    {
        name: "Stops on a line",
        note: "Stops on a line. The thin-plate spline's linear part only changes along that line, so the colors stay the same across it, all the way to the edges.",
        state: {
            width: 600, height: 400, space: "oklab",
            stops: [makeStop("#ff375f", 15, 30), makeStop("#ffd60a", 50, 50), makeStop("#0a84ff", 85, 70)],
        },
    },
    {
        name: "Stops in one corner",
        note: "All the stops are in one corner. Past them, the thin-plate spline keeps going in straight lines and is far out of gamut by the opposite corner. The grids level off at the box's edges, and the harmonic grid drifts toward the stops' average.",
        state: {
            width: 600, height: 400, space: "oklab",
            stops: [makeStop("#ff3b30", 8, 10), makeStop("#0a84ff", 30, 14), makeStop("#ffd60a", 12, 34), makeStop("#30d158", 32, 36)],
        },
    },
    {
        name: "Thin box",
        note: "A wide, short box, so the grids' edges are close to every stop. Try each Edges choice, since this is where they differ most.",
        state: {
            width: 800, height: 120, space: "oklab",
            stops: [makeStop("#ff375f", 12, 50), makeStop("#0a84ff", 40, 20), makeStop("#ffd60a", 65, 80), makeStop("#30d158", 90, 40)],
        },
    },
    {
        name: "Stretched sunset",
        note: "The sunset's stops in a wide, short box. Positions are percentages, so every model stretches with the box. The grids' discs are sized from its shorter side. Change Box to watch each model change shape.",
        state: {
            width: 900, height: 220, space: "oklab",
            stops: [
                makeStop("#1a1446", 10, 8), makeStop("#5b2a86", 70, 12), makeStop("#e0457b", 30, 50),
                makeStop("#ff8a3d", 80, 60), makeStop("#ffd166", 45, 92), makeStop("#2e1760", 95, 95),
            ],
        },
    },
    {
        name: "Stops just outside the box",
        note: "The magenta and green stops sit just outside the box, which CSS allows. The thin-plate spline uses them wherever they are. With Edges set to Mirrored, the grids stop at the box. A stop outside it fixes nothing unless its disc reaches in, so the grids ignore these two. Set Edges to Open or Free, and the grids reach past the box and include them.",
        state: {
            width: 600, height: 400, space: "oklab",
            stops: [makeStop("#ff3b30", 20, 30), makeStop("#0a84ff", 70, 25), makeStop("#ffd60a", 45, 78), makeStop("#e040fb", 104, 55), makeStop("#30d158", -6, 92)],
        },
    },
    {
        name: "Stops with spread",
        note: "Three of the stops have a spread. With Stop size set to A disc, each one holds its color across its disc, and the harmonic grid's tents turn into plateaus. With One texel, the harmonic grid sinks toward the stops' average between them, and Spread sets can give the spread a meaning there too. Try changing Grid with One texel as well. The harmonic grid flattens further as the texels shrink, and the biharmonic grid barely changes.",
        state: {
            width: 600, height: 400, space: "oklab",
            stops: [makeStop("#ff3b30", 22, 30, null, 0.3), makeStop("#0a84ff", 75, 28, null, 0.2), makeStop("#ffd60a", 48, 78, null, 0.25), makeStop("#30d158", 88, 80)],
        },
    },
    {
        name: "One stop",
        note: "A single stop. Every model draws its color everywhere.",
        state: {
            width: 600, height: 400, space: "srgb",
            stops: [makeStop("#5e5ce6", 50, 50)],
        },
    },
];

function presetState(index) {
    const preset = structuredClone(PRESETS[index].state);
    return {
        overlay: state?.overlay ?? true,
        backdrop: state?.backdrop ?? "checkerboard",
        view: state?.view ?? "gradient",
        normalization: state?.normalization ?? false,
        crossSection: state?.crossSection ?? false,
        row: state?.row ?? 50,
        sample: state?.sample ?? false,
        sheet: state?.sheet ?? false,
        sheetComponent: state?.sheetComponent ?? 0,
        numbers: state?.numbers ?? false,
        about: state?.about ?? false,
        clipping: state?.clipping ?? false,
        gamut: state?.gamut ?? "display-p3",
        gamutMapping: state?.gamutMapping ?? "map",
        model: state?.model ?? "spline",
        models: state?.models ?? ["spline"],
        edges: state?.edges ?? "mirrored",
        hold: state?.hold ?? "points",
        spreadMeaning: state?.spreadMeaning ?? "none",
        reference: state?.reference ?? "spline",
        otherCurves: state?.otherCurves ?? false,
        gridResolution: state?.gridResolution ?? 64,
        defaultSpread: state?.defaultSpread ?? 0.02,
        ...preset,
    };
}

// MARK: - Thin-plate spline (FreeformGradient.cpp)

// U(r) = r^2 * log(r), from the square of r: r^2 * log(r) = r^2 * log(r^2) / 2, which saves a square root. U(0) is its
// limit, 0, so each stop's own term vanishes at its position. Equivalent to radialBasis() in FreeformGradient.cpp.
const radialBasis = squaredDistance => squaredDistance > 0 ? 0.5 * squaredDistance * Math.log(squaredDistance) : 0;

// IEEE remainder, as std::remainder: the quotient is rounded to the nearest integer, ties to even.
function remainder(x, y) {
    const quotient = x / y;
    let rounded = Math.round(quotient);
    if (Math.abs(quotient - Math.trunc(quotient)) === 0.5)
        rounded = 2 * Math.round(quotient / 2);
    return x - rounded * y;
}

// Solves `matrix * x = values` for each of the 4 columns of values, by Gaussian elimination with partial pivoting.
// Returns null if the matrix is singular. Equivalent to solve() in FreeformGradient.cpp.
function solve(matrix, values, size) {
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

// A stop's color in the interpolation color space. Like WebKit for now, missing components are resolved to 0, rather
// than taking their value from the other stops. (toInterpolationComponents() in FreeformGradient.cpp)
function interpolationComponents(text) {
    const color = parseColor(text) ?? BLACK;
    const components = convertColor(color.space, color.c, state.space, false).map(v => Number.isNaN(v) ? 0 : v);
    return [...components, Number.isNaN(color.alpha) ? 0 : color.alpha];
}

// The spline through the stops, in the interpolation color space, premultiplied. Positions are in CSS pixels, moved by
// -origin and divided by scale first. Equivalent to FreeformGradient::fitSpline() in FreeformGradient.cpp.
function fitThinPlateSpline(influence = null) {
    // With `influence`, a stop's index, the colors are 1 at that stop and 0 at the others, unconverted.
    const hueIndex = influence === null ? HUE_INDEX[state.space] : undefined;

    // 1. Convert each stop's color to the interpolation color space. Where stops share a position, the last one is used.
    const points = [];
    for (const stop of state.stops) {
        const position = [stop.pos[0] / 100 * state.width, stop.pos[1] / 100 * state.height];
        const existing = points.findIndex(point => point.position[0] === position[0] && point.position[1] === position[1]);
        if (existing >= 0)
            points.splice(existing, 1);
        const index = state.stops.indexOf(stop);
        const color = influence === null ? interpolationComponents(stop.color) : Array(4).fill(index === influence ? 1 : 0);
        points.push({ position, color, stop: index });
    }

    // 2. In a cylindrical color space, move each hue by whole turns to within half a turn of their circular mean.
    if (hueIndex !== undefined) {
        let sine = 0, cosine = 0;
        for (const point of points) {
            sine += Math.sin(point.color[hueIndex] * Math.PI / 180);
            cosine += Math.cos(point.color[hueIndex] * Math.PI / 180);
        }
        const mean = Math.atan2(sine, cosine) * 180 / Math.PI;
        for (const point of points)
            point.color[hueIndex] = mean + remainder(point.color[hueIndex] - mean, 360);
    }

    // 3. Premultiply.
    for (const point of influence === null ? points : []) {
        for (let component = 0; component < 3; ++component) {
            if (component !== hueIndex)
                point.color[component] *= point.color[3];
        }
    }

    // 4. Move the positions so their centroid is at the origin, and scale them so the farthest is at a distance of 1.
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

    // 5. Choose the linear part: a for one stop, a + b * t along a line for stops on a line, a + b * x + c * y otherwise.
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

    // 6. Solve for the weights and the coefficients of the linear part:
    //
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

    const solution = solve(matrix, values, size);
    if (!solution) {
        // Distinct positions make the system solvable, so this is only reached through rounding. Use the first color.
        return { hueIndex, origin, scale, centers: [], polynomial: [points[0].color.slice(), [0, 0, 0, 0], [0, 0, 0, 0]], terms: [[1, 0, 0]], points };
    }

    // `stop` and `color` aren't in WebKit's Center; the visualizations use them.
    const centers = points.map((point, i) => ({ position: point.position, weight: solution[i], stop: point.stop, color: point.color }));
    // Gather the linear terms into the coefficients of 1, x and y.
    const polynomial = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    for (let k = 0; k < terms.length; ++k) {
        for (let coefficient = 0; coefficient < 3; ++coefficient) {
            for (let component = 0; component < 4; ++component)
                polynomial[coefficient][component] += terms[k][coefficient] * solution[count + k][component];
        }
    }
    return { hueIndex, origin, scale, centers, polynomial, terms, points };
}

// The spline, and for a grid model, the grid solved from the same stops. The stops' colors, hue fixup and
// premultiplication are shared, so the models differ only in how the colors spread between the stops.
function fitSpline(model = state.model, influence = null) {
    const spline = fitThinPlateSpline(influence);
    if (model !== "spline")
        spline.grid = solveGrid(model, spline.points);
    return spline;
}

// MARK: - Grid models (MeshShader2)

// Not in WebKit: the two models of ~/Data/Code/MeshShader2's FreeformGradient. Each stop is a disc of its color, held
// fixed, and the colors between are a solution on a grid over the box, of
// - the biharmonic equation, ∆²u = 0: the same thin plate as the spline, but held by discs, and inside the box;
// - or Laplace's, ∆u = 0: a stretched membrane, creased at each stop, which never passes the stops' colors.
// MeshShader2 solves it on the GPU, by multigrid and conjugate gradients, with antialiased discs. Here it is solved
// directly, by banded Cholesky, with a texel held if its center is in a disc, and always the texel a stop is in.
const MODELS = ["spline", "biharmonic", "harmonic"];
const GRID_RESOLUTIONS = [32, 48, 64, 96, 128];

// The models that are on, in MODELS order, and the one the Visualize panel shows, which is one of them. Links from
// before there was a list of models have a model, and cm: 1 for all three.
function modelsFrom(data) {
    let models = Array.isArray(data.ms) ? MODELS.filter(model => data.ms.includes(model)) : [];
    let model = MODELS.includes(data.md) ? data.md : null;
    if (!models.length)
        models = data.cm === 1 ? MODELS.slice() : [model ?? "spline"];
    if (!models.includes(model))
        model = models[0];
    return { model, models };
}

const MODEL_NAMES = { spline: "Thin-plate spline", biharmonic: "Biharmonic grid", harmonic: "Harmonic grid" };
const gridModelIsOn = () => state.models.some(model => model !== "spline");

// The part of a grid solve that depends only on where the stops are, not on their colors: the grid, the texels each
// stop holds, and the factored matrix. Colors only change the right-hand side, so new colors cost two triangular
// solves, and so does each stop's share of the colors.
const factorCache = new Map();

function gridFactor(model, positions, spreads) {
    // Dragging solves at half the resolution, to keep up.
    const resolution = drag ? Math.max(24, state.gridResolution / 2) : state.gridResolution;
    const key = JSON.stringify([model, resolution, state.edges, state.hold, state.spreadMeaning, state.width, state.height, positions, spreads]);
    const cached = factorCache.get(key);
    if (cached)
        return cached;
    const start = performance.now();

    // Mirrored edges hold the grid to the box. Open ones reach half the box's size past each side, so the edges are
    // far from the stops. Free ones reach past every stop, and a quarter of the box past the furthest.
    let domain;
    if (state.edges === "free") {
        const xs = [0, state.width, ...positions.map(p => p[0])], ys = [0, state.height, ...positions.map(p => p[1])];
        const x = Math.min(...xs) - 0.25 * state.width, y = Math.min(...ys) - 0.25 * state.height;
        domain = { x, y, width: Math.max(...xs) + 0.25 * state.width - x, height: Math.max(...ys) + 0.25 * state.height - y };
    } else {
        const pad = state.edges === "open" ? 0.5 : 0;
        domain = { x: -pad * state.width, y: -pad * state.height, width: (1 + 2 * pad) * state.width, height: (1 + 2 * pad) * state.height };
    }
    const longest = Math.max(domain.width, domain.height);
    const columns = Math.max(3, Math.round(resolution * domain.width / longest));
    const rows = Math.max(3, Math.round(resolution * domain.height / longest));
    const texel = [domain.width / columns, domain.height / rows];
    const count = columns * rows;

    // Texels are numbered along the shorter side, so the matrix's band is as narrow as it can be.
    const byColumn = columns >= rows;
    const minor = byColumn ? rows : columns;
    const index = (x, y) => byColumn ? x * rows + y : y * columns + x;
    const band = model === "biharmonic" ? 2 * minor : minor;
    const stride = band + 1;
    // The lower band: entry (i, j), for j from i - band to i.
    const matrix = new Float64Array(count * stride);
    const at = (i, j) => i * stride + j - i + band;
    const add = (i, j, value) => {
        if (j <= i)
            matrix[at(i, j)] += value;
    };

    // L, the Laplacian, with mirrored edges: a texel past an edge is the texel at it, so no color flows across.
    const neighbors = new Array(count);
    for (let y = 0; y < rows; ++y) {
        for (let x = 0; x < columns; ++x) {
            const list = [];
            if (x > 0)
                list.push(index(x - 1, y));
            if (x < columns - 1)
                list.push(index(x + 1, y));
            if (y > 0)
                list.push(index(x, y - 1));
            if (y < rows - 1)
                list.push(index(x, y + 1));
            neighbors[index(x, y)] = list;
        }
    }
    const stretching = weight => {
        for (let i = 0; i < count; ++i) {
            add(i, i, weight * neighbors[i].length);
            for (const j of neighbors[i])
                add(i, j, -weight);
        }
    };
    if (model === "harmonic") {
        // Minimizes the stretching, |∇u|²: the matrix is −L. Its natural edge is a mirrored one.
        stretching(1);
    } else if (state.edges === "free") {
        // Minimizes the thin-plate energy, u_xx² + 2·u_xy² + u_yy², with only the differences that fit in the grid, so
        // nothing holds its edges. Planes cost nothing, so with fewer than three stops the solution isn't unique: as
        // Finch et al. do, a little stretching and a little size are added.
        const term = (entries, weight) => {
            for (const [i, a] of entries) {
                for (const [j, b] of entries)
                    add(i, j, weight * a * b);
            }
        };
        for (let y = 0; y < rows; ++y) {
            for (let x = 0; x < columns; ++x) {
                if (x > 0 && x < columns - 1)
                    term([[index(x - 1, y), 1], [index(x, y), -2], [index(x + 1, y), 1]], 1);
                if (y > 0 && y < rows - 1)
                    term([[index(x, y - 1), 1], [index(x, y), -2], [index(x, y + 1), 1]], 1);
                if (x < columns - 1 && y < rows - 1)
                    term([[index(x, y), 1], [index(x + 1, y), -1], [index(x, y + 1), -1], [index(x + 1, y + 1), 1]], 2);
            }
        }
        stretching(1e-4);
        for (let i = 0; i < count; ++i)
            add(i, i, 1e-8);
    } else {
        // Minimizes the bending, (∆u)²: the matrix is L·L.
        for (let i = 0; i < count; ++i) {
            const row = [[i, -neighbors[i].length], ...neighbors[i].map(k => [k, 1])];
            for (const [k, value] of row) {
                add(i, k, -value * neighbors[k].length);
                for (const j of neighbors[k])
                    add(i, j, value);
            }
        }
    }

    // The discs, or with points, only the texel each stop is in. A texel held by more than one stop takes the later.
    const held = new Int32Array(count).fill(-1);
    const shorter = Math.min(state.width, state.height);
    // With one texel each, spread can set how firmly a stop holds its texel: by a spring, instead of fixing it. A spread
    // of 1 fixes it. A spring's stiffness k = 2π·s / (1 − s) makes the stop pull on a membrane as a fixed texel would
    // if it were exp(−(1 − s) / s) times as big, so a spread of 0.5 is about a third as big.
    const firmness = state.hold === "points" && state.spreadMeaning === "strength";
    const springTexel = [], springStop = [], springStiffness = [];
    positions.forEach(([px, py], k) => {
        const radius = state.hold === "points" ? 0 : spreads[k] * 0.5 * shorter;
        // A stop on the grid's right or bottom edge, as at 100%, holds the texel at that edge.
        const cx = Math.min(Math.floor((px - domain.x) / texel[0]), px <= domain.x + domain.width ? columns - 1 : columns);
        const cy = Math.min(Math.floor((py - domain.y) / texel[1]), py <= domain.y + domain.height ? rows - 1 : rows);
        if (cx >= 0 && cx < columns && cy >= 0 && cy < rows) {
            const spread = clamp(spreads[k], 0.001, 1);
            if (firmness && spread < 0.999) {
                springTexel.push(index(cx, cy));
                springStop.push(k);
                springStiffness.push(2 * Math.PI * spread / (1 - spread));
            } else
                held[index(cx, cy)] = k;
        }
        if (!radius)
            return;
        const x0 = Math.max(0, Math.floor((px - radius - domain.x) / texel[0])), x1 = Math.min(columns - 1, Math.ceil((px + radius - domain.x) / texel[0]));
        const y0 = Math.max(0, Math.floor((py - radius - domain.y) / texel[1])), y1 = Math.min(rows - 1, Math.ceil((py + radius - domain.y) / texel[1]));
        for (let y = y0; y <= y1; ++y) {
            for (let x = x0; x <= x1; ++x) {
                if (Math.hypot(domain.x + (x + 0.5) * texel[0] - px, domain.y + (y + 0.5) * texel[1] - py) <= radius)
                    held[index(x, y)] = k;
            }
        }
    });
    let heldCount = 0;
    for (let i = 0; i < count; ++i)
        heldCount += held[i] >= 0;
    springTexel.forEach((i, n) => add(i, i, springStiffness[n]));

    // Held texels move to the right-hand side, keeping the matrix symmetric. What moves is kept, to apply to colors.
    const couplingTexel = [], couplingStop = [], couplingValue = [];
    for (let i = 0; i < count; ++i) {
        for (let j = Math.max(0, i - band); j < i; ++j) {
            const value = matrix[at(i, j)];
            if (!value)
                continue;
            const iHeld = held[i] >= 0, jHeld = held[j] >= 0;
            if (jHeld && !iHeld) {
                couplingTexel.push(i);
                couplingStop.push(held[j]);
                couplingValue.push(value);
            }
            if (iHeld && !jHeld) {
                couplingTexel.push(j);
                couplingStop.push(held[i]);
                couplingValue.push(value);
            }
            if (iHeld || jHeld)
                matrix[at(i, j)] = 0;
        }
    }
    for (let i = 0; i < count; ++i) {
        if (held[i] >= 0)
            matrix[at(i, i)] = 1;
    }

    // Cholesky, in place: the band becomes L, with L·Lᵀ the matrix.
    for (let i = 0; i < count; ++i) {
        const low = Math.max(0, i - band), iRow = i * stride - i + band;
        for (let j = low; j <= i; ++j) {
            const jRow = j * stride - j + band;
            let sum = matrix[iRow + j];
            for (let k = low; k < j; ++k)
                sum -= matrix[iRow + k] * matrix[jRow + k];
            matrix[iRow + j] = i === j ? Math.sqrt(Math.max(sum, 1e-300)) : sum / matrix[jRow + j];
        }
    }

    const factor = {
        key, columns, rows, origin: [domain.x, domain.y], texel, count, band, stride, index, matrix, held, heldCount,
        springTexel: Int32Array.from(springTexel), springStop: Int32Array.from(springStop), springStiffness: Float64Array.from(springStiffness),
        anchored: heldCount + springTexel.length,
        couplingTexel: Int32Array.from(couplingTexel), couplingStop: Int32Array.from(couplingStop), couplingValue: Float64Array.from(couplingValue),
        milliseconds: performance.now() - start,
    };
    factorCache.set(key, factor);
    if (factorCache.size > 8)
        factorCache.delete(factorCache.keys().next().value);
    return factor;
}

// Solves for each of `channels` values per stop, given as values[stop][channel], all in one pass over the factor.
// Returns a solution per channel, in the factor's texel order.
function gridSolve(factor, values, channels) {
    const { count, band, stride, matrix, held, couplingTexel, couplingStop, couplingValue, springTexel, springStop, springStiffness } = factor;
    // Channel c of texel i is at i * channels + c.
    const x = new Float64Array(count * channels);
    for (let n = 0; n < springTexel.length; ++n) {
        const row = values[springStop[n]], o = springTexel[n] * channels, stiffness = springStiffness[n];
        for (let c = 0; c < channels; ++c)
            x[o + c] += stiffness * row[c];
    }
    for (let n = 0; n < couplingTexel.length; ++n) {
        const row = values[couplingStop[n]], o = couplingTexel[n] * channels, value = couplingValue[n];
        for (let c = 0; c < channels; ++c)
            x[o + c] -= value * row[c];
    }
    for (let i = 0; i < count; ++i) {
        if (held[i] >= 0) {
            const row = values[held[i]];
            for (let c = 0; c < channels; ++c)
                x[i * channels + c] = row[c];
        }
    }
    // L·y = b, then Lᵀ·x = y, in place.
    for (let i = 0; i < count; ++i) {
        const low = Math.max(0, i - band), iRow = i * stride - i + band, o = i * channels;
        for (let k = low; k < i; ++k) {
            const value = matrix[iRow + k];
            if (!value)
                continue;
            const ok = k * channels;
            for (let c = 0; c < channels; ++c)
                x[o + c] -= value * x[ok + c];
        }
        const diagonal = matrix[iRow + i];
        for (let c = 0; c < channels; ++c)
            x[o + c] /= diagonal;
    }
    for (let i = count - 1; i >= 0; --i) {
        const o = i * channels, high = Math.min(count - 1, i + band);
        for (let k = i + 1; k <= high; ++k) {
            const value = matrix[k * stride - k + band + i];
            if (!value)
                continue;
            const ok = k * channels;
            for (let c = 0; c < channels; ++c)
                x[o + c] -= value * x[ok + c];
        }
        const diagonal = matrix[i * stride + band];
        for (let c = 0; c < channels; ++c)
            x[o + c] /= diagonal;
    }
    return Array.from({ length: channels }, (_, c) => {
        const solution = new Float64Array(count);
        for (let i = 0; i < count; ++i)
            solution[i] = x[i * channels + c];
        return solution;
    });
}

const gridCache = new Map();

function solveGrid(model, points) {
    const spreads = points.map(point => spreadOf(state.stops[point.stop]));
    // The spline's points are normalized, so the positions come from the stops.
    const positions = points.map(point => [state.stops[point.stop].pos[0] / 100 * state.width, state.stops[point.stop].pos[1] / 100 * state.height]);
    const factor = gridFactor(model, positions, spreads);
    const key = factor.key + JSON.stringify(points.map(point => point.color));
    const cached = gridCache.get(key);
    if (cached)
        return cached;
    const start = performance.now();
    const { columns, rows, index } = factor;
    const values = new Float32Array(columns * rows * 4);
    if (factor.anchored && sharesBySpread()) {
        // Each stop's influence, weighted by its spread and renormalized, so stops with more spread claim more.
        const shares = influencesOf(factor, points);
        const weights = points.map(point => Math.max(spreadOf(state.stops[point.stop]), 0.001));
        for (let y = 0; y < rows; ++y) {
            for (let x = 0; x < columns; ++x) {
                const i = index(x, y);
                let total = 0;
                const color = [0, 0, 0, 0];
                points.forEach((point, k) => {
                    const share = weights[k] * shares[k][i];
                    total += share;
                    for (let c = 0; c < 4; ++c)
                        color[c] += share * point.color[c];
                });
                // Where weighted influences cancel out, as they can where they go negative, the plain sum is used.
                if (Math.abs(total) < 1e-6) {
                    total = 1;
                    color.fill(0);
                    points.forEach((point, k) => point.color.forEach((v, c) => color[c] += shares[k][i] * v));
                }
                for (let c = 0; c < 4; ++c)
                    values[(y * columns + x) * 4 + c] = color[c] / total;
            }
        }
    } else if (factor.anchored) {
        const solutions = gridSolve(factor, points.map(point => point.color), 4);
        for (let c = 0; c < 4; ++c) {
            for (let y = 0; y < rows; ++y) {
                for (let x = 0; x < columns; ++x)
                    values[(y * columns + x) * 4 + c] = solutions[c][index(x, y)];
            }
        }
    }
    const grid = { columns, rows, origin: factor.origin, texel: factor.texel, values, heldCount: factor.heldCount, factor, milliseconds: performance.now() - start };
    gridCache.set(key, grid);
    if (gridCache.size > 24)
        gridCache.delete(gridCache.keys().next().value);
    return grid;
}

// With one texel each, spread can set each stop's share of the color instead of its size.
const sharesBySpread = () => state.hold === "points" && state.spreadMeaning === "share";

// Each stop's influence on every texel: one solve with 1 at the stop and 0 at the others, kept with the factor.
function influencesOf(factor, points) {
    factor.shares ??= gridSolve(factor, points.map((_, k) => points.map((_, j) => j === k ? 1 : 0)), points.length);
    return factor.shares;
}

// Each stop's share of the color at a point, for the model in `fit`: the stops' influences there. They add up to 1.
function stopShares(fit, [px, py]) {
    const shares = new Array(state.stops.length).fill(0);
    if (fit.grid) {
        const { factor } = fit.grid;
        if (!factor.anchored)
            return shares;
        influencesOf(factor, fit.points);
        const fx = clamp((px - factor.origin[0]) / factor.texel[0] - 0.5, 0, factor.columns - 1);
        const fy = clamp((py - factor.origin[1]) / factor.texel[1] - 0.5, 0, factor.rows - 1);
        const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(x0 + 1, factor.columns - 1), y1 = Math.min(y0 + 1, factor.rows - 1);
        const tx = fx - x0, ty = fy - y0, at = factor.index;
        fit.points.forEach((point, k) => {
            const s = factor.shares[k];
            shares[point.stop] = (s[at(x0, y0)] * (1 - tx) + s[at(x1, y0)] * tx) * (1 - ty) + (s[at(x0, y1)] * (1 - tx) + s[at(x1, y1)] * tx) * ty;
        });
        if (sharesBySpread()) {
            const weighted = shares.map((share, k) => share * Math.max(spreadOf(state.stops[k]), 0.001));
            const total = weighted.reduce((a, b) => a + b, 0);
            if (Math.abs(total) >= 1e-6)
                return weighted.map(share => share / total);
        }
        return shares;
    }
    fit.shareFits ??= fit.points.map(point => fitThinPlateSpline(point.stop));
    fit.points.forEach((point, k) => shares[point.stop] = interpolatedColor(fit.shareFits[k], [px, py])[0]);
    return shares;
}

// The grid's color at a position in CSS pixels, filtered bilinearly between texel centers, as MeshShader2 filters it
// up to the view. Equivalent to gridColor() in the shader.
function gridColor(grid, [px, py]) {
    const fx = clamp((px - grid.origin[0]) / grid.texel[0] - 0.5, 0, grid.columns - 1);
    const fy = clamp((py - grid.origin[1]) / grid.texel[1] - 0.5, 0, grid.rows - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(x0 + 1, grid.columns - 1), y1 = Math.min(y0 + 1, grid.rows - 1);
    const tx = fx - x0, ty = fy - y0, v = grid.values, w = grid.columns;
    return [0, 1, 2, 3].map(c => (v[(y0 * w + x0) * 4 + c] * (1 - tx) + v[(y0 * w + x1) * 4 + c] * tx) * (1 - ty)
        + (v[(y1 * w + x0) * 4 + c] * (1 - tx) + v[(y1 * w + x1) * 4 + c] * tx) * ty);
}

// A stop's spread: its own, or the default. A disc's radius is its spread times half the box's shorter side.
// With one texel each, a stop without its own spread has 0.5, the middle of how firmly or how big a share.
const spreadOf = stop => stop.spread ?? (state.hold === "points" ? 0.5 : state.defaultSpread);

// The radius of a stop's disc, in CSS pixels.
function discRadius(stop) {
    if (state.hold === "points")
        return 0;
    return spreadOf(stop) * 0.5 * Math.min(state.width, state.height);
}

// The color at a position in CSS pixels, in the interpolation color space, premultiplied. Equivalent to
// FreeformGradient::interpolatedColor() in FreeformGradient.cpp.
function interpolatedColor(spline, [px, py]) {
    if (spline.grid)
        return gridColor(spline.grid, [px, py]);
    const x = (px - spline.origin[0]) / spline.scale, y = (py - spline.origin[1]) / spline.scale;
    const color = [0, 1, 2, 3].map(k => spline.polynomial[0][k] + spline.polynomial[1][k] * x + spline.polynomial[2][k] * y);
    for (const center of spline.centers) {
        const dx = x - center.position[0], dy = y - center.position[1];
        const basis = radialBasis(dx * dx + dy * dy);
        for (let k = 0; k < 4; ++k)
            color[k] += center.weight[k] * basis;
    }
    return color;
}

// The color at a position in percentages of the box, as 8-bit sRGB hex, for a new stop that doesn't change the colors
// much. Like FreeformGradient::premultipliedColor(): alpha is clamped before unpremultiplying.
function colorAt(percentPosition) {
    const spline = fitSpline();
    const color = interpolatedColor(spline, [percentPosition[0] / 100 * state.width, percentPosition[1] / 100 * state.height]);
    const [r, g, b, alpha] = displayColor(unpremultipliedColor(color, spline.hueIndex));
    const hex = v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}${alpha < 1 ? hex(alpha) : ""}`;
}

// The spline's value with alpha clamped, then unpremultiplied, as FreeformGradient::premultipliedColor() does before it
// converts.
function unpremultipliedColor(color, hueIndex) {
    const alpha = clamp(color[3], 0, 1);
    const components = color.slice(0, 3).map((value, k) => k === hueIndex ? normalizeHue(value) : alpha ? value / alpha : 0);
    if (state.space === "lch" || state.space === "oklch")
        components[1] = Math.max(0, components[1]);
    return [...components, alpha];
}

// Unpremultiplied components in the interpolation color space, as sRGB, clamped, and alpha.
function displayColor(color) {
    return toOutput({ space: state.space, c: color.slice(0, 3), alpha: color[3] }, "srgb");
}

const cssForDisplayColor = ([r, g, b, alpha]) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)} / ${+alpha.toFixed(3)})`;

// MARK: - WebGPU renderer
// Ported from WebKit's FreeformGradientRendererMetal.mm: a single triangle covers the canvas, and each fragment
// evaluates the spline at its pixel's center in the interpolation color space, then converts it to the canvas's.

__SHADER_HELPERS__

const SHADER = `
__SHADER_MATRICES__
${wgslMatrix("xyzToLMS", M.xyzToLMS)}
${wgslMatrix("lmsToOKLab", M.lmsToOKLab)}

// Equivalent to FreeformGradient::Center in FreeformGradient.h.
struct Center {
    position: vec2f,
    weight: vec4f,
};

struct Uniforms {
    // a, b and c of the spline.
    polynomial: array<vec4f, 3>,
    splineOrigin: vec2f,
    splineScale: f32,
    scale: f32,
    centerCount: u32,
    space: u32,
    outputIsDisplayP3: u32,
    // Not in WebKit: 1 draws U(r) around the one center instead of the color.
    view: u32,
    // Not in WebKit: a grid model's solution, used instead of the spline when gridWidth isn't 0.
    gridWidth: u32,
    gridHeight: u32,
    gridOrigin: vec2f,
    gridTexel: vec2f,
    // Not in WebKit: 1 maps colors outside the canvas's gamut as CSS Color 4 does, instead of clipping them.
    gamutMapping: u32,
};

@group(0) @binding(0) var<storage, read> centers: array<Center>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var<storage, read> grid: array<vec4f>;

// Equivalent to gridColor() in the page.
fn gridColor(position: vec2f) -> vec4f {
    let size = vec2f(f32(uniforms.gridWidth), f32(uniforms.gridHeight));
    let f = clamp((position - uniforms.gridOrigin) / uniforms.gridTexel - 0.5, vec2f(0.0), size - 1.0);
    let x0 = u32(floor(f.x));
    let y0 = u32(floor(f.y));
    let x1 = min(x0 + 1u, uniforms.gridWidth - 1u);
    let y1 = min(y0 + 1u, uniforms.gridHeight - 1u);
    let t = f - floor(f);
    let w = uniforms.gridWidth;
    let top = mix(grid[y0 * w + x0], grid[y0 * w + x1], t.x);
    let bottom = mix(grid[y1 * w + x0], grid[y1 * w + x1], t.x);
    return mix(top, bottom, t.y);
}

// U(r) = r^2 * log(r), from the square of r.
fn radialBasis(squaredDistance: f32) -> f32 {
    // Equivalent to radialBasis() in FreeformGradient.cpp.

    if (squaredDistance > 0.0) {
        return 0.5 * squaredDistance * log(squaredDistance);
    }
    return 0.0;
}

fn interpolatedColor(position: vec2f) -> vec4f {
    // Equivalent to FreeformGradient::interpolatedColor() in FreeformGradient.cpp.

    if (uniforms.gridWidth > 0u) {
        return gridColor(position);
    }

    let point = (position - uniforms.splineOrigin) / uniforms.splineScale;

    var color = uniforms.polynomial[0] + uniforms.polynomial[1] * point.x + uniforms.polynomial[2] * point.y;
    for (var i = 0u; i < uniforms.centerCount; i++) {
        let offset = point - centers[i].position;
        color += centers[i].weight * radialBasis(dot(offset, offset));
    }
    return color;
}

fn hueIndex() -> i32 {
    switch uniforms.space {
        case 12u, 13u: { return 0; }
        case 9u, 11u: { return 2; }
        default: { return -1; }
    }
}

__SHADER_COLOR__

// Not in WebKit: CSS gamut mapping to the canvas's RGB gamut, https://drafts.csswg.org/css-color-4/#binsearch. Colors
// are moved toward gray in OKLCh, keeping their lightness and hue, until they're within one just-noticeable difference
// of their clipped versions. Equivalent to gamutMappedLinear() in the page.
fn xyzToOKLab(xyz: vec3f) -> vec3f {
    return transform(lmsToOKLab, powSigned(transform(xyzToLMS, xyz), 1.0 / 3.0));
}

fn okLabToOutputLinear(lab: vec3f) -> vec3f {
    let xyz = okLabToXYZ(lab);
    if (uniforms.outputIsDisplayP3 == 1u) {
        return transform(xyzToLinP3, xyz);
    }
    return transform(xyzToLinSRGB, xyz);
}

fn outputLinearToOKLab(rgb: vec3f) -> vec3f {
    if (uniforms.outputIsDisplayP3 == 1u) {
        return xyzToOKLab(transform(linP3ToXYZ, rgb));
    }
    return xyzToOKLab(transform(linSRGBToXYZ, rgb));
}

fn inOutputGamut(rgb: vec3f) -> bool {
    return all(rgb >= vec3f(-1e-5)) && all(rgb <= vec3f(1.0 + 1e-5));
}

fn gamutMappedLinear(origin: vec3f) -> vec3f {
    let jnd = 0.02;
    let epsilon = 0.0001;
    if (origin.x >= 1.0) {
        return vec3f(1.0);
    }
    if (origin.x <= 0.0) {
        return vec3f(0.0);
    }
    let originRGB = okLabToOutputLinear(origin);
    if (inOutputGamut(originRGB)) {
        return originRGB;
    }
    var clipped = clamp(originRGB, vec3f(0.0), vec3f(1.0));
    if (distance(outputLinearToOKLab(clipped), origin) < jnd) {
        return clipped;
    }
    let chroma = length(origin.yz);
    let direction = origin.yz / chroma;
    var low = 0.0;
    var high = chroma;
    var lowInGamut = true;
    while (high - low > epsilon) {
        let middle = (low + high) / 2.0;
        let current = vec3f(origin.x, direction * middle);
        let currentRGB = okLabToOutputLinear(current);
        if (lowInGamut && inOutputGamut(currentRGB)) {
            low = middle;
            continue;
        }
        clipped = clamp(currentRGB, vec3f(0.0), vec3f(1.0));
        let difference = distance(outputLinearToOKLab(clipped), current);
        if (difference < jnd) {
            if (jnd - difference < epsilon) {
                return clipped;
            }
            lowInGamut = false;
            low = middle;
        } else {
            high = middle;
        }
    }
    return clipped;
}

// Not in WebKit: toPremultipliedColor(), with CSS gamut mapping in place of clipping when it's chosen.
fn outputColor(color: vec4f) -> vec4f {
    if (uniforms.gamutMapping == 0u) {
        return toPremultipliedColor(color);
    }
    let alpha = saturate(color.w);
    var c = color.xyz;
    if (uniforms.space == 12u || uniforms.space == 13u) {
        c.x = normalizeHue(c.x);
    } else if (uniforms.space == 9u || uniforms.space == 11u) {
        c.z = normalizeHue(c.z);
    }
    let rgb = clamp(srgbFromLinear(gamutMappedLinear(xyzToOKLab(toXYZ(uniforms.space, c)))), vec3f(0.0), vec3f(1.0));
    return vec4f(rgb * alpha, alpha);
}

fn premultipliedColor(position: vec2f) -> vec4f {
    // Equivalent to FreeformGradient::premultipliedColor() in FreeformGradient.cpp.

    var color = interpolatedColor(position);

    // The spline can overshoot the colors of the stops, so alpha is clamped before unpremultiplying.
    let alpha = saturate(color.w);
    for (var component = 0; component < 3; component++) {
        if (component != hueIndex()) {
            if (alpha > 0.0) {
                color[component] = color[component] / alpha;
            } else {
                color[component] = 0.0;
            }
        }
    }

    return outputColor(color);
}

struct RasterizerData {
    @builtin(position) position: vec4f,
};

// A single triangle, twice the size of the canvas, covers it, with the rest clipped away. Equivalent to
// freeformGradientVertex() in FreeformGradientRendererMetal.mm.
@vertex fn freeformGradientVertex(@builtin(vertex_index) vertexID: u32) -> RasterizerData {
    // 0, 1 and 2 become (0, 0), (2, 0) and (0, 2), then (-1, -1), (3, -1) and (-1, 3).
    let position = vec2f(f32((vertexID << 1u) & 2u), f32(vertexID & 2u)) * 2.0 - 1.0;
    var out: RasterizerData;
    out.position = vec4f(position, 0.0, 1.0);
    return out;
}

// Evaluates the color at the pixel's center, and returns it premultiplied in the canvas's color space. Equivalent to
// freeformGradientFragment() in FreeformGradientRendererMetal.mm.
@fragment fn freeformGradientFragment(in: RasterizerData) -> @location(0) vec4f {
    // The position of a fragment is the center of its pixel, in pixels: (x + 0.5, y + 0.5).
    let position = in.position.xy / uniforms.scale;
    if (uniforms.view == 1u) {
        return radialBasisColor(position);
    }
    if (uniforms.view == 2u) {
        return influenceColor(interpolatedColor(position).x);
    }
    return premultipliedColor(position);
}

// Not in WebKit: a stop's influence, white at 0, orange at 1, dark red past it, and blue below 0. Equivalent to
// influenceDisplayColor() in the page.
fn influenceColor(value: f32) -> vec4f {
    if (value < 0.0) {
        return vec4f(mix(vec3f(1.0), vec3f(0.16, 0.42, 0.95), saturate(-value * 4.0)), 1.0);
    }
    if (value <= 1.0) {
        return vec4f(mix(vec3f(1.0), vec3f(0.95, 0.45, 0.1), value), 1.0);
    }
    return vec4f(mix(vec3f(0.95, 0.45, 0.1), vec3f(0.45, 0.05, 0.05), saturate((value - 1.0) * 4.0)), 1.0);
}

// Not in WebKit: U(r) around the one center, white at 0, blue below it and orange above it. U is smallest, -1 / (2e),
// at r = 1 / sqrt(e).
fn radialBasisColor(position: vec2f) -> vec4f {
    let offset = (position - uniforms.splineOrigin) / uniforms.splineScale - centers[0].position;
    let u = radialBasis(dot(offset, offset));
    if (u < 0.0) {
        return vec4f(mix(vec3f(1.0), vec3f(0.16, 0.42, 0.95), saturate(-u * 2.0 * 2.718281828)), 1.0);
    }
    return vec4f(mix(vec3f(1.0), vec3f(0.95, 0.45, 0.1), 1.0 - exp(-u)), 1.0);
}
`;

class WebGPUFreeformGradientRenderer {
    static async create() {
        if (!navigator.gpu)
            throw new Error("WebGPU isn't available in this browser.");
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter)
            throw new Error("No WebGPU adapter.");
        const device = await adapter.requestDevice();
        return new WebGPUFreeformGradientRenderer(device);
    }

    constructor(device) {
        this.device = device;
        this.format = navigator.gpu.getPreferredCanvasFormat();
        this.outputSpace = "srgb";
        this.contexts = new Map();
        const module = device.createShaderModule({ code: SHADER });
        this.compilationInfo = module.getCompilationInfo?.();
        this.pipeline = device.createRenderPipeline({
            layout: "auto",
            vertex: { module, entryPoint: "freeformGradientVertex" },
            fragment: { module, entryPoint: "freeformGradientFragment", targets: [{ format: this.format }] },
            primitive: { topology: "triangle-list" },
        });
    }

    // Each model's box has its own canvas, configured the first time it's drawn into.
    contextFor(canvas) {
        let context = this.contexts.get(canvas);
        if (context)
            return context;
        context = canvas.getContext("webgpu");
        try {
            context.configure({ device: this.device, format: this.format, alphaMode: "premultiplied", colorSpace: "display-p3" });
            this.outputSpace = "display-p3";
        } catch {
            context.configure({ device: this.device, format: this.format, alphaMode: "premultiplied" });
            this.outputSpace = "srgb";
        }
        this.contexts.set(canvas, context);
        return context;
    }

    render(canvas, spline, scale, view = 0) {
        const { device } = this;
        const context = this.contextFor(canvas);

        // Matches Center in the shader: a vec2f, padded to 16 bytes, then a vec4f. A buffer can't be empty, so a
        // spline without centers still gets one, which the shader doesn't read.
        const centerData = new Float32Array(Math.max(1, spline.centers.length) * 8);
        spline.centers.forEach((center, i) => {
            centerData.set(center.position, i * 8);
            centerData.set(center.weight, i * 8 + 4);
        });
        const centers = device.createBuffer({ size: centerData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(centers, 0, centerData);

        // Not in WebKit: a grid model's solution, 4 f32s a texel. As with the centers, the buffer can't be empty.
        const gridData = spline.grid ? spline.grid.values : new Float32Array(4);
        const grid = device.createBuffer({ size: gridData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(grid, 0, gridData);

        // Matches Uniforms in the shader: 3 vec4fs, a vec2f, 2 f32s, 6 u32s and 2 vec2fs, padded to 112 bytes.
        const uniformData = new ArrayBuffer(112);
        const floats = new Float32Array(uniformData), uints = new Uint32Array(uniformData);
        spline.polynomial.forEach((coefficient, i) => floats.set(coefficient, i * 4));
        floats.set(spline.origin, 12);
        floats[14] = spline.scale;
        floats[15] = scale;
        uints[16] = spline.centers.length;
        uints[17] = SPACES.indexOf(state.space);
        uints[18] = this.outputSpace === "display-p3" ? 1 : 0;
        uints[19] = view;
        uints[20] = spline.grid?.columns ?? 0;
        uints[21] = spline.grid?.rows ?? 0;
        floats.set(spline.grid?.origin ?? [0, 0], 22);
        floats.set(spline.grid?.texel ?? [1, 1], 24);
        uints[26] = state.gamutMapping === "map" ? 1 : 0;
        const uniforms = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(uniforms, 0, uniformData);

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "clear", clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: "store" }],
        });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: centers } }, { binding: 1, resource: { buffer: uniforms } }, { binding: 2, resource: { buffer: grid } }],
        }));
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
        centers.destroy();
        uniforms.destroy();
        grid.destroy();
    }
}

// MARK: - Page

const $ = id => document.getElementById(id);
// A box for each model, side by side, all from the same stops.
const views = [...document.querySelectorAll(".view")].map(figure => {
    const overlay = figure.querySelector(".overlay");
    return {
        model: figure.dataset.model,
        figure,
        box: figure.querySelector(".viewBox"),
        wrap: figure.querySelector(".stageWrap"),
        stage: figure.querySelector(".stage"),
        gpu: figure.querySelector(".gpu"),
        message: figure.querySelector(".stageMessage"),
        diff: figure.querySelector(".diff"),
        overlay,
        overlayContext: overlay.getContext("2d"),
        caption: figure.querySelector("figcaption"),
        details: figure.querySelector(".viewDetails"),
        plot: figure.querySelector(".plot"),
        plotNote: figure.querySelector(".plotNote"),
        sheet: figure.querySelector(".sheet"),
        numbers: figure.querySelector(".numbers"),
        sheetGrid: null,
    };
});
// Each model's fit, from the last render, and with "influence" shown, each model's influence of the selected stop.
let splines = { };
let influences = { };

let gpuRenderer = null;
let gpuError = null;

for (const space of SPACES)
    $("space").add(new Option(space, space));
$("preset").add(new Option("Custom", ""));
PRESETS.forEach((preset, index) => $("preset").add(new Option(preset.name, String(index))));

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

// Drags write the URL when they end.
function changed({ dragging = !!drag } = { }) {
    scheduleRender();
    if (!dragging)
        scheduleHashWrite();
}

let renderTimings = { };

function render() {
    let last = performance.now();
    const start = last;
    renderTimings = { fit: 0, boxes: 0, stats: 0, overlay: 0, plot: 0, sheet: 0, numbers: 0, controls: 0 };
    const time = name => {
        const now = performance.now();
        renderTimings[name] += now - last;
        last = now;
    };
    const { width, height } = state;
    const dpr = window.devicePixelRatio || 1;
    renderBackdrop();
    selected = clamp(selected, 0, state.stops.length - 1);

    const css = cssText();
    $("output").value = `background-image: ${css};`;

    if (!viewAvailable(state.view))
        state.view = "gradient";
    requestedView = state.view;
    splines = Object.fromEntries(state.models.map(model => [model, fitSpline(model)]));
    influences = state.view !== "influence" ? { } : Object.fromEntries(state.models.map(model => [model, fitSpline(model, selected)]));
    currentSpline = splines[state.model];
    time("fit");

    for (const view of views) {
        view.figure.hidden = !state.models.includes(view.model);
        if (!view.figure.hidden)
            renderView(view, dpr);
    }
    time("boxes");

    // Only said while WebGPU is starting, or if it can't draw.
    $("gpuStatus").hidden = !!gpuRenderer && !gpuError;
    $("gpuStatus").textContent = gpuError ? `WebGPU: ${gpuError}` : "WebGPU: starting…";
    $("gpuStatus").className = gpuError ? "status error" : "status";

    updateMargin(width, height);
    for (const view of views) {
        if (view.figure.hidden)
            continue;
        time("boxes");
        updateStats(view);
        time("stats");
        view.plot.hidden = view.plotNote.hidden = !state.crossSection;
        view.sheet.hidden = !state.sheet;
        view.numbers.hidden = !state.numbers;
        asView(view, () => {
            drawOverlay(view, width, height, dpr);
            time("overlay");
            drawPlot();
            time("plot");
            drawSheet({ recompute: true });
            time("sheet");
            updateCoefficients();
            time("numbers");
        });
    }
    updateControls();
    updateNumbersTable();
    time("controls");
    renderTimings.total = performance.now() - start;
    if (lastSamplePosition)
        showSample(lastSamplePosition, lastSamplePosition.view);
}

function renderView(view, dpr) {
    const { width, height } = state;
    view.stage.style.width = `${width}px`;
    view.stage.style.height = `${height}px`;
    view.figure.querySelector(".modelNote").textContent = MODEL_NOTES[view.model];
    // The sources hold links to the papers, so they're HTML.
    view.figure.querySelector(".modelSource").innerHTML = MODEL_SOURCES[view.model];
    view.figure.querySelector(".modelSpec").textContent = MODEL_SPECS[view.model];
    for (const [selector, list] of [[".modelPros", MODEL_PROS], [".modelCons", MODEL_CONS]]) {
        const element = view.figure.querySelector(selector);
        if (element.children.length !== list[view.model].length)
            element.replaceChildren(...list[view.model].map(text => Object.assign(document.createElement("li"), { textContent: text })));
    }
    view.figure.querySelector(".modelAbout").open = state.about;
    view.figure.querySelector(".modelSummary").textContent = MODEL_SUMMARIES[view.model];
    const fit = splines[view.model];
    // The parts of the spline are shown in its box, when the Visualize panel shows it.
    const viewName = state.view === "difference" || state.view === "grid" ? "gradient" : view.model === "spline" || state.view === "influence" ? state.view : "gradient";
    const comparing = state.view === "difference" && view.model !== referenceModel();
    view.diff.hidden = !comparing;
    if (comparing)
        drawDifference(view);
    const shownSpline = viewName === "gradient" ? fit : viewName === "influence" ? influences[view.model] : viewSpline(fit);
    const message = view.message;
    message.style.display = "none";
    const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
    if (view.gpu.width !== pixelWidth || view.gpu.height !== pixelHeight) {
        view.gpu.width = pixelWidth;
        view.gpu.height = pixelHeight;
    }
    if (viewName === "basis" && !shownSpline.centers.length) {
        message.textContent = "A later stop is at the same position as this one, so this one has no term.";
        message.style.display = "flex";
        gpuRenderer?.render(view.gpu, { ...shownSpline, polynomial: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] }, pixelWidth / width);
    } else if (gpuRenderer)
        gpuRenderer.render(view.gpu, shownSpline, pixelWidth / width, viewName === "basis" ? 1 : viewName === "influence" ? 2 : 0);
    else {
        message.textContent = gpuError ? `WebGPU: ${gpuError}` : "Starting WebGPU…";
        message.style.display = "flex";
    }
}

// How far a model's colors go past the stops' colors, and how much of the box is outside the chosen gamut, from a grid
// of samples. Going past is measured in Oklab: how much lighter than the lightest stop, darker than the darkest, or
// more colorful than the most colorful any point is. Nearly transparent points, whose colors barely show, are left out.
const STATS_COLUMNS = 64;
function gamutStats(fit) {
    const hueIndex = fit.hueIndex;
    const oklab = color => fromXYZ("oklab", toXYZ(state.space, color.slice(0, 3).map(v => Number.isNaN(v) ? 0 : v)));
    const stopColors = fit.points.map(point => oklab(unpremultipliedColor(point.color, hueIndex)));
    const lightest = Math.max(...stopColors.map(c => c[0])), darkest = Math.min(...stopColors.map(c => c[0]));
    const mostColorful = Math.max(...stopColors.map(c => Math.hypot(c[1], c[2])));
    const outputSpace = state.gamut;
    // Coarser while dragging, to keep up.
    const columns = drag ? STATS_COLUMNS / 2 : STATS_COLUMNS, rows = Math.max(1, Math.round(columns * state.height / state.width));
    const clipped = new Uint8Array(columns * rows);
    let lighter = 0, darker = 0, moreColorful = 0, worst = 0, worstPoint = null, clippedCount = 0;
    for (let j = 0; j < rows; ++j) {
        for (let i = 0; i < columns; ++i) {
            const position = [(i + 0.5) / columns * state.width, (j + 0.5) / rows * state.height];
            const raw = interpolatedColor(fit, position);
            const color = unpremultipliedColor(raw, hueIndex);
            if (color[3] >= 0.05) {
                const [L, a, b] = oklab(color);
                const past = [L - lightest, darkest - L, Math.hypot(a, b) - mostColorful];
                lighter = Math.max(lighter, past[0]);
                darker = Math.max(darker, past[1]);
                moreColorful = Math.max(moreColorful, past[2]);
                const furthest = Math.max(...past);
                if (furthest > worst) {
                    worst = furthest;
                    worstPoint = position;
                }
            }
            const rgb = fromXYZ(outputSpace, toXYZ(state.space, color.slice(0, 3).map(v => Number.isNaN(v) ? 0 : v)));
            const epsilon = 1 / 1024;
            if (raw[3] < -epsilon || raw[3] > 1 + epsilon || rgb.some(v => v < -epsilon || v > 1 + epsilon)) {
                clipped[j * columns + i] = 1;
                ++clippedCount;
            }
        }
    }
    return { lighter, darker, moreColorful, worst, worstPoint, clippedFraction: clippedCount / (columns * rows), clipped, columns, rows, outputSpace };
}

// Less than this in Oklab is too little to see, and is reported as staying within the stops' colors.
const PAST_THRESHOLD = 0.005;

function updateStats(view) {
    view.stats = gamutStats(splines[view.model]);
}

// The models side by side, in a table under Visualize when Numbers is on.
function numbersTable() {
    const shown = views.filter(view => !view.figure.hidden && view.stats);
    const gamut = GAMUT_NAMES[state.gamut];
    const past = ({ lighter, darker, moreColorful }) => {
        const parts = [];
        if (lighter > PAST_THRESHOLD)
            parts.push(`${lighter.toFixed(2)} lighter`);
        if (darker > PAST_THRESHOLD)
            parts.push(`${darker.toFixed(2)} darker`);
        if (moreColorful > PAST_THRESHOLD)
            parts.push(`${moreColorful.toFixed(2)} more colorful`);
        return parts.length ? parts.join(", ") : "no";
    };
    const percent = value => value < 0.001 ? "none" : value < 0.005 ? "under 1%" : `${Math.round(value * 100)}%`;
    const rows = [
        ["Goes past the stops' colors (Oklab)", shown.map(view => past(view.stats))],
        [`Outside ${gamut} (${state.gamutMapping === "map" ? "gamut mapped" : "clipped"})`, shown.map(view => `${percent(view.stats.clippedFraction)} of the box`)],
    ];
    if (state.view === "difference") {
        rows.push([`Differs from the ${MODEL_NAMES[referenceModel()].toLowerCase()} (ΔE OK, average / largest)`,
            shown.map(view => view.model === referenceModel() || !view.difference ? "—" : `${view.difference.mean.toFixed(3)} / ${view.difference.largest.toFixed(3)}`)]);
    }
    return { header: ["", ...shown.map(view => MODEL_NAMES[view.model])], rows: rows.map(([label, cells]) => [label, ...cells]) };
}

function updateNumbersTable() {
    const panel = $("numbersPanel");
    panel.hidden = !state.numbers;
    if (!state.numbers)
        return;
    const { header, rows } = numbersTable();
    const cells = (row, tag) => row.map(cell => `<${tag}>${escapeHTML(cell)}</${tag}>`).join("");
    $("numbersTable").innerHTML = `<thead><tr>${cells(header, "th")}</tr></thead><tbody>${rows.map(row => `<tr>${cells(row, "td")}</tr>`).join("")}</tbody>`;
}


const GAMUT_NAMES = { "srgb": "sRGB", "display-p3": "Display P3", "rec2020": "Rec. 2020" };

// The boxes share one size and margin, scaled down together to fit side by side, or one above another on a narrow
// screen.
function updateMargin(width, height) {
    const scroller = $("stageScroller");
    const count = state.models.length;
    const narrow = narrowScreen.matches;
    const perRow = narrow ? 1 : count;
    const gap = 16;
    const cellWidth = Math.max(100, (scroller.clientWidth - gap * (perRow - 1)) / perRow);
    margin = { x: narrow || count > 1 ? NARROW_MARGIN : MIN_MARGIN, y: narrow || count > 1 ? NARROW_MARGIN : MIN_MARGIN };
    viewScale = Math.min(1, cellWidth / (width + 2 * margin.x));
    const boxWidth = Math.floor((width + 2 * margin.x) * viewScale), boxHeight = Math.floor((height + 2 * margin.y) * viewScale);
    for (const view of views) {
        view.box.style.width = `${boxWidth}px`;
        view.box.style.height = `${boxHeight}px`;
        view.details.style.width = `${Math.max(boxWidth, 260)}px`;
        view.wrap.style.padding = `${margin.y}px ${margin.x}px`;
        view.wrap.style.transform = viewScale < 1 ? `scale(${viewScale})` : "";
    }
    scroller.style.height = "";
}

// MARK: - Overlay

__OVERLAY_HELPERS__

function drawOverlay(view, width, height, dpr) {
    const { overlay } = view;
    const cssWidth = width + 2 * margin.x, cssHeight = height + 2 * margin.y;
    overlay.style.left = `${-margin.x}px`;
    overlay.style.top = `${-margin.y}px`;
    overlay.style.width = `${cssWidth}px`;
    overlay.style.height = `${cssHeight}px`;
    const visualizing = state.normalization || state.crossSection || state.view === "term" || state.view === "basis" || state.clipping || requestedView === "grid" || state.numbers;
    const discs = view.model !== "spline" && state.overlay;
    overlay.style.display = state.overlay || visualizing ? "" : "none";
    // With the stops hidden, they can't be dragged, and the box can still be sampled.
    overlay.style.pointerEvents = state.overlay ? "" : "none";
    if (overlay.width !== Math.round(cssWidth * dpr) || overlay.height !== Math.round(cssHeight * dpr)) {
        overlay.width = Math.round(cssWidth * dpr);
        overlay.height = Math.round(cssHeight * dpr);
    }
    const ctx = view.overlayContext;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    if (state.clipping && view.stats && requestedView === "gradient")
        drawClipping(ctx, view.stats, width, height);
    if (state.numbers && requestedView === "gradient" && view.stats?.worstPoint && view.stats.worst > PAST_THRESHOLD)
        drawWorstOvershoot(ctx, view.stats.worstPoint);
    if (requestedView === "grid" && splines[view.model]?.grid)
        drawGridTexels(ctx, splines[view.model].grid);
    if (visualizing)
        drawVisualization(ctx, width, height);
    if (!state.overlay)
        return;

    if (discs) {
        // The discs the grid holds, where they're big enough to see.
        for (const stop of state.stops) {
            const radius = discRadius(stop);
            if (radius < 4)
                continue;
            const [x, y] = toOverlay(stop.pos);
            strokeTwice(ctx, () => {
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, 2 * Math.PI);
            }, [3, 3]);
        }
    }

    // The box, so stops outside it are clearly outside.
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(margin.x + 0.5, margin.y + 0.5, width - 1, height - 1);
    ctx.setLineDash([]);

    const accent = "#0a84ff";
    // The boxes may be scaled down to fit side by side; the stops stay big enough to see and grab.
    const markerScale = Math.min(2, 1 / viewScale);
    state.stops.forEach((stop, index) => {
        const isSelected = index === selected;
        const [x, y] = toOverlay(stop.pos);
        const radius = (isSelected ? 10 : 8) * markerScale;
        // A checkerboard under the color, so a translucent stop shows as such.
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.clip();
        ctx.fillStyle = "#fff";
        ctx.fillRect(x - radius, y - radius, 2 * radius, 2 * radius);
        ctx.fillStyle = "#ccc";
        for (let i = 0; i < 2; ++i) {
            for (let j = 0; j < 2; ++j) {
                if ((i + j) % 2)
                    ctx.fillRect(x - radius + i * radius, y - radius + j * radius, radius, radius);
            }
        }
        ctx.fillStyle = parseColor(stop.color) ? stop.color : "#000";
        ctx.fill();
        ctx.restore();
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.lineWidth = 3 * markerScale;
        ctx.strokeStyle = isSelected ? accent : "#ffffff";
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, radius + 2 * markerScale, 0, 2 * Math.PI);
        ctx.lineWidth = markerScale;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
        ctx.stroke();
    });
}

// A ring where a model's colors go furthest past the stops'.
function drawWorstOvershoot(ctx, [px, py]) {
    const x = margin.x + px, y = margin.y + py, radius = 7 / Math.max(viewScale, 0.25);
    strokeTwice(ctx, () => {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.moveTo(x - radius * 1.6, y);
        ctx.lineTo(x - radius * 0.6, y);
        ctx.moveTo(x + radius * 0.6, y);
        ctx.lineTo(x + radius * 1.6, y);
        ctx.moveTo(x, y - radius * 1.6);
        ctx.lineTo(x, y - radius * 0.6);
        ctx.moveTo(x, y + radius * 0.6);
        ctx.lineTo(x, y + radius * 1.6);
    });
    drawLabel(ctx, "furthest past the stops", x, y + radius * 2.6);
}

// Diagonal hatching over the samples that are clipped.
function drawClipping(ctx, stats, width, height) {
    const cellWidth = width / stats.columns, cellHeight = height / stats.rows;
    ctx.save();
    ctx.beginPath();
    for (let j = 0; j < stats.rows; ++j) {
        for (let i = 0; i < stats.columns; ++i) {
            if (stats.clipped[j * stats.columns + i])
                ctx.rect(margin.x + i * cellWidth, margin.y + j * cellHeight, cellWidth + 0.5, cellHeight + 0.5);
        }
    }
    ctx.clip();
    const spacing = 8 / Math.max(viewScale, 0.25);
    ctx.lineWidth = 2 / Math.max(viewScale, 0.25);
    for (const [color, offset] of [["rgba(0, 0, 0, 0.6)", 0], ["rgba(255, 255, 255, 0.8)", spacing / 2]]) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        for (let d = -height + offset; d < width + height; d += spacing) {
            ctx.moveTo(margin.x + d, margin.y);
            ctx.lineTo(margin.x + d + height, margin.y + height);
        }
        ctx.stroke();
    }
    ctx.restore();
}

// The index of the stop at (x, y), or -1. `slop` scales the distance a stop can be from (x, y) and still be hit.
function hitTest(x, y, slop = 1) {
    let best = -1, bestDistance = Infinity;
    state.stops.forEach((stop, index) => {
        const [sx, sy] = toOverlay(stop.pos);
        const distance = Math.hypot(sx - x, sy - y);
        if (distance <= 12 * slop && distance <= bestDistance) {
            best = index;
            bestDistance = distance;
        }
    });
    return best;
}

let drag = null;

// The pointer's position on the overlay, in the stage's own coordinates.
function overlayPosition(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    return [(event.clientX - rect.left) / viewScale, (event.clientY - rect.top) / viewScale];
}

// Fingers cover more than a mouse pointer, and the stage may be drawn smaller than its own size.
const hitSlop = event => (event.pointerType === "mouse" ? 1 : 2.5) / viewScale;

// Starts dragging the stop under the pointer, if there is one.
function beginDrag(event) {
    const [x, y] = overlayPosition(event);
    const hit = hitTest(x, y, hitSlop(event));
    if (hit < 0)
        return false;
    event.preventDefault();
    try {
        event.currentTarget.setPointerCapture(event.pointerId);
    } catch { }
    selected = hit;
    drag = { pointerId: event.pointerId, start: fromOverlay(x, y), startPosition: state.stops[hit].pos.slice() };
    event.currentTarget.style.cursor = "grabbing";
    scheduleRender();
    return true;
}

// The mouse buttons held as of the last pointer event anywhere on the page. After a <select>'s menu closes, WebKit
// still thinks the button that opened it is down, since the menu took the mouse up, so the next press comes as a
// pointermove with a button newly held instead of a pointerdown.
let lastMouseButtons = 0;
for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
    document.addEventListener(type, event => {
        if (event.pointerType === "mouse")
            lastMouseButtons = event.buttons;
    });
}

for (const { overlay } of views) {
overlay.addEventListener("pointerdown", beginDrag);

overlay.addEventListener("pointermove", event => {
    if (!drag && event.pointerType === "mouse" && (event.buttons & 1) && !(lastMouseButtons & 1) && beginDrag(event))
        return;
    const [x, y] = overlayPosition(event);
    if (!drag || drag.pointerId !== event.pointerId) {
        event.currentTarget.style.cursor = hitTest(x, y, hitSlop(event)) >= 0 ? "grab" : "default";
        return;
    }
    event.currentTarget.style.cursor = "grabbing";
    const p = fromOverlay(x, y);
    const position = [drag.startPosition[0] + p[0] - drag.start[0], drag.startPosition[1] + p[1] - drag.start[1]];
    state.stops[selected].pos = round2Point(clampedToReach(position));
    changed();
});

function endDrag(event) {
    if (drag && drag.pointerId === event.pointerId) {
        drag = null;
        event.currentTarget.style.cursor = "grab";
        writeHash();
    }
}
overlay.addEventListener("pointerup", endDrag);
overlay.addEventListener("pointercancel", endDrag);
overlay.addEventListener("lostpointercapture", endDrag);
}

// Adds a stop with the color already there, so the colors change as little as they can.
function addStop(position) {
    const stopPosition = round2Point(clampedToReach(position));
    state.stops.push(makeStop(colorAt(stopPosition), ...stopPosition));
    selected = state.stops.length - 1;
    changed();
}

for (const { overlay } of views) {
    overlay.addEventListener("dblclick", event => {
        const [x, y] = overlayPosition(event);
        if (hitTest(x, y, hitSlop(event)) < 0)
            addStop(fromOverlay(x, y));
    });
}

function removeSelectedStop() {
    if (state.stops.length < 2)
        return;
    state.stops.splice(selected, 1);
    selected = Math.min(selected, state.stops.length - 1);
    changed();
}

document.addEventListener("keydown", event => {
    if ((event.key !== "Delete" && event.key !== "Backspace") || event.metaKey || event.ctrlKey || event.altKey)
        return;
    if (event.target.closest?.("input, select, textarea"))
        return;
    event.preventDefault();
    removeSelectedStop();
});

// MARK: - Visualize

// The spline that the chosen view shows: all of it, its linear part, or its linear part and the selected stop's term.
let currentSpline = null;
let activeView = null;
// The view chosen in the Show menu, before asView() narrows it to what one box can show.
let requestedView = "gradient";

// The model the difference view compares with: the one chosen, if it's on.
const referenceModel = () => state.models.includes(state.reference) ? state.reference : state.models[0];

// White where a model agrees with the one compared with, purple where it differs, from a grid of samples.
// CSS gamut mapping, https://drafts.csswg.org/css-color-4/#binsearch: an OKLab color mapped into an RGB space's gamut,
// returned as that space's linear components. Equivalent to gamutMappedLinear() in the shader.
function gamutMappedLinear(origin, space) {
    const JND = 0.02, EPSILON = 0.0001;
    const toLinear = lab => {
        const rgb = fromXYZ(space, toXYZ("oklab", lab));
        return rgb.map(v => Math.sign(v) * (space === "rec2020" ? Math.abs(v) ** 2.4 : srgbLinearOf(Math.abs(v))));
    };
    const linearToOKLab = rgb => fromXYZ("oklab", toXYZ(space, rgb.map(v => Math.sign(v) * (space === "rec2020" ? Math.abs(v) ** (1 / 2.4) : srgbEncodedOf(Math.abs(v))))));
    const inGamut = rgb => rgb.every(v => v >= -1e-5 && v <= 1 + 1e-5);
    const clip = rgb => rgb.map(v => clamp(v, 0, 1));
    const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (origin[0] >= 1)
        return [1, 1, 1];
    if (origin[0] <= 0)
        return [0, 0, 0];
    const originRGB = toLinear(origin);
    if (inGamut(originRGB))
        return originRGB;
    let clipped = clip(originRGB);
    if (distance(linearToOKLab(clipped), origin) < JND)
        return clipped;
    const chroma = Math.hypot(origin[1], origin[2]);
    const direction = [origin[1] / chroma, origin[2] / chroma];
    let low = 0, high = chroma, lowInGamut = true;
    while (high - low > EPSILON) {
        const middle = (low + high) / 2;
        const current = [origin[0], direction[0] * middle, direction[1] * middle];
        const currentRGB = toLinear(current);
        if (lowInGamut && inGamut(currentRGB)) {
            low = middle;
            continue;
        }
        clipped = clip(currentRGB);
        const difference = distance(linearToOKLab(clipped), current);
        if (difference < JND) {
            if (JND - difference < EPSILON)
                return clipped;
            lowInGamut = false;
            low = middle;
        } else
            high = middle;
    }
    return clipped;
}

// The sRGB transfer function and its inverse, which Display P3 shares.
const srgbLinearOf = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const srgbEncodedOf = v => v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;

// A color as it's seen in an RGB space: clipped, or with gamut mapping chosen, mapped.
function seenColor({ space, c, alpha }, outputSpace) {
    if (state.gamutMapping !== "map")
        return toOutput({ space, c, alpha }, outputSpace);
    const lab = fromXYZ("oklab", toXYZ(space, c.map(v => Number.isNaN(v) ? 0 : v)));
    const linear = gamutMappedLinear(lab, outputSpace);
    const encoded = linear.map(v => clamp(outputSpace === "rec2020" ? v ** (1 / 2.4) : srgbEncodedOf(v), 0, 1));
    return [...encoded, Number.isNaN(alpha) ? 0 : alpha];
}

function drawDifference(view) {
    const reference = referenceModel();
    const fit = splines[view.model], other = splines[reference];
    const columns = drag ? 60 : 150, rows = Math.max(1, Math.round(columns * state.height / state.width));
    const canvas = view.diff;
    if (canvas.width !== columns || canvas.height !== rows) {
        canvas.width = columns;
        canvas.height = rows;
    }
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(columns, rows);
    // What's seen: each color clipped to the gamut the clipping is measured against, in Oklab, with its alpha.
    const oklab = (color, hueIndex) => {
        const c = unpremultipliedColor(color, hueIndex);
        const rgb = seenColor({ space: state.space, c: c.slice(0, 3), alpha: c[3] }, state.gamut);
        return [...fromXYZ("oklab", toXYZ(state.gamut, rgb.slice(0, 3))), clamp(c[3], 0, 1)];
    };
    let total = 0, largest = 0;
    for (let j = 0; j < rows; ++j) {
        for (let i = 0; i < columns; ++i) {
            const p = [(i + 0.5) / columns * state.width, (j + 0.5) / rows * state.height];
            const a = oklab(interpolatedColor(fit, p), fit.hueIndex), b = oklab(interpolatedColor(other, p), other.hueIndex);
            // A color matters as much as it shows, so the colors' difference is scaled by their alpha.
            const alpha = (a[3] + b[3]) / 2;
            const difference = Math.hypot(alpha * (a[0] - b[0]), alpha * (a[1] - b[1]), alpha * (a[2] - b[2]), a[3] - b[3]);
            total += difference;
            largest = Math.max(largest, difference);
            const t = Math.sqrt(clamp(difference / 0.15, 0, 1));
            const o = (j * columns + i) * 4;
            image.data[o] = 255 + (90 - 255) * t;
            image.data[o + 1] = 255 + (25 - 255) * t;
            image.data[o + 2] = 255 + (140 - 255) * t;
            image.data[o + 3] = 255;
        }
    }
    ctx.putImageData(image, 0, 0);
    view.difference = { reference, mean: total / (columns * rows), largest };
}

// The grid a grid model is solved on, and the texels its stops hold, outlined in their colors.
function drawGridTexels(ctx, grid) {
    const { factor } = grid;
    const x0 = margin.x + factor.origin[0], y0 = margin.y + factor.origin[1];
    const [w, h] = factor.texel;
    ctx.save();
    ctx.lineWidth = 1 / Math.max(viewScale, 0.25);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.18)";
    ctx.beginPath();
    for (let x = 0; x <= factor.columns; ++x) {
        ctx.moveTo(x0 + x * w, y0);
        ctx.lineTo(x0 + x * w, y0 + factor.rows * h);
    }
    for (let y = 0; y <= factor.rows; ++y) {
        ctx.moveTo(x0, y0 + y * h);
        ctx.lineTo(x0 + factor.columns * w, y0 + y * h);
    }
    ctx.stroke();
    const points = splines[activeView.model].points;
    for (let y = 0; y < factor.rows; ++y) {
        for (let x = 0; x < factor.columns; ++x) {
            const k = factor.held[factor.index(x, y)];
            if (k < 0)
                continue;
            const stop = state.stops[points[k].stop];
            ctx.fillStyle = parseColor(stop.color) ? stop.color : "#000";
            ctx.fillRect(x0 + x * w, y0 + y * h, w, h);
            ctx.strokeStyle = "#fff";
            ctx.strokeRect(x0 + x * w + 0.5, y0 + y * h + 0.5, w - 1, h - 1);
        }
    }
    ctx.restore();
}

// Runs `body` with the visualization code pointed at one model's box: its fit, its canvases, and the spline's parts
// only for the spline.
function asView(view, body) {
    const saved = { model: state.model, view: state.view, spline: currentSpline, active: activeView };
    state.model = view.model;
    if (state.view === "difference" || state.view === "grid" || (view.model !== "spline" && state.view !== "influence"))
        state.view = "gradient";
    currentSpline = splines[view.model];
    activeView = view;
    try {
        return body();
    } finally {
        state.model = saved.model;
        state.view = saved.view;
        currentSpline = saved.spline;
        activeView = saved.active;
    }
}

function drawSheets() {
    for (const view of views) {
        if (!view.figure.hidden)
            asView(view, () => drawSheet());
    }
}

function selectedCenter(spline) {
    return spline.centers.find(center => center.stop === selected) ?? null;
}

function viewSpline(spline) {
    switch (state.view) {
    case "influence":
        return influences[state.model] ?? spline;
    case "plane":
        return { ...spline, centers: [] };
    case "term":
    case "basis": {
        const center = selectedCenter(spline);
        return { ...spline, centers: center ? [center] : [] };
    }
    default:
        return spline;
    }
}

const COMPONENT_LABELS = {
    "xyz-d50": ["x", "y", "z"], "xyz-d65": ["x", "y", "z"],
    lab: ["L", "a", "b"], lch: ["L", "C", "h"], oklab: ["L", "a", "b"], oklch: ["L", "C", "h"],
    hsl: ["h", "s", "l"], hwb: ["h", "w", "b"],
};
// Each component's usual range, so they can share a graph.
const COMPONENT_RANGES = {
    lab: [[0, 100], [-125, 125], [-125, 125]], lch: [[0, 100], [0, 150], [0, 360]],
    oklab: [[0, 1], [-0.4, 0.4], [-0.4, 0.4]], oklch: [[0, 1], [0, 0.4], [0, 360]],
    hsl: [[0, 360], [0, 100], [0, 100]], hwb: [[0, 360], [0, 100], [0, 100]],
};
const COMPONENT_COLORS = ["#e5484d", "#30a46c", "#0090ff", "#8e8e93"];

function components() {
    const labels = COMPONENT_LABELS[state.space] ?? ["r", "g", "b"];
    const ranges = COMPONENT_RANGES[state.space] ?? [[0, 1], [0, 1], [0, 1]];
    return [...labels.map((label, k) => ({ label, range: ranges[k] })), { label: "α", range: [0, 1] }];
}

const normalizedComponent = (value, range) => (value - range[0]) / (range[1] - range[0]);

// U(r) around the center, as radialBasisColor() in the shader colors it.
function radialBasisDisplayColor(u) {
    const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
    return u < 0 ? mix([1, 1, 1], [0.16, 0.42, 0.95], clamp(-u * 2 * Math.E, 0, 1)) : mix([1, 1, 1], [0.95, 0.45, 0.1], 1 - Math.exp(-u));
}

// A stop's influence, as influenceColor() in the shader colors it.
function influenceDisplayColor(value) {
    const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
    if (value < 0)
        return mix([1, 1, 1], [0.16, 0.42, 0.95], clamp(-value * 4, 0, 1));
    if (value <= 1)
        return mix([1, 1, 1], [0.95, 0.45, 0.1], value);
    return mix([0.95, 0.45, 0.1], [0.45, 0.05, 0.05], clamp((value - 1) * 4, 0, 1));
}

function radialBasisAt(spline, center, [px, py]) {
    const x = (px - spline.origin[0]) / spline.scale - center.position[0], y = (py - spline.origin[1]) / spline.scale - center.position[1];
    return radialBasis(x * x + y * y);
}

function signed(value, digits) {
    const text = Math.abs(value) < 0.5 * 10 ** -digits ? (0).toFixed(digits) : value.toFixed(digits);
    return value < 0 && !text.match(/^-?0\.?0*$/) ? text : ` ${text.replace(/^-/, "")}`;
}

// Digits for a component, by its range.
const digitsFor = range => range[1] - range[0] >= 50 ? 2 : 3;

function escapeHTML(text) {
    return text.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
}

function swatchHTML(stopIndex, large = false) {
    const color = state.stops[stopIndex]?.color ?? "black";
    return `<span class="swatch${large ? " large" : ""}" style="background: ${escapeHTML(color)}"></span>`;
}

const linearPartText = spline => spline.terms.length === 3 ? "a + b·x + c·y" : spline.terms.length === 2 ? "a + b·t" : "a";

function drawLabel(ctx, text, x, y, align = "center") {
    ctx.font = "600 11px -apple-system, system-ui, sans-serif";
    const width = ctx.measureText(text).width + 12;
    const left = align === "left" ? x : align === "right" ? x - width : x - width / 2;
    ctx.fillStyle = "rgba(29, 29, 31, 0.85)";
    ctx.beginPath();
    ctx.roundRect(left, y - 9, width, 18, 9);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(text, left + 6, y + 0.5);
}

// A line that shows on light and dark colors: white under dark.
function strokeTwice(ctx, path, dash = []) {
    ctx.setLineDash(dash);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
    path();
    ctx.stroke();
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
    path();
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawVisualization(ctx, width, height) {
    const spline = currentSpline;
    const toCanvas = ([px, py]) => [margin.x + px, margin.y + py];
    const fromNormalized = ([x, y]) => toCanvas([spline.origin[0] + x * spline.scale, spline.origin[1] + y * spline.scale]);

    if (state.crossSection) {
        const y = margin.y + state.row / 100 * height;
        strokeTwice(ctx, () => {
            ctx.beginPath();
            ctx.moveTo(margin.x, y);
            ctx.lineTo(margin.x + width, y);
        }, [6, 4]);
        drawLabel(ctx, "cross-section", margin.x + 6, y - 14, "left");
    }

    if (state.normalization && state.model === "spline") {
        const [cx, cy] = fromNormalized([0, 0]);
        for (const center of spline.centers) {
            const [x, y] = fromNormalized(center.position);
            strokeTwice(ctx, () => {
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(x, y);
            }, [2, 3]);
        }
        strokeTwice(ctx, () => {
            ctx.beginPath();
            ctx.arc(cx, cy, spline.scale, 0, 2 * Math.PI);
        }, [6, 4]);
        if (spline.terms.length === 2) {
            // Stops on a line: the linear part only changes along it.
            const [, dx, dy] = spline.terms[1];
            const reach = Math.hypot(width, height) + Math.hypot(margin.x, margin.y);
            strokeTwice(ctx, () => {
                ctx.beginPath();
                ctx.moveTo(cx - dx * reach, cy - dy * reach);
                ctx.lineTo(cx + dx * reach, cy + dy * reach);
            });
            drawLabel(ctx, "t", cx + dx * spline.scale * 0.5 + 12, cy + dy * spline.scale * 0.5 - 12);
        }
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#fff";
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        drawLabel(ctx, "(0, 0)", cx, cy + 18);
        drawLabel(ctx, "distance 1", cx, cy - spline.scale);
    }

    if (state.view === "term" || state.view === "basis") {
        const center = selectedCenter(spline);
        if (center) {
            const [x, y] = fromNormalized(center.position);
            strokeTwice(ctx, () => {
                ctx.beginPath();
                ctx.arc(x, y, spline.scale, 0, 2 * Math.PI);
            }, [3, 3]);
            drawLabel(ctx, "r = 1, where U(r) = 0", x, y + spline.scale);
            if (state.view === "term") {
                const weights = components().map(({ label, range }, k) => `${label} ${signed(center.weight[k], digitsFor(range)).trim()}`);
                drawLabel(ctx, `w = ${weights.join(", ")}`, x, y - 24);
            }
        }
    }
}

const VIEW_NOTES = {
    difference: "Each box except the one you compare with turns white where the two models agree and purple where they differ. It's darkest at a difference of 0.15 in Oklab (ΔE OK) or more. Differences under about 0.02 are hard to see. Colors are compared as they're seen, fitted to the chosen gamut and weighted by alpha.",
    grid: "The grid each grid model is solved on, with the texels the stops fix outlined in their colors. Every other texel is worked out from those. In the harmonic grid, each one is the average of its four neighbors. In the biharmonic grid, each one's Laplacian is the average of its neighbors' Laplacians. The thin-plate spline has no grid.",
    influence: "Every model mixes the stops' colors in fixed proportions, so each point's color is a weighted sum of them. This shows the selected stop's weight. It's orange where the stop adds its color, white where it adds none, blue where it takes color away, and dark red above 1. The thin-plate spline's weight goes negative and keeps growing outside the box. The biharmonic grid's has negative patches too and can go above 1, but it ends at the box's edges. The harmonic grid's stays between 0 and 1.",
    gradient: "The gradient each model draws from the same stops.",
    plane: "The thin-plate spline is f(p) = a + b·x + c·y + Σ wᵢ·U(|p − pᵢ|) for each component. The weights wᵢ and a, b and c are solved together, so f matches each stop's color at its position. This view shows only the linear part, a + b·x + c·y. It's the tilt that the stops' terms are added to, and on its own it reaches few of the stops' colors.",
    term: "The linear part plus only the selected stop's term, wᵢ·U(r). Where the weight is positive, the term lowers that component near the stop and raises it far away. Where it's negative, it does the opposite. It changes sign at r = 1, the dashed circle, because U(1) = 0.",
    basis: "U(r) = r²·log r is the shape a thin plate takes when you push it at one point. Every stop's term is this shape, centered on the stop and scaled by its weights. It's 0 at the stop and at r = 1, the dashed circle. It dips below 0 in between (blue) and grows past r = 1 (orange). r is in normalized units.",
};

// Which models each Show view is for. The others' boxes show the gradient.
const VIEW_MODELS = {
    gradient: MODELS, influence: MODELS, difference: MODELS,
    grid: ["biharmonic", "harmonic"],
    plane: ["spline"], term: ["spline"], basis: ["spline"],
};

// A view is offered when a model it's for is on, and the difference view when there's another model to compare with.
function viewAvailable(view) {
    if (view === "difference")
        return state.models.length > 1;
    return VIEW_MODELS[view].some(model => state.models.includes(model));
}

function updateVisualizationControls() {
    for (const option of $("view").options)
        option.disabled = !viewAvailable(option.value);
    $("view").value = state.view;
    const reference = $("reference");
    if ([...reference.options].map(option => option.value).join() !== state.models.join())
        reference.replaceChildren(...state.models.map(model => new Option(MODEL_NAMES[model], model)));
    reference.value = referenceModel();
    $("referenceRow").hidden = state.view !== "difference";
    let note = VIEW_NOTES[state.view];
    const others = state.models.filter(model => !VIEW_MODELS[state.view].includes(model));
    if (others.length)
        note += ` ${others.map(model => `the ${MODEL_NAMES[model].toLowerCase()}'s`).join(" and ").replace(/^t/, "T")} box${others.length > 1 ? "es show" : " shows"} the gradient.`;
    $("normalizationRow").hidden = !state.models.includes("spline");
    $("otherCurvesRow").hidden = state.models.length < 2 || !["gradient", "influence"].includes(state.view);
    $("viewNote").textContent = note;
    for (const [id, key] of VISUALIZATION_TOGGLES)
        $(id).checked = state[key];
    $("sampleNote").hidden = !state.sample;
    $("crossSectionPanel").hidden = !state.crossSection;
    $("sheetPanel").hidden = !state.sheet;
    // Hatching is over the gradient, and the influence and U(r) views have one surface each, so no Height.
    const showingGradient = state.view === "gradient";
    $("clippingToggle").disabled = !showingGradient;
    $("clippingToggle").closest("label").title = showingGradient ? "" : "Only over the gradient";
    $("clippingNote").hidden = !state.clipping;
    $("clippingNote").textContent = showingGradient
        ? "Hatching marks where a box's colors fall outside the gamut chosen under Gamut, or where its alpha falls outside 0 to 1."
        : "The hatching is only drawn over the gradient.";
    $("sheetComponent").closest(".row").hidden = state.view === "influence" || state.view === "basis";
    $("sheetNote").textContent = (state.view === "influence"
        ? "The selected stop's influence as a surface over each box. Each stop is a peg at height 0, and the selected one is at 1."
        : state.view === "basis"
        ? "U(r) as a surface over the thin-plate spline's box. The other boxes show their components."
        : "Each component as a surface over each box, colored with the gradient. Each stop is a peg as tall as its value.") + " Drag any of them to turn them all.";
    $("gamut").value = state.gamut;
    $("gamutMapping").value = state.gamutMapping;
    const preset = matchingPreset();
    $("preset").value = preset < 0 ? "" : String(preset);
    $("presetNote").textContent = preset < 0 ? "" : PRESETS[preset].note ?? "";
    $("presetNote").hidden = !$("presetNote").textContent;
    $("crossSectionNote").textContent = state.view === "influence"
        ? "The selected stop's influence along the row. Dots are the stops on the row."
        : state.view === "basis"
        ? "U(r) along the row under the thin-plate spline's box. The other boxes show their components."
        : "Each component along the row, premultiplied. The dashed lines mark the ends of each component's range. Dots are the stops on the row.";
    $("row").value = state.row;
    $("rowValue").textContent = `${state.row}%`;
    $("tilt").value = Math.round(sheetTilt * 180 / Math.PI);

    const spline = splines.spline;
    const normalization = $("normalizationNote");
    normalization.hidden = !state.normalization || !spline;
    if (!normalization.hidden) {
        let text = `The spline is fitted after moving the stops so their center is at (0, 0), and scaling them so the farthest one is at a distance of 1, here ${+spline.scale.toFixed(1)}px. This doesn't change the result. It keeps the numbers in the solve a similar size.`;
        if (spline.terms.length === 2)
            text += " The stops are on a line, so the linear part is a + b·t along that line. A tilt across it couldn't be worked out.";
        else if (spline.terms.length === 1)
            text += " With only one stop, the linear part is a constant, a.";
        normalization.textContent = text;
    }

    const select = $("sheetComponent");
    const labels = [...components().map(component => component.label), "All"];
    if ([...select.options].map(option => option.text).join() !== labels.join()) {
        select.replaceChildren(...labels.map((label, k) => new Option(label, String(k))));
    }
    select.value = String(state.sheetComponent);
}

// MARK: Cross-section

function sizeCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx, width, height };
}

const CURVE_DASHES = { spline: [7, 3], biharmonic: [3, 2], harmonic: [1, 2.5] };

const isDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

function drawPlot() {
    if (!state.crossSection)
        return;
    const canvas = activeView.plot;
    const { ctx, width, height } = sizeCanvas(canvas);
    const spline = viewSpline(currentSpline);
    const ink = isDark() ? "255, 255, 255" : "0, 0, 0";
    const rowY = state.row / 100 * state.height;
    const left = 4, right = width - 4, top = 18, bottom = height - 6;
    const samples = Math.max(2, Math.round((right - left) / 2));
    const xAt = i => i / samples * state.width;
    const info = components();

    let curves, low, high;
    if (state.view === "influence") {
        curves = [{ color: `rgb(${ink})`, values: Array.from({ length: samples + 1 }, (_, i) => interpolatedColor(spline, [xAt(i), rowY])[0]) }];
        low = -0.15;
        high = 1.15;
        activeView.plotNote.innerHTML = `<span><b style="background: currentColor"></b>Stop ${selected + 1}'s influence, with dashed lines at 0 and 1</span>`;
    } else if (state.view === "basis") {
        const center = selectedCenter(currentSpline);
        curves = center ? [{ color: `rgb(${ink})`, values: Array.from({ length: samples + 1 }, (_, i) => radialBasisAt(spline, center, [xAt(i), rowY])) }] : [];
        low = -0.25;
        high = 1;
        activeView.plotNote.innerHTML = "<span><b style=\"background: currentColor\"></b>U(r) along the row. The dashed line is 0.</span>";
    } else {
        curves = info.map(({ range }, k) => ({
            color: COMPONENT_COLORS[k],
            values: Array.from({ length: samples + 1 }, (_, i) => normalizedComponent(interpolatedColor(spline, [xAt(i), rowY])[k], range)),
        }));
        low = -0.15;
        high = 1.15;
        activeView.plotNote.innerHTML = info.map(({ label, range }, k) => `<span><b style="background: ${COMPONENT_COLORS[k]}"></b>${escapeHTML(label)} ${range[0]}…${range[1]}</span>`).join("");
    }
    // The other models' curves, dashed, from the same row.
    const others = state.otherCurves && ["gradient", "influence"].includes(state.view) ? state.models.filter(model => model !== state.model) : [];
    for (const model of others) {
        if (state.view === "influence") {
            curves.push({ color: `rgb(${ink})`, dash: CURVE_DASHES[model], values: Array.from({ length: samples + 1 }, (_, i) => interpolatedColor(influences[model], [xAt(i), rowY])[0]) });
            continue;
        }
        info.forEach(({ range }, k) => curves.push({
            color: COMPONENT_COLORS[k],
            dash: CURVE_DASHES[model],
            values: Array.from({ length: samples + 1 }, (_, i) => normalizedComponent(interpolatedColor(splines[model], [xAt(i), rowY])[k], range)),
        }));
    }
    if (others.length) {
        const sample = model => `<svg width="22" height="6" style="vertical-align: middle"><line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" stroke-width="1.5" stroke-dasharray="${CURVE_DASHES[model].join(" ")}"/></svg>`;
        activeView.plotNote.innerHTML += "<br>" + others.map(model => `<span>${sample(model)} ${MODEL_NAMES[model]}</span>`).join("");
    }
    for (const curve of curves) {
        for (const value of curve.values) {
            low = Math.min(low, value);
            high = Math.max(high, value);
        }
    }
    low = Math.max(low, -2);
    high = Math.min(high, 3);
    const y = value => bottom - (value - low) / (high - low) * (bottom - top);
    const x = px => left + px / state.width * (right - left);

    ctx.strokeStyle = `rgba(${ink}, 0.3)`;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (const value of state.view === "basis" ? [0] : [0, 1]) {
        ctx.beginPath();
        ctx.moveTo(left, y(value));
        ctx.lineTo(right, y(value));
        ctx.stroke();
    }
    ctx.setLineDash([]);

    // Stops near the row.
    for (const center of currentSpline.centers) {
        const stop = state.stops[center.stop];
        const distance = Math.abs(stop.pos[1] - state.row);
        if (distance > 10)
            continue;
        const px = stop.pos[0] / 100 * state.width;
        ctx.globalAlpha = 1 - distance / 10;
        ctx.strokeStyle = `rgba(${ink}, 0.25)`;
        ctx.beginPath();
        ctx.moveTo(x(px), top - 8);
        ctx.lineTo(x(px), bottom);
        ctx.stroke();
        ctx.fillStyle = parseColor(stop.color) ? stop.color : "#000";
        ctx.beginPath();
        ctx.arc(x(px), 9, 5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = `rgba(${ink}, 0.5)`;
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (distance < 0.5 && state.view !== "basis" && state.view !== "influence") {
            info.forEach(({ range }, k) => {
                ctx.fillStyle = COMPONENT_COLORS[k];
                ctx.beginPath();
                ctx.arc(x(px), y(normalizedComponent(center.color[k], range)), 4, 0, 2 * Math.PI);
                ctx.fill();
            });
        }
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top - 10, width, bottom - top + 16);
    ctx.clip();
    for (const curve of [...curves].reverse()) {
        ctx.strokeStyle = curve.color;
        ctx.lineWidth = curve.dash ? 1.25 : 1.75;
        ctx.setLineDash(curve.dash ?? []);
        ctx.beginPath();
        curve.values.forEach((value, i) => i ? ctx.lineTo(x(xAt(i)), y(value)) : ctx.moveTo(x(xAt(i)), y(value)));
        ctx.stroke();
    }
    ctx.restore();
}

// MARK: Sample

let lastSamplePosition = null;

function hideSample() {
    lastSamplePosition = null;
    $("sample").style.display = "none";
}

function sampleHTML([px, py]) {
    const spline = viewSpline(currentSpline);
    const info = components();
    if (state.view === "influence") {
        const share = interpolatedColor(spline, [px, py])[0];
        return `(${px.toFixed(0)}, ${py.toFixed(0)})px\n${swatchHTML(selected)} stop ${selected + 1}'s share of the color here: ${share.toFixed(4)}`;
    }
    if (spline.grid) {
        const grid = spline.grid;
        const muted = text => `<span class="muted">${escapeHTML(text)}</span>`;
        const labelWidth = 17, columnWidth = 9;
        const row = (label, values) => escapeHTML(label) + " ".repeat(Math.max(1, labelWidth - label.length))
            + values.map((value, k) => signed(value, digitsFor(info[k].range)).padStart(columnWidth)).join("");
        const tx = (px - grid.origin[0]) / grid.texel[0] - 0.5, ty = (py - grid.origin[1]) / grid.texel[1] - 0.5;
        const total = gridColor(grid, [px, py]);
        const color = unpremultipliedColor(total, spline.hueIndex);
        return [
            `(${px.toFixed(0)}, ${py.toFixed(0)})px ${muted("→ texel")} (${tx.toFixed(2)}, ${ty.toFixed(2)}) ${muted(`of ${grid.columns}×${grid.rows}`)}`,
            "",
            muted(" ".repeat(labelWidth) + info.map(({ label }) => label.padStart(columnWidth)).join("")),
            row("= premultiplied", total),
            row("÷ clamped α", color),
            `<span class="swatch large" style="background: ${cssForDisplayColor(displayColor(color))}"></span> ${escapeHTML(state.space)}(${color.slice(0, 3).map((v, k) => signed(v, digitsFor(info[k].range)).trim()).join(" ")} / ${+color[3].toFixed(3)})`,
        ].join("\n");
    }
    const x = (px - spline.origin[0]) / spline.scale, y = (py - spline.origin[1]) / spline.scale;
    const lines = [];
    const muted = text => `<span class="muted">${escapeHTML(text)}</span>`;
    lines.push(`(${px.toFixed(0)}, ${py.toFixed(0)})px ${muted("→ normalized")} p = (${x.toFixed(3)}, ${y.toFixed(3)})`);

    if (state.view === "basis") {
        const center = selectedCenter(currentSpline);
        if (!center)
            return lines.join("\n");
        const dx = x - center.position[0], dy = y - center.position[1];
        const r = Math.hypot(dx, dy);
        lines.push(`${swatchHTML(center.stop)} r = |p − p${center.stop + 1}| = ${r.toFixed(3)}`);
        lines.push(`U(r) = r²·log r = ${radialBasis(r * r).toFixed(4)}`);
        return lines.join("\n");
    }

    const labelWidth = 17, columnWidth = 9;
    const row = (label, values, labelHTML = escapeHTML(label)) => labelHTML + " ".repeat(Math.max(1, labelWidth - label.length))
        + values.map((value, k) => (typeof value === "string" ? value : signed(value, digitsFor(info[k].range))).padStart(columnWidth)).join("");
    lines.push("");
    lines.push(muted(" ".repeat(labelWidth) + info.map(({ label }) => label.padStart(columnWidth)).join("")));
    const total = [0, 1, 2, 3].map(k => spline.polynomial[0][k] + spline.polynomial[1][k] * x + spline.polynomial[2][k] * y);
    lines.push(row(linearPartText(spline), total));
    const terms = spline.centers.map(center => {
        const dx = x - center.position[0], dy = y - center.position[1];
        const u = radialBasis(dx * dx + dy * dy);
        return { center, r: Math.hypot(dx, dy), values: center.weight.map(w => w * u) };
    });
    const shown = terms.length > 12 ? 11 : terms.length;
    for (const term of terms.slice(0, shown)) {
        const label = `  w${term.center.stop + 1}·U(${term.r.toFixed(2)})`;
        lines.push(row(label, term.values, `${swatchHTML(term.center.stop)} ${escapeHTML(label.slice(2))}`));
    }
    if (terms.length > shown) {
        const rest = terms.slice(shown);
        lines.push(row(`  ${rest.length} more stops`, [0, 1, 2, 3].map(k => rest.reduce((sum, term) => sum + term.values[k], 0))));
    }
    for (const term of terms) {
        for (let k = 0; k < 4; ++k)
            total[k] += term.values[k];
    }
    lines.push(muted("─".repeat(labelWidth + 4 * columnWidth)));
    lines.push(row("= premultiplied", total));
    const color = unpremultipliedColor(total, spline.hueIndex);
    lines.push(row("÷ clamped α", color));
    const display = displayColor(color);
    lines.push(`${`<span class="swatch large" style="background: ${cssForDisplayColor(display)}"></span>`} ${escapeHTML(state.space)}(${color.slice(0, 3).map((v, k) => signed(v, digitsFor(info[k].range)).trim()).join(" ")} / ${+color[3].toFixed(3)})`);
    return lines.join("\n");
}

// Each stop's share of the color at a point, in the box's model.
function sharesHTML(position) {
    if (state.view === "influence")
        return "";
    const shares = stopShares(splines[state.model], position);
    const muted = text => `<span class="muted">${escapeHTML(text)}</span>`;
    const lines = shares.map((share, k) => `${swatchHTML(k)} ${String(k + 1).padStart(2)} ${signed(share, 3).padStart(8)}`);
    const columns = [];
    for (let i = 0; i < lines.length; i += 2)
        columns.push(lines.slice(i, i + 2).join("    "));
    return `\n\n${muted("Each stop's share of the color here:")}\n${columns.join("\n")}\n${muted(`adding up to ${shares.reduce((a, b) => a + b, 0).toFixed(3)}`)}`;
}

function showSample(event, view) {
    lastSamplePosition = { clientX: event.clientX, clientY: event.clientY, pointerType: event.pointerType, view };
    if (!state.sample || !splines[view.model])
        return hideSample();
    // The stage may be scaled down to fit, so this goes by its drawn size.
    const rect = view.stage.getBoundingClientRect();
    const u = (event.clientX - rect.left) / rect.width, v = (event.clientY - rect.top) / rect.height;
    if (u < 0 || u > 1 || v < 0 || v > 1) {
        $("sample").style.display = "none";
        return;
    }
    const sample = $("sample");
    // The sample adds up the terms of the model in this box.
    sample.innerHTML = asView(view, () => sampleHTML([u * state.width, v * state.height]) + sharesHTML([u * state.width, v * state.height]));
    sample.style.display = "block";
    // Beside a mouse pointer, and above a finger, which would cover it otherwise.
    const { width, height } = sample.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    let x, y;
    if (event.pointerType === "mouse") {
        x = event.clientX + 18 + width > viewportWidth ? event.clientX - 18 - width : event.clientX + 18;
        y = Math.min(event.clientY + 18, innerHeight - height - 8);
    } else {
        x = clamp(event.clientX - width / 2, 8, viewportWidth - width - 8);
        y = event.clientY - height - 36 >= 8 ? event.clientY - height - 36 : event.clientY + 36;
    }
    sample.style.left = `${Math.max(8, x) + scrollX}px`;
    sample.style.top = `${Math.max(8, y) + scrollY}px`;
}

// A mouse samples as it hovers. A finger samples where it touches, unless it is dragging a stop, and the sample stays
// once it lifts.
for (const view of views) {
    view.stage.addEventListener("pointermove", event => {
        if (event.pointerType === "mouse" || !drag)
            showSample(event, view);
    });
    view.stage.addEventListener("pointerdown", event => {
        if (event.pointerType !== "mouse" && !drag)
            showSample(event, view);
    });
    view.stage.addEventListener("pointerleave", event => {
        if (event.pointerType === "mouse")
            hideSample();
    });
}

// MARK: 3D

let sheetYaw = -0.6;
let sheetTilt = 40 * Math.PI / 180;
const SHEET_GRID = 24;

// The index of the Height choice that shows every component's surface at once.
const ALL_COMPONENTS = 4;

function computeSheet() {
    const spline = viewSpline(currentSpline);
    const center = selectedCenter(currentSpline);
    const info = components();
    const single = state.view === "basis" || state.view === "influence";
    const all = state.sheetComponent === ALL_COMPONENTS && !single;
    const shown = all ? [0, 1, 2, 3] : [Math.min(state.sheetComponent, 3)];

    // Samples on the grid's vertices, for the heights, and at the centers of its cells, for the colors.
    const sampleGrid = (count, offset) => Array.from({ length: count }, (_, i) => Array.from({ length: count }, (_, j) => {
        const position = [(i + offset) / SHEET_GRID * state.width, (j + offset) / SHEET_GRID * state.height];
        if (state.view === "basis")
            return center ? radialBasisAt(spline, center, position) : 0;
        return interpolatedColor(spline, position);
    }));
    const vertexValues = sampleGrid(SHEET_GRID + 1, 0);
    const faceValues = sampleGrid(SHEET_GRID, 0.5);

    // Samples along the cross-section's row, where its plane cuts each surface.
    const SECTION_SAMPLES = SHEET_GRID * 4;
    const sectionValues = !state.crossSection ? null : Array.from({ length: SECTION_SAMPLES + 1 }, (_, i) => {
        const position = [i / SECTION_SAMPLES * state.width, state.row / 100 * state.height];
        if (state.view === "basis")
            return center ? radialBasisAt(spline, center, position) : 0;
        return interpolatedColor(spline, position);
    });

    let sheets;
    if (state.view === "influence") {
        sheets = [{
            vertices: vertexValues.map(column => column.map(color => color[0])),
            faces: faceValues.map(column => column.map(color => cssForDisplayColor([...influenceDisplayColor(color[0]), 1]))),
            section: sectionValues?.map(color => color[0]),
            sectionColor: null,
        }];
    } else if (state.view === "basis") {
        // U(r) grows without bound, so it is scaled down to fit.
        const largest = Math.max(1, ...vertexValues.flat());
        sheets = [{
            vertices: vertexValues.map(column => column.map(value => value / largest)),
            faces: faceValues.map(column => column.map(value => cssForDisplayColor([...radialBasisDisplayColor(value), 1]))),
            section: sectionValues?.map(value => value / largest),
            sectionColor: null,
        }];
    } else {
        const gradientColors = all ? null : faceValues.map(column => column.map(color => cssForDisplayColor(displayColor(unpremultipliedColor(color, spline.hueIndex)))));
        sheets = shown.map(k => ({
            component: k,
            vertices: vertexValues.map(column => column.map(color => normalizedComponent(color[k], info[k].range))),
            // With every surface shown, each is tinted with its component's color, so they can be told apart.
            faces: gradientColors ?? faceValues.map(column => column.map(() => COMPONENT_COLORS[k] + "a0")),
            section: sectionValues?.map(color => normalizedComponent(color[k], info[k].range)),
            sectionColor: COMPONENT_COLORS[k],
        }));
    }

    const pegs = [];
    if (state.view === "influence") {
        for (const c of currentSpline.centers)
            pegs.push({ stop: c.stop, height: c.stop === selected ? 1 : 0 });
    } else if (state.view === "basis") {
        if (center)
            pegs.push({ stop: center.stop, height: 0 });
    } else {
        for (const k of shown) {
            for (const c of currentSpline.centers)
                pegs.push({ stop: c.stop, height: normalizedComponent(c.color[k], info[k].range), ring: all ? COMPONENT_COLORS[k] : null });
        }
    }
    const label = state.view === "basis" ? "U(r)" : state.view === "influence" ? "share" : all ? "" : info[shown[0]].label;
    activeView.sheetGrid = { sheets, pegs, label, range: all ? [0, 1] : info[shown[0]].range, all };
}

function drawSheet({ recompute = false } = { }) {
    if (!state.sheet)
        return;
    if (recompute || !activeView.sheetGrid)
        computeSheet();
    const { ctx, width, height } = sizeCanvas(activeView.sheet);
    const { sheets, pegs, label, range, all } = activeView.sheetGrid;
    const longest = Math.max(state.width, state.height);
    const extentX = state.width / longest, extentY = state.height / longest;
    const zScale = 0.45;
    const fit = Math.min(width, height * 1.3) * 0.62;
    const project = (u, v, z) => {
        const x0 = (u - 0.5) * extentX, y0 = (v - 0.5) * extentY, z0 = z * zScale;
        const cosYaw = Math.cos(sheetYaw), sinYaw = Math.sin(sheetYaw);
        const xr = x0 * cosYaw - y0 * sinYaw, yr = x0 * sinYaw + y0 * cosYaw;
        const cosTilt = Math.cos(sheetTilt), sinTilt = Math.sin(sheetTilt);
        return [width / 2 + xr * fit, height / 2 + 30 + (yr * sinTilt - z0 * cosTilt) * fit, yr * cosTilt + z0 * sinTilt];
    };
    const ink = isDark() ? "255, 255, 255" : "0, 0, 0";

    const outline = (z, dash, alpha) => {
        const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => project(u, v, z));
        ctx.setLineDash(dash);
        ctx.strokeStyle = `rgba(${ink}, ${alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        corners.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
        return corners;
    };
    const floor = outline(0, [], 0.35);
    ctx.fillStyle = `rgba(${ink}, 0.05)`;
    ctx.beginPath();
    floor.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.fill();
    if (state.view !== "basis") {
        const top = outline(1, [4, 4], 0.3);
        ctx.fillStyle = `rgba(${ink}, 0.6)`;
        ctx.font = "11px -apple-system, system-ui, sans-serif";
        ctx.fillText(all ? "top of each range" : `${label} = ${range[1]}`, top[0][0] + 6, top[0][1] - 4);
        ctx.fillText(all ? "bottom of each range" : `${label} = ${range[0]}`, floor[0][0] + 6, floor[0][1] + 14);
    }

    const items = [];
    for (const { vertices, faces } of sheets) {
        for (let i = 0; i < SHEET_GRID; ++i) {
            for (let j = 0; j < SHEET_GRID; ++j) {
                const quad = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => project(a / SHEET_GRID, b / SHEET_GRID, vertices[a][b]));
                const depth = quad.reduce((sum, p) => sum + p[2], 0) / 4;
                items.push({ depth, draw: () => {
                    ctx.beginPath();
                    quad.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
                    ctx.closePath();
                    ctx.fillStyle = faces[i][j];
                    ctx.fill();
                    ctx.strokeStyle = `rgba(${ink}, 0.1)`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                } });
            }
        }
    }
    if (state.crossSection) {
        // The cross-section's plane, standing on its row, cut into strips so it sorts among the surface's cells.
        const v = state.row / 100;
        const zLow = Math.min(0, ...sheets.flatMap(({ vertices }) => vertices.flat()));
        const zHigh = Math.max(1, ...sheets.flatMap(({ vertices }) => vertices.flat()));
        for (let i = 0; i < SHEET_GRID; ++i) {
            const u0 = i / SHEET_GRID, u1 = (i + 1) / SHEET_GRID;
            const quad = [project(u0, v, zLow), project(u1, v, zLow), project(u1, v, zHigh), project(u0, v, zHigh)];
            const depth = quad.reduce((sum, p) => sum + p[2], 0) / 4;
            items.push({ depth, draw: () => {
                ctx.beginPath();
                quad.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
                ctx.closePath();
                ctx.fillStyle = `rgba(${ink}, 0.18)`;
                ctx.fill();
                ctx.strokeStyle = `rgba(${ink}, 0.5)`;
                ctx.lineWidth = 1;
                ctx.setLineDash([6, 4]);
                for (const [a, b] of [[0, 1], [3, 2]]) {
                    ctx.beginPath();
                    ctx.moveTo(...quad[a].slice(0, 2));
                    ctx.lineTo(...quad[b].slice(0, 2));
                    ctx.stroke();
                }
                ctx.setLineDash([]);
            } });
        }
        for (const edge of [0, 1]) {
            const ends = [project(edge, v, zLow), project(edge, v, zHigh)];
            items.push({ depth: (ends[0][2] + ends[1][2]) / 2, draw: () => {
                ctx.strokeStyle = `rgba(${ink}, 0.5)`;
                ctx.lineWidth = 1;
                ctx.setLineDash([6, 4]);
                ctx.beginPath();
                ctx.moveTo(...ends[0].slice(0, 2));
                ctx.lineTo(...ends[1].slice(0, 2));
                ctx.stroke();
                ctx.setLineDash([]);
            } });
        }
        // Where the plane cuts each surface: the curves the cross-section plot draws.
        for (const { section, sectionColor } of sheets) {
            const points = section.map((z, i) => project(i / (section.length - 1), v, z));
            for (let i = 0; i + 1 < points.length; ++i) {
                const [a, b] = [points[i], points[i + 1]];
                items.push({ depth: (a[2] + b[2]) / 2 - 0.01, draw: () => {
                    ctx.strokeStyle = sectionColor ?? `rgba(${ink}, 0.9)`;
                    ctx.lineWidth = 2.5;
                    ctx.lineCap = "round";
                    ctx.beginPath();
                    ctx.moveTo(a[0], a[1]);
                    ctx.lineTo(b[0], b[1]);
                    ctx.stroke();
                    ctx.lineCap = "butt";
                } });
            }
        }
    }
    for (const peg of pegs) {
        const stop = state.stops[peg.stop];
        const u = stop.pos[0] / 100, v = stop.pos[1] / 100;
        const base = project(u, v, 0), tip = project(u, v, peg.height);
        items.push({ depth: tip[2] + 0.02, draw: () => {
            ctx.strokeStyle = `rgba(${ink}, 0.85)`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(base[0], base[1]);
            ctx.lineTo(tip[0], tip[1]);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(tip[0], tip[1], peg.stop === selected ? 7 : 6, 0, 2 * Math.PI);
            ctx.fillStyle = parseColor(stop.color) ? stop.color : "#000";
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = peg.ring ?? (peg.stop === selected ? "#0a84ff" : "#fff");
            ctx.stroke();
        } });
    }
    items.sort((a, b) => b.depth - a.depth).forEach(item => item.draw());
}

// Turning any of the 3D views turns them all.
for (const { sheet } of views) {
    let rotating = null;
    sheet.addEventListener("pointerdown", event => {
        rotating = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        sheet.setPointerCapture(event.pointerId);
        sheet.style.cursor = "grabbing";
    });
    sheet.addEventListener("pointermove", event => {
        if (!rotating || rotating.pointerId !== event.pointerId)
            return;
        sheetYaw += (event.clientX - rotating.x) * 0.01;
        sheetTilt = clamp(sheetTilt + (event.clientY - rotating.y) * 0.006, 10 * Math.PI / 180, 85 * Math.PI / 180);
        rotating.x = event.clientX;
        rotating.y = event.clientY;
        $("tilt").value = Math.round(sheetTilt * 180 / Math.PI);
        drawSheets();
    });
    const stop = () => {
        rotating = null;
        sheet.style.cursor = "grab";
    };
    sheet.addEventListener("pointerup", stop);
    sheet.addEventListener("pointercancel", stop);
}

// MARK: Coefficients

function updateCoefficients() {
    if (!state.numbers)
        return;
    const spline = currentSpline;
    if (spline.grid) {
        const grid = spline.grid;
        activeView.numbers.textContent = `${state.model} grid, ${grid.columns}×${grid.rows} texels of ${grid.texel.map(v => v.toFixed(1)).join("×")}px, ${state.edges} edges\n${grid.heldCount} texels fixed by the stops${state.hold === "points" ? "" : "' discs"}${grid.factor.springTexel.length ? `, ${grid.factor.springTexel.length} held by springs` : ""}\nfactored in ${grid.factor.milliseconds.toFixed(0)} ms, then solved for the colors in ${grid.milliseconds.toFixed(0)} ms`;
        return;
    }
    const info = components();
    const labelWidth = 10, columnWidth = 10;
    // A swatch takes about two characters' room.
    const row = (label, values, swatch = null) => (swatch === null ? label.padEnd(labelWidth) : `${swatchHTML(swatch)} ${label.padEnd(labelWidth - 2)}`)
        + values.map((value, k) => signed(value, digitsFor(info[k].range) + 1).padStart(columnWidth)).join("");
    const lines = [];
    lines.push(`centroid (${spline.origin.map(v => v.toFixed(1)).join(", ")})px, scale ${spline.scale.toFixed(1)}px`);
    let linear = linearPartText(spline);
    if (spline.terms.length === 2)
        linear += `, t = ${spline.terms[1][1].toFixed(3)}·x + ${spline.terms[1][2].toFixed(3)}·y`;
    lines.push(`linear part: ${linear}`);
    lines.push("");
    lines.push(" ".repeat(labelWidth) + info.map(({ label }) => label.padStart(columnWidth)).join(""));
    ["a", "b", "c"].forEach((name, i) => lines.push(row(name, spline.polynomial[i])));
    for (const center of spline.centers)
        lines.push(row(`w${center.stop + 1}`, center.weight, center.stop));
    const sums = [
        ["Σw", () => 1],
        ["Σw·x", c => c.position[0]],
        ["Σw·y", c => c.position[1]],
    ];
    lines.push("");
    for (const [name, factor] of sums)
        lines.push(row(name, [0, 1, 2, 3].map(k => spline.centers.reduce((sum, c) => sum + c.weight[k] * factor(c), 0))));
    lines.push("The sums are 0, up to rounding.");
    activeView.numbers.innerHTML = lines.join("\n");
}

// MARK: Visualize controls

$("gamutMapping").addEventListener("change", () => {
    state.gamutMapping = $("gamutMapping").value;
    changed();
});
$("gamut").addEventListener("change", () => {
    state.gamut = $("gamut").value;
    changed();
});
$("reference").addEventListener("change", () => {
    state.reference = $("reference").value;
    changed();
});
$("view").addEventListener("change", () => {
    state.view = $("view").value;
    changed();
});
const VISUALIZATION_TOGGLES = [["otherCurvesToggle", "otherCurves"], ["clippingToggle", "clipping"], ["normalizationToggle", "normalization"], ["sampleToggle", "sample"], ["crossSectionToggle", "crossSection"], ["sheetToggle", "sheet"], ["numbersToggle", "numbers"]];
for (const [id, key] of VISUALIZATION_TOGGLES) {
    $(id).addEventListener("change", () => {
        state[key] = $(id).checked;
        if (key === "sample" && !state.sample)
            hideSample();
        changed();
    });
}
$("row").addEventListener("input", () => {
    state.row = Number($("row").value);
    changed({ dragging: true });
});
$("row").addEventListener("change", writeHash);
$("sheetComponent").addEventListener("change", () => {
    state.sheetComponent = Number($("sheetComponent").value);
    changed();
});
$("tilt").addEventListener("input", () => {
    sheetTilt = Number($("tilt").value) * Math.PI / 180;
    drawSheets();
});

// MARK: - Controls

function updateControls() {
    $("width").value = state.width;
    $("height").value = state.height;
    $("space").value = state.space;
    $("hueNote").hidden = !(state.space in HUE_INDEX);
    const gridModel = gridModelIsOn();
    for (const button of document.querySelectorAll("#modelBar button"))
        button.setAttribute("aria-pressed", String(state.models.includes(button.dataset.model)));
    $("edges").value = state.edges;
    $("gridResolution").value = String(state.gridResolution);
    if (document.activeElement !== $("defaultSpread"))
        $("defaultSpread").value = state.defaultSpread;
    $("edges").title = EDGE_NOTES[state.edges];
    $("hold").value = state.hold;
    $("hold").title = HOLD_NOTES[state.hold];
    $("defaultSpreadRow").hidden = state.hold !== "discs";
    $("spreadMeaningRow").hidden = state.hold !== "points";
    $("spreadMeaning").value = state.spreadMeaning;
    $("spreadMeaning").title = SPREAD_MEANING_NOTES[state.spreadMeaning];
    $("overlayToggle").checked = state.overlay;
    updateVisualizationControls();

    const stop = state.stops[selected];
    $("stopTitle").textContent = `Stop ${selected + 1} of ${state.stops.length}`;
    if (document.activeElement !== $("stopText")) {
        $("stopText").value = stop.color;
        $("stopText").classList.remove("invalid");
    }
    $("stopPicker").value = hexForColor(parseColor(stop.color) ?? BLACK);
    if (document.activeElement !== $("stopX"))
        $("stopX").value = stop.pos[0];
    if (document.activeElement !== $("stopY"))
        $("stopY").value = stop.pos[1];
    if (document.activeElement !== $("stopWeight"))
        $("stopWeight").value = stop.weight ?? "";
    $("stopSpread").value = spreadOf(stop);
    const spreadUsed = gridModel && (state.hold === "discs" || state.spreadMeaning !== "none");
    $("stopSpread").disabled = !spreadUsed;
    const spreadNotes = [...(stop.spread === null ? ["the default"] : []), ...(spreadUsed ? [] : ["not used now"])];
    $("stopSpreadValue").textContent = spreadOf(stop).toFixed(2) + (spreadNotes.length ? ` (${spreadNotes.join(", ")})` : "");
    $("stopSpreadDefault").hidden = stop.spread === null;
    $("removeStop").disabled = state.stops.length < 2;

    const list = $("stopList");
    if (list.children.length !== state.stops.length) {
        list.replaceChildren();
        state.stops.forEach((_, i) => {
            const button = document.createElement("button");
            button.append(document.createElement("span"));
            button.addEventListener("click", () => {
                selected = i;
                scheduleRender();
            });
            list.append(button);
        });
    }
    [...list.children].forEach((button, i) => {
        const text = state.stops[i].color;
        button.firstChild.style.background = "";
        button.firstChild.style.background = text;
        button.title = text;
        button.classList.toggle("selected", i === selected);
    });
}

function commitNumber(id, min, max, apply) {
    $(id).addEventListener("change", () => {
        const value = parseInt($(id).value, 10);
        if (Number.isFinite(value))
            apply(clamp(value, min, max));
        changed();
    });
}
commitNumber("width", 100, 2000, value => state.width = value);
commitNumber("height", 100, 2000, value => state.height = value);

$("space").addEventListener("change", () => {
    state.space = $("space").value;
    changed();
});
for (const resolution of GRID_RESOLUTIONS)
    $("gridResolution").add(new Option(String(resolution), String(resolution)));
// Any of the models can be on, but at least one is.
for (const button of document.querySelectorAll("#modelBar button")) {
    button.addEventListener("click", () => {
        const model = button.dataset.model;
        const on = state.models.includes(model);
        if (on && state.models.length === 1)
            return;
        state.models = MODELS.filter(other => other === model ? !on : state.models.includes(other));
        // New stops take their color from the thin-plate spline if it's on, or else the first model.
        if (!state.models.includes(state.model))
            state.model = state.models.includes("spline") ? "spline" : state.models[0];
        changed();
    });
}

// Opening or closing About in one column does the same in the others, so they stay lined up.
for (const view of views) {
    view.figure.querySelector(".modelAbout").addEventListener("toggle", event => {
        if (event.target.open === state.about)
            return;
        state.about = event.target.open;
        for (const other of views)
            other.figure.querySelector(".modelAbout").open = state.about;
        scheduleHashWrite();
    });
}
$("spreadMeaning").addEventListener("change", () => {
    state.spreadMeaning = $("spreadMeaning").value;
    changed();
});
$("hold").addEventListener("change", () => {
    state.hold = $("hold").value;
    changed();
});
$("edges").addEventListener("change", () => {
    state.edges = $("edges").value;
    changed();
});
$("gridResolution").addEventListener("change", () => {
    state.gridResolution = Number($("gridResolution").value);
    changed();
});
$("defaultSpread").addEventListener("change", () => {
    const value = parseFloat($("defaultSpread").value);
    state.defaultSpread = Number.isFinite(value) ? clamp(value, 0, 1) : 0.02;
    changed();
});


$("overlayToggle").addEventListener("change", () => {
    state.overlay = $("overlayToggle").checked;
    changed();
});
$("preset").addEventListener("change", () => {
    if ($("preset").value === "")
        return updateControls();
    state = presetState(Number($("preset").value));
    selected = 0;
    changed();
});

// The preset the gradient still matches, by its box, color space and stops, or -1 once anything there has changed.
function matchingPreset() {
    const describe = ({ width, height, space, stops }) => JSON.stringify([width, height, space, stops.map(stop => [stop.color, ...stop.pos, stop.weight ?? null, stop.spread ?? null])]);
    const current = describe(state);
    return PRESETS.findIndex(preset => describe(preset.state) === current);
}

$("stopPicker").addEventListener("input", () => {
    state.stops[selected].color = $("stopPicker").value;
    $("stopText").value = $("stopPicker").value;
    $("stopText").classList.remove("invalid");
    changed({ dragging: true });
});
$("stopPicker").addEventListener("change", writeHash);
$("stopText").addEventListener("input", () => {
    const text = $("stopText").value.trim();
    const valid = !!parseColor(text);
    $("stopText").classList.toggle("invalid", !valid);
    if (!valid)
        return;
    state.stops[selected].color = text;
    changed();
});
$("stopText").addEventListener("blur", () => {
    $("stopText").value = state.stops[selected].color;
    $("stopText").classList.remove("invalid");
});
for (const [id, axis] of [["stopX", 0], ["stopY", 1]]) {
    $(id).addEventListener("change", () => {
        const value = parseFloat($(id).value);
        if (Number.isFinite(value))
            state.stops[selected].pos[axis] = round2(clamp(value, -1000, 1000));
        changed();
    });
}
$("stopWeight").addEventListener("change", () => {
    const value = parseFloat($("stopWeight").value);
    state.stops[selected].weight = Number.isFinite(value) ? value : null;
    changed();
});
$("stopSpread").addEventListener("input", () => {
    state.stops[selected].spread = clamp(Number($("stopSpread").value), 0, 1);
    changed({ dragging: true });
});
$("stopSpread").addEventListener("change", () => changed());
$("stopSpreadDefault").addEventListener("click", () => {
    state.stops[selected].spread = null;
    changed();
});
$("addStop").addEventListener("click", () => {
    // In the middle of the box, or, if a stop is there, a little way from it.
    const taken = position => state.stops.some(stop => Math.hypot(stop.pos[0] - position[0], stop.pos[1] - position[1]) < 4);
    let position = [50, 50];
    for (let step = 1; taken(position) && step < 20; ++step)
        position = [50 + 7 * step * Math.cos(step * 2.4), 50 + 7 * step * Math.sin(step * 2.4)];
    addStop(position);
});
$("removeStop").addEventListener("click", removeSelectedStop);

__COPY__
$("copyLink").addEventListener("click", () => {
    writeHash();
    copy(location.href, "the link");
});

window.addEventListener("hashchange", () => {
    if (location.hash === lastWrittenHash)
        return;
    const decoded = decodeState(location.hash.slice(1));
    if (decoded) {
        state = decoded;
        selected = 0;
        lastWrittenHash = location.hash;
        scheduleRender();
    }
});

__BACKDROP__
// MARK: - Start

new ResizeObserver(() => scheduleRender()).observe($("stageScroller"));

state = decodeState(location.hash.slice(1)) ?? presetState(2);
writeHash();
render();

WebGPUFreeformGradientRenderer.create().then(renderer => {
    gpuRenderer = renderer;
    renderer.device.lost.then(info => {
        gpuRenderer = null;
        gpuError = `device lost (${info.message})`;
        scheduleRender();
    });
    renderer.device.addEventListener?.("uncapturederror", event => {
        gpuError = event.error.message;
        console.error(event.error.message);
        scheduleRender();
    });
    renderer.compilationInfo?.then(info => {
        for (const message of info.messages)
            console[message.type === "error" ? "error" : "warn"](`WGSL ${message.lineNum}:${message.linePos} ${message.message}`);
    });
    scheduleRender();
}, error => {
    gpuError = error.message;
    scheduleRender();
});
</script>
</body>
</html>
