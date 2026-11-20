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

test("the triangles the mesh is drawn with", async t => {
    await sleep(300);
    t.ok(state.view === "gradient" && !shown("tessellationCount"), "the box shows the gradient to start with");
    set("view", "triangles");
    await sleep(300);
    const { subdivisions, patches } = tessellation(state.width, state.height);
    t.equal(patches.length, (state.rows - 1) * (state.cols - 1), "a grid for each patch");
    t.above(subdivisions, 2, "a bent mesh is cut finer than a cell to a patch");
    t.equal(patches[0].length, (subdivisions + 1) ** 2 * 2, "of points, a side one more than its cells");
    // The first patch's first point is the mesh's top left point, and its last the point at row 2, column 2.
    const first = resolvedPosition(0, 0), last = resolvedPosition(1, 1);
    t.below(Math.hypot(patches[0][0] * 100 - first[0], patches[0][1] * 100 - first[1]), 1e-4, "a patch's first point is its top left corner");
    t.below(Math.hypot(patches[0].at(-2) * 100 - last[0], patches[0].at(-1) * 100 - last[1]), 1e-4, "and its last its bottom right");
    t.ok(shown("tessellationCount") && /cells to a patch: [\d,]+ triangles in \d+ patch/.test($("tessellationCount").textContent), "the count is shown");
    set("overlayToggle", false);
    await sleep(300);
    const pixels = overlay.getContext("2d").getImageData(0, 0, overlay.width, overlay.height).data;
    let drawn = 0;
    for (let i = 3; i < pixels.length; i += 4)
        drawn += pixels[i] > 0 ? 1 : 0;
    t.ok(shown("overlay") && overlay.style.pointerEvents === "none", "with the points hidden the triangles still show, and take no clicks");
    t.above(drawn, 2000, "pixels the triangles alone draw");
    t.equal(decodeState(encodeState()).view, "triangles", "the link keeps it");
    set("view", "gradient");
    await sleep(300);
    t.ok(!shown("overlay"), "with both off the overlay goes");
    set("overlayToggle", true);
    document.querySelector('[aria-controls="viewNotes"]').click();
    t.ok(shown("viewNote") && /as it's drawn/.test($("viewNote").textContent), "the info button shows the view's note");
});

test("the color under the pointer", async t => {
    await sleep(300);
    t.ok(!state.sample, "sampling is off to start with");
    const rect = stage.getBoundingClientRect();
    const move = (x, y) => stage.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", clientX: rect.left + x * rect.width, clientY: rect.top + y * rect.height }));
    move(0.5, 0.5);
    t.ok(!shown("sampleTip"), "nothing shows while it's off");
    set("sampleToggle", true);
    move(0.3, 0.3);
    t.ok(shown("sampleTip") && /Patch row 1, column 1 · u [\d.]+ · v [\d.]+\n.*\(/.test($("sampleTip").textContent), "the sample says where in which patch, and the color there");
    // At a corner of the mesh, the color is that point's.
    const corner = resolvedPosition(0, 0).map(v => v / 100);
    const hit = locate(meshPatches(), [corner[0] + 1e-4, corner[1] + 1e-4]);
    const color = sampleColor(hit.patch, hit.u, hit.v);
    const expected = convertColor("srgb", parseColor(state.points[0].color).c, state.space, false);
    t.below(Math.max(...expected.map((v, k) => Math.abs(v - color[k]))), 0.01, "at the mesh's first point, how far the sample is from the point's color");
    t.ok(decodeState(encodeState()).sample, "the link keeps it");
    stage.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    t.ok(!shown("sampleTip"), "it goes when the pointer leaves");
});

test("a color backdrop, and no background in the CSS", async t => {
    set("backdrop", "color");
    set("backdropColor", "#336699");
    await sleep(100);
    t.equal(stage.style.backgroundColor, "rgb(51, 102, 153)", "a color backdrop is behind the box");
    t.ok(shown("backdropColor"), "with its color well");
    t.equal(decodeState(encodeState()).backdropColor, "#336699", "and its color is in the link");
    t.ok(!$("background"), "there's no Background field");
    t.ok(!/mesh-gradient\(in \w+ #/.test($("output").value), "nor a background in the CSS");
    set("backdrop", "checkerboard");
    await sleep(100);
    t.equal(stage.style.backgroundColor, "", "the checkerboard has no color");
    t.ok(!shown("backdropColor"), "nor its well");
});
