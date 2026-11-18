// MARK: - Shared controls

// The editor gives PRESETS, PRESET_KEYS (the state a preset sets besides the box), presetState(index), resetEditing()
// for when a preset replaces the state, TWO_SIDED_LINES, whether its lines can hold a different color each side, influenceAvailable(), whether something is selected to show the influence of,
// gradientData(model, influence), VIEW_NOTES, cssText(), the gradient as its made-up CSS, and MODEL_ABOUT, for
// each model how it works, its pros and cons, where it comes from (HTML, for its links) and what a spec would need.

for (const space of SPACES)
    $("space").add(new Option(space, space));
$("preset").add(new Option("Custom", ""));
PRESETS.forEach((preset, index) => $("preset").add(new Option(preset.name, String(index))));

function matchingPreset() {
    const describe = source => JSON.stringify([source.width, source.height, ...PRESET_KEYS.map(key => source[key])]);
    const current = describe(state);
    return PRESETS.findIndex(preset => describe(preset.state) === current);
}

// The preset, the box, the space, the grid, the models and the visualizations; the editor updates the rest.
function updateCommonControls() {
    const preset = matchingPreset();
    $("preset").value = preset < 0 ? "" : String(preset);
    $("presetNote").textContent = PRESETS[preset]?.note ?? "";
    $("presetNote").hidden = !PRESETS[preset]?.note;

    $("view").value = state.view;
    for (const option of $("view").options)
        option.disabled = !viewAvailable(option.value);
    $("viewNote").textContent = VIEW_NOTES[state.view];
    $("levelRow").hidden = state.view !== "level";
    $("stepsRow").hidden = state.view !== "relaxation";
    const levels = views.find(view => !view.figure.hidden)?.renderer?.levels ?? [];
    $("level").max = String(Math.max(0, levels.length - 1));
    $("level").value = String(state.level);
    const level = levels[Math.min(state.level, levels.length - 1)];
    $("levelValue").textContent = level ? `${Math.min(state.level, levels.length - 1)}: ${level.width} × ${level.height}` : String(state.level);
    $("steps").value = String(state.steps);
    $("stepsValue").textContent = (2 ** state.steps).toLocaleString();
    $("playSteps").textContent = playing ? "Stop" : "Play";
    for (const id of ["crossSection", "sheet", "numbers"]) {
        $(id).checked = state[id];
        $(id + "Note").hidden = !state[id];
    }
    $("sheetRow").hidden = !state.sheet;
    $("gamut").value = state.gamut;
    $("sample").checked = state.sample;
    $("otherCurves").checked = state.otherCurves;
    $("otherCurvesRow").hidden = !state.crossSection || state.models.length < 2;
    $("edgeStrips").checked = state.edgeStrips;
    $("edgeStripsRow").hidden = !TWO_SIDED_LINES;
    const heights = sheetHeights(state.space);
    if ($("sheetHeight").dataset.space !== String(state.space)) {
        $("sheetHeight").replaceChildren(...heights.map(height => new Option(height.label, height.value)));
        $("sheetHeight").dataset.space = String(state.space);
    }
    $("sheetHeight").value = sheetHeight(state.space).value;
    for (const id of ["width", "height"]) {
        if (document.activeElement !== $(id))
            $(id).value = state[id];
    }
    $("space").value = state.space;
    $("gamutMapping").value = state.gamutMapping;
    $("edges").value = state.edges;
    $("editing").value = state.editing;
    renderBackdrop();
    $("resolution").value = String(state.resolution);
    for (const button of document.querySelectorAll("#modelBar button"))
        button.setAttribute("aria-pressed", String(state.models.includes(button.dataset.model)));
    $("aboutButton").setAttribute("aria-pressed", String(state.about));
    for (const view of views) {
        const about = MODEL_ABOUT[view.model];
        const element = view.figure.querySelector(".modelAbout");
        element.hidden = !state.about;
        element.querySelector(".modelNote").textContent = about.note;
        element.querySelector(".modelSource").innerHTML = about.source;
        element.querySelector(".modelSpec").textContent = about.spec;
        for (const [selector, list] of [[".modelPros", about.pros], [".modelCons", about.cons]]) {
            const items = element.querySelector(selector);
            if (items.children.length !== list.length)
                items.replaceChildren(...list.map(text => Object.assign(document.createElement("li"), { textContent: text })));
        }
    }
    const css = cssText();
    if ($("output").value !== css)
        $("output").value = css;
}

