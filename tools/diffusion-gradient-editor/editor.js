__COMMON_HEAD__

// MARK: - State

// A curve is a shape with a color on each side, kept in the form it was drawn in: `kind` is "ellipse", "line", "arc"
// or "path", and only rendering, hit testing and the overlay flatten it to Bézier nodes, with curveNodes(). Positions
// are fractions of the box, 0 to 1 across and down. An open curve's colors are `left` and `right`, as seen going from
// its start to its end with y down. A closed curve's are `inside` and `outside`.
//
// - An ellipse has a `center`, `radii` as fractions of the box's width and height, and an `angle` it's turned by, in
//   degrees, in the box's pixels. It's always closed.
// - A line goes `from` one point `to` another.
// - An arc is part of a circle in the box's pixels, `from` one point `to` another. Its `bend` is how far its middle is
//   from the straight line between them, as a fraction of half that line, to the left of the way from one to the
//   other: 1 is half a circle.
// - A path is a chain of Bézier `nodes`, open or closed. A node's `in` and `out` handles are offsets from it, in the
//   same units, and zero for none.
let state = null;

// A node is smooth when its handles are opposite, so moving one turns the other, and a corner otherwise.
const node = (x, y, inX = 0, inY = 0, outX = -inX, outY = -inY) => ({
    p: [x, y], in: [inX, inY], out: [outX, outY],
    kind: (inX || inY) && Math.abs(inX * outY - inY * outX) < 1e-9 && inX * outX + inY * outY < 0 ? "smooth" : "corner",
});

const ellipse = (cx, cy, rx, ry, angle = 0) => ({ kind: "ellipse", closed: true, center: [cx, cy], radii: [rx, ry], angle });
const line = (from, to) => ({ kind: "line", closed: false, from, to });
const arc = (from, to, bend = 1) => ({ kind: "arc", closed: false, from, to, bend });
const isPath = curve => !curve.kind || curve.kind === "path";

