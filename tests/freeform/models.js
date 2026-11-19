// The three models' numbers and the CSS, against what they gave when these tests were written: see golden.js.

const cssHash = text => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; ++i) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16);
};

// Each model's four components, summed over a 3 by 3 grid of points in the box.
function modelSums() {
    return Object.fromEntries(MODELS.filter(model => splines[model]).map(model => {
        const total = [0, 0, 0, 0];
        for (const x of [0.1, 0.5, 0.9]) {
            for (const y of [0.15, 0.5, 0.85]) {
                const color = interpolatedColor(splines[model], [x * state.width, y * state.height]);
                for (let k = 0; k < 4; ++k)
                    total[k] += color[k];
            }
        }
        return [model, total.map(v => +v.toFixed(4))];
    }));
}

// What golden.js holds, from the page as it is now: paste console.log(JSON.stringify(captureGolden())) into it.
function captureGolden() {
    const golden = { presets: { }, options: { } };
    for (const [index, { name }] of PRESETS.entries()) {
        set("preset", String(index));
        render();
        golden.presets[name] = { css: cssHash(cssText()), sums: modelSums() };
    }
    return golden;
}

test("every preset's models and CSS are as they were", async t => {
    t.equal(PRESETS.map(preset => preset.name).join(), Object.keys(GOLDEN.presets).join(), "the presets");
    for (const [index, { name }] of PRESETS.entries()) {
        const golden = GOLDEN.presets[name];
        if (!golden)
            continue;
        set("preset", String(index));
        render();
        t.ok(!gpuError, `${name}: ${gpuError}`);
        t.equal(cssHash(cssText()), golden.css, `${name}: the CSS (${cssText().slice(0, 60)}…)`);
        const sums = modelSums();
        for (const model of MODELS) {
            const worst = Math.max(...golden.sums[model].map((value, k) => Math.abs(value - (sums[model]?.[k] ?? NaN))));
            t.ok(worst <= 2e-4, `${name}: the ${model} model is off by ${worst}`);
        }
    }
});

test("Stop size, Spread sets and Edges each give what they did", async t => {
    await preset("Stops with spread");
    for (const [key, [biharmonic, harmonic]] of Object.entries(GOLDEN.options)) {
        const [hold, meaning, edges] = key.split("/");
        set("hold", hold);
        set("spreadMeaning", meaning);
        set("edges", edges);
        render();
        const sums = modelSums();
        t.ok(Math.abs(sums.biharmonic[0] - biharmonic) <= 2e-4, `${key}: the biharmonic grid gave ${sums.biharmonic[0]}, not ${biharmonic}`);
        t.ok(Math.abs(sums.harmonic[0] - harmonic) <= 2e-4, `${key}: the harmonic grid gave ${sums.harmonic[0]}, not ${harmonic}`);
    }
    set("hold", "points");
    set("spreadMeaning", "none");
    set("edges", "mirrored");
});

test("the thin-plate spline goes through its stops, and three stops make a plane", async t => {
    await preset("Scattered sunset");
    render();
    for (const center of splines.spline.centers) {
        const stop = state.stops[center.stop];
        const here = interpolatedColor(splines.spline, [stop.pos[0] / 100 * state.width, stop.pos[1] / 100 * state.height]);
        t.below(Math.max(...here.map((value, k) => Math.abs(value - center.color[k]))), 1e-6, `stop ${center.stop + 1}: the spline's miss at the stop`);
    }
    await preset("Three stops");
    render();
    // A plane's value in the middle of two points is the mean of its values at them.
    const at = (x, y) => interpolatedColor(splines.spline, [x * state.width, y * state.height]);
    const a = at(0.1, 0.2), b = at(0.9, 0.7), middle = at(0.5, 0.45);
    t.below(Math.max(...middle.map((value, k) => Math.abs(value - (a[k] + b[k]) / 2))), 1e-6, "the spline through three stops, off a plane");
});
