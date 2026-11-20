// MARK: - URL fragment

function encodeState() {
    const json = JSON.stringify({ v: 1, ...state });
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// The shared settings of a link, each kept to what the page can show, or its default.
function soundState(data) {
    const defaults = presetState(DEFAULT_PRESET);
    const integer = (value, low, high, fallback) => Number.isInteger(value) ? clamp(value, low, high) : fallback;
    const finite = v => typeof v === "number" && Number.isFinite(v);
    data.width = finite(data.width) ? clamp(Math.round(data.width), 100, 2000) : defaults.width;
    data.height = finite(data.height) ? clamp(Math.round(data.height), 100, 2000) : defaults.height;
    data.steps = integer(data.steps, 0, 12, defaults.steps);
    data.level = integer(data.level, 0, 16, defaults.level);
    const resolutions = [...$("resolution").options].map(option => Number(option.value));
    if (!resolutions.includes(data.resolution))
        data.resolution = defaults.resolution;
    const models = Array.isArray(data.models) ? MODELS.filter(model => data.models.includes(model)) : [];
    data.models = models.length ? models : defaults.models;
    if (![...$("view").options].some(option => option.value === data.view))
        data.view = "gradient";
    const point = p => Array.isArray(p) && p.length === 2 && p.every(finite);
    data.section = Array.isArray(data.section) && data.section.length === 2 && data.section.every(point)
        ? data.section.map(p => p.map(v => clamp(v, 0, 1))) : defaults.section;
    if (!SECTION_KINDS.includes(data.sectionKind))
        data.sectionKind = defaults.sectionKind;
    data.sectionRow = finite(data.sectionRow) ? clamp(data.sectionRow, 0, 1) : defaults.sectionRow;
    if (typeof data.sheetHeight !== "string")
        data.sheetHeight = defaults.sheetHeight;
    for (const key of ["crossSection", "sheet", "numbers", "about", "sample", "otherCurves"])
        data[key] = !!data[key];
    data.edgeStrips = data.edgeStrips !== false;
    if (data.flatHold !== "cut")
        data.flatHold = "band";
    return data;
}

function decodeState(text) {
    try {
        const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
        const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, ch => ch.charCodeAt(0))));
        if (data.v !== 1 || !acceptsState(data))
            return null;
        if (typeof data.space === "number")
            data.space = ["srgb", "srgb-linear", "oklab"][data.space];
        if (!SPACES.includes(data.space))
            data.space = "oklab";
        if (data.gamutMapping !== "clip")
            data.gamutMapping = "map";
        if (!BACKDROPS.includes(data.backdrop))
            data.backdrop = "checkerboard";
        if (!/^#[0-9a-f]{6}$/i.test(data.backdropColor))
            data.backdropColor = "#ffffff";
        if (!GAMUTS.includes(data.gamut))
            data.gamut = "srgb";
        if (!EDGES.includes(data.edges))
            data.edges = "mirrored";
        if (!Object.hasOwn(EDITING, data.editing))
            data.editing = "full";
        delete data.v;
        return soundState({ ...presetState(DEFAULT_PRESET), ...data });
    } catch {
        return null;
    }
}

// WebKit throws after 100 replaceState() calls in 10 seconds, so writes are throttled.
let hashTimer = null;
let lastWrittenHash = "";
function writeHash() {
    clearTimeout(hashTimer);
    hashTimer = null;
    const hash = "#" + encodeState();
    if (hash === lastWrittenHash)
        return;
    try {
        history.replaceState(null, "", hash);
        lastWrittenHash = hash;
    } catch {
        hashTimer = setTimeout(writeHash, 1000);
    }
}
function scheduleHashWrite() {
    if (hashTimer === null)
        hashTimer = setTimeout(writeHash, 250);
}

// MARK: - Start

new ResizeObserver(() => scheduleRender()).observe($("views"));
state = decodeState(location.hash.slice(1)) ?? presetState(DEFAULT_PRESET);
resetEditing();
render();
setUpGPU().then(() => scheduleRender(), error => {
    gpuError = error.message;
    scheduleRender();
});