const PRESETS = [
    {
        name: "A line between two colors",
        note: "One open curve, orange above and blue below. Past its ends the two sides meet, and the jump fades out. Show the lines of equal lightness to see how differently the two models round its ends.",
        state: {
            width: 600, height: 400,
            curves: [{ ...line([0.15, 0.5], [0.85, 0.5]), left: "#ff6b3d", right: "#3d7bff" }],
        },
    },
    {
        name: "A circle",
        note: "One closed curve, red inside and blue outside. Show where it leaves sRGB: the biharmonic model overshoots on both sides of the jump.",
        state: {
            width: 600, height: 400,
            curves: [{ ...ellipse(0.5, 0.5, 0.2, 0.3), inside: "#d93a2b", outside: "#1e88ff" }],
        },
    },
    {
        name: "Overlapping shapes",
        note: "Shapes over shapes, and two open curves the same light gray on both sides, which hold the color like strokes.",
        state: {
            width: 500, height: 500,
            curves: [
                { ...ellipse(0.45, 0.4, 0.12, 0.12), inside: "#d33b2c", outside: "#1e88ff" },
                { ...ellipse(0.36, 0.45, 0.08, 0.36, 18), inside: "#d7f20a", outside: "#ebebeb" },
                { kind: "path", closed: false, nodes: [node(0.28, 0.78, 0, 0, 0.08, 0.16), node(0.52, 0.86, -0.08, 0.02, 0.06, -0.02), node(0.52, 0.62, 0, 0.1, 0.06, -0.08), node(0.66, 0.56)], left: "#ebebeb", right: "#ebebeb" },
                { kind: "path", closed: false, nodes: [node(0.64, 0.38, 0, 0, 0.14, 0.02), node(0.74, 0.62, 0.04, -0.12)], left: "#ebebeb", right: "#ebebeb" },
            ],
        },
    },
    {
        name: "Two jumps close together",
        note: "A black stripe between two white fields. The biharmonic model keeps each jump's slope going, so it goes whiter than white outside the stripe and blacker than black inside it, and both are clipped. The harmonic model can't go past the colors it holds. Turn on the cross-section to see it.",
        state: {
            width: 600, height: 400,
            curves: [
                { ...line([0.15, 0.45], [0.85, 0.45]), left: "#ffffff", right: "#000000" },
                { ...line([0.15, 0.55], [0.85, 0.55]), left: "#000000", right: "#ffffff" },
            ],
        },
    },
    {
        name: "Strength",
        note: "Three lines with the same colors, held at 100%, 60% and 30%. A weaker hold lets the colors around a line bleed into it. Only the harmonic model takes strength for now. Show what the curves hold to see the weaker lines' texels held only in part.",
        state: {
            width: 600, height: 400,
            curves: [0.25, 0.5, 0.75].map((x, i) => ({
                ...line([x, 0.2], [x, 0.8]), left: "#7a2cff", right: "#ffc400", strength: [100, 60, 30][i],
            })),
        },
    },
    {
        name: "Blur",
        note: "Three circles, blurred 0, 20 and 60 px. A blurred curve is held as two one-sided copies, moved apart by the blur, and the solve fills the band between them. Show what the curves hold to see the copies.",
        state: {
            width: 600, height: 300,
            curves: [0.2, 0.5, 0.8].map((x, i) => ({
                ...ellipse(x, 0.5, 0.1, 0.2), inside: "#ff3d7f", outside: "#1b1f3b", blur: [0, 20, 60][i],
            })),
        },
    },
    {
        name: "Rings",
        note: "Circles inside circles, each the same color on both sides. With no jumps, they're like the stops of a gradient, and the colors diffuse between them. The harmonic model is creased along each ring, and the biharmonic one bends smoothly through them. Turn on 3D to see the shapes.",
        state: {
            width: 500, height: 500,
            curves: [[0.08, "#fff1a8"], [0.22, "#ff9a1f"], [0.36, "#c4204f"], [0.48, "#2b1055"]].map(([radius, color]) => ({
                ...ellipse(0.5, 0.5, radius, radius), inside: color, outside: color,
            })),
        },
    },
    {
        name: "A leaf",
        note: "A closed curve with two corner nodes, and a vein the same green on both sides.",
        state: {
            width: 600, height: 400,
            curves: [
                { kind: "path", closed: true, nodes: [node(0.2, 0.62, 0.1, 0.04, 0.06, -0.14), node(0.48, 0.34, -0.14, 0.03), node(0.8, 0.38, -0.1, -0.04, -0.06, 0.14), node(0.52, 0.66, 0.14, -0.03)], inside: "#82cf6c", outside: "#f4f1e6" },
                { kind: "path", closed: false, nodes: [node(0.24, 0.6, 0, 0, 0.2, -0.04), node(0.76, 0.4, -0.2, 0.04)], left: "#2f7a32", right: "#2f7a32" },
            ],
        },
    },
    {
        name: "Sunset",
        note: "A sky, a sun blurred into it, and two hills: a few curves make a whole picture.",
        state: {
            width: 600, height: 400,
            curves: [
                { ...line([0, 0.06], [1, 0.06]), left: "#1c2a6b", right: "#3a4fb0" },
                { ...ellipse(0.64, 0.44, 0.07, 0.105), inside: "#fff5c2", outside: "#ffb15e", blur: 36 },
                { kind: "path", closed: false, nodes: [node(0, 0.62, 0, 0, 0.14, -0.06), node(0.38, 0.54, -0.12, 0, 0.14, 0), node(0.72, 0.6, -0.1, 0, 0.12, 0), node(1, 0.52, -0.1, 0.02)], left: "#ff9757", right: "#3f6b3c" },
                { kind: "path", closed: false, nodes: [node(0, 0.84, 0, 0, 0.2, -0.08), node(0.52, 0.76, -0.18, 0, 0.18, 0), node(1, 0.9, -0.18, -0.04)], left: "#4a7d42", right: "#1f3b22" },
            ],
        },
    },
];

// What the shared code needs from this editor: which state a preset sets, which preset to start from, what to reset
// when a preset is chosen, and which links it can read.
const PRESET_KEYS = ["curves"];
const DEFAULT_PRESET = 2;

function resetEditing() {
    selection = null;
    penCurve = null;
}

