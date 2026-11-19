// The thin plate spline's box, measured from what it draws. Colors run 0 to 1.

const plainStop = (x, y, color, spread = 0) => ({ p: [x, y], color, opacity: 100, spread });

// The worst difference between the spline's box and `expected(x, y)`, a color at a point of the box, over its texels.
function worstMiss({ width, height, values, window }, expected) {
    let worst = 0;
    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
            const p = [((x + 0.5) / width - window[0]) / window[2], ((y + 0.5) / height - window[1]) / window[3]];
            const color = expected(...p);
            for (let k = 0; k < color.length; ++k)
                worst = Math.max(worst, Math.abs(values[4 * (y * width + x) + k] - color[k]));
        }
    }
    return worst;
}

// The spline fit here, in doubles, from the page's stops.
function fitHere() {
    const { points } = gradientData("spline");
    const colors = state.stops.map((_, i) => points.slice(i * 8, i * 8 + 4));
    return fitSpline(colors);
}

test("the spline has each stop's color at the stop", async t => {
    set("space", "srgb");
    for (const { name } of PRESETS) {
        await preset(name);
        const fit = fitHere();
        const { points } = gradientData("spline");
        let worst = 0;
        state.stops.forEach((stop, i) => {
            const color = splineColor(fit, stop.p);
            for (let k = 0; k < 4; ++k)
                worst = Math.max(worst, Math.abs(color[k] - points[i * 8 + k]));
        });
        t.below(worst, 1e-9, `${name}: the worst miss at a stop`);
    }
});

test("the spline's box is the spline at each texel", async t => {
    set("space", "srgb");
    set("numbers", true);
    for (const name of ["Four stops", "Six stops", "Two stops close together", "Stops on a line", "Stops in one corner", "Opacity"]) {
        await preset(name);
        const fit = fitHere();
        const readout = await grab(0);
        const [low, high] = range(readout);
        // In single precision on the GPU, against doubles here; as a fraction of how far the colors range.
        t.below(worstMiss(readout, (x, y) => splineColor(fit, [x, y])) / Math.max(1, high - low), 2e-5, `${name}: the worst miss from the spline`);
    }
});

test("three stops make a plane, whatever the edges, the grid and the stops' size", async t => {
    set("space", "srgb");
    set("numbers", true);
    state.width = 600;
    state.height = 400;
    const corners = [[0.2531, 0.3012, [1, 0, 0]], [0.7479, 0.3558, [0, 1, 0]], [0.4467, 0.7519, [0, 0, 1]]];
    const [[x0, y0, c0], [x1, y1, c1], [x2, y2, c2]] = corners;
    const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    const plane = (x, y) => {
        const u = ((x - x0) * (y2 - y0) - (x2 - x0) * (y - y0)) / det, v = ((x1 - x0) * (y - y0) - (x - x0) * (y1 - y0)) / det;
        return c0.map((_, k) => c0[k] + u * (c1[k] - c0[k]) + v * (c2[k] - c0[k]));
    };
    for (const [edges, resolution, stopSize] of [["mirrored", "128", "disc"], ["open", "256", "disc"], ["natural", "512", "texel"]]) {
        set("edges", edges);
        set("resolution", resolution);
        set("stopSize", stopSize);
        state.stops = corners.map(([x, y, c]) => plainStop(x, y, "#" + c.map(v => (v ? "ff" : "00")).join(""), 40));
        t.below(worstMiss(await grab(0), plane), 2e-5, `${edges} edges at ${resolution}: the worst miss from the plane`);
    }
});

test("with one-texel stops and natural edges the biharmonic model is nearer the spline", async t => {
    set("space", "srgb");
    set("numbers", true);
    set("resolution", "256");
    await preset("Four stops");
    const apart = async () => difference((await grab(0)).values, (await grab(1)).values);
    const mirrored = await apart();
    set("edges", "natural");
    set("stopSize", "texel");
    const natural = await apart();
    t.above(mirrored, 0.05, "with mirrored edges and discs, the worst difference from the spline");
    t.below(natural, mirrored / 2, `with natural edges and one-texel stops (mirrored ${mirrored.toFixed(4)})`);
});

test("one stop, stops in the same place, and stops on a line", async t => {
    set("space", "srgb");
    set("numbers", true);
    state.stops = [plainStop(0.3, 0.4, "#ff8000")];
    let readout = await grab(0);
    t.below(worstMiss(readout, () => [1, 128 / 255, 0, 1]), 1e-6, "one stop's color fills the box");
    // Where stops share a position, the last is used.
    state.stops = [plainStop(0.3, 0.4, "#ff0000"), plainStop(0.7, 0.6, "#0000ff"), plainStop(0.3, 0.4, "#00ff00")];
    readout = await grab(0);
    const at = sampleReadout(readout, [0.3, 0.4]);
    t.below(Math.hypot(at[0], at[1] - 1, at[2]), 0.02, "the last of two stops in one place is used");
    // Stops on a line: the spline doesn't tilt across it, so it's the same on both sides.
    state.width = state.height = 400;
    state.stops = [plainStop(0.2, 0.2, "#000000"), plainStop(0.4, 0.4, "#ffffff"), plainStop(0.8, 0.8, "#ff0000")];
    readout = await grab(0);
    for (const [x, y] of [[0.3, 0.6], [0.9, 0.1], [0.05, 0.5]]) {
        const sides = [sampleReadout(readout, [x, y]), sampleReadout(readout, [y, x])];
        t.below(Math.max(...[0, 1, 2].map(k => Math.abs(sides[0][k] - sides[1][k]))), 1e-3, `(${x}, ${y}) and its mirror in the line`);
    }
    t.above(Math.abs(sampleReadout(readout, [0.3, 0.6])[0] - sampleReadout(readout, [0.6, 0.9])[0]), 0.05, "along the line the color changes");
    t.ok(!gpuError, `a WebGPU error: ${gpuError}`);
});

test("the selected stop's influence is 1 at it and 0 at the others", async t => {
    await preset("Six stops");
    selection = 2;
    const { points, spline } = gradientData("spline", true);
    state.stops.forEach((stop, i) => {
        t.below(Math.abs(splineColor(spline, stop.p)[0] - (i === 2 ? 1 : 0)), 1e-9, `at stop ${i + 1}`);
    });
    t.equal(points.length / 8, 6, "a point for each stop");
});
