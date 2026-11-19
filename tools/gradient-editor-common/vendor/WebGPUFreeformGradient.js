// Draws a freeform gradient with WebGPU: the browser side of the
// FreeformGradient package's WebGPU renderer, a port of its Metal renderer:
// the solver's harmonic and biharmonic multigrids, and the sharp edges drawn
// over two-sided lines. It is given the WGSL in WebGPUFreeformGradient.wgsl and a
// gradient as WebGPUFreeformGradient.GradientData encodes it, solves it for
// the size of whatever it draws into, and draws into any texture view of the
// format it was made for. Its readPixels needs readTexturePixels, from the
// WebGPUHost package's script, which pages inline before it.
//
//   const renderer = new WebGPUFreeformGradientRenderer(device, { shader, format: "bgra8unorm" });
//   renderer.setGradient(gradient);
//   const encoder = device.createCommandEncoder();
//   renderer.encode(encoder, context.getCurrentTexture().createView(), canvas.width, canvas.height);
//   device.queue.submit([encoder.finish()]);

// What the Metal solver's harmonic multigrid does, in the same numbers: see
// FreeformGradientSolver.swift.
const preSmoothing = 2;
const postSmoothing = 2;
const smallLevelSmoothing = 8;
const coarsestSmoothing = 500;
const finestCycles = 2;
const twoSidedCycles = 2;
const harmonicOmega = 0.9;
// A two-sided segment holds each side's color across at least this many
// texels of the finest level. The biharmonic needs two whole texels a side to
// hold the slope across the line as well as the colors: with fewer, it tilts
// each side into a steep plane through both colors, far past them. Three
// leaves room for the partly held texels at the band's edge.
const twoSidedTexels = 3;
// Levels of no more than this many texels take all their smoothing steps in
// one dispatch, as many as the device allows: the Metal solver's
// smallLevelTexels.
const maximumSmallLevelTexels = 1024;

// What the Metal solver's biharmonic does, settled as its images are.
const biharmonicOmega = 0.55;
const biharmonicSmoothing = 4;
const galerkinSmoothing = 4;
const biharmonicCycles = 1;
const finestBiharmonicCycles = 16;
const twoSidedBiharmonicCycles = 4;
// With natural edges the finest level takes more steps, its residual formed afresh every few.
const naturalBiharmonicCycles = 40;
const naturalRestart = 10;
const conjugateGradientSmoothing = 2;
// The coarsest level's inverse, n × n with n up to 64, then each row's scale.
const coarsestTexels = 64;
// Partial sums of a dot product, one a workgroup of 16×16 texels, over a
// 2048-texel grid.
const maximumPartialSums = (2048 / 16) * (2048 / 16);
// What a level's Galerkin coefficients take: 25 coefficients, whether the row
// is free, its magnitude, its sum, and whether it is the background.
const coefficientSlices = 29;

// How far beyond where a two-sided line holds its colors its strips blend
// into the solution, in finest texels: the Metal renderer's edgeBlendTexels.
const edgeBlendTexels = 1.5;

const fround = Math.fround;

// The rows of the Galerkin levels below a level's own equation where no point
// and no edge reaches: the 13-point stencil's Pᵀ K P / 4 on an unbounded
// grid, and that of each in turn, 25 numbers a row, as the Metal solver's
// backgroundRows.
//
// After those 16 levels' rows are the same for the membrane's 5-point
// Laplacian, which the shader adds by the membrane's weight.
function backgroundRows() {
  return new Float32Array([
    ...stencilBackgroundRows([
      [0, 0, 20], [-1, 0, -8], [1, 0, -8], [0, -1, -8], [0, 1, -8],
      [-1, -1, 2], [1, -1, 2], [-1, 1, 2], [1, 1, 2], [-2, 0, 1], [2, 0, 1], [0, -2, 1], [0, 2, 1],
    ]),
    ...stencilBackgroundRows([[0, 0, 4], [-1, 0, -1], [1, 0, -1], [0, -1, -1], [0, 1, -1]]),
  ]);
}

function stencilBackgroundRows(coefficients) {
  let stencil = new Map();
  const key = (x, y) => `${x},${y}`;
  for (const [x, y, c] of coefficients) {
    stencil.set(key(x, y), { x, y, c });
  }
  const corners = (i) => {
    const x = 0.5 * i - 0.25;
    const base = Math.floor(x);
    return [[base, 1 - (x - base)], [base + 1, x - base]];
  };
  const fromOrigin = [[-1, 0.25], [0, 0.75], [1, 0.75], [2, 0.25]];
  const rows = [];
  for (let level = 0; level < 16; level++) {
    const coarse = new Map();
    for (const [ix, wx] of fromOrigin) {
      for (const [iy, wy] of fromOrigin) {
        for (const { x, y, c } of stencil.values()) {
          for (const [jx, vx] of corners(ix + x)) {
            for (const [jy, vy] of corners(iy + y)) {
              const k = key(jx, jy);
              const entry = coarse.get(k) ?? { x: jx, y: jy, c: 0 };
              entry.c += 0.25 * wx * wy * c * vx * vy;
              coarse.set(k, entry);
            }
          }
        }
      }
    }
    stencil = coarse;
    for (let o = 0; o < 25; o++) {
      rows.push(coarse.get(key(o % 5 - 2, Math.floor(o / 5) - 2))?.c ?? 0);
    }
  }
  return rows;
}

// The membrane's weight in a level's own equation with natural edges, scaled
// as Finch et al. scale theirs, by the texel's size in the box squared, so
// it weighs the same on every grid. It's a tenth of their 0.16, which bent a
// plane through three points by 0.03 of its colors' range; this bends it by
// 0.003, and 32-bit floats still solve it.
const membraneWeight = 0.016;

// Each Chebyshev step's weights, toward eigenvalues in [1/16, 1] of a level
// scaled so that none is larger than 1, in 32-bit floats as the Metal solver
// works them out.
function chebyshevSteps(count) {
  const low = fround(1 / 16), high = 1;
  const gamma = fround(2 / fround(low + high));
  const sigma = fround(fround(high - low) / fround(high + low));
  const steps = [];
  let omega = 1;
  for (let index = 0; index < count; index++) {
    if (index === 1) {
      omega = fround(1 / fround(1 - fround(fround(sigma * sigma) / 2)));
    } else if (index > 1) {
      omega = fround(1 / fround(1 - fround(fround(fround(sigma * sigma) * omega) / 4)));
    }
    steps.push({ omega, gamma });
  }
  return steps;
}

// The index of a grid's texture that is neither of two others.
function spare(a, b) {
  return [0, 1, 2].find((i) => i !== a && i !== b);
}

// Textures of a level, so a step reads one and writes another: two, and a
// third for the biharmonic's Chebyshev steps, which also read the one before.
// The same as the Metal solver's Grid.
class Grid {
  constructor(textures) {
    this.textures = textures;
    this.current = 0;
  }
  // What the last step wrote.
  get texture() { return this.textures[this.current]; }
  // What the next step writes.
  get next() { return this.textures[this.current === 0 ? 1 : 0]; }
  flip() { this.current = this.current === 0 ? 1 : 0; }
}