// Before shapes kept their form, every curve was a path of nodes.
function acceptsState(data) {
    if (!Array.isArray(data.curves))
        return false;
    for (const curve of data.curves)
        curve.kind ??= "path";
    return true;
}

function presetState(index) {
    return {
        ...commonState(),
        showCurves: state?.showCurves ?? true,
        ...structuredClone(PRESETS[index].state),
    };
}

// MARK: - Curves to segments

const boxScale = () => {
    const shorter = Math.min(state.width, state.height);
    return [state.width / shorter, state.height / shorter];
};

// A curve as Bézier nodes: a path's own, or a shape's.
function curveNodes(curve) {
    switch (curve.kind) {
    case "ellipse":
        return ellipseNodes(curve);
    case "line":
        return [curve.from, curve.to].map(p => ({ p, in: [0, 0], out: [0, 0], kind: "corner" }));
    case "arc":
        return arcNodes(curve);
    default:
        return curve.nodes;
    }
}

// A point on an ellipse at `phi` radians around from its first radius, `scale` times as far out, as a fraction of the
// box.
function ellipsePoint({ center, radii, angle }, phi, scale = 1) {
    const [sx, sy] = boxScale();
    const turn = angle * Math.PI / 180, cos = Math.cos(turn), sin = Math.sin(turn);
    const x = radii[0] * sx * Math.cos(phi) * scale, y = radii[1] * sy * Math.sin(phi) * scale;
    return [center[0] + (x * cos - y * sin) / sx, center[1] + (x * sin + y * cos) / sy];
}

// An ellipse as four smooth nodes, going clockwise on screen.
function ellipseNodes(curve) {
    const [sx, sy] = boxScale();
    const turn = curve.angle * Math.PI / 180, cos = Math.cos(turn), sin = Math.sin(turn);
    const k = 0.5523;
    return [0, 1, 2, 3].map(i => {
        const phi = i * Math.PI / 2;
        const x = -curve.radii[0] * sx * Math.sin(phi) * k, y = curve.radii[1] * sy * Math.cos(phi) * k;
        const tangent = [(x * cos - y * sin) / sx, (x * sin + y * cos) / sy];
        return { p: ellipsePoint(curve, phi), in: [-tangent[0], -tangent[1]], out: tangent, kind: "smooth" };
    });
}

// An arc's circle, in units of the box's shorter side: its ends `a` and `b`, the middle of the chord between them and
// half its length, the way to the chord's left, the arc's middle, and, unless it's straight, the circle's center and
// radius, where the arc starts around it, and how far it goes, in radians, positive clockwise on screen.
function arcGeometry({ from, to, bend }) {
    const [sx, sy] = boxScale();
    const a = [from[0] * sx, from[1] * sy], b = [to[0] * sx, to[1] * sy];
    const half = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
    const along = half ? [(b[0] - a[0]) / (2 * half), (b[1] - a[1]) / (2 * half)] : [1, 0];
    const leftward = [along[1], -along[0]];
    const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const sagitta = bend * half;
    const apex = [middle[0] + leftward[0] * sagitta, middle[1] + leftward[1] * sagitta];
    const geometry = { a, b, half, leftward, middle, apex, straight: Math.abs(sagitta) < 1e-6 || half < 1e-6, scale: [sx, sy] };
    if (geometry.straight)
        return geometry;
    const radius = (half * half + sagitta * sagitta) / (2 * Math.abs(sagitta));
    const center = [apex[0] - leftward[0] * Math.sign(sagitta) * radius, apex[1] - leftward[1] * Math.sign(sagitta) * radius];
    const halfSweep = Math.atan2(half, radius - Math.abs(sagitta));
    // Clockwise on screen when the middle is clockwise of the start, around the center.
    const clockwise = (a[0] - center[0]) * (apex[1] - center[1]) - (a[1] - center[1]) * (apex[0] - center[0]) > 0;
    return { ...geometry, center, radius, start: Math.atan2(a[1] - center[1], a[0] - center[0]), sweep: 2 * halfSweep * (clockwise ? 1 : -1) };
}

