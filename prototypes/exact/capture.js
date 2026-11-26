// Runs in the diffusion editor's page, with the tests' prelude.js: solves each of CAPTURES, and posts what the
// biharmonic model's finest level held and what it solved to capture.py.

// Reads a level's textures through a compute pass, since they can't be copied.
async function dumpTextures(renderer, textures, width, height) {
    const device = renderer.device;
    const out = {};
    for (const [name, texture] of textures) {
        const module = device.createShaderModule({ code: `
@group(0) @binding(0) var t: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> o: array<vec4<f32>>;
@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    o[id.y * ${width}u + id.x] = textureLoad(t, vec2<i32>(id.xy), 0);
}` });
        const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
        const size = width * height * 16;
        const buffer = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        const read = device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: texture.createView() }, { binding: 1, resource: { buffer } }] });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.dispatchWorkgroups(width, height);
        pass.end();
        encoder.copyBufferToBuffer(buffer, 0, read, 0, size);
        device.queue.submit([encoder.finish()]);
        await read.mapAsync(GPUMapMode.READ);
        out[name] = new Float32Array(read.getMappedRange().slice(0));
        read.destroy();
        buffer.destroy();
    }
    return out;
}

test("capture", async t => {
    const post = async (name, body) => {
        const response = await fetch(`http://127.0.0.1:${CAPTURE_PORT}/${name}`, { method: "POST", body: new Blob([body]) });
        if (!response.ok)
            throw new Error(`posting ${name}: ${response.status}`);
    };
    for (const { slug, preset: name, edges, resolution } of CAPTURES) {
        set("numbers", false);
        await preset(name);
        // Alone, the box is as large as the grid asked for.
        state.models = ["biharmonic"];
        if (edges)
            set("edges", edges);
        state.width = state.height = 1024;
        set("resolution", String(resolution));
        set("numbers", true);
        const renderer = views[0].renderer;
        const solve = async restart => {
            renderer.finestRestart = restart;
            renderer.solvedSize = null;
            await grab(0);
            return renderer.levels[0];
        };
        const level = await solve(null), { width, height } = level;
        const got = await dumpTextures(renderer, [["color", level.constraintColor], ["weight", level.constraintWeight],
            ["tears", level.tears], ["values", level.values.texture]], width, height);
        for (const [key, array] of Object.entries(got))
            await post(`${slug}.${key}`, array);
        // And with the residual never formed afresh.
        const carried = await solve(0);
        await post(`${slug}.carried`, (await dumpTextures(renderer, [["carried", carried.values.texture]], width, height)).carried);
        renderer.finestRestart = null;
        const strengths = Array.from(renderer.gradient.strengths ?? []);
        await post(`${slug}.json`, new TextEncoder().encode(JSON.stringify({ width, height, natural: !!renderer.gradient.naturalEdges,
            points: renderer.pointCount, partial: strengths.some(strength => strength < 1) })));
    }
    t.ok(true, "captured");
});
