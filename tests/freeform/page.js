// The freeform-gradient() editor's cross-section: a row, as before, or a line from A to B.

test("the cross-section along a row or a line", async t => {
    set("crossSectionToggle", true);
    set("sheetToggle", true);
    await sleep(1500);
    t.equal(state.sectionKind, "row", "it starts along a row");
    const before = views[0].plot.toDataURL().length;
    set("sectionKind", "line");
    await sleep(1000);
    t.ok($("row").closest(".row").hidden, "a line hides the Row slider");
    t.ok(/Drag A and B/.test($("crossSectionNote").textContent), "and says how to move its ends");
    const overlay = views[0].overlay, rect = overlay.getBoundingClientRect();
    const fire = (type, position) => {
        const [x, y] = toOverlay(position);
        overlay.dispatchEvent(new PointerEvent(type, {
            bubbles: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: type === "pointerup" ? 0 : 1,
            clientX: rect.left + x * viewScale, clientY: rect.top + y * viewScale,
        }));
    };
    const stops = state.stops.length;
    fire("pointerdown", state.section[1]);
    await sleep(50);
    fire("pointermove", [80, 30]);
    await sleep(50);
    fire("pointermove", [75, 15]);
    await sleep(50);
    fire("pointerup", [75, 15]);
    await sleep(1000);
    t.equal(JSON.stringify(state.section[1]), "[75,15]", "B drags to where the pointer goes");
    t.equal(state.stops.length, stops, "without adding a stop");
    const back = decodeState(encodeState());
    t.equal(`${back?.sectionKind} ${JSON.stringify(back?.section)}`, "line [[10,50],[75,15]]", "the line survives the link");
    t.ok(views[0].plot.toDataURL().length !== before, "the plot follows the line");
    set("sectionKind", "row");
    await sleep(800);
    t.equal(JSON.stringify(sectionEnds()), "[[0,50],[100,50]]", "the row is as it was");
});

test("every view and panel draws", async t => {
    await preset("Scattered sunset");
    for (const view of VIEWS) {
        set("view", view);
        render();
        t.ok(!gpuError, `the ${view} view: ${gpuError}`);
    }
    set("view", "gradient");
    for (const id of ["clippingToggle", "normalizationToggle", "sampleToggle", "numbersToggle", "sheetToggle", "crossSectionToggle"]) {
        set(id, true);
        render();
        t.ok(!gpuError, `with ${id} on: ${gpuError}`);
    }
    await sleep(500);
    t.above($("numbersTable").querySelectorAll("tbody tr").length, 1, "the numbers table's rows");
    t.ok(!$("crossSectionPanel").hidden && !$("sheetPanel").hidden, "the cross-section's and 3D's panels show");
    for (const id of ["clippingToggle", "normalizationToggle", "sampleToggle", "numbersToggle", "sheetToggle", "crossSectionToggle"])
        set(id, false);
    render();
});

test("the models' buttons show and hide their boxes", async t => {
    await preset("Scattered sunset");
    const visible = () => views.filter(view => !view.figure.hidden).length;
    t.equal(visible(), 3, "boxes to start with");
    const button = [...document.querySelectorAll("#modelBar button")].find(button => button.textContent.includes("Harmonic"));
    button.click();
    render();
    t.equal(visible(), 2, "boxes with the harmonic grid off");
    t.ok(!state.models.includes("harmonic"), "and it's out of the state");
    button.click();
    render();
    t.equal(visible(), 3, "boxes with it back on");
});

test("a link carries the gradient and its settings", async t => {
    for (const { name } of PRESETS) {
        await preset(name);
        const back = decodeState(encodeState());
        t.ok(!!back, `${name}: its link reads back`);
        for (const key of ["stops", "width", "height", "space", "models", "view", "edges", "hold", "spreadMeaning", "gridResolution", "defaultSpread"])
            t.equal(JSON.stringify(back?.[key]), JSON.stringify(state[key]), `${name}: ${key}`);
    }
    t.equal(decodeState("not a link"), null, "a bad link is no state");
});

test("adding, moving, editing and removing stops", async t => {
    await preset("Three stops");
    render();
    const overlay = views[0].overlay;
    const client = position => {
        const rect = overlay.getBoundingClientRect(), [x, y] = toOverlay(position);
        return { clientX: rect.left + x * viewScale, clientY: rect.top + y * viewScale };
    };
    const fire = (type, position) => overlay.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: type === "pointerup" ? 0 : 1, ...client(position),
    }));
    const count = state.stops.length;
    // A pointer lands on a whole pixel, so within half a percent of where it's aimed.
    const near = (position, [x, y]) => Math.abs(position[0] - x) <= 0.5 && Math.abs(position[1] - y) <= 0.5;
    overlay.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, ...client([60, 60]) }));
    t.equal(state.stops.length, count + 1, "a double-click adds a stop");
    const added = state.stops.at(-1);
    t.ok(near(added.pos, [60, 60]), `where it was clicked: ${added.pos}`);
    t.equal(selected, count, "and selects it");
    // In the color that was there, so the gradient doesn't change.
    const before = interpolatedColor(splines.spline, [0.3 * state.width, 0.3 * state.height]);
    render();
    const after = interpolatedColor(splines.spline, [0.3 * state.width, 0.3 * state.height]);
    t.below(Math.max(...before.map((value, k) => Math.abs(value - after[k]))), 0.01, "the new stop changes the spline elsewhere by");
    fire("pointerdown", added.pos);
    await sleep(40);
    fire("pointermove", [70, 50]);
    await sleep(40);
    fire("pointerup", [70, 50]);
    t.ok(near(state.stops.at(-1).pos, [70, 50]), `a drag moves it: ${state.stops.at(-1).pos}`);
    set("stopX", "25");
    set("stopY", "35");
    t.equal(JSON.stringify(state.stops[selected].pos), "[25,35]", "the position fields move it");
    $("stopText").value = "rgb(10 20 30)";
    $("stopText").dispatchEvent(new Event("input"));
    t.equal(state.stops[selected].color, "rgb(10 20 30)", "the color field colors it");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    t.equal(state.stops.length, count, "Delete removes the selected stop");
    $("addStop").click();
    t.equal(state.stops.length, count + 1, "Add stop adds one");
    $("removeStop").click();
    t.equal(state.stops.length, count, "Remove stop removes it");
    render();
});