// An arc as Bézier nodes, a stretch for each quarter turn or less.
function arcNodes(curve) {
    const g = arcGeometry(curve);
    const corner = p => ({ p, in: [0, 0], out: [0, 0], kind: "corner" });
    if (g.straight)
        return [corner(curve.from), corner(curve.to)];
    const [sx, sy] = g.scale;
    const count = Math.max(1, Math.ceil(Math.abs(g.sweep) / (Math.PI / 2) - 1e-9));
    const step = g.sweep / count;
    const k = 4 / 3 * Math.tan(step / 4) * g.radius;
    const nodes = [];
    for (let i = 0; i <= count; ++i) {
        const theta = g.start + step * i;
        const tangent = [-Math.sin(theta) * k / sx, Math.cos(theta) * k / sy];
        const p = i === 0 ? curve.from : i === count ? curve.to : [(g.center[0] + g.radius * Math.cos(theta)) / sx, (g.center[1] + g.radius * Math.sin(theta)) / sy];
        nodes.push({ p, in: i ? [-tangent[0], -tangent[1]] : [0, 0], out: i < count ? tangent : [0, 0], kind: i && i < count ? "smooth" : "corner" });
    }
    return nodes;
}

// Each stretch of a curve, as its four Bézier points.
function stretches(curve) {
    const nodes = curveNodes(curve);
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

__COMMON_PAGE__
// MARK: - View notes

const VIEW_NOTES = {
    gradient: "The gradient each model draws from the same curves.",
    holds: "Every texel of the grid is worked out from the texels the curves hold, shown here in the colors they're held to, over the faded gradient. A curve holds a band 1% of the box's shorter side either side of it, each side its own color. Below 100% strength, its texels are held only in part, so the colors around them bleed in. A blurred curve is held as two one-sided copies, moved apart by the blur, and the solve fills the band between them. Set Grid to 128 to see the texels.",
    gamut: "Hatching marks where the solved colors fall outside sRGB, so they're clipped to draw them. The harmonic model makes each texel the average of its neighbors, so it can't go past the colors it's held to. The biharmonic model keeps the slope smooth through each curve, so past a jump it keeps going, and overshoots. In oklab, a mix of two colors inside sRGB can also fall outside it, in either model.",
    isolines: "Lines of equal lightness, every 0.025 of Oklab L. The harmonic model is a membrane: its lines bunch up at the curves and kink where they end, since it's continuous there but not smooth. The biharmonic model is a stiff sheet: its lines bend smoothly around a curve's end, since its slope is continuous too.",
    difference: "White where the two models agree, purple where they differ, darkest at a difference of 0.15 in Oklab (ΔE OK) or more. Both boxes show the same difference.",
    level: "The solve runs on a pyramid of grids, each half the size of the one above it. The coarsest is solved outright, and each finer level starts from the one below, scaled up, so it only has to fix the detail. This shows one level's texels as they are, unfiltered, with the texels the curves hold marked. Level 0 is the finest, the one that's drawn.",
    relaxation: "The harmonic model's finest grid, started from the curves' average color and relaxed without the pyramid: each step moves every texel toward the average of its four neighbors. The colors creep out from the curves a texel or two a step, so a fine grid would take hundreds of thousands of steps to settle. That's why the solve starts coarse. The biharmonic box shows its gradient.",
};

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
    if (curve.closed && curveNodes(curve).length > 2)
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
    if (!state.showCurves)
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
        if (!isPath(curve)) {
            drawShapeHandles(ctx, curve, size);
            return;
        }
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

// A shape's handles, in CSS pixels of a box `size` across and down: a line's or an arc's ends, an arc's middle, and an
// ellipse's center, the ends of its two radii, and a knob past the first that turns it.
function shapeHandles(curve, size) {
    const toPixels = ([x, y]) => [x * size[0], y * size[1]];
    switch (curve.kind) {
    case "line":
        return [{ name: "from", at: toPixels(curve.from) }, { name: "to", at: toPixels(curve.to) }];
    case "arc": {
        const g = arcGeometry(curve);
        return [{ name: "from", at: toPixels(curve.from) }, { name: "to", at: toPixels(curve.to) },
                { name: "bend", at: toPixels([g.apex[0] / g.scale[0], g.apex[1] / g.scale[1]]), round: true }];
    }
    case "ellipse": {
        const center = toPixels(curve.center), end = toPixels(ellipsePoint(curve, 0));
        const length = Math.hypot(end[0] - center[0], end[1] - center[1]);
        const turn = curve.angle * Math.PI / 180;
        const knob = [end[0] + Math.cos(turn) * 22, end[1] + Math.sin(turn) * 22];
        return [{ name: "center", at: center }, { name: "rx", at: end, round: true }, { name: "ry", at: toPixels(ellipsePoint(curve, Math.PI / 2)), round: true },
                { name: "angle", at: length ? knob : [center[0] + 22, center[1]], knob: true }];
    }
    }
    return [];
}

function drawShapeHandles(ctx, curve, size) {
    const handles = shapeHandles(curve, size);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    const from = curve.kind === "ellipse" ? handles[0].at : null;
    const spokes = curve.kind === "ellipse" ? handles.slice(1)
        : curve.kind === "arc" ? [handles[2]] : [];
    for (const { at } of spokes) {
        const origin = from ?? toChordMiddle(curve, size);
        ctx.beginPath();
        ctx.moveTo(...origin);
        ctx.lineTo(...at);
        ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const { at, round, knob } of handles) {
        ctx.beginPath();
        if (knob)
            ctx.arc(...at, 4, 0, 2 * Math.PI);
        else if (round)
            ctx.arc(...at, 5, 0, 2 * Math.PI);
        else
            ctx.rect(at[0] - 4.5, at[1] - 4.5, 9, 9);
        ctx.fillStyle = knob ? ACCENT : "#fff";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = ACCENT;
        ctx.stroke();
    }
}

const toChordMiddle = (curve, size) => [(curve.from[0] + curve.to[0]) / 2 * size[0], (curve.from[1] + curve.to[1]) / 2 * size[1]];

// Moves a shape's handle to `at`, a fraction of the box; `origin` is the shape when the drag started, and `delta` how
// far it's moved since.
function moveShapeHandle(curve, name, at, origin, delta, event) {
    const [sx, sy] = boxScale();
    switch (name) {
    case "from":
    case "to":
        curve[name] = at;
        break;
    case "bend": {
        const g = arcGeometry(curve);
        const along = (at[0] * sx - g.middle[0]) * g.leftward[0] + (at[1] * sy - g.middle[1]) * g.leftward[1];
        curve.bend = g.half ? clamp(along / g.half, -4, 4) : 1;
        break;
    }
    case "center":
        curve.center = add(origin.center, delta);
        break;
    case "rx":
    case "ry": {
        // The pointer's offset along the ellipse's own axes.
        const turn = curve.angle * Math.PI / 180, cos = Math.cos(turn), sin = Math.sin(turn);
        const x = (at[0] - curve.center[0]) * sx, y = (at[1] - curve.center[1]) * sy;
        const along = [x * cos + y * sin, -x * sin + y * cos];
        if (name === "rx")
            curve.radii = [Math.abs(along[0]) / sx, curve.radii[1]];
        else
            curve.radii = [curve.radii[0], Math.abs(along[1]) / sy];
        if (event.shiftKey) {
            // A circle, the size of the radius being dragged.
            const radius = name === "rx" ? curve.radii[0] * sx : curve.radii[1] * sy;
            curve.radii = [radius / sx, radius / sy];
        }
        break;
    }
    case "angle": {
        let angle = Math.atan2((at[1] - curve.center[1]) * sy, (at[0] - curve.center[0]) * sx) * 180 / Math.PI;
        if (event.shiftKey)
            angle = Math.round(angle / 15) * 15;
        curve.angle = Math.round(angle * 10) / 10;
        break;
    }
    }
}

// Moves a whole curve by `delta` from where it was, `origin`.
function moveCurve(curve, origin, delta) {
    switch (curve.kind) {
    case "ellipse":
        curve.center = add(origin.center, delta);
        break;
    case "line":
    case "arc":
        curve.from = add(origin.from, delta);
        curve.to = add(origin.to, delta);
        break;
    default:
        curve.nodes.forEach((node, i) => node.p = add(origin.nodes[i].p, delta));
    }
}

// A shape as a path of Bézier nodes, keeping its colors, strength and blur.
function convertToPath(curve) {
    const nodes = structuredClone(curveNodes(curve));
    for (const key of ["center", "radii", "angle", "from", "to", "bend"])
        delete curve[key];
    curve.kind = "path";
    curve.nodes = nodes;
}

const KIND_NAMES = { ellipse: "an ellipse", line: "a line", arc: "an arc" };
const curveName = (curve, index) => `Curve ${index + 1}, ${KIND_NAMES[curve.kind] ?? (curve.closed ? "a closed path" : "a path")}`;

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
    if (selection && !isPath(state.curves[selection.curve])) {
        for (const handle of shapeHandles(state.curves[selection.curve], size).reverse()) {
            if (near(handle.at, 8))
                return { kind: "shape", curve: selection.curve, handle: handle.name };
        }
    } else if (selection) {
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
function addCurve(shape) {
    const curve = shape.closed ? { ...shape, inside: newColors[0], outside: newColors[1] } : { ...shape, left: newColors[0], right: newColors[1] };
    state.curves.push(curve);
    selection = { curve: state.curves.length - 1, node: null };
    return selection.curve;
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
            } else if (hit.kind === "shape") {
                drag = { kind: "shape", curve: hit.curve, handle: hit.handle, start: at, origin: structuredClone(state.curves[hit.curve]) };
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
                drag = { kind: "curve", curve: hit.curve, start: at, origin: structuredClone(state.curves[hit.curve]) };
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
                    penCurve = addCurve({ kind: "path", closed: false, nodes: [node] });
                }
                selection = { curve: penCurve, node: state.curves[penCurve].nodes.length - 1 };
                drag = { kind: "pen", curve: penCurve, node: selection.node, start: at };
            }
        } else {
            const shape = tool === "line" ? line(at, at.slice())
                : tool === "ellipse" ? ellipse(at[0], at[1], 0, 0)
                : tool === "arc" ? arc(at, at.slice())
                : { kind: "path", closed: false, nodes: [{ p: at, in: [0, 0], out: [0, 0], kind: "smooth" }] };
            const index = addCurve(shape);
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
            moveCurve(curve, drag.origin, delta);
            break;
        case "shape":
            moveShapeHandle(curve, drag.handle, at, drag.origin, delta, event);
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
        case "arc":
            curve.to = at;
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
            curve.center = [cx, cy];
            curve.radii = [rx, ry];
            break;
        }
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
            const span = Math.max(...curveNodes(curve).map(node => Math.hypot((node.p[0] - finished.start[0]) * size[0], (node.p[1] - finished.start[1]) * size[1])));
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

