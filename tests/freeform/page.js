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
