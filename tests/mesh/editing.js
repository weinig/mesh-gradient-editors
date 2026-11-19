// Undo, redo and the keys.

// A key pressed with nothing focused.
const press = (key, more = {}) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...more }));

test("undo, redo, and the arrow keys", async t => {
    await sleep(500);
    t.ok($("undo").disabled && $("redo").disabled, "nothing to undo or redo to start with");
    selected = [1, 1];
    const start = resolvedPosition(1, 1).slice();
    for (let i = 0; i < 3; ++i)
        press("ArrowRight");
    t.below(Math.abs(resolvedPosition(1, 1)[0] - (start[0] + 300 / state.width)), 0.02, "three presses of the right arrow move the point three pixels");
    press("ArrowDown", { shiftKey: true });
    t.below(Math.abs(resolvedPosition(1, 1)[1] - (start[1] + 1000 / state.height)), 0.02, "with Shift, ten");
    await sleep(500);
    t.ok(!$("undo").disabled, "Undo is ready");
    press("z", { metaKey: true });
    await sleep(100);
    t.below(Math.hypot(resolvedPosition(1, 1)[0] - start[0], resolvedPosition(1, 1)[1] - start[1]), 1e-9, "undo puts the point back");
    press("z", { metaKey: true, shiftKey: true });
    await sleep(100);
    t.below(Math.abs(resolvedPosition(1, 1)[0] - (start[0] + 300 / state.width)), 0.02, "redo moves it again");
    $("undo").click();
    await sleep(100);
    t.below(Math.hypot(resolvedPosition(1, 1)[0] - start[0], resolvedPosition(1, 1)[1] - start[1]), 1e-9, "the Undo button undoes too");
    t.ok(!$("redo").disabled, "and Redo is ready");
    // Undo leaves the settings around the gradient alone.
    const mapping = state.gamutMapping;
    t.equal(mapping, "map", "out of gamut colors are gamut mapped by default");
    $("gamutMapping").value = "clip";
    $("gamutMapping").dispatchEvent(new Event("change"));
    await sleep(500);
    $("redo").click();
    await sleep(100);
    t.equal(state.gamutMapping, "clip", "a setting stays through a redo");
    // A preset is a step.
    $("preset").value = "1";
    $("preset").dispatchEvent(new Event("change"));
    await sleep(500);
    const points = JSON.stringify(state.points);
    $("undo").click();
    await sleep(100);
    t.ok(JSON.stringify(state.points) !== points, "undo steps back from a preset");
    $("redo").click();
    await sleep(100);
    t.equal(JSON.stringify(state.points), points, "and redo to it");
});