function updateControls() {
    updateCommonControls();
    $("showCurves").checked = state.showCurves;
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
        row.querySelector("span").textContent = curveName(curve, i);
        for (const [input, side] of [[row.querySelector(".first"), first], [row.querySelector(".second"), second]]) {
            input.title = side[0].toUpperCase() + side.slice(1);
            if (document.activeElement !== input)
                input.value = curve[side];
        }
    });
    $("emptyNote").hidden = state.curves.length > 0;
    const css = cssText();
    if ($("output").value !== css)
        $("output").value = css;

    const selected = selection && state.curves[selection.curve];
    $("curvesTitle").textContent = selected ? curveName(selected, selection.curve) : "Curves";
    $("curveFields").hidden = !selected;
    if (selected) {
        const sides = selected.closed ? ["inside", "outside"] : ["left", "right"];
        for (const [which, side] of [["first", sides[0]], ["second", sides[1]]]) {
            $(which + "ColorLabel").textContent = side[0].toUpperCase() + side.slice(1);
            if (document.activeElement !== $(which + "Color"))
                $(which + "Color").value = selected[side];
        }
        updateShapeFields(selected);
        $("toPathRow").hidden = isPath(selected);
        for (const [id, value, unit] of [["strength", selected.strength ?? 100, "%"], ["blur", selected.blur ?? 0, " px"]]) {
            $(id).value = value;
            $(id + "Value").textContent = value + unit;
        }
    }
}

