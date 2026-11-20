// Adding stops and lines, and reading links.

test("lines, inserted stops and bad links", async t => {
    await preset("Spread");
    const mouse = pointer();
    document.querySelector("#toolbar [data-mode=lines]").click();
    await mouse.click(0.75, 0.3);
    t.equal(gradientData("biharmonic").points.length / 8, 4, "a line of one stop leaves its stop a point");
    t.ok(!$("spread").disabled, "and the stop keeps its spread");
    t.ok(!/line\(/.test(cssText()), "and the CSS has no line");
    mouse.doubleClick(0.75, 0.3);
    t.equal(state.lines.length, 0, "ending a line of one stop removes it");
    await preset("A line");
    const stretch = lineStretches(state.lines[0])[1];
    await mouse.click(...bezier(stretch.bezier, 0.5));
    t.ok(state.stops.at(-1).color.startsWith("oklab("), "a stop inserted on a line takes the line's color there");
    document.querySelector("#toolbar [data-mode=points]").click();
    const bad = btoa(JSON.stringify({
        v: 1, stops: [{ p: [0.1, 0.1], color: "red" }, { p: [0.9, 0.9], color: "blue" }, { p: "x" }],
        lines: [{ stops: [0, 9] }, { stops: [0, 1], closed: true }], models: [], steps: 20, section: 5, view: "nope", resolution: 4096,
    }));
    const decoded = decodeState(bad);
    t.equal(decoded.stops.length, 2, "a link's unsound stops are dropped");
    t.equal(JSON.stringify(decoded.lines), '[{"stops":[0,1],"closed":false}]', "and its lines made sound");
    t.equal(`${decoded.models.join("+")} ${decoded.steps} ${decoded.view} ${decoded.resolution}`, "biharmonic+harmonic 12 gradient 512", "and its settings");
    t.equal(straightComponent([0, 0, -30, 1], 2, "oklch"), 330, "a hue below 0 comes back to 0 to 360");
});

// A key pressed with nothing focused.
const press = (key, more = {}) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...more }));

test("undo, redo, and the arrow, Delete and Escape keys", async t => {
    await preset("Four points");
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
    // Undo leaves the settings around the gradient alone.
    set("space", "srgb");
    await sleep(500);
    $("undo").click();
    await sleep(100);
    t.equal(state.space, "srgb", "undo doesn't change the interpolation space");
});

test("after a menu closes, a press that comes as a move still drags", async t => {
    await preset("Four points");
    const from = state.stops[0].p.slice();
    await pointer().dragAfterMenu([from, [0.4, 0.4], [0.5, 0.5]]);
    t.equal(state.stops.length, 4, "no stop is added");
    t.below(Math.hypot(state.stops[0].p[0] - 0.5, state.stops[0].p[1] - 0.5), 0.01, "the stop under the press is dragged");
});

test("the page opens on a line", async t => {
    t.ok(state.lines.length > 0, "the first preset has a line");
    t.equal($("preset").selectedOptions[0].text, "A line", "and is A line");
});

