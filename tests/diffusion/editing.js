// Drawing and editing curves.

test("the pen, double-clicks and bad links", async t => {
    await preset("A line between two colors");
    const mouse = pointer();
    const pick = name => document.querySelector(`#toolbar [data-tool=${name}]`).click();
    const before = state.curves.length;
    pick("pen");
    await mouse.click(0.2, 0.2);
    await mouse.click(0.4, 0.3);
    await mouse.click(0.6, 0.2);
    await mouse.click(0.6, 0.2);
    mouse.doubleClick(0.6, 0.2);
    t.equal(state.curves.at(-1).nodes.length, 3, "a double-click ends the curve without a duplicate node");
    await mouse.click(0.5, 0.6);
    await mouse.click(0.5, 0.6);
    mouse.doubleClick(0.5, 0.6);
    t.equal(state.curves.length - before, 1, "a double-click on nothing adds no curve");
    await mouse.click(0.2, 0.7);
    await mouse.click(0.4, 0.8);
    await mouse.click(0.2, 0.7);
    t.equal(state.curves.at(-1).closed, false, "two nodes don't close a curve");
    mouse.doubleClick(0.2, 0.7);
    const count = state.curves.length;
    await mouse.click(0.8, 0.8);
    $("curveList").children[0].click();
    $("deleteCurve").click();
    await sleep(50);
    t.equal(count - state.curves.length, 1, "removing a curve while the pen is drawing");
    pick("select");
    const bad = btoa(JSON.stringify({ v: 1, curves: [
        { kind: "zzz", left: "red", right: "blue" },
        { kind: "ellipse", closed: true, center: [0.5, 0.5], inside: "red", outside: "blue" },
        { kind: "line", closed: false, from: [0.1, 0.1], to: [0.9, 0.9], left: "red", right: "blue" },
    ] }));
    t.equal(decodeState(bad).curves.length, 1, "a link's unsound curves are dropped");
});

test("Falloff: Flat or Smooth", async t => {
    await preset("A circle");
    selection = { curve: 0, node: null };
    changed();
    await sleep(300);
    t.equal($("free").checked, false, "it starts unchecked");
    $("free").click();
    await sleep(800);
    t.equal(state.curves[0].free, true, "checking it frees the curve's slope");
    t.ok(/ free/.test($("output").value), "the CSS says free");
    t.equal(decodeState(encodeState())?.curves?.[0]?.free, true, "it survives the link");
    set("blur", 20);
    await sleep(500);
    t.equal($("free").disabled, true, "a blurred curve has no free slope");
    t.ok(!/ free/.test($("output").value), "and its CSS doesn't say free");
});

// A key pressed with nothing focused.
const press = (key, more = {}) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...more }));

test("undo, redo, and the arrow, Delete and Escape keys", async t => {
    await preset("A circle");
    await sleep(500);
    const start = state.curves[0].center[0];
    selection = { curve: 0, node: null };
    changed();
    for (let i = 0; i < 3; ++i)
        press("ArrowRight");
    t.below(Math.abs(state.curves[0].center[0] - (start + 3 / state.width)), 1e-9, "three presses of the right arrow move the curve three pixels");
    press("ArrowDown", { shiftKey: true });
    await sleep(500);
    t.equal($("undo").disabled, false, "there is a step to undo");
    press("z", { metaKey: true });
    await sleep(100);
    t.below(Math.abs(state.curves[0].center[0] - start), 1e-9, "undo puts the curve back");
    t.equal($("redo").disabled, false, "and there is a step to redo");
    press("z", { metaKey: true, shiftKey: true });
    await sleep(100);
    t.below(Math.abs(state.curves[0].center[0] - (start + 3 / state.width)), 1e-9, "redo moves it again");
    const count = state.curves.length;
    press("Delete");
    await sleep(500);
    t.equal(state.curves.length, count - 1, "Delete removes the selected curve");
    $("undo").click();
    await sleep(100);
    t.equal(state.curves.length, count, "the Undo button brings it back");
    selection = { curve: 0, node: null };
    press("Escape");
    t.equal(selection, null, "Escape selects nothing");
    // Typing in a field keeps its keys.
    $("width").focus();
    $("width").dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    t.equal(state.curves.length, count, "Backspace in a field deletes no curve");
    $("width").blur();
});

test("after a menu closes, a press that comes as a move still drags", async t => {
    await preset("A line between two colors");
    const before = state.curves[0].from.slice();
    await pointer().dragAfterMenu([[0.5, 0.5], [0.5, 0.6], [0.5, 0.7]]);
    t.below(Math.abs(state.curves[0].from[1] - (before[1] + 0.2)), 0.01, "the curve under the press is dragged");
});

test("a selected curve's handles drag", async t => {
    await preset("A leaf");
    const index = state.curves.findIndex(curve => isPath(curve));
    selection = { curve: index, node: null };
    changed();
    await sleep(100);
    const node = state.curves[index].nodes.find(node => node.out[0] || node.out[1]);
    const n = state.curves[index].nodes.indexOf(node);
    const at = [node.p[0] + node.out[0], node.p[1] + node.out[1]];
    await pointer().drag([at, [at[0] + 0.03, at[1] + 0.03], [at[0] + 0.06, at[1] + 0.06]]);
    const moved = state.curves[index].nodes[n];
    t.below(Math.hypot(moved.p[0] + moved.out[0] - (at[0] + 0.06), moved.p[1] + moved.out[1] - (at[1] + 0.06)), 0.005, "the handle goes where it's dragged");
    t.equal(moved.p.join(), node.p.join(), "and its node stays put");
});

test("the presets after the papers draw", async t => {
    for (const name of ["Orzan et al., Figure 2: a diffusion curve", "Finch et al., Figure 2: a shaded sphere", "Finch et al., Figure 5: a tear"]) {
        await preset(name);
        await sleep(500);
        t.ok(!gpuError, `${name}: ${gpuError}`);
        t.equal(JSON.stringify(decodeState(encodeState()).curves.map(curve => curve.kind)), JSON.stringify(state.curves.map(curve => curve.kind)), `${name}: its link's curves`);
    }
});