// The fields for a shape's own form, by kind: a label, the key, and whether it's a point or a pair of fractions of the
// box, shown as percentages, or a number.
const SHAPE_FIELDS = {
    ellipse: [["Center", "center", "pair"], ["Radii", "radii", "pair"], ["Turn", "angle", "degrees"]],
    line: [["From", "from", "pair"], ["To", "to", "pair"]],
    arc: [["From", "from", "pair"], ["To", "to", "pair"], ["Bend", "bend", "number"]],
};

function updateShapeFields(curve) {
    const container = $("shapeFields");
    const fields = SHAPE_FIELDS[curve.kind] ?? [];
    if (container.dataset.kind !== (curve.kind ?? "path")) {
        container.dataset.kind = curve.kind ?? "path";
        container.replaceChildren(...fields.map(shapeFieldRow));
    }
    fields.forEach(([, key, type], i) => {
        const inputs = container.children[i].querySelectorAll("input");
        const values = type === "pair" ? curve[key].map(v => Math.round(v * 1000) / 10) : [Math.round(curve[key] * 100) / 100];
        inputs.forEach((input, k) => {
            if (document.activeElement !== input)
                input.value = values[k];
        });
    });
}

function shapeFieldRow([label, key, type]) {
    const row = document.createElement("div");
    row.className = "row";
    row.append(Object.assign(document.createElement("label"), { textContent: label }));
    const count = type === "pair" ? 2 : 1;
    for (let k = 0; k < count; ++k) {
        const input = Object.assign(document.createElement("input"), { type: "number", step: type === "number" ? "0.05" : "1" });
        input.title = type === "pair" ? `${label}, ${["across", "down"][k]}, as a percentage of the box's ${["width", "height"][k]}` : label;
        input.addEventListener("input", () => {
            const curve = selection && state.curves[selection.curve];
            const value = Number(input.value);
            if (!curve || input.value === "" || !Number.isFinite(value))
                return;
            if (type === "pair") {
                curve[key] = curve[key].slice();
                curve[key][k] = key === "radii" ? Math.max(0, value) / 100 : value / 100;
            } else {
                curve[key] = key === "bend" ? clamp(value, -4, 4) : value;
            }
            changed();
        });
        row.append(input);
        if (type === "pair")
            row.append(k ? " %" : " % ×");
    }
    if (type === "degrees")
        row.append(" °");
    return row;
}

