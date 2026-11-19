// What the renderer draws, measured from its solve. Colors run 0 to 1, and the tolerances are a few times what
// these measured when they were written.

const plainStop = (x, y, color) => ({ p: [x, y], color, opacity: 100, spread: 0 });

// The plane through three stops' colors, each stop moved to the middle of the texel it's in, which is what a
// one-texel stop holds.
function planeThrough(stops, width, height) {
    const [[x0, y0, c0], [x1, y1, c1], [x2, y2, c2]] = stops.map(([x, y, c]) => [(Math.floor(x * width) + 0.5) / width, (Math.floor(y * height) + 0.5) / height, c]);
    const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    return (x, y) => {
        const u = ((x - x0) * (y2 - y0) - (x2 - x0) * (y - y0)) / det, v = ((x1 - x0) * (y - y0) - (x - x0) * (y1 - y0)) / det;
        return c0.map((_, k) => c0[k] + u * (c1[k] - c0[k]) + v * (c2[k] - c0[k]));
    };
}

test("with natural edges, three one-texel stops make a plane", async t => {
    set("space", "srgb");
    set("numbers", true);
    set("edges", "natural");
    set("stopSize", "texel");
    state.width = state.height = 512;
    state.lines = [];
    const corners = [[0.25, 0.3, [1, 0, 0]], [0.75, 0.35, [0, 1, 0]], [0.45, 0.75, [0, 0, 1]]];
    for (const [resolution, limit] of [["128", 0.01], ["256", 0.015], ["512", 0.035], ["1024", 0.07]]) {
        set("resolution", resolution);
        state.stops = [plainStop(0.25, 0.3, "#ff0000"), plainStop(0.75, 0.35, "#00ff00"), plainStop(0.45, 0.75, "#0000ff")];
        const { width, height, values, weights } = await grab(0);
        const plane = planeThrough(corners, width, height);
        let worst = 0;
        for (let y = 0; y < height; ++y) {
            for (let x = 0; x < width; ++x) {
                const expected = plane((x + 0.5) / width, (y + 0.5) / height);
                for (let k = 0; k < 3; ++k)
                    worst = Math.max(worst, Math.abs(values[4 * (y * width + x) + k] - expected[k]));
            }
        }
        t.below(worst, limit, `at ${width}: the worst miss from the plane`);
        // These stops are on texels' edges at these grids; each must still hold one texel, not two.
        t.equal(weights.reduce((count, w) => count + (w >= 1), 0), 3, `at ${width}: texels held`);
    }
});

test("with mirrored edges and discs, three stops are far from a plane", async t => {
    // What natural edges and one-texel stops change: this is here so the test above can't pass by accident.
    set("space", "srgb");
    set("numbers", true);
    set("resolution", "256");
    state.width = state.height = 512;
    state.lines = [];
    state.stops = [plainStop(0.25, 0.3, "#ff0000"), plainStop(0.75, 0.35, "#00ff00"), plainStop(0.45, 0.75, "#0000ff")];
    const { width, height, values } = await grab(0);
    const plane = planeThrough([[0.25, 0.3, [1, 0, 0]], [0.75, 0.35, [0, 1, 0]], [0.45, 0.75, [0, 0, 1]]], width, height);
    let worst = 0;
    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x)
            worst = Math.max(worst, Math.abs(values[4 * (y * width + x)] - plane((x + 0.5) / width, (y + 0.5) / height)[0]));
    }
    t.above(worst, 0.5, "the worst miss from the plane");
});

test("every preset draws with natural edges and one-texel stops", async t => {
    for (const { name } of PRESETS) {
        await preset(name);
        set("edges", "natural");
        set("stopSize", "texel");
        await sleep(500);
        t.ok(!gpuError, `${name}: ${gpuError}`);
    }
});