// A level's uniforms, 64 bytes, in slots this far apart.
const uniformSlotBytes = 256;
const uniformSlots = 1024;

export class WebGPUFreeformGradientRenderer {
  // The pipelines do not depend on the gradient, so they are made once. The
  // display pass writes encoded sRGB, for a unorm format: bgra8unorm, as the
  // Metal renderer's view is.
  constructor(device, { shader, format }) {
    this.device = device;
    this.format = format;
    const limits = device.limits;
    // As many texels as one workgroup can hold, two copies of each. Pages ask
    // for the device's own limits, so it is the Metal solver's 1024 on a Mac.
    this.smallLevelTexels = Math.max(1, Math.min(
      maximumSmallLevelTexels,
      limits.maxComputeInvocationsPerWorkgroup,
      limits.maxComputeWorkgroupSizeX,
      Math.floor(limits.maxComputeWorkgroupStorageSize / 32)));

    const module = device.createShaderModule({ code: shader });
    const compute = (entryPoint, constants) => device.createComputePipeline({
      layout: "auto", compute: { module, entryPoint, constants },
    });
    this.pipelines = {
      constraints: compute("freeformConstraints"),
      fill: compute("freeformFill"),
      prolong: compute("freeformProlong"),
      smooth: compute("freeformSmooth"),
      smoothSmall: compute("freeformSmoothSmall", { smallLevelTexels: this.smallLevelTexels }),
      restrict: compute("freeformRestrict"),
      correct: compute("freeformCorrect"),
    };
    for (const name of [
      "OwnCoefficients", "BackgroundFromOwn", "BackgroundFromGalerkin", "EntriesFromOwn", "EntriesFromGalerkin",
      "RowsFromOwn", "RowsFromGalerkin", "ChebyshevOwn", "ChebyshevGalerkin", "ResidualOwn", "ResidualGalerkin",
      "RestrictOwn", "RestrictGalerkin", "CorrectOwn", "CorrectGalerkin", "CoarsestInverse", "CoarsestSolve",
      "CoarsestSolveOwn", "ChebyshevOwnCorrection", "ResidualOwnCorrection", "Clear", "Dot", "Scalars", "Reset",
      "HoldColors", "Direction", "Step", "ProlongHeld", "FillHeld",
    ]) {
      this.pipelines[name] = compute("bh" + name);
    }
    this.displayPipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "freeformDisplayVertex" },
      fragment: { module, entryPoint: "freeformDisplayFragment", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
    this.edgePipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "freeformEdgeVertex" },
      fragment: { module, entryPoint: "freeformEdgeFragment", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });

    const storage = (size) => device.createBuffer({ size, usage: GPUBufferUsage.STORAGE });
    this.coarsestInverse = storage((coarsestTexels * coarsestTexels + coarsestTexels) * 4);
    this.partialSums = storage(maximumPartialSums * 16);
    this.conjugateGradientState = storage(64);
    const rows = backgroundRows();
    this.backgroundRows = device.createBuffer({
      size: rows.byteLength, usage: GPUBufferUsage.STORAGE, mappedAtCreation: true,
    });
    new Float32Array(this.backgroundRows.getMappedRange()).set(rows);
    this.backgroundRows.unmap();
    this.edgeBuffer = null;
    this.edgeVertexCount = 0;

    // A solve is a thousand dispatches or more, and WebKit makes each bind
    // group an argument buffer of its own: made anew every solve, they take
    // about as long as the GPU does. So views and bind groups are made once
    // and kept — the same textures, buffers and uniform slots are bound the
    // same way solve after solve — until the pyramid or a buffer they bind
    // is replaced.
    this.views = new WeakMap();
    this.bindGroups = new Map();
    this.ids = new WeakMap();
    this.lastID = 0;

    this.uniforms = device.createBuffer({
      size: uniformSlotBytes * uniformSlots, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.fillColor = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.displayUniforms = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    this.gradient = null;
    this.levels = [];
    this.boxScale = [1, 1];
    // The box the gradient was last solved for, or null if it is not.
    this.solvedSize = null;
    this.pointBuffer = null;
    this.segmentBuffer = null;
  }

  // Replaces the gradient, to be solved the next time it is drawn.
  setGradient(gradient) {
    this.gradient = gradient;
    this.solvedSize = null;
  }

  // Encodes solving the gradient for a box `width` by `height`, if it is not
  // solved for one already, and drawing it into `view`.
  encode(encoder, view, width, height) {
    const pass = () => encoder.beginRenderPass({
      colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
    });
    if (!this.gradient || !this.prepare(width, height)) {
      pass().end();
      return;
    }
    if (this.solvedSize?.[0] !== width || this.solvedSize?.[1] !== height) {
      this.encodeSolve(encoder);
      this.solvedSize = [width, height];
    }

    const uniforms = new ArrayBuffer(32);
    new Uint32Array(uniforms, 0, 4).set([this.gradient.space, this.gradient.outputIsDisplayP3 ?? 0, this.gradient.gamutMapping ?? 0, 0]);
    new Float32Array(uniforms, 16, 4).set(this.gradient.window ?? [0, 0, 1, 1]);
    this.device.queue.writeBuffer(this.displayUniforms, 0, uniforms);
    const render = pass();
    render.setPipeline(this.displayPipeline);
    render.setBindGroup(0, this.bindGroup(this.displayPipeline, [
      { binding: 0, resource: { buffer: this.displayUniforms } },
      { binding: 1, resource: this.view(this.levels[0].values.texture) },
    ]));
    render.draw(3);
    if (this.edgeVertexCount > 0 && this.gradient.edgeStrips !== false) {
      // Over the gradient, the strips either side of its two-sided lines.
      render.setPipeline(this.edgePipeline);
      render.setBindGroup(0, this.bindGroup(this.edgePipeline, [
        { binding: 0, resource: { buffer: this.displayUniforms } },
        { binding: 1, resource: this.view(this.levels[0].values.texture) },
        { binding: 2, resource: { buffer: this.edgeBuffer } },
      ]));
      render.draw(this.edgeVertexCount);
    }
    render.end();
  }

  // Draws the gradient into a texture of its own, `width` by `height` pixels,
  // its box that size, and resolves to its pixels: rows of `width * 4` bytes
  // from the top, in the format's byte order, premultiplied.
  async readPixels(width, height) {
    const { device } = this;
    const texture = device.createTexture({
      size: [width, height], format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const encoder = device.createCommandEncoder();
    this.encode(encoder, texture.createView(), width, height);
    device.queue.submit([encoder.finish()]);
    const pixels = await readTexturePixels(device, texture, width, height);
    texture.destroy();
    return pixels;
  }

  destroy() {
    this.destroyLevels();
    this.pointBuffer?.destroy();
    this.segmentBuffer?.destroy();
    this.edgeBuffer?.destroy();
    for (const buffer of [this.coarsestInverse, this.partialSums, this.conjugateGradientState, this.backgroundRows]) {
      buffer.destroy();
    }
    this.uniforms.destroy();
    this.fillColor.destroy();
    this.displayUniforms.destroy();
  }

  // MARK: - Views and bind groups

  // A view of the whole of `texture`, made the first time it is asked for.
  view(texture) {
    let view = this.views.get(texture);
    if (!view) {
      view = texture.createView();
      this.views.set(texture, view);
    }
    return view;
  }

  // A bind group of `pipeline`'s first group with `entries`, made the first
  // time they are bound together.
  bindGroup(pipeline, entries) {
    const key = [this.id(pipeline), ...entries.map(({ binding, resource }) => resource.buffer
      ? `${binding}:${this.id(resource.buffer)}:${resource.offset ?? 0}:${resource.size ?? 0}`
      : `${binding}:${this.id(resource)}`)].join(" ");
    let group = this.bindGroups.get(key);
    if (!group) {
      group = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
      this.bindGroups.set(key, group);
    }
    return group;
  }

  // A number for an object, the same each time, for a bind group's key.
  id(object) {
    let id = this.ids.get(object);
    if (id === undefined) {
      id = ++this.lastID;
      this.ids.set(object, id);
    }
    return id;
  }

  // Replaces `old` with a storage buffer holding `data`, or writes `data` into
  // it if it has room, so that the bind groups that bind it stay good.
  storageBuffer(old, data) {
    if (old && old.size >= data.byteLength) {
      this.device.queue.writeBuffer(old, 0, data);
      return old;
    }
    old?.destroy();
    this.bindGroups.clear();
    // Room to grow, so a gradient that gains a point or a segment does not
    // make a new one.
    const result = this.device.createBuffer({
      size: Math.max(256, Math.ceil(data.byteLength * 1.5 / 16) * 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(result, 0, data);
    return result;
  }

  // MARK: - The pyramid

  // Sizes the pyramid for a box `width` by `height`, as the Metal solver's
  // prepare(boxSize:resolution:) does: a grid of the box's shape whose
  // longest side is no more than the resolution nor the box's own, halving
  // down to a few texels. Returns whether there is a grid at all.
  prepare(width, height) {
    const longest = Math.max(width, height);
    const shortest = Math.min(width, height);
    if (shortest <= 0) {
      this.destroyLevels();
      this.solvedSize = null;
      return false;
    }
    // The biharmonic's dot products have room for a grid of up to 2048
    // texels a side.
    const scale = Math.min(1, Math.min(this.gradient.resolution, 2048) / longest);
    let levelWidth = Math.max(1, Math.round(width * scale));
    let levelHeight = Math.max(1, Math.round(height * scale));
    this.boxScale = [width / shortest, height / shortest];
    const finest = this.levels[0];
    if (finest && finest.width === levelWidth && finest.height === levelHeight) {
      return true;
    }

    this.destroyLevels();
    const levels = [];
    while (true) {
      levels.push(this.makeLevel(levelWidth, levelHeight));
      if (Math.max(levelWidth, levelHeight) <= 8) {
        break;
      }
      levelWidth = Math.floor((levelWidth + 1) / 2);
      levelHeight = Math.floor((levelHeight + 1) / 2);
    }
    this.levels = levels;
    return true;
  }

  makeLevel(width, height) {
    const { device } = this;
    const texture = (format) => device.createTexture({
      size: [width, height], format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    // Two textures to start with; the biharmonic adds a third.
    const grid = () => new Grid([texture("rgba32float"), texture("rgba32float")]);
    return {
      texture,
      width, height,
      values: grid(),
      constraintColor: texture("rgba32float"),
      constraintWeight: texture("r32float"),
      // Where tears cross the level's grid.
      tears: texture("r32float"),
      rightHandSide: texture("rgba32float"),
      correction: grid(),
      correctionRightHandSide: texture("rgba32float"),
      // What only the biharmonic needs, made when it first does.
      coefficients: null,
      conjugateGradient: null,
      owned: [],
    };
  }

  // Gives the levels what the biharmonic needs besides: a third texture for
  // each grid; coefficients for each level but the finest of several; and on
  // that one, the conjugate gradients' residual, direction and K times it —
  // two of the first two, since a step cannot read and write a texture.
  prepareBiharmonic() {
    const { device, levels } = this;
    levels.forEach((level, index) => {
      if (level.values.textures.length < 3) {
        for (const grid of [level.values, level.correction]) {
          const texture = level.texture("rgba32float");
          grid.textures.push(texture);
          level.owned.push(texture);
        }
      }
      if (!level.coefficients && (index > 0 || levels.length === 1)) {
        level.coefficients = device.createBuffer({
          size: level.width * level.height * coefficientSlices * 4, usage: GPUBufferUsage.STORAGE,
        });
        level.owned.push(level.coefficients);
      }
      if (!level.conjugateGradient && index === 0 && levels.length > 1) {
        const textures = [0, 1, 2, 3, 4].map(() => level.texture("rgba32float"));
        level.owned.push(...textures);
        level.conjugateGradient = {
          residual: new Grid(textures.slice(0, 2)),
          direction: new Grid(textures.slice(2, 4)),
          product: textures[4],
        };
      }
    });
  }

  destroyLevels() {
    for (const level of this.levels) {
      for (const t of [...level.values.textures.slice(0, 2), level.constraintColor, level.constraintWeight, level.tears,
                       level.rightHandSide, ...level.correction.textures.slice(0, 2), level.correctionRightHandSide,
                       ...level.owned]) {
        t.destroy();
      }
    }
    this.levels = [];
    this.bindGroups.clear();
  }

  // MARK: - Solving

  encodeSolve(encoder) {
    const { device, gradient, levels } = this;
    this.slots = new Map();
    this.slotData = new ArrayBuffer(uniformSlotBytes * uniformSlots);
    this.packSources();

    const pass = encoder.beginComputePass();
    this.pass = pass;
    const finest = levels[0];
    // With no points to diffuse, the gradient is transparent.
    if (gradient.isEmpty) {
      this.fill(finest, [0, 0, 0, 0]);
    } else {
      const holdLevels = (holds) => {
        for (let index = 0; index < levels.length; index++) {
          this.dispatch("constraints", levels[index], [
            this.uniformEntry(index, index, 0, [0, 0], holds),
            { binding: 1, resource: { buffer: this.pointBuffer } },
            { binding: 2, resource: { buffer: this.segmentBuffer } },
            { binding: 3, resource: this.view(levels[index].constraintColor) },
            { binding: 4, resource: this.view(levels[index].constraintWeight) },
            { binding: 5, resource: this.view(levels[index].rightHandSide) },
            // Read only for holds 2 and 3; any texture the kernel doesn't write otherwise.
            { binding: 6, resource: this.view(holds >= 2 ? finest.values.texture : finest.correctionRightHandSide) },
            { binding: 7, resource: this.view(levels[index].tears) },
          ]);
        }
      };
      if (gradient.model === "biharmonic") {
        // Held less than fully, a segment would make the biharmonic overshoot badly beside it. Instead, it's solved
        // without the segments less than fully held, then again with them held fully, each at its strength's mix
        // from that solution's color to its own. Since the solution is linear in the held colors, a lone segment's
        // strength mixes from the gradient without it to the gradient with it.
        // As packSources() clamps them: a strength that isn't a number holds fully.
        const weak = Array.from({ length: this.segmentCount }, (_, i) => Number.isFinite(gradient.strengths?.[i]) && gradient.strengths[i] < 1);
        if (weak.some(Boolean)) {
          if (this.pointCount || !weak.every(Boolean)) {
            holdLevels(1);
            this.encodeBiharmonic();
          } else {
            this.fill(finest, gradient.average);
          }
          holdLevels(2);
          this.encodeBiharmonic();
        } else {
          holdLevels(0);
          this.encodeBiharmonic();
          // A point of no radius holds the texel it's in, at the texel's center. Solved again, with each center
          // held off its point's color by as much as this solution slopes between the two, the point itself has its
          // color, wherever in the texel it is.
          if (this.hasThinPoints) {
            holdLevels(3);
            this.encodeBiharmonic();
          }
        }
      } else {
        holdLevels(0);
        this.encodeMultigrid();
      }
    }
    pass.end();
    this.pass = null;
    device.queue.writeBuffer(this.uniforms, 0, this.slotData, 0, uniformSlotBytes * Math.max(this.slots.size, 1));
    this.makeEdges();
  }

  // Full multigrid: the coarsest level solved outright, then each finer level
  // started from the one below and V-cycled, the finest more than once.
  encodeMultigrid() {
    const { levels, gradient } = this;
    const coarsest = levels.length - 1;
    const bottom = levels[coarsest];
    this.fill(bottom, gradient.average);
    this.smooth(coarsest, bottom.values, bottom.rightHandSide, coarsestSmoothing, coarsest);
    for (let index = coarsest - 1; index >= 0; index--) {
      this.prolong(index);
      const extra = gradient.hasTwoSidedLines ? twoSidedCycles : 0;
      const cycles = index === 0 ? 1 + finestCycles + extra : 1;
      for (let cycle = 0; cycle < cycles; cycle++) {
        this.vCycle(index, levels[index].values, levels[index].rightHandSide, index);
      }
    }
  }

  vCycle(index, x, b, top) {
    const { levels } = this;
    const level = levels[index];
    if (index === levels.length - 1) {
      this.smooth(index, x, b, coarsestSmoothing, top);
      return;
    }
    const small = this.isSmall(level);
    this.smooth(index, x, b, small ? smallLevelSmoothing : preSmoothing, top);

    const coarse = levels[index + 1];
    this.dispatch("restrict", coarse, [
      this.uniformEntry(index, top, 0, [coarse.width, coarse.height]),
      { binding: 1, resource: this.view(x.texture) },
      { binding: 2, resource: this.view(b) },
      { binding: 3, resource: this.view(level.constraintWeight) },
      { binding: 4, resource: this.view(coarse.correctionRightHandSide) },
      { binding: 5, resource: this.view(coarse.correction.texture) },
    ]);

    this.vCycle(index + 1, coarse.correction, coarse.correctionRightHandSide, top);

    this.dispatch("correct", level, [
      this.uniformEntry(index, top),
      { binding: 1, resource: this.view(coarse.correction.texture) },
      { binding: 2, resource: this.view(x.texture) },
      { binding: 3, resource: this.view(x.next) },
      { binding: 4, resource: this.view(level.constraintWeight) },
    ]);
    x.flip();

    this.smooth(index, x, b, small ? smallLevelSmoothing : postSmoothing, top);
  }

  // `times` smoothing steps of `x` toward `b` on level `index`: a dispatch
  // each, or for a small level, all in one.
  smooth(index, x, b, times, top) {
    if (times <= 0) {
      return;
    }
    const level = this.levels[index];
    const entries = (iterations) => [
      this.uniformEntry(index, top, iterations),
      { binding: 1, resource: this.view(x.texture) },
      { binding: 2, resource: this.view(x.next) },
      { binding: 3, resource: this.view(b) },
      { binding: 4, resource: this.view(level.constraintWeight) },
    ];
    if (this.isSmall(level)) {
      const pipeline = this.pipelines.smoothSmall;
      this.pass.setPipeline(pipeline);
      this.pass.setBindGroup(0, this.bindGroup(pipeline, entries(times)));
      this.pass.dispatchWorkgroups(1);
      x.flip();
      return;
    }
    for (let step = 0; step < times; step++) {
      this.dispatch("smooth", level, entries(0));
      x.flip();
    }
  }

  isSmall(level) {
    return level.width * level.height <= this.smallLevelTexels;
  }

  // Starts level `index` from the solution of the level below it.
  prolong(index) {
    const level = this.levels[index];
    level.values.current = 0;
    this.dispatch("prolong", level, [
      this.uniformEntry(index, index),
      { binding: 1, resource: this.view(this.levels[index + 1].values.texture) },
      { binding: 2, resource: this.view(level.values.textures[0]) },
    ]);
  }

  fill(level, color) {
    this.device.queue.writeBuffer(this.fillColor, 0, new Float32Array(color));
    level.values.current = 0;
    this.dispatch("fill", level, [
      this.uniformEntry(this.levels.indexOf(level), this.levels.indexOf(level)),
      { binding: 1, resource: { buffer: this.fillColor } },
      { binding: 2, resource: this.view(level.values.textures[0]) },
    ]);
  }

  dispatch(name, over, entries) {
    const pipeline = this.pipelines[name];
    this.pass.setPipeline(pipeline);
    this.pass.setBindGroup(0, this.bindGroup(pipeline, entries));
    this.pass.dispatchWorkgroups(Math.ceil(over.width / 8), Math.ceil(over.height / 8));
  }

  // MARK: - The biharmonic

  // The biharmonic kernels' uniforms: `of` the level, or the finer of two;
  // `coarse` the coarser, or the level itself for its own coefficients.
  bh({ of, coarse = null, fill = [0, 0, 0, 0], step = null, flag = 0, count = 0, own = of }) {
    // `own` is the level whose own equation the kernel has or builds on: `of`, unless told.
    const natural = this.gradient.naturalEdges ? 1 : 0;
    const membrane = natural ? membraneWeight / Math.max(own.width, own.height) ** 2 : 0;
    const key = ["bh", of.width, of.height, coarse?.width ?? 0, coarse?.height ?? 0, ...fill,
                 step?.omega ?? 0, step?.gamma ?? 0, flag, count, natural, membrane].join(":");
    return this.slotEntry(20, key, (u32, f32) => {
      u32[0] = of.width;
      u32[1] = of.height;
      u32[2] = coarse?.width ?? 0;
      u32[3] = coarse?.height ?? 0;
      f32.set(fill, 4);
      f32[8] = biharmonicOmega;
      f32[9] = step?.omega ?? 0;
      f32[10] = step?.gamma ?? 0;
      u32[11] = flag;
      u32[12] = count;
      u32[13] = natural;
      f32[14] = membrane;
    });
  }

  // Dispatches a biharmonic kernel over `over` texels, or `[x, y, z]`
  // workgroups, with `bindings` from the WGSL's names to what they are bound
  // to here.
  bhDispatch(name, over, uniforms, bindings) {
    const numbers = {
      x: 21, previous: 22, out: 23, color: 24, weight: 25, rightHandSide: 26, coefficients: 27,
      coarseCoefficients: 28, background: 29, out2: 30, inverse: 31, partials: 32, state: 33, y: 34, z: 35, tears: 36,
    };
    const entries = uniforms ? [uniforms] : [];
    for (const [name, resource] of Object.entries(bindings)) {
      entries.push({
        binding: numbers[name],
        resource: resource instanceof GPUBuffer ? { buffer: resource } : this.view(resource),
      });
    }
    const pipeline = this.pipelines[name];
    this.pass.setPipeline(pipeline);
    this.pass.setBindGroup(0, this.bindGroup(pipeline, entries));
    if (Array.isArray(over)) {
      this.pass.dispatchWorkgroups(...over);
    } else {
      this.pass.dispatchWorkgroups(Math.ceil(over.width / 8), Math.ceil(over.height / 8));
    }
  }

  // The biharmonic, coarse to fine, as the Metal solver's encodeBiharmonic
  // from the levels below: the coarsest level's own equation solved outright,
  // then each finer level started from the one below and V-cycled toward its
  // own equation, below it the Galerkin levels of that equation, and the
  // finest settled by conjugate gradients.
  encodeBiharmonic() {
    const { levels, gradient } = this;
    this.prepareBiharmonic();
    const coarsest = levels.length - 1;
    const bottom = levels[coarsest];
    this.bhDispatch("FillHeld", bottom, this.bh({ of: bottom, fill: gradient.average }), {
      out: bottom.values.textures[0], color: bottom.constraintColor, weight: bottom.constraintWeight,
    });
    bottom.values.current = 0;
    this.bhDispatch("OwnCoefficients", bottom, this.bh({ of: bottom, coarse: bottom }), {
      weight: bottom.constraintWeight, coarseCoefficients: bottom.coefficients, tears: bottom.tears,
    });
    this.invertCoarsest();
    this.bhDispatch("CoarsestSolveOwn", [1, 1, 1], this.bh({ of: bottom }), {
      inverse: this.coarsestInverse, x: bottom.values.texture, out: bottom.values.next,
      color: bottom.constraintColor, weight: bottom.constraintWeight, tears: bottom.tears,
    });
    bottom.values.flip();

    // With natural edges or tears, what's left to solve can be too faint for a residual carried along.
    const careful = gradient.naturalEdges || this.hasTears;
    const cycles = (careful ? naturalBiharmonicCycles : finestBiharmonicCycles)
      + (gradient.hasTwoSidedLines ? twoSidedBiharmonicCycles : 0);
    for (let index = coarsest - 1; index >= 0; index--) {
      const level = levels[index];
      this.bhDispatch("ProlongHeld", level, this.bh({ of: level }), {
        y: levels[index + 1].values.texture, out: level.values.textures[0],
        color: level.constraintColor, weight: level.constraintWeight,
      });
      level.values.current = 0;
      this.buildGalerkinLevels(index);
      if (index === 0) {
        this.encodeConjugateGradients(cycles, careful ? naturalRestart : 0);
      } else {
        for (let cycle = 0; cycle < biharmonicCycles; cycle++) {
          this.biharmonicVCycle(index);
        }
      }
    }
  }

  // The Galerkin levels below level `top`'s own equation, down to the
  // coarsest, and the coarsest's inverse.
  buildGalerkinLevels(top) {
    const { levels } = this;
    const level = levels[top];
    const coarse = levels[top + 1];
    const own = this.bh({ of: level, coarse, flag: 0 });
    const from = { weight: level.constraintWeight, coarseCoefficients: coarse.coefficients };
    this.bhDispatch("BackgroundFromOwn", coarse, own, { ...from, background: this.backgroundRows });
    this.bhDispatch("EntriesFromOwn", [Math.ceil(coarse.width / 8), Math.ceil(coarse.height / 8), 13], own, { ...from, tears: level.tears });
    this.bhDispatch("RowsFromOwn", coarse, own, { ...from, tears: level.tears });
    for (let index = top + 1; index < levels.length - 1; index++) {
      const fine = levels[index];
      const below = levels[index + 1];
      const uniforms = this.bh({ of: fine, coarse: below, flag: Math.min(index - top, 15), own: level });
      const galerkin = { coefficients: fine.coefficients, coarseCoefficients: below.coefficients };
      this.bhDispatch("BackgroundFromGalerkin", below, uniforms, { ...galerkin, background: this.backgroundRows });
      this.bhDispatch("EntriesFromGalerkin", [Math.ceil(below.width / 8), Math.ceil(below.height / 8), 13], uniforms, galerkin);
      this.bhDispatch("RowsFromGalerkin", below, uniforms, galerkin);
    }
    this.invertCoarsest();
  }

  invertCoarsest() {
    const bottom = this.levels[this.levels.length - 1];
    this.bhDispatch("CoarsestInverse", [1, 1, 1], this.bh({ of: bottom }), {
      coefficients: bottom.coefficients, inverse: this.coarsestInverse,
    });
  }

  // One V-cycle of level `top`'s own equation: smoothed, its residual solved
  // for on the Galerkin levels below, that correction added, and smoothed
  // again.
  biharmonicVCycle(top) {
    const { levels } = this;
    const level = levels[top];
    const coarse = levels[top + 1];
    const steps = chebyshevSteps(biharmonicSmoothing);

    this.chebyshevOwn(level, steps);
    // The level's residual goes in its correction's right-hand side, which the
    // level being solved does not otherwise use.
    this.bhDispatch("ResidualOwn", level, this.bh({ of: level }), {
      x: level.values.texture, out: level.correctionRightHandSide,
      color: level.constraintColor, weight: level.constraintWeight, tears: level.tears,
    });
    this.bhDispatch("RestrictOwn", coarse, this.bh({ of: level, coarse }), {
      x: level.correctionRightHandSide, weight: level.constraintWeight,
      out: coarse.correctionRightHandSide, out2: coarse.correction.textures[0],
    });
    coarse.correction.current = 0;

    this.encodeCoarseCorrection(top, galerkinSmoothing);

    this.bhDispatch("CorrectOwn", level, this.bh({ of: level }), {
      y: coarse.correction.texture, x: level.values.texture, out: level.values.next, weight: level.constraintWeight,
    });
    level.values.flip();
    this.chebyshevOwn(level, steps);
  }

  // The correction of level `top` its residual, restricted to the level
  // below's right-hand side, asks for: V-cycled on the Galerkin levels, down
  // to the coarsest, solved outright, and back up. It is left in the level
  // below's correction.
  encodeCoarseCorrection(top, smoothing) {
    const { levels } = this;
    const coarsest = levels.length - 1;
    const steps = chebyshevSteps(smoothing);
    for (let index = top + 1; index < coarsest; index++) {
      const fine = levels[index];
      const below = levels[index + 1];
      this.chebyshevGalerkin(fine, steps);
      // The residual goes in a texture of the correction the smoothing is
      // done with.
      const residual = fine.correction.textures[fine.correction.current === 0 ? 1 : 0];
      this.bhDispatch("ResidualGalerkin", fine, this.bh({ of: fine }), {
        x: fine.correction.texture, out: residual, rightHandSide: fine.correctionRightHandSide,
        coefficients: fine.coefficients,
      });
      this.bhDispatch("RestrictGalerkin", below, this.bh({ of: fine, coarse: below }), {
        x: residual, coefficients: fine.coefficients,
        out: below.correctionRightHandSide, out2: below.correction.textures[0],
      });
      below.correction.current = 0;
    }

    const bottom = levels[coarsest];
    this.bhDispatch("CoarsestSolve", [1, 1, 1], this.bh({ of: bottom }), {
      inverse: this.coarsestInverse, rightHandSide: bottom.correctionRightHandSide, out: bottom.correction.next,
    });
    bottom.correction.flip();

    for (let index = coarsest - 1; index > top; index--) {
      const fine = levels[index];
      this.bhDispatch("CorrectGalerkin", fine, this.bh({ of: fine }), {
        y: levels[index + 1].correction.texture, x: fine.correction.texture, out: fine.correction.next,
        coefficients: fine.coefficients,
      });
      fine.correction.flip();
      this.chebyshevGalerkin(fine, steps);
    }
  }

  // `count` steps of conjugate gradients on the finest level's own equation,
  // preconditioned by a V-cycle, from the solution it holds.
  encodeConjugateGradients(count, restart = 0) {
    const { levels } = this;
    if (count <= 0 || levels.length <= 1) {
      return;
    }
    const level = levels[0];
    const { residual, direction, product } = level.conjugateGradient;
    const uniforms = this.bh({ of: level });
    // The held texels at their colors — conjugate gradients never change
    // them — then r = D c - K x, and the scalars reset.
    this.bhDispatch("HoldColors", level, uniforms, {
      x: level.values.texture, out: level.values.next, color: level.constraintColor, weight: level.constraintWeight,
    });
    level.values.flip();
    const start = () => {
      this.bhDispatch("ResidualOwn", level, uniforms, {
        x: level.values.texture, out: residual.texture, color: level.constraintColor, weight: level.constraintWeight,
        tears: level.tears,
      });
      this.bhDispatch("Reset", [1, 1, 1], null, { state: this.conjugateGradientState });
    };
    start();

    for (let step = 0; step < count; step++) {
      // The residual each step carries along drifts from the solution's own in 32-bit floats. With natural edges,
      // what's left to solve can be a twist that only the box's four corner texels resist, too faint to survive
      // that, so there the residual is formed afresh from the solution every few steps.
      if (restart > 0 && step > 0 && step % restart === 0) {
        start();
      }
      const z = this.encodePreconditioner();
      this.encodeDot(residual.texture, z, false);
      this.bhDispatch("Direction", level, uniforms, {
        state: this.conjugateGradientState, x: z, y: direction.texture, out: direction.next,
      });
      direction.flip();
      this.bhDispatch("ResidualOwnCorrection", level, this.bh({ of: level, flag: 1 }), {
        x: direction.texture, out: product, rightHandSide: residual.texture, weight: level.constraintWeight,
        tears: level.tears,
      });
      this.encodeDot(direction.texture, product, true);
      this.bhDispatch("Step", level, uniforms, {
        state: this.conjugateGradientState, x: direction.texture, y: product, z: level.values.texture,
        rightHandSide: residual.texture, out: level.values.next, out2: residual.next,
      });
      level.values.flip();
      residual.flip();
    }
  }

  // a · b over the finest level, into the scalars: r · z and beta, or with
  // `alpha`, alpha.
  encodeDot(a, b, alpha) {
    const level = this.levels[0];
    const groups = [Math.ceil(level.width / 16), Math.ceil(level.height / 16), 1];
    this.bhDispatch("Dot", groups, null, { x: a, y: b, partials: this.partialSums });
    this.bhDispatch("Scalars", [1, 1, 1], this.bh({ of: level, flag: alpha ? 1 : 0, count: groups[0] * groups[1] }), {
      partials: this.partialSums, state: this.conjugateGradientState,
    });
  }

  // The preconditioner: z for the residual r, by a V-cycle of the finest
  // level's correction toward K z = r from zero. Returns z, in the finest
  // level's correction.
  encodePreconditioner() {
    const { levels } = this;
    const level = levels[0];
    const coarse = levels[1];
    const residual = level.conjugateGradient.residual.texture;
    const steps = chebyshevSteps(conjugateGradientSmoothing);

    this.bhDispatch("Clear", level, this.bh({ of: level }), { out: level.correction.textures[0] });
    level.correction.current = 0;
    this.chebyshevOwnCorrection(level, residual, steps);

    this.bhDispatch("ResidualOwnCorrection", level, this.bh({ of: level, flag: 0 }), {
      x: level.correction.texture, out: level.correctionRightHandSide, rightHandSide: residual,
      weight: level.constraintWeight, tears: level.tears,
    });
    this.bhDispatch("RestrictOwn", coarse, this.bh({ of: level, coarse }), {
      x: level.correctionRightHandSide, weight: level.constraintWeight,
      out: coarse.correctionRightHandSide, out2: coarse.correction.textures[0],
    });
    coarse.correction.current = 0;

    this.encodeCoarseCorrection(0, conjugateGradientSmoothing);

    this.bhDispatch("CorrectOwn", level, this.bh({ of: level }), {
      y: coarse.correction.texture, x: level.correction.texture, out: level.correction.next,
      weight: level.constraintWeight,
    });
    level.correction.flip();
    this.chebyshevOwnCorrection(level, residual, steps);
    return level.correction.texture;
  }

  chebyshevOwnCorrection(level, rightHandSide, steps) {
    const grid = level.correction;
    let previous = grid.current;
    for (const step of steps) {
      const next = spare(grid.current, previous);
      this.bhDispatch("ChebyshevOwnCorrection", level, this.bh({ of: level, step }), {
        x: grid.texture, previous: grid.textures[previous], out: grid.textures[next],
        rightHandSide, weight: level.constraintWeight, tears: level.tears,
      });
      previous = grid.current;
      grid.current = next;
    }
  }

  chebyshevOwn(level, steps) {
    const grid = level.values;
    let previous = grid.current;
    for (const step of steps) {
      const next = spare(grid.current, previous);
      this.bhDispatch("ChebyshevOwn", level, this.bh({ of: level, step }), {
        x: grid.texture, previous: grid.textures[previous], out: grid.textures[next],
        color: level.constraintColor, weight: level.constraintWeight, tears: level.tears,
      });
      previous = grid.current;
      grid.current = next;
    }
  }

  chebyshevGalerkin(level, steps) {
    const grid = level.correction;
    let previous = grid.current;
    for (const step of steps) {
      const next = spare(grid.current, previous);
      this.bhDispatch("ChebyshevGalerkin", level, this.bh({ of: level, step }), {
        x: grid.texture, previous: grid.textures[previous], out: grid.textures[next],
        rightHandSide: level.correctionRightHandSide, coefficients: level.coefficients,
      });
      previous = grid.current;
      grid.current = next;
    }
  }

  // MARK: - Sharp edges

  // The strips either side of the two-sided lines, for the box and the finest
  // level as they are now, as the Metal renderer's makeEdges: six vertices a
  // quad, of 12 numbers each.
  makeEdges() {
    const finest = this.levels[0];
    const boxScale = this.boxScale.map(fround);
    const texel = Math.max(fround(boxScale[0] / finest.width), fround(boxScale[1] / finest.height));
    // A segment that holds its colors less than fully lets the solution in
    // right up to it, so it has no strips.
    let segments = this.gradient.segments;
    if (this.gradient.strengths?.some(strength => strength < 1)) {
      segments = segments.slice();
      this.gradient.strengths.forEach((strength, i) => {
        if (strength < 1) {
          segments[i * 23 + 22] = 0;
        }
      });
    }
    const quads = this.gradient.isEmpty ? [] : edgeQuads(
      segments, boxScale, texel, fround(edgeBlendTexels * texel), fround(2 * texel));
    this.edgeVertexCount = quads.length * 6;
    if (quads.length === 0) {
      return;
    }
    const bytes = new ArrayBuffer(this.edgeVertexCount * 48);
    const floats = new Float32Array(bytes);
    const words = new Uint32Array(bytes);
    let v = 0;
    for (const quad of quads) {
      for (const corner of [0, 1, 2, 0, 2, 3]) {
        const o = v * 12;
        floats.set(quad.colors[corner] ?? [0, 0, 0, 0], o);
        floats.set(quad.edgeColors[corner], o + 4);
        floats.set(quad.corners[corner], o + 8);
        floats[o + 10] = quad.across[corner];
        words[o + 11] = quad.colors[corner] ? 0 : 1;
        v++;
      }
    }
    this.edgeBuffer = this.storageBuffer(this.edgeBuffer, bytes);
  }

  // MARK: - Uniforms and sources

  // The uniforms of level `index` solving level `top`'s equation, in a slot of
  // their own, the same slot each time they are the same.
  uniformEntry(index, top, iterations = 0, coarseSize = [0, 0], holds = 0) {
    return this.slotEntry(0, `level:${index}:${top}:${iterations}:${coarseSize[0]}x${coarseSize[1]}:${holds}`, (u32, f32) => {
      const level = this.levels[index];
      u32[0] = level.width;
      u32[1] = level.height;
      f32[2] = this.boxScale[0] / level.width;
      f32[3] = this.boxScale[1] / level.height;
      f32[4] = this.boxScale[0];
      f32[5] = this.boxScale[1];
      u32[6] = this.pointCount;
      u32[7] = this.segmentCount;
      f32[8] = harmonicOmega;
      f32[9] = this.scale(index, top);
      u32[10] = iterations;
      u32[11] = holds;
      u32[12] = coarseSize[0];
      u32[13] = coarseSize[1];
      f32[14] = this.strengthScale;
    });
  }

  // 64 bytes of uniforms at `binding`, written by `write` into a slot of their
  // own, the same slot each time `key` is the same.
  slotEntry(binding, key, write) {
    let slot = this.slots.get(key);
    if (slot === undefined) {
      slot = this.slots.size;
      if (slot >= uniformSlots) {
        throw new Error("The solve needs more uniform slots than there are.");
      }
      this.slots.set(key, slot);
      const offset = slot * uniformSlotBytes;
      write(new Uint32Array(this.slotData, offset, 16), new Float32Array(this.slotData, offset, 16));
    }
    return { binding, resource: { buffer: this.uniforms, offset: slot * uniformSlotBytes, size: 64 } };
  }

  // How much coarser level `index` is than `top`, squared.
  scale(index, top) {
    const ratio = Math.max(this.levels[top].width, this.levels[top].height)
      / Math.max(this.levels[index].width, this.levels[index].height);
    return Math.fround(ratio * ratio);
  }

  // The points and the lines' segments, as the shader reads them, for the box
  // and the finest level as they are now: a two-sided segment is never
  // thinner than twoSidedTexels of the finest level, and its distances to its
  // line's ends are in units of the box's shorter side. As the Metal solver's
  // segments(of:settings:boxScale:finestTexel:) does, the distances go by
  // each line's own segments, in order, to the resolved segments in order.
  packSources() {
    const { gradient, boxScale } = this;
    const points = gradient.points;
    this.pointCount = points.length / 8;
    this.hasThinPoints = false;
    for (let i = 6; i < points.length; i += 8) {
      this.hasThinPoints ||= !(points[i] > 0);
    }
    const pointData = new Float32Array(Math.max(points.length, 8));
    pointData.set(points);

    const finest = this.levels[0];
    const texel = Math.max(boxScale[0] / finest.width, boxScale[1] / finest.height);
    // A strength is given for a texel of `strengthTexel`, in units of the box's shorter side: by default, a grid of
    // 512 texels along the longer side.
    const strengthTexel = gradient.strengthTexel > 0 ? gradient.strengthTexel : Math.max(...boxScale) / 512;
    this.strengthScale = (texel / strengthTexel) ** 2;
    const least = twoSidedTexels * texel;
    this.hasTears = false;
    const segments = gradient.segments;
    const count = segments.length / 23;
    this.segmentCount = count;
    const segmentBytes = new ArrayBuffer(Math.max(count, 1) * 112);
    const f32 = new Float32Array(segmentBytes);
    const u32 = new Uint32Array(segmentBytes);
    const far = 3.4028234663852886e38;
    const distances = [];
    for (const line of gradient.lines) {
      const lengths = [];
      for (let e = 0; e < line.ends.length; e += 4) {
        lengths.push(Math.fround(Math.hypot((line.ends[e + 2] - line.ends[e]) * boxScale[0],
                                            (line.ends[e + 3] - line.ends[e + 1]) * boxScale[1])));
      }
      const total = lengths.reduce((a, b) => a + b, 0);
      let before = 0;
      for (const length of lengths) {
        distances.push(line.closed ? [far, far] : [before, total - before - length]);
        before += length;
      }
    }
    for (let i = 0; i < count; i++) {
      const s = i * 23;
      const o = i * 28;
      // 0 for one color, 1 for a color each side across a band, 2 for a tear.
      const kind = segments[s + 22] === 2 ? 2 : segments[s + 22] !== 0 ? 1 : 0;
      this.hasTears ||= kind === 2;
      for (let k = 0; k < 20; k++) {
        f32[o + k] = segments[s + k];
      }
      f32[o + 20] = kind === 1 ? Math.max(segments[s + 20], least) : segments[s + 20];
      f32[o + 21] = kind === 1 ? Math.max(segments[s + 21], least) : segments[s + 21];
      u32[o + 22] = kind;
      f32[o + 23] = i < distances.length ? distances[i][0] : far;
      f32[o + 24] = i < distances.length ? distances[i][1] : far;
      const strength = gradient.strengths?.[i] ?? 1;
      f32[o + 25] = Number.isFinite(strength) ? Math.min(Math.max(strength, 0), 1) : 1;
    }

    this.pointBuffer = this.storageBuffer(this.pointBuffer, pointData);
    this.segmentBuffer = this.storageBuffer(this.segmentBuffer, segmentBytes);
  }
}

// MARK: - Edge quads

// The strips either side of the two-sided stretches of the lines, a port of
// FreeformGradientDescriptor.edgeQuads(settings:boxScale:texel:blendWidth:pieceLength:),
// from the resolved segments, 23 numbers each. Each side's strip is held color
// out to where the solver holds it, then blends to the solution over
// `blendWidth` more. In 32-bit floats where a result decides something — how
// many pieces, whether pieces meet — so they come out as Swift's do.
function edgeQuads(segments, boxScale, texel, blendWidth, pieceLength) {
  const at = (a, b, t) => fround(a + fround(fround(b - a) * t));
  const mix4 = (a, b, t) => a.map((x, i) => at(x, b[i], t));
  const length = (x, y) => fround(Math.hypot(fround(x), fround(y)));
  // A vector of no length stays one, rather than becoming NaN.
  const normalize = ([x, y]) => {
    const l = Math.hypot(x, y);
    return l > 0 ? [fround(x / l), fround(y / l)] : [0, 0];
  };

  const pieces = [];
  for (let s = 0; s + 22 < segments.length; s += 23) {
    if (segments[s + 22] === 0) {
      continue;
    }
    const segment = {
      startLeft: segments.slice(s, s + 4), endLeft: segments.slice(s + 4, s + 8),
      startRight: segments.slice(s + 8, s + 12), endRight: segments.slice(s + 12, s + 16),
      start: segments.slice(s + 16, s + 18), end: segments.slice(s + 18, s + 20),
      startRadius: segments[s + 20], endRadius: segments[s + 21],
      tear: segments[s + 22] === 2,
    };
    const along = length(fround(fround(segment.end[0] - segment.start[0]) * boxScale[0]),
                         fround(fround(segment.end[1] - segment.start[1]) * boxScale[1]));
    // A segment of no length has no direction to draw strips along.
    if (!(along > 0)) {
      continue;
    }
    const count = Math.max(1, Math.ceil(fround(along / Math.max(pieceLength, fround(1e-4)))));
    // The segment's own ends, exactly, so a piece ending a segment meets the
    // piece starting the next: rounding s + (e - s) can miss e by a unit in
    // the last place, which would break the run there.
    const start = segment.start.map(fround), end = segment.end.map(fround);
    for (let piece = 0; piece < count; piece++) {
      const a = fround(piece / count), b = fround((piece + 1) / count);
      pieces.push({
        start: piece === 0 ? start : [at(start[0], end[0], a), at(start[1], end[1], a)],
        end: piece === count - 1 ? end : [at(start[0], end[0], b), at(start[1], end[1], b)],
        startLeft: mix4(segment.startLeft, segment.endLeft, a), endLeft: mix4(segment.startLeft, segment.endLeft, b),
        startRight: mix4(segment.startRight, segment.endRight, a), endRight: mix4(segment.startRight, segment.endRight, b),
        startRadius: at(segment.startRadius, segment.endRadius, a),
        endRadius: at(segment.startRadius, segment.endRadius, b),
        tear: segment.tear,
      });
    }
  }

  // Runs of two-sided segments end to end, so the strips of a curve's
  // segments share their corners rather than gaping at each joint.
  const runs = [];
  for (const piece of pieces) {
    const last = runs.at(-1)?.at(-1);
    if (last && last.end[0] === piece.start[0] && last.end[1] === piece.start[1]) {
      runs.at(-1).push(piece);
    } else {
      runs.push([piece]);
    }
  }

  const quads = [];
  for (const run of runs) {
    // A run that ends where it starts is a closed line: its seam is a joint
    // like any other, and it has no ends for its blend to narrow toward.
    const closed = run.length > 2 && run[0].start[0] === run.at(-1).end[0] && run[0].start[1] === run.at(-1).end[1];
    const directions = run.map((p) => normalize([fround(p.end[0] - p.start[0]) * boxScale[0],
                                                 fround(p.end[1] - p.start[1]) * boxScale[1]]));
    // Left of the way along, y down.
    const normals = directions.map(([x, y]) => [y, -x]);
    // Toward a run's open ends, the blend narrows to nothing.
    const lengths = [0];
    for (const p of run) {
      lengths.push(fround(lengths.at(-1) + length(fround(p.end[0] - p.start[0]) * boxScale[0],
                                                  fround(p.end[1] - p.start[1]) * boxScale[1])));
    }
    const total = lengths.at(-1);
    const blends = lengths.map((l) => closed ? blendWidth : fround(blendWidth * Math.min(1, fround(Math.min(l, fround(total - l)) / Math.max(blendWidth, 1e-6)))));
    const joints = [];
    for (let index = 0; index <= run.length; index++) {
      const last = run.length - 1;
      const before = index > 0 ? normals[index - 1] : normals[closed ? last : 0];
      const after = index < run.length ? normals[index] : normals[closed ? 0 : last];
      // A hairpin, which turns right back, has no miter; it takes the way on.
      let miter = normalize([before[0] + after[0], before[1] + after[1]]);
      if (miter[0] === 0 && miter[1] === 0) {
        miter = after;
      }
      // As far out along the miter as keeps the strip as wide as asked, but
      // no more than twice.
      const scale = Math.max(miter[0] * after[0] + miter[1] * after[1], 0.5);
      joints.push([fround(miter[0] / scale), fround(miter[1] / scale)]);
    }
    run.forEach((segment, index) => {
      // A tear holds its colors on the texel either side of it; a band, out to its radius.
      const held = segment.tear ? [texel, texel]
        : [Math.max(segment.startRadius, fround(twoSidedTexels * texel)),
           Math.max(segment.endRadius, fround(twoSidedTexels * texel))];
      const half = (a, b) => a.map((x, i) => fround(fround(x + b[i]) / 2));
      const edge = [half(segment.startLeft, segment.startRight), half(segment.endLeft, segment.endRight)];
      for (const sign of [1, -1]) {
        const colors = sign > 0 ? [segment.startLeft, segment.endLeft] : [segment.startRight, segment.endRight];
        const out = (position, joint, distance) => [
          fround(position[0] + fround(fround(sign * joint[0] * distance) / boxScale[0])),
          fround(position[1] + fround(fround(sign * joint[1] * distance) / boxScale[1])),
        ];
        const start = joints[index], end = joints[index + 1];
        const heldStart = out(segment.start, start, held[0]), heldEnd = out(segment.end, end, held[1]);
        quads.push({
          corners: [segment.start, segment.end, heldEnd, heldStart],
          colors: [colors[0], colors[1], colors[1], colors[0]],
          across: [0, 0, held[1], held[0]],
          edgeColors: [edge[0], edge[1], edge[1], edge[0]],
        });
        const blend = [blends[index], blends[index + 1]];
        if (!(blend[0] > 0 || blend[1] > 0)) {
          continue;
        }
        quads.push({
          corners: [heldStart, heldEnd, out(segment.end, end, held[1] + blend[1]), out(segment.start, start, held[0] + blend[0])],
          colors: [colors[0], colors[1], null, null],
          across: [held[0], held[1], held[1] + blend[1], held[0] + blend[0]],
          edgeColors: [edge[0], edge[1], edge[1], edge[0]],
        });
      }
    });
  }
  return quads;
}