async function copy(text, label) {
    try {
        await navigator.clipboard.writeText(text);
        $("copyStatus").textContent = `Copied ${label}.`;
    } catch {
        $("output").select();
        $("copyStatus").textContent = document.execCommand("copy") ? `Copied ${label}.` : "Couldn't copy.";
    }
    setTimeout(() => $("copyStatus").textContent = "", 1500);
}
$("aboutButton").addEventListener("click", () => {
    state.about = !state.about;
    changed();
});
$("copyCSS").addEventListener("click", () => copy($("output").value, "the CSS"));
$("copyLink").addEventListener("click", () => {
    writeHash();
    copy(location.href, "the link");
});

$("preset").addEventListener("change", () => {
    if ($("preset").value === "")
        return updateControls();
    state = { ...presetState(Number($("preset").value)) };
    resetEditing();
    changed();
});
for (const id of ["width", "height"]) {
    $(id).addEventListener("change", () => {
        const value = parseInt($(id).value, 10);
        if (Number.isFinite(value))
            state[id] = clamp(value, 100, 2000);
        changed();
    });
}
$("space").addEventListener("change", () => {
    state.space = $("space").value;
    changed();
});
$("editing").addEventListener("change", () => {
    state.editing = $("editing").value;
    changed();
});
$("edges").addEventListener("change", () => {
    state.edges = $("edges").value;
    changed();
});
$("gamutMapping").addEventListener("change", () => {
    state.gamutMapping = $("gamutMapping").value;
    changed();
});
$("resolution").addEventListener("change", () => {
    state.resolution = Number($("resolution").value);
    changed();
});
// Either model, or both side by side, but at least one.
for (const button of document.querySelectorAll("#modelBar button")) {
    button.addEventListener("click", () => {
        const model = button.dataset.model;
        const on = state.models.includes(model);
        if (on && state.models.length === 1)
            return;
        state.models = ["biharmonic", "harmonic"].filter(other => other === model ? !on : state.models.includes(other));
        if (!viewAvailable(state.view))
            state.view = "gradient";
        changed();
    });
}

$("view").addEventListener("change", () => {
    state.view = $("view").value;
    changed();
});
$("level").addEventListener("input", () => {
    state.level = Number($("level").value);
    changed();
});
$("steps").addEventListener("input", () => {
    stopPlaying();
    state.steps = Number($("steps").value);
    changed();
});
for (const id of ["crossSection", "sheet", "numbers"]) {
    $(id).addEventListener("change", () => {
        state[id] = $(id).checked;
        changed();
    });
}
$("gamut").addEventListener("change", () => {
    state.gamut = $("gamut").value;
    changed();
});
for (const id of ["otherCurves", "edgeStrips"]) {
    $(id).addEventListener("change", () => {
        state[id] = $(id).checked;
        changed();
    });
}
$("sample").addEventListener("change", () => {
    state.sample = $("sample").checked;
    changed();
});
$("sheetHeight").addEventListener("change", () => {
    state.sheetHeight = $("sheetHeight").value;
    changed();
});

// Playing the relaxation doubles its steps twice a second, from 1 to 4,096, so the colors are seen spreading at every
// scale.
let playing = null;
function stopPlaying() {
    if (playing)
        cancelAnimationFrame(playing.frame);
    playing = null;
}
$("playSteps").addEventListener("click", () => {
    if (playing) {
        stopPlaying();
        updateControls();
        return;
    }
    playing = { start: performance.now(), frame: 0 };
    const tick = now => {
        const steps = clamp(Math.floor((now - playing.start) / 500), 0, 12);
        if (steps !== state.steps) {
            state.steps = steps;
            changed();
        }
        if (steps >= 12) {
            stopPlaying();
            updateControls();
        } else {
            playing.frame = requestAnimationFrame(tick);
        }
    };
    state.steps = 0;
    changed();
    playing.frame = requestAnimationFrame(tick);
});

__BACKDROP__
