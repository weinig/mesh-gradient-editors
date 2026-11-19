// Helpers for the tests in this folder, which run inside a built editor's page: run.py appends this file, then an
// editor's cases, to a copy of the page. A case is test(name, async t => { ... }); it fails if a check of t's fails,
// if it throws, or if the page logs a JavaScript or WebGPU error while it runs.

const cases = [];
const test = (name, run) => cases.push({ name, run });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pageErrors = [];
addEventListener("error", event => pageErrors.push(event.message));
addEventListener("unhandledrejection", event => pageErrors.push(String(event.reason)));

// Sets a control as a user would, and tells the page.
function set(id, value) {
    const element = $(id);
    if (element.type === "checkbox")
        element.checked = value;
    else
        element.value = value;
    element.dispatchEvent(new Event(element.type === "range" ? "input" : "change"));
    if (element.type === "range")
        element.dispatchEvent(new Event("change"));
}

// Picks a preset by its name, so the tests don't depend on the presets' order.
async function preset(name) {
    const index = PRESETS.findIndex(preset => preset.name === name);
    if (index < 0)
        throw new Error(`no preset named ${name}`);
    set("preset", String(index));
    await sleep(300);
}

// The solve of box `view` (0 the biharmonic, 1 the harmonic) read back afresh: needs Numbers, Cross-section or 3D on.
async function grab(view = 0) {
    // Drawn here and now: a window that's covered gets no frames of its own, and the page would wait for one.
    changed();
    render();
    await sleep(400);
    for (let tries = 0; tries < 100 && views[view].reading; ++tries)
        await sleep(50);
    views[view].readout = null;
    views[view].readKey = null;
    changed();
    render();
    for (let tries = 0; tries < 400 && !(views[view].readout && !views[view].reading); ++tries)
        await sleep(50);
    if (!views[view].readout)
        throw new Error("the solve was never read back");
    return views[view].readout;
}

// The least and greatest of a readout's color components, not its alpha.
function range(readout) {
    let low = Infinity, high = -Infinity;
    for (let i = 0; i < readout.values.length; ++i) {
        if (i % 4 === 3)
            continue;
        low = Math.min(low, readout.values[i]);
        high = Math.max(high, readout.values[i]);
    }
    return [low, high];
}

// The largest difference between two readouts' values.
function difference(a, b) {
    let worst = 0;
    for (let i = 0; i < a.length; ++i)
        worst = Math.max(worst, Math.abs(a[i] - b[i]));
    return worst;
}

// Pointer events on box `view`'s overlay, at fractions of its width and height.
function pointer(view = 0) {
    const overlay = views[view].overlay;
    const at = (x, y) => {
        const rect = overlay.getBoundingClientRect();
        return { clientX: rect.left + x * rect.width, clientY: rect.top + y * rect.height };
    };
    const fire = (type, x, y) => overlay.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: 1, button: 0, buttons: type === "pointerup" ? 0 : 1, ...at(x, y),
    }));
    return {
        fire,
        async click(x, y) {
            fire("pointerdown", x, y);
            fire("pointerup", x, y);
            await sleep(30);
        },
        async drag(points) {
            fire("pointerdown", ...points[0]);
            for (const point of points.slice(1)) {
                await sleep(40);
                fire("pointermove", ...point);
            }
            await sleep(40);
            fire("pointerup", ...points.at(-1));
            await sleep(300);
        },
        doubleClick: (x, y) => overlay.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, ...at(x, y) })),
    };
}

// Whether an element is drawn at all.
const shown = id => getComputedStyle($(id)).display !== "none";

async function runCases() {
    await sleep(1500);
    const results = [];
    // The page as it opened, to put back before each case. The freeform-gradient() editor has no resetEditing().
    const initial = structuredClone(state);
    for (const { name, run } of cases) {
        document.title = `TESTS running ${name}`;
        const failures = [];
        const t = {
            ok: (condition, message) => condition || failures.push(message),
            below: (value, limit, message) => value <= limit || failures.push(`${message}: ${+value.toFixed(4)} is over ${limit}`),
            above: (value, limit, message) => value >= limit || failures.push(`${message}: ${+value.toFixed(4)} is under ${limit}`),
            equal: (value, expected, message) => value === expected || failures.push(`${message}: ${JSON.stringify(value)}, not ${JSON.stringify(expected)}`),
        };
        const errorsBefore = pageErrors.length;
        try {
            if (typeof resetEditing === "function") {
                state = structuredClone(initial);
                resetEditing();
                changed();
                await sleep(300);
            }
            await run(t);
        } catch (error) {
            failures.push(`threw ${error?.message ?? error}`);
        }
        if (pageErrors.length > errorsBefore)
            failures.push(`page errors: ${pageErrors.slice(errorsBefore).join("; ")}`);
        if (typeof gpuError !== "undefined" && gpuError)
            failures.push(`WebGPU error: ${gpuError}`);
        results.push([name, failures]);
    }
    document.title = `TESTS done ${JSON.stringify(results)}`;
}
