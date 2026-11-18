// MARK: - URL fragment

function encodeState() {
    const json = JSON.stringify({ v: 1, ...state });
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
        if (data.gamutMapping !== "map")
            data.gamutMapping = "clip";
        if (!BACKDROPS.includes(data.backdrop))
            data.backdrop = "checkerboard";
        if (!GAMUTS.includes(data.gamut))
            data.gamut = "srgb";
        if (!EDGES.includes(data.edges))
            data.edges = "mirrored";
        delete data.v;
        return { ...presetState(DEFAULT_PRESET), ...data };
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
render();
setUpGPU().then(() => scheduleRender(), error => {
    gpuError = error.message;
    scheduleRender();
});
