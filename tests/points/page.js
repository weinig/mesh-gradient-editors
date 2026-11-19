// The page's own features: the three models' boxes, color spaces, views, panels, and links.

test("three boxes, the thin plate spline first", async t => {
    t.equal(MODELS.join(), "spline,biharmonic,harmonic", "the models");
    t.equal(views.filter(view => !view.figure.hidden).length, 3, "boxes shown to start with");
    t.equal(views[0].renderer.constructor.name, "SplineRenderer", "the spline's renderer");
    t.equal(views[1].renderer.constructor.name, "WebGPUFreeformGradientRenderer", "the biharmonic's renderer");
    const buttons = [...document.querySelectorAll("#modelBar button")];
    t.equal(buttons.map(button => button.textContent).join("|"), "Thin plate spline|Biharmonic|Harmonic", "the model buttons");
    t.ok($("output").value.startsWith("background-image: freeform-gradient(in oklab,"), "the CSS is the spline's by default");
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
    for (const view of ["holds", "gamut", "isolines", "difference", "level", "relaxation", "influence", "gradient"]) {
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
