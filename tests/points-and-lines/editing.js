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
