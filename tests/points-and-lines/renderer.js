// What the renderer draws, measured from its solve. Colors run 0 to 1, and the tolerances are a few times what
// these measured when they were written.

const plainStop = (x, y, color) => ({ p: [x, y], color, opacity: 100, spread: 0 });

// The plane through three stops' colors.
function planeThrough(stops) {
    const [[x0, y0, c0], [x1, y1, c1], [x2, y2, c2]] = stops;
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
        const plane = planeThrough(corners);
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

test("a one-texel stop's color is at the stop, wherever in its texel it is", async t => {
    set("space", "srgb");
    set("numbers", true);
    set("edges", "natural");
    set("stopSize", "texel");
    set("resolution", "128");
    state.width = state.height = 512;
    state.lines = [];
    // Stops away from their texels' centers, by different amounts.
    const corners = [[0.2531, 0.3012, [1, 0, 0]], [0.7479, 0.3558, [0, 1, 0]], [0.4467, 0.7519, [0, 0, 1]]];
    const hex = c => "#" + c.map(v => (v ? "ff" : "00")).join("");
    state.stops = corners.map(([x, y, c]) => plainStop(x, y, hex(c)));
    const { width, height, values } = await grab(0);
    const plane = planeThrough(corners);
    let worst = 0;
    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
            const expected = plane((x + 0.5) / width, (y + 0.5) / height);
            for (let k = 0; k < 3; ++k)
                worst = Math.max(worst, Math.abs(values[4 * (y * width + x) + k] - expected[k]));
        }
    }
    t.below(worst, 0.01, "the worst miss from the plane through the stops themselves");
});

test("moving a one-texel stop moves the gradient smoothly, not a texel at a time", async t => {
    set("space", "srgb");
    set("numbers", true);
    set("edges", "natural");
    set("stopSize", "texel");
    set("resolution", "128");
    state.width = state.height = 512;
    state.lines = [];
    // One stop moved across two texels in fifths of a texel, and the color far from it at each step.
    const seen = [];
    for (let step = 0; step <= 10; ++step) {
        state.stops = [plainStop(0.3 + step * 0.2 / 128, 0.5, "#000000"), plainStop(0.7, 0.52, "#ffffff"), plainStop(0.5, 0.2, "#808080")];
        seen.push(sampleReadout(await grab(0), [0.05, 0.9])[0]);
    }
    const steps = seen.slice(1).map((v, i) => Math.abs(v - seen[i]));
    const mean = steps.reduce((a, b) => a + b) / steps.length;
    t.above(mean, 1e-4, "the color far away changes as the stop moves");
    t.below(Math.max(...steps) / mean, 2.5, `the largest step over the mean step (${steps.map(v => v.toFixed(4)).join(", ")})`);
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
    const plane = planeThrough([[0.25, 0.3, [1, 0, 0]], [0.75, 0.35, [0, 1, 0]], [0.45, 0.75, [0, 0, 1]]]);
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