for (const which of ["first", "second"]) {
    $(which + "Color").addEventListener("input", () => {
        const curve = selection && state.curves[selection.curve];
        if (!curve)
            return;
        const sides = curve.closed ? ["inside", "outside"] : ["left", "right"];
        curve[sides[which === "first" ? 0 : 1]] = $(which + "Color").value;
        changed();
    });
}

const TOOL_NOTES = {
    select: "Click a curve to select it, and drag it to move it. Click a swatch to change that side's color. Shapes keep their form: drag a line's or an arc's ends, an arc's middle to bend it, or an ellipse's center, its radii, and the knob that turns it. Hold Shift to make an ellipse a circle, or to turn it in steps of 15°. On a path, drag its nodes and handles, and double-click a node to switch it between corner and smooth.",
    pen: "Click to add corner nodes, or drag to add smooth ones. Click the first node to close the curve, or double-click to leave it open.",
    line: "Drag to draw a straight line.",
    ellipse: "Drag to draw an ellipse. Hold Shift for a circle.",
    arc: "Drag from one end of the arc to the other. It bulges to the left of the way you drag, as half a circle; drag its middle to bend it more or less.",
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

$("toPath").addEventListener("click", () => {
    const curve = selection && state.curves[selection.curve];
    if (!curve || isPath(curve))
        return;
    convertToPath(curve);
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

__COMMON_CONTROLS__
// MARK: - CSS

// A made-up diffusion-gradient(), each curve written as a CSS shape:
//
//   diffusion-gradient( [ harmonic || in <space> ]? , <diffusion-curve># )
//   <diffusion-curve> = <basic-shape> [ left <color> right <color> | inside <color> outside <color> ]
//                       [ strength <percentage> ]? [ blur <length> ]?

const number = v => String(Math.round(v * 100) / 100 || 0);
const percent = v => `${number(v * 100)}%`;
const position = ([x, y]) => `${percent(x)} ${percent(y)}`;
const pixels = v => `${number(v)}px`;

// A shape() of Bézier nodes: a line for each straight stretch and a curve for each other, closed if the curve is.
function pathShape(curve, nodes) {
    const commands = [`from ${position(nodes[0].p)}`];
    stretches({ ...curve, kind: "path", nodes }).forEach(([p0, p1, p2, p3], i, all) => {
        const straight = p1[0] === p0[0] && p1[1] === p0[1] && p2[0] === p3[0] && p2[1] === p3[1];
        // A closed shape's last stretch, if it's straight, is the close.
        if (curve.closed && straight && i === all.length - 1 && i > 0)
            return;
        commands.push(straight ? `line to ${position(p3)}` : `curve to ${position(p3)} with ${position(p1)} / ${position(p2)}`);
    });
    if (curve.closed)
        commands.push("close");
    return `shape(${commands.join(", ")})`;
}

function shapeText(curve) {
    const { width, height } = state;
    switch (curve.kind) {
    case "ellipse": {
        const [rx, ry] = [curve.radii[0] * width, curve.radii[1] * height];
        const turn = ((curve.angle % 180) + 180) % 180;
        if (Math.abs(rx - ry) < 0.5)
            return `circle(${pixels(rx)} at ${position(curve.center)})`;
        if (turn < 0.05 || turn > 179.95)
            return `ellipse(${percent(curve.radii[0])} ${percent(curve.radii[1])} at ${position(curve.center)})`;
        if (Math.abs(turn - 90) < 0.05)
            return `ellipse(${percent(ry / width)} ${percent(rx / height)} at ${position(curve.center)})`;
        // Turned: four quarter arcs around it, clockwise.
        const quarters = [1, 2, 3, 0].map(i => `arc to ${position(ellipsePoint(curve, i * Math.PI / 2))} of ${pixels(rx)} ${pixels(ry)} cw rotate ${number(curve.angle)}deg`);
        return `shape(from ${position(ellipsePoint(curve, 0))}, ${quarters.join(", ")}, close)`;
    }
    case "line":
        return `shape(from ${position(curve.from)}, line to ${position(curve.to)})`;
    case "arc": {
        const g = arcGeometry(curve);
        if (g.straight)
            return `shape(from ${position(curve.from)}, line to ${position(curve.to)})`;
        const radius = g.radius * Math.min(width, height);
        const size = Math.abs(g.sweep) > Math.PI ? " large" : "";
        return `shape(from ${position(curve.from)}, arc to ${position(curve.to)} of ${pixels(radius)} ${g.sweep > 0 ? "cw" : "ccw"}${size})`;
    }
    default:
        return curve.nodes.length ? pathShape(curve, curve.nodes) : "shape(from 0 0)";
    }
}

function curveText(curve) {
    const sides = curve.closed ? ["inside", "outside"] : ["left", "right"];
    let text = `${shapeText(curve)} ${sides.map(side => `${side} ${curve[side]}`).join(" ")}`;
    if ((curve.strength ?? 100) !== 100)
        text += ` strength ${curve.strength}%`;
    if ((curve.blur ?? 0) !== 0)
        text += ` blur ${curve.blur}px`;
    return text;
}

function cssText() {
    const prelude = [state.models.length === 1 && state.models[0] === "harmonic" ? "harmonic" : "", `in ${SHADER_SPACES[state.space]}`].filter(Boolean).join(" ");
    const lines = [prelude, ...state.curves.map(curveText)];
    return `background-image: diffusion-gradient(${lines.join(",\n    ")});`;
}

async function copy(text, label) {
    try {
        await navigator.clipboard.writeText(text);
        $("copyStatus").textContent = `Copied ${label}.`;
    } catch {
        $("output").select();
        $("copyStatus").textContent = document.execCommand("copy") ? `Copied ${label}.` : "Couldn't copy.";
    }
    setTimeout(() => $("copyStatus").textContent = "", 1500);
}
$("copyCSS").addEventListener("click", () => copy($("output").value, "the CSS"));
$("copyLink").addEventListener("click", () => {
    writeHash();
    copy(location.href, "the link");
});

__COMMON_FRAGMENT__
