// The page's own features: the three models' boxes, color spaces, views, panels, and links.

test("three boxes, the thin plate spline first", async t => {
    t.equal(MODELS.join(), "spline,biharmonic,harmonic", "the models");
    t.equal(views.filter(view => !view.figure.hidden).length, 3, "boxes shown to start with");
    t.equal(views[0].renderer.constructor.name, "SplineRenderer", "the spline's renderer");
    t.equal(views[1].renderer.constructor.name, "WebGPUFreeformGradientRenderer", "the biharmonic's renderer");
    const buttons = [...document.querySelectorAll("#modelBar button")];
    t.equal(buttons.map(button => button.textContent).join("|"), "Thin plate spline|Biharmonic|Harmonic", "the model buttons");
    t.ok($("output").value.startsWith("background-image: freeform-gradient(in oklab,"), "the CSS is the spline's by default");
    set("space", "srgb");
    t.ok(cssText().startsWith("background-image: freeform-gradient(#"), "with no interpolation method when it's the one WebKit would choose");
    set("space", "oklab");
    buttons[0].click();
    await sleep(300);
    t.ok(views[0].figure.hidden && !views[1].figure.hidden, "its button hides the spline's box");
    t.ok($("output").value.startsWith("background-image: freeform-gradient(biharmonic in oklab,"), "and the CSS names the first model shown");
    buttons[1].click();
    buttons[2].click();
    t.equal(state.models.join(), "harmonic", "the last model shown stays");
    buttons[0].click();
    buttons[1].click();
    await sleep(300);
    t.equal(state.models.join(), "spline,biharmonic,harmonic", "the models come back in their order");
    $("aboutButton").click();
    await sleep(200);
    t.equal(views.map(view => view.figure.querySelectorAll(".modelPros li").length).join(), "5,5,3", "each model's pros");
});

test("every interpolation space and view draws", async t => {
    await preset("A color wheel");
    state.stops[6].color = "rgb(255 255 255 / 0.3)";
    state.stops[0].color = "hsl(none 90% 50%)";
    changed();
    for (const space of SPACES) {
        set("space", space);
        await sleep(450);
        t.ok(!gpuError, `${space} gave a WebGPU error: ${gpuError}`);
    }
    set("space", "oklch");
    selection = 0;
    for (const view of ["holds", "gamut", "isolines", "difference", "level", "relaxation", "influence", "plane", "term", "basis", "gradient"]) {
        set("view", view);
        await sleep(450);
        t.equal($("view").value, view, `the ${view} view is available`);
        t.ok(!gpuError, `the ${view} view gave a WebGPU error: ${gpuError}`);
    }
    for (const edges of EDGES) {
        set("edges", edges);
        await sleep(450);
        t.ok(!gpuError, `${edges} edges gave a WebGPU error: ${gpuError}`);
    }
    for (const id of ["crossSection", "sheet", "numbers", "otherCurves"])
        set(id, true);
    await sleep(2500);
    t.equal(views.filter(view => view.readout).length, 3, "boxes read back for the panels");
    t.ok(/texels/.test(views[0].numbers.textContent), "the spline's box has numbers");
});

test("every preset draws, and its link comes back the same", async t => {
    for (const { name } of PRESETS) {
        await preset(name);
        t.ok(!gpuError, `${name}: ${gpuError}`);
        t.equal(JSON.stringify(decodeState(encodeState())), JSON.stringify(state), `${name}: its link`);
    }
});

test("bad links are made sound", async t => {
    const bad = btoa(JSON.stringify({
        v: 1, stops: [{ p: [0.1, 0.1], color: "red" }, { p: [0.9, 0.9], color: "blue", spread: 500 }, { p: "x" }],
        models: ["nope"], steps: 20, section: 5, view: "nope", resolution: 4096, stopSize: "huge",
    }));
    const decoded = decodeState(bad);
    t.equal(decoded.stops.length, 2, "a link's unsound stops are dropped");
    t.equal(decoded.stops[1].spread, 100, "and a spread kept to 100%");
    t.equal(`${decoded.models.join("+")} ${decoded.steps} ${decoded.view} ${decoded.resolution} ${decoded.stopSize}`, "spline+biharmonic+harmonic 12 gradient 512 disc", "and its settings");
    t.equal(decodeState(btoa(JSON.stringify({ v: 1, stops: 5 }))), null, "a link with no stops isn't read");
    t.equal(decodeState(btoa(JSON.stringify({ v: 1, stops: [], models: ["harmonic", "spline"] }))).models.join(), "spline,harmonic", "a link's models are put in order");
});

