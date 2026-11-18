// MARK: - Shared controls

// The editor gives PRESETS, PRESET_KEYS (the state a preset sets besides the box), presetState(index), resetEditing()
// for when a preset replaces the state, and VIEW_NOTES.

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
    $("resolution").value = String(state.resolution);
    for (const button of document.querySelectorAll("#modelBar button"))
        button.setAttribute("aria-pressed", String(state.models.includes(button.dataset.model)));
}

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
        const steps = Math.min(12, Math.floor((now - playing.start) / 500));
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

