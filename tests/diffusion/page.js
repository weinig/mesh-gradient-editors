// The page's own features: color spaces, views, panels, and the cross-section.

test("every interpolation space and view draws", async t => {
    await preset("A circle");
    state.curves[0].inside = "oklch(0.7 0.2 30 / 0.6)";
    state.curves[0].outside = "hsl(none 80% 50%)";
    changed();
    for (const space of SPACES) {
        set("space", space);
        await sleep(450);
        t.ok(!gpuError, `${space} gave a WebGPU error: ${gpuError}`);
    }
    set("space", "oklch");
    for (const view of ["holds", "gamut", "isolines", "difference", "level", "relaxation", "gradient"]) {
        set("view", view);
        await sleep(400);
        t.ok(!gpuError, `the ${view} view gave a WebGPU error: ${gpuError}`);
    }
    for (const id of ["crossSection", "sheet", "numbers"])
        set(id, true);
    await sleep(2500);
    t.equal([...$("sheetHeight").options].map(option => option.text).join("|"), "L (oklch)|C (oklch)|h (oklch)|Alpha", "the 3D heights");
});

test("backdrops, about, numbers, sampling and influence", async t => {
    await preset("Overlapping shapes");
    set("gamutMapping", "map");
    await sleep(400);
    set("backdrop", "puppy");
    await sleep(200);
    t.ok(views[0].stage.style.backgroundImage.startsWith('url("data:'), "the puppy backdrop is an image");
    set("backdrop", "none");
    await sleep(100);
    t.ok(!views[0].stage.classList.contains("checkerboard"), "no backdrop has no checkerboard");
    set("backdrop", "color");
    set("backdropColor", "#336699");
    await sleep(100);
    t.equal(views.map(view => view.stage.style.backgroundColor).join(), views.map(() => "rgb(51, 102, 153)").join(), "a color backdrop is behind every box");
    t.equal(decodeState(encodeState()).backdropColor, "#336699", "and its color is in the link");
    set("backdrop", "checkerboard");
    await sleep(100);
    t.equal(views[0].stage.style.backgroundColor, "", "and goes with it");
    $("aboutButton").click();
    await sleep(200);
    t.ok(!views[0].figure.querySelector(".modelAbout").hidden, "About the models opens");
    t.equal(views[0].figure.querySelectorAll(".modelPros li").length, 3, "the biharmonic model's pros");
    t.ok($("output").value.startsWith("background-image: diffusion-gradient(in "), "the CSS is a diffusion-gradient()");
    set("numbers", true);
    set("sample", true);
    set("gamut", "display-p3");
    await sleep(2500);
    t.ok(/outside Display P3/.test(views[0].numbers.textContent), "the numbers measure against Display P3");
    const rect = views[0].overlay.getBoundingClientRect();
    views[0].overlay.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: rect.left + rect.width * 0.3, clientY: rect.top + rect.height * 0.4 }));
    await sleep(100);
    t.ok(!$("sampleReadout").hidden && $("sampleReadout").textContent.startsWith("oklab "), "the sample shows the color under the pointer");
    selection = { curve: 0, node: null };
    changed();
    set("view", "influence");
    await sleep(2500);
    t.equal($("view").value, "influence", "the influence view is available with a curve selected");
});

test("the cross-section's rows show only when it's on, and its row drags", async t => {
    const rows = ["sectionKindRow", "sectionRowRow", "otherCurvesRow"];
    t.equal(rows.map(shown).join(), "false,false,false", "with the cross-section off");
    set("crossSection", true);
    await sleep(300);
    t.equal(rows.map(shown).join(), "true,false,true", "with it on, along a line");
    set("sectionKind", "row");
    await sleep(300);
    t.equal(rows.map(shown).join(), "true,true,true", "with it on, along a row");
    await pointer().drag([[0.02, 0.5], [0.02, 0.4], [0.02, 0.3]]);
    t.below(Math.abs(state.sectionRow - 0.3), 0.02, "the row dragged to 30%");
    t.equal(JSON.stringify(sectionEnds()[0]), JSON.stringify([0, state.sectionRow]), "a row's ends are at the box's sides");
    const back = decodeState(encodeState());
    t.equal(back?.sectionKind, "row", "the kind survives the link");
    set("sectionKind", "line");
    await sleep(300);
    t.equal(JSON.stringify(sectionEnds()), "[[0.1,0.5],[0.9,0.5]]", "the line's ends are as they were");
    t.equal([...document.querySelectorAll("[hidden]")].filter(element => getComputedStyle(element).display !== "none").length, 0, "hidden elements still drawn");
});

test("a smaller grid while editing, and the chosen one after", async t => {
    await preset("A circle");
    set("resolution", "512");
    set("editing", "half");
    await sleep(400);
    const full = views[0].renderer.levels[0].width;
    drag = { kind: "curve", curve: 0 };
    state.curves[0].inside = "#d33b2e";
    render();
    await device.queue.onSubmittedWorkDone();
    t.equal(views[0].renderer.levels[0].width, full / 2, "the grid while dragging");
    drag = null;
    render();
    await device.queue.onSubmittedWorkDone();
    t.equal(views[0].renderer.levels[0].width, full, "the grid after");
});
