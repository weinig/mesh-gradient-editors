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
    $("curveList").children[0].querySelector("button.small").click();
    await sleep(50);
    t.equal(count - state.curves.length, 1, "removing a curve from the list while the pen is drawing");
    pick("select");
    const bad = btoa(JSON.stringify({ v: 1, curves: [
        { kind: "zzz", left: "red", right: "blue" },
        { kind: "ellipse", closed: true, center: [0.5, 0.5], inside: "red", outside: "blue" },
        { kind: "line", closed: false, from: [0.1, 0.1], to: [0.9, 0.9], left: "red", right: "blue" },
    ] }));
    t.equal(decodeState(bad).curves.length, 1, "a link's unsound curves are dropped");
});

test("the Free slope checkbox", async t => {
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
