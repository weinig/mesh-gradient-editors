// What the renderer draws, measured from its solve. Colors run 0 to 1, and the tolerances are a few times what
// these measured when they were written.

// Two-colored lines for the tests: gray levels, in srgb, so a component is the gray.
const grayLine = (from, to, left, right, more = {}) => ({ ...line(from, to), left, right, ...more });

test("biharmonic Strength mixes from the gradient without the curve to the one with it", async t => {
    await preset("Strength");
    set("numbers", true);
    const curve = (x, strength) => ({ ...line([x, 0.2], [x + 0.1, 0.8]), left: "#7a2cff", right: "#ffc400", strength });
    const solve = async curves => {
        state.curves = curves;
        return Float32Array.from((await grab(0)).values);
    };
    const zero = await solve([curve(0.25, 100), curve(0.6, 0)]);
    const absent = await solve([curve(0.25, 100)]);
    const full = await solve([curve(0.25, 100), curve(0.6, 100)]);
    const half = await solve([curve(0.25, 100), curve(0.6, 50)]);
    t.above(difference(full, absent), 0.5, "a full-strength curve changes the gradient");
    t.below(difference(zero, absent), 0.02, "a curve at 0% is as no curve");
    t.below(difference(half, absent.map((v, i) => 0.5 * v + 0.5 * full[i])), 0.02, "a curve at 50% is halfway between");
});

test("harmonic Strength is the same on every grid", async t => {
    set("space", "srgb");
    set("numbers", true);
    state.width = state.height = 512;
    const values = [];
    // The grids where a band is its own 1% of the box: on coarser ones it's 3 texels, which is wider, and holds more.
    for (const resolution of ["512", "1024"]) {
        set("resolution", resolution);
        state.curves = [
            grayLine([0.55, 0.1], [0.55, 0.9], "#000000", "#000000"),
            grayLine([0.65, 0.1], [0.65, 0.9], "#000000", "#000000"),
            grayLine([0.6, 0.1], [0.6, 0.9], "#ffffff", "#ffffff", { strength: 30 }),
        ];
        values.push(sampleReadout(await grab(1), [0.6, 0.5])[0]);
    }
    t.below(Math.max(...values) - Math.min(...values), 0.02, `a 30% curve's color across grids (${values.map(v => v.toFixed(3)).join(", ")})`);
    t.above(Math.min(...values), 0.85, "and it holds most of its color");
});

test("outside a two-sided corner, the texels hold the outside color", async t => {
    set("space", "srgb");
    set("numbers", true);
    set("resolution", "512");
    state.width = state.height = 512;
    state.curves = [{ kind: "path", closed: false, nodes: [node(0.2, 0.5), node(0.5, 0.5), node(0.5, 0.2)], left: "#ff0000", right: "#0000ff" }];
    for (const view of [0, 1]) {
        const readout = await grab(view);
        // Beside the corner, in the two patches a segment's cap used to hold to a mix, and well along each segment.
        for (const [patch, reference] of [[[0.506, 0.494], [0.506, 0.35]], [[0.494, 0.506], [0.35, 0.506]]]) {
            const here = sampleReadout(readout, patch), there = sampleReadout(readout, reference);
            t.below(Math.max(...[0, 1, 2].map(k => Math.abs(here[k] - there[k]))), 0.05, `${views[view].model}: the patch at ${patch}`);
        }
    }
});

test("an edge is antialiased with a mix of its two colors, not a third hue", async t => {
    set("space", "oklch");
    state.width = state.height = 512;
    // Off the pixel grid and tilted, so the edge is antialiased; red to cyan, whose hues are far apart.
    state.curves = [grayLine([0.5003, 0.1], [0.5103, 0.9], "#ff0000", "#00ffff")];
    state.showCurves = false;
    changed();
    await sleep(1500);
    render();
    const gpu = views[1].gpu;
    const canvas = Object.assign(document.createElement("canvas"), { width: gpu.width, height: gpu.height });
    const context = canvas.getContext("2d");
    context.drawImage(gpu, 0, 0);
    let mixed = 0;
    for (const fraction of [0.3, 0.5, 0.7]) {
        const y = Math.round(fraction * gpu.height), x = Math.round((0.5003 + 0.0125 * (fraction - 0.1)) * gpu.width) - 3;
        const pixels = context.getImageData(x, y, 7, 1).data;
        for (let i = 0; i < 7; ++i) {
            const [r, g, b] = [pixels[4 * i], pixels[4 * i + 1], pixels[4 * i + 2]];
            // Not one of the two sides.
            if (r < 250 && g < 250) {
                ++mixed;
                // A mix of red and cyan has as much green as blue; the hue between them, orange, has no blue.
                t.below(Math.abs(g - b), 12, `the edge pixel (${r}, ${g}, ${b}) at ${fraction}`);
            }
        }
    }
    t.above(mixed, 1, "edge pixels found");
});

test("on a coarse grid a curve still holds its slope", async t => {
    set("space", "srgb");
    set("numbers", true);
    for (const name of ["A circle", "Overlapping shapes", "Blur"]) {
        await preset(name);
        set("space", "srgb");
        for (const resolution of ["128", "256", "512"]) {
            set("resolution", resolution);
            const [low, high] = range(await grab(0));
            t.above(low, -0.06, `${name} at ${resolution}: the least color`);
            t.below(high, 1.1, `${name} at ${resolution}: the greatest color`);
        }
    }
});

test("a lone free-slope line with natural edges is a plane through both its colors", async t => {
    set("space", "srgb");
    set("numbers", true);
    set("resolution", "256");
    set("edges", "natural");
    state.width = state.height = 512;
    state.curves = [grayLine([0.5, 0.2], [0.5, 0.8], "#404040", "#c0c0c0", { free: true })];
    const { width, height, values } = await grab(0);
    // The plane that best fits the first component, and the worst miss from it as a share of the range.
    let n = 0, sx = 0, sy = 0, sv = 0, sxx = 0, syy = 0, sxy = 0, sxv = 0, syv = 0, low = Infinity, high = -Infinity;
    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
            const v = values[4 * (y * width + x)];
            ++n; sx += x; sy += y; sv += v; sxx += x * x; syy += y * y; sxy += x * y; sxv += x * v; syv += y * v;
            low = Math.min(low, v); high = Math.max(high, v);
        }
    }
    const mx = sx / n, my = sy / n, mv = sv / n;
    const cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my, cxv = sxv / n - mx * mv, cyv = syv / n - my * mv;
    const det = cxx * cyy - cxy * cxy, b = (cxv * cyy - cyv * cxy) / det, c = (cyv * cxx - cxv * cxy) / det, a = mv - b * mx - c * my;
    let miss = 0;
    for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x)
            miss = Math.max(miss, Math.abs(values[4 * (y * width + x)] - (a + b * x + c * y)));
    }
    t.above(high - low, 50, "the plane is steep: the two colors are a texel apart");
    t.below(miss / (high - low), 0.005, "the worst miss from a plane, as a share of the range");
});

test("free slopes and natural edges draw at every grid", async t => {
    await preset("Flat and smooth");
    set("edges", "natural");
    for (const resolution of ["128", "512", "1024"]) {
        set("resolution", resolution);
        await sleep(600);
        t.ok(!gpuError, `at ${resolution}: ${gpuError}`);
    }
});
