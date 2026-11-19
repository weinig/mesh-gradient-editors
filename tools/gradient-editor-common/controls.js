// MARK: - Undo, redo and keys

// Undo steps through what the editor itself holds, its PRESET_KEYS and the box's size, not the settings around it.
// A step is taken when a change has settled: after a drag or a slider's move ends, not during it.
const undoSteps = [];
let undoIndex = -1;
let undoTimer = null;

const undoSnapshot = () => JSON.stringify(Object.fromEntries(["width", "height", ...PRESET_KEYS].map(key => [key, state[key]])));

function takeUndoStep() {
    undoTimer = null;
    if (drag || adjusting)
        return scheduleUndoStep();
    const now = undoSnapshot();
    if (now === undoSteps[undoIndex])
        return;
    undoSteps.splice(undoIndex + 1, Infinity, now);
    if (undoSteps.length > 200)
        undoSteps.shift();
    undoIndex = undoSteps.length - 1;
    updateUndoButtons();
}

function scheduleUndoStep() {
    if (undoTimer === null)
        undoTimer = setTimeout(takeUndoStep, 300);
}

// Steps back, or forward for 1, to what the editor held then.
function stepUndo(by) {
    // A change still settling is a step of its own, to come back to.
    if (undoTimer !== null) {
        clearTimeout(undoTimer);
        takeUndoStep();
    }
    if (drag || !undoSteps[undoIndex + by])
        return;
    undoIndex += by;
    Object.assign(state, JSON.parse(undoSteps[undoIndex]));
    restoredEditing();
    changed();
    updateUndoButtons();
}

function updateUndoButtons() {
    $("undo").disabled = undoIndex <= 0;
    $("redo").disabled = undoIndex >= undoSteps.length - 1;
}

$("undo").addEventListener("click", () => stepUndo(-1));
$("redo").addEventListener("click", () => stepUndo(1));

// The editor gives restoredEditing(), to drop a selection that undo left pointing at nothing; deleteSelection() and
// nudgeSelection(dx, dy), which say whether there was a selection to act on; and cancelEditing(), for Escape.
document.addEventListener("keydown", event => {
    // Keys typed into a field of text are the field's: its own undo, its Delete. Arrows are also a slider's and a
    // menu's.
    const field = event.target.closest?.("input, textarea, select");
    const typing = !!field && (field.tagName === "TEXTAREA" || ["text", "number", "search"].includes(field.type));
    const steering = typing || (!!field && (field.tagName === "SELECT" || field.type === "range"));
    const command = event.metaKey || event.ctrlKey;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (command && !typing && (key === "z" || key === "y")) {
        event.preventDefault();
        stepUndo(key === "y" || event.shiftKey ? 1 : -1);
        return;
    }
    if (typing || command || event.altKey || (steering && key.startsWith("Arrow")))
        return;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    let handled = false;
    if (key === "Delete" || key === "Backspace") {
        handled = deleteSelection();
    } else if (key === "Escape") {
        cancelEditing();
        handled = true;
    } else if (arrows[key]) {
        // A pixel of the box, or ten with Shift.
        const pixels = event.shiftKey ? 10 : 1;
        handled = nudgeSelection(arrows[key][0] * pixels / state.width, arrows[key][1] * pixels / state.height);
    }
    if (handled) {
        event.preventDefault();
        changed();
    }
});

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
    $("presetInfo").disabled = !PRESETS[preset]?.note;

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
    $("sectionKindRow").hidden = !state.crossSection;
    $("sectionKind").value = state.sectionKind;
    $("sectionRowRow").hidden = !state.crossSection || state.sectionKind !== "row";
    $("sectionRow").value = String(Math.round(state.sectionRow * 100));
    $("sectionRowValue").textContent = `${Math.round(state.sectionRow * 100)}%`;
    $("sectionDrag").textContent = state.sectionKind === "row" ? "Drag the row up and down in either box." : "Drag A and B in either box.";
    $("gamut").value = state.gamut;
    // The gamut to check against shows while something checks against it.
    $("gamutRow").hidden = !(state.view === "gamut" || state.numbers || state.sample);
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

// An info button shows and hides the notes it controls, which start hidden so that the controls stay put as the
// notes change. Whether they're shown is the page's own, not the link's.
for (const button of document.querySelectorAll("button.info")) {
    button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.75" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="4.9" r="0.95" fill="currentColor"/><path d="M8 7.3v4.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    button.addEventListener("click", () => {
        const notes = $(button.getAttribute("aria-controls"));
        notes.hidden = !notes.hidden;
        button.setAttribute("aria-expanded", String(!notes.hidden));
    });
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
// Any of the models side by side, but at least one.
for (const button of document.querySelectorAll("#modelBar button")) {
    button.addEventListener("click", () => {
        const model = button.dataset.model;
        const on = state.models.includes(model);
        if (on && state.models.length === 1)
            return;
        state.models = MODELS.filter(other => other === model ? !on : state.models.includes(other));
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
$("sectionKind").addEventListener("change", () => {
    state.sectionKind = $("sectionKind").value;
    changed();
});
$("sectionRow").addEventListener("input", () => {
    state.sectionRow = Number($("sectionRow").value) / 100;
    changed();
});
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
