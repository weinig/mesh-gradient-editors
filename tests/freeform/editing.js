// Adding, moving and removing stops.

// A key pressed with nothing focused.
const press = (key, more = {}) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...more }));

test("clicks add stops, drags move them, in any box", async t => {
    await preset("Three stops");
    for (const [index, view] of views.entries()) {
        const mouse = pointer(index);
        await mouse.click(0.6, 0.55);
        t.equal(state.stops.length, 4 + index, `a click in the ${view.model} box adds a stop`);
        t.equal(selection, 3 + index, "and selects it");
        t.ok(/^#[0-9a-f]{6}$/.test(state.stops.at(-1).color), "in the color there");
        await mouse.drag([[0.6, 0.55], [0.5, 0.5], [0.3, 0.6]]);
        t.below(Math.hypot(state.stops.at(-1).p[0] - 0.3, state.stops.at(-1).p[1] - 0.6), 0.01, "a drag moves it");
    }
    await pointer(0).drag([[0.3, 0.6], [0.1, 0.8], [-0.03, 0.9]]);
    t.equal(state.stops.length, 6, "a stop dragged a little outside the box stays");
    t.below(Math.abs(state.stops.at(-1).p[0] + 0.03), 0.01, "outside it");
    const count = state.stops.length;
    await pointer(0).click(-0.05, 0.3);
    t.equal(state.stops.length, count, "a click outside the box adds nothing");
    await pointer(0).drag([[-0.03, 0.9], [-0.2, 1.1], [-0.4, 1.4]]);
    t.equal(state.stops.length, 5, "a stop dragged well clear of the box goes");
});

test("a new stop takes the spline's color there, so the spline barely changes", async t => {
    await preset("Four stops");
    const before = splineColor(currentSpline(), [0.3, 0.6]);
    await pointer(0).click(0.5, 0.5);
    t.equal(state.stops.length, 5, "a stop is added");
    const after = splineColor(currentSpline(), [0.3, 0.6]);
    t.below(Math.max(...before.map((v, k) => Math.abs(v - after[k]))), 0.01, "and the spline elsewhere moves by");
});

test("the spread circle is dragged in the grid models' boxes, and isn't in the spline's", async t => {
    await preset("Spread");
    selection = 2;
    changed();
    await sleep(200);
    const stop = state.stops[2];
    const [sx] = boxScale();
    const edge = stop.p[0] + spreadRadius(stop) / sx;
    t.equal(hitTest(views[1], [edge * views[1].stage.clientWidth, stop.p[1] * views[1].stage.clientHeight])?.kind, "spread", "the circle's edge in the biharmonic box");
    t.equal(hitTest(views[0], [edge * views[0].stage.clientWidth, stop.p[1] * views[0].stage.clientHeight]), null, "the same place in the spline's box");
    await pointer(1).drag([[edge, stop.p[1]], [edge - 0.05, stop.p[1]], [edge - 0.1, stop.p[1]]]);
    t.below(state.stops[2].spread, 45, "dragging the circle inward lowers the spread from 60%");
    t.above(state.stops[2].spread, 5, "but not to nothing");
    t.equal(state.stops.length, 4, "and adds no stop");
});

test("the stop's fields, the list, and the buttons", async t => {
    await preset("Four stops");
    $("stopList").children[1].click();
    await sleep(100);
    t.equal(selection, 1, "a swatch selects its stop");
    t.equal($("stopTitle").textContent, "Stop 2", "the title");
    $("stopText").value = "oklch(0.7 0.2 140)";
    $("stopText").dispatchEvent(new Event("input"));
    t.equal(state.stops[1].color, "oklch(0.7 0.2 140)", "a color typed in");
    set("stopX", "40");
    t.below(Math.abs(state.stops[1].p[0] - 0.4), 1e-9, "a position typed in");
    set("opacity", "50");
    set("spread", "30");
    t.equal(`${state.stops[1].opacity} ${state.stops[1].spread}`, "50 30", "opacity and spread");
    t.ok(cssText().includes("rgb(from oklch(0.7 0.2 140) r g b / calc(alpha * 0.5)) 40% 22%,"), "the spline's CSS has the opacity in the color, and no spread");
    set("stopWeight", "2.5");
    t.equal(state.stops[1].weight, 2.5, "a weight typed in");
    t.ok(cssText().includes(" 40% 22% / 2.5,"), "is in the spline's CSS");
    set("stopX", "-5");
    t.below(Math.abs(state.stops[1].p[0] + 0.05), 1e-9, "a position outside the box typed in");
    set("stopX", "40");
    set("stopWeight", "");
    t.equal(state.stops[1].weight, null, "and the weight cleared");
    document.querySelector('#modelBar [data-model="spline"]').click();
    t.ok(/oklch\(0\.7 0\.2 140\) 40% 22% spread 30% opacity 50%/.test(cssText()), "a grid model's has the spread");
    document.querySelector('#modelBar [data-model="spline"]').click();
    $("addStop").click();
    t.equal(state.stops.length, 5, "Add stop");
    $("deleteStop").click();
    t.equal(state.stops.length, 4, "Remove stop");
    $("clearStops").click();
    await sleep(400);
    t.equal(state.stops.length, 0, "Remove all");
    t.ok(!gpuError, `no stops gave a WebGPU error: ${gpuError}`);
    await pointer(0).click(0.5, 0.5);
    await sleep(300);
    t.equal(state.stops[0].color, "#7f7f7f", "the first stop is gray");
});

test("undo, redo, and the arrow, Delete and Escape keys", async t => {
    await preset("Four stops");
    await sleep(500);
    const start = state.stops[0].p[0];
    selection = 0;
    changed();
    for (let i = 0; i < 3; ++i)
        press("ArrowRight");
    t.below(Math.abs(state.stops[0].p[0] - (start + 3 / state.width)), 1e-9, "three presses of the right arrow move the stop three pixels");
    await sleep(500);
    press("z", { metaKey: true });
    await sleep(100);
    t.below(Math.abs(state.stops[0].p[0] - start), 1e-9, "undo puts the stop back");
    press("z", { metaKey: true, shiftKey: true });
    await sleep(100);
    t.below(Math.abs(state.stops[0].p[0] - (start + 3 / state.width)), 1e-9, "redo moves it again");
    press("Delete");
    await sleep(500);
    t.equal(state.stops.length, 3, "Delete removes the selected stop");
    $("undo").click();
    await sleep(100);
    t.equal(state.stops.length, 4, "the Undo button brings it back");
    selection = 0;
    press("Escape");
    t.equal(selection, null, "Escape selects nothing");
});

test("after a menu closes, a press that comes as a move still drags", async t => {
    await preset("Four stops");
    const from = state.stops[0].p.slice();
    await pointer(1).dragAfterMenu([from, [0.4, 0.4], [0.5, 0.5]]);
    t.equal(state.stops.length, 4, "no stop is added");
    t.below(Math.hypot(state.stops[0].p[0] - 0.5, state.stops[0].p[1] - 0.5), 0.01, "the stop under the press is dragged");
});

test("the gradient is gamut mapped by default, and the gamut to check shows only when something checks", async t => {
    t.equal(state.gamutMapping, "map", "out of gamut colors by default");
    t.equal(decodeState(btoa(JSON.stringify({ v: 1, stops: [] }))).gamutMapping, "map", "and for a link that doesn't say");
    t.equal(decodeState(btoa(JSON.stringify({ v: 1, stops: [], gamutMapping: "clip" }))).gamutMapping, "clip", "a link that says clip is clipped");
    t.ok(!shown("gamutRow"), "the gamut to check is hidden to start with");
    set("view", "gamut");
    await sleep(200);
    t.ok(shown("gamutRow"), "it shows for Where it leaves the gamut");
    set("view", "gradient");
    set("numbers", true);
    await sleep(200);
    t.ok(shown("gamutRow"), "and for the numbers");
});

test("a box is drawn from a finished solve, not along with it", async t => {
    await preset("Four stops");
    await sleep(600);
    t.ok(!solving, "nothing is being solved at rest");
    const before = views[1].gradientKey;
    state.stops[0].p = [0.3, 0.3];
    render();
    t.ok(solving, "a change starts a solve");
    t.ok(views[1].gradientKey !== before, "of the changed gradient");
    state.stops[0].p = [0.35, 0.3];
    const during = views[1].gradientKey;
    render();
    t.equal(views[1].gradientKey, during, "and nothing more is started until it's done");
    await sleep(600);
    t.ok(!solving && views[1].gradientKey !== during, "then the latest is solved");
});

test("the paper's two points make a ramp in the spline and the biharmonic model", async t => {
    await preset("Finch et al., Figure 8: two points make a ramp");
    t.equal(`${state.edges} ${state.stopSize}`, "natural texel", "the preset sets natural edges and one-texel stops");
    set("space", "srgb");
    set("numbers", true);
    for (const index of [0, 1]) {
        const readout = await grab(index);
        const at = x => sampleReadout(readout, [x, 0.5])[0];
        const slope = (at(0.8) - at(0.3)) / 0.5;
        const worst = Math.max(...[0.05, 0.2, 0.5, 0.65, 0.95].map(x => Math.abs(at(x) - (at(0.3) + slope * (x - 0.3)))));
        t.below(worst, index ? 0.03 : 0.001, `${views[index].model}: the worst miss from a straight ramp`);
        t.below(Math.abs(sampleReadout(readout, [0.5, 0.1])[0] - at(0.5)), index ? 0.03 : 0.001, `${views[index].model}: the same up and down the box`);
    }
});