test("links from the editor this one replaced are read", async t => {
    const old = {
        v: 1, w: 500, h: 300, s: "srgb", o: 1, k: "none", vw: "grid", n: 1, x: 1, r: 25, xk: 0, xs: [10, 50, 90, 50], m: 0, d: 1, dc: 2,
        md: "spline", ed: "free", ho: "discs", sm: "none", rf: "spline", oc: 0, gr: 64, ds: 0.02, ms: ["spline", "harmonic"], nb: 0, ab: 0, cl: 0,
        gm: "srgb", gmap: "clip", sp: [0.3, null], p: [["#ff0000", 20, 30], ["blue", 104, -6, 2]],
    };
    const decoded = decodeState(btoa(JSON.stringify(old)));
    t.equal(`${decoded.width} ${decoded.height} ${decoded.space} ${decoded.backdrop} ${decoded.gamut} ${decoded.gamutMapping}`, "500 300 srgb none srgb clip", "the box and its settings");
    t.equal(`${decoded.edges} ${decoded.stopSize} ${decoded.view} ${decoded.models.join("+")}`, "free disc holds spline+harmonic", "the edges, stops, view and models");
    t.equal(`${decoded.normalization} ${decoded.crossSection} ${decoded.sectionKind} ${decoded.sectionRow} ${decoded.sheet} ${decoded.sheetHeight}`, "true true row 0.25 true c2", "the visualizations");
    t.equal(JSON.stringify(decoded.stops.map(stop => [stop.color, ...stop.p, stop.weight])), '[["#ff0000",0.2,0.3,null],["blue",1.04,-0.06,2]]', "the stops");
    // A spread of 0.3 was a disc 0.15 of the shorter side in radius; the default, 0.02, one of 0.01.
    t.equal(decoded.stops.map(stop => stop.spread).join(), "41,0", "their spreads");
    t.equal(Object.keys(decoded).filter(key => key.length <= 2).join(), "", "none of the old names is left");
});

test("free edges are open and natural at once", async t => {
    await preset("Stops just outside the box");
    set("numbers", true);
    set("edges", "mirrored");
    const mirrored = await grab(1);
    const corner = readout => sampleReadout(readout, [0.98, 0.5]);
    set("edges", "free");
    const free = await grab(1);
    t.ok(!gpuError, `free edges gave a WebGPU error: ${gpuError}`);
    t.equal(free.window.join(), "0.25,0.25,0.5,0.5", "the box is the middle of the grid");
    t.ok(views[1].renderer.gradient.naturalEdges, "and nothing holds its sides");
    // The magenta stop is outside the box's right side: only the bigger grid takes it in.
    t.above(difference(corner(free), corner(mirrored)), 0.05, "a stop outside the box changes the colors beside it");
});

test("the spline's own views, numbers and shares", async t => {
    await preset("Two stops close together");
    selection = 0;
    set("numbers", true);
    set("view", "plane");
    await sleep(400);
    t.equal(views[0].renderer.gradient.spline.centers.length, 0, "the linear part has no stop's term");
    set("view", "term");
    await sleep(400);
    t.equal(views[0].renderer.gradient.spline.centers.length, 1, "with the selected stop's term, one");
    set("view", "basis");
    await sleep(400);
    t.equal(views[0].influence.gradient.spline.centers[0].slice(2).join(), "1,1,1,0", "U(r) is the selected stop's term with a weight of 1");
    selection = null;
    changed();
    await sleep(300);
    t.ok($("view").querySelector('[value="basis"]').disabled, "U(r) needs a selected stop");
    set("view", "gradient");
    await grab(0);
    await grab(2);
    await sleep(300);
    t.ok(/Past the stops' colors, in Oklab: [\d.]+ lighter, [\d.]+ darker/.test(views[0].numbers.textContent), "the spline goes past the stops' colors");
    t.ok(/\na\t.*\nb\t.*\nc\t.*\nw1\t/.test(views[0].numbers.textContent), "and its box has the spline's coefficients");
    t.ok(/Within the stops' colors/.test(views[2].numbers.textContent), "the harmonic model stays within them");
    t.ok(views[0].worst && !views[2].worst, "the spline's box marks where it goes furthest");
    const shares = EXTRA.sample(views[0], state.stops[1].p)[0];
    t.equal(shares, "Each stop's share: 1: 0%, 2: 100%, 3: 0%, 4: 0%", "at a stop, the color is all that stop's");
    t.equal(EXTRA.sample(views[1], [0.5, 0.5]).length, 0, "the grid models' boxes have no shares");
    set("normalization", true);
    await sleep(200);
    t.ok(shown("normalizationNote") && /farthest is at a distance of 1/.test($("normalizationNote").textContent), "the normalization's note");
});
