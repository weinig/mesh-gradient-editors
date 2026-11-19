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
        t.ok(/^#[0-9a-f]{6}$/.test(state.stops.at(-1).color), "in a color from the stops around it");
        await mouse.drag([[0.6, 0.55], [0.5, 0.5], [0.3, 0.6]]);
        t.below(Math.hypot(state.stops.at(-1).p[0] - 0.3, state.stops.at(-1).p[1] - 0.6), 0.01, "a drag moves it");
    }
    await pointer(0).drag([[0.3, 0.6], [0.1, 0.8], [-0.1, 1.1]]);
    t.equal(state.stops.length, 5, "a stop dragged out of the box goes");
});

test("the spread circle is dragged in the grid models' boxes, and isn't in the spline's", async t => {
    await preset("Spread");
    selection = 2;
    changed();
    await sleep(200);
    const stop = state.stops[2];
    const [sx] = boxScale();
    const edge = stop.p[0] + spreadRadius(stop) / sx;
    t.equal(hitTest(views[1], [edge * views[1].overlay.clientWidth, stop.p[1] * views[1].overlay.clientHeight])?.kind, "spread", "the circle's edge in the biharmonic box");
    t.equal(hitTest(views[0], [edge * views[0].overlay.clientWidth, stop.p[1] * views[0].overlay.clientHeight]), null, "the same place in the spline's box");
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
    t.ok(/oklch\(0\.7 0\.2 140\) 40% 22% opacity 50%/.test(cssText()), "the spline's CSS has the opacity and no spread");
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