test("a line's handles: dragged, pulled out, kept through a new stop, and reset", async t => {
    await preset("A line");
    const mouse = pointer();
    const line = () => state.lines[0];
    t.ok(!line().handles, "a line curves on its own to start with");
    selection = 1;
    changed();
    await sleep(100);
    const shown = stopHandles(1);
    t.equal(shown.map(handle => handle.which).join(), "in,out", "a stop in the middle of a line shows two handles");
    t.equal(stopHandles(0).map(handle => handle.which).join(), "out", "a stop at its end shows one");
    const out = shown[1];
    await mouse.drag([out.at, [out.at[0] + 0.03, out.at[1] - 0.05], [out.at[0] + 0.06, out.at[1] - 0.1]]);
    t.equal(line().handles?.length, 4, "dragging a handle gives the line handles of its own");
    const handle = line().handles[1];
    t.below(Math.hypot(handle.out[0] - (out.at[0] + 0.06 - state.stops[1].p[0]), handle.out[1] - (out.at[1] - 0.1 - state.stops[1].p[1])), 0.005, "the handle is where it was dragged");
    const [sx, sy] = boxScale();
    const cross = handle.in[0] * sx * handle.out[1] * sy - handle.in[1] * sy * handle.out[0] * sx;
    t.below(Math.abs(cross), 1e-6, "and the other handle stays opposite it");
    t.equal(state.stops.length, 4, "no stop was added");
    // With Option, one handle moves alone.
    const before = handle.in.slice();
    const at = stopHandles(1)[1].at;
    await mouse.drag([at, [at[0], at[1] + 0.1]], { altKey: true });
    t.equal(line().handles[1].in.join(), before.join(), "with Option the other handle stays put");
    t.ok(/handles -?[\d.]+% -?[\d.]+% -?[\d.]+% -?[\d.]+%/.test(cssText()), "the CSS has each stop's handles");
    t.equal(JSON.stringify(decodeState(encodeState()).lines), JSON.stringify(state.lines), "the handles survive the link");
    // A stop added on the line splits its stretch, so the line keeps its shape.
    const stretch = lineStretches(line())[1];
    const middle = bezier(stretch.bezier, 0.5);
    const was = [0.1, 0.25, 0.4, 0.6, 0.75, 0.9].map(s => bezier(stretch.bezier, s));
    document.querySelector("#toolbar [data-mode=lines]").click();
    await mouse.click(...middle);
    t.equal(line().stops.length, 5, "a click on the line adds a stop");
    // Each point of the old stretch is still on one of the two it became.
    const now = lineStretches(line()).slice(1, 3).flatMap(part => Array.from({ length: 2001 }, (_, i) => bezier(part.bezier, i / 2000)));
    const off = Math.max(...was.map(p => Math.min(...now.map(q => Math.hypot(p[0] - q[0], p[1] - q[1])))));
    t.below(off, 2e-4, "and the line is where it was");
    document.querySelector("#toolbar [data-mode=points]").click();
    // Option-dragging a stop pulls its handles out.
    const p = state.stops[line().stops[0]].p.slice();
    await mouse.drag([p, [p[0] + 0.05, p[1]], [p[0] + 0.1, p[1]]], { altKey: true });
    t.below(Math.abs(line().handles[0].out[0] - 0.1), 0.005, "Option-dragging a stop pulls its handle out");
    t.equal(state.stops[line().stops[0]].p.join(), p.join(), "and leaves the stop where it was");
    t.ok(!$("resetHandles").disabled, "Reset handles is on for a stop on a line with its own");
    selection = line().stops[0];
    $("resetHandles").click();
    t.ok(!line().handles, "Reset handles lets the line curve on its own again");
    $("undo").click();
    await sleep(100);
});

test("the + adds a point or a line, and Select adds nothing", async t => {
    await preset("A line");
    const stops = state.stops.length, lines = state.lines.length;
    $("addLine").click();
    await sleep(100);
    t.equal(state.lines.length - lines, 1, "Line adds a line");
    t.equal(state.stops.length - stops, 2, "of two stops");
    t.ok(!$("removeLine").disabled, "and selects one, which can remove it");
    $("removeLine").click();
    t.equal(`${state.lines.length} ${state.stops.length}`, `${lines} ${stops}`, "Remove line takes its stops with it");
    $("addStop").click();
    await sleep(100);
    t.equal(state.stops.length - stops, 1, "Point adds a stop");
    t.ok($("removeLine").disabled, "on no line");
    document.querySelector("#toolbar [data-mode=select]").click();
    await pointer().click(0.97, 0.97);
    t.equal(state.stops.length - stops, 1, "a click in Select adds no stop");
    t.equal(selection, null, "and selects nothing");
    document.querySelector("#toolbar [data-mode=points]").click();
});

test("dragging on from a new stop in Lines pulls out its handles", async t => {
    await preset("Four points");
    document.querySelector("#toolbar [data-mode=lines]").click();
    const mouse = pointer();
    await mouse.click(0.3, 0.5);
    await mouse.drag([[0.5, 0.6], [0.55, 0.6], [0.6, 0.6]]);
    const line = state.lines.at(-1);
    t.equal(line.stops.length, 2, "two stops on the line");
    t.below(Math.hypot(state.stops.at(-1).p[0] - 0.5, state.stops.at(-1).p[1] - 0.6), 0.005, "the new stop stays where it was pressed");
    t.below(Math.abs(line.handles?.[1].out[0] - 0.1), 0.005, "and the drag is its handle");
    t.below(Math.abs(line.handles[1].in[0] + 0.1), 0.005, "with the other opposite");
    mouse.doubleClick(0.6, 0.6);
    document.querySelector("#toolbar [data-mode=points]").click();
    t.ok(!gpuError, `a WebGPU error: ${gpuError}`);
});

test("the presets after the papers draw", async t => {
    for (const name of ["A line shaped by its handles", "Finch et al., Figure 5: a bright point in a dark rim", "Finch et al., Figure 8: two points make a ramp"]) {
        await preset(name);
        await sleep(400);
        t.ok(!gpuError, `${name}: ${gpuError}`);
        t.equal(JSON.stringify(decodeState(encodeState())), JSON.stringify(state), `${name}: its link`);
    }
    await preset("Finch et al., Figure 5: a bright point in a dark rim");
    // The rim's handles make it a circle: every point of it is the same distance from the middle.
    const radii = lineStretches(state.lines[0]).flatMap(stretch => [0.25, 0.5, 0.75].map(s => Math.hypot(...bezier(stretch.bezier, s).map(v => v - 0.5))));
    t.below(Math.max(...radii) - Math.min(...radii), 0.001, "the rim is a circle");
});
