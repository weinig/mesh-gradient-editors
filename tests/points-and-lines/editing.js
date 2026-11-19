// Adding stops and lines, and reading links.

test("lines, inserted stops and bad links", async t => {
    await preset("Spread");
    const mouse = pointer();
    document.querySelector("#toolbar [data-mode=lines]").click();
    await mouse.click(0.75, 0.3);
    t.equal(gradientData("biharmonic").points.length / 8, 4, "a line of one stop leaves its stop a point");
    t.ok(!$("spreadRow").hidden, "and the stop keeps its spread");
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
