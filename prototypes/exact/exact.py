#!/usr/bin/env python3
# Checks the renderer's biharmonic solve against an exact one. From what capture.py saved of a solve — the finest
# level's held colors, their weights and its tears — this builds the level's own equation in double precision, solves
# it outright with a sparse direct solver, and says how far the renderer's solution is from that. See README.md.
#
# The equation is built from the thin plate's energy, a term at a time, not a texel's row at a time as the shader's
# ownRow() builds it, so agreeing also says the shader's rows are that energy's.
#
#   python3 prototypes/exact/exact.py                 every capture in data/
#   python3 prototypes/exact/exact.py A-leaf-1024     one
#
# Needs NumPy and SciPy. A 1024 grid takes a minute or two and a few gigabytes.
import glob
import json
import os
import re
import sys
import time

import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla

here = os.path.dirname(os.path.abspath(__file__))
data = os.path.join(here, "data")
vendor = os.path.join(os.path.dirname(os.path.dirname(here)), "tools", "gradient-editor-common", "vendor")


# The renderer's own constants, from its sources.
def constant(file, name):
    source = open(os.path.join(vendor, file)).read()
    return float(re.search(rf"^const {name} = ([0-9.eE+-]+);", source, re.M).group(1))


OMEGA = constant("WebGPUFreeformGradient.js", "biharmonicOmega")
NATURAL_MEMBRANE = constant("WebGPUFreeformGradient.js", "membraneWeight")
SLOPE_WEIGHT = constant("WebGPUFreeformGradient.wgsl", "slopeWeight")
TEAR_MEMBRANE = constant("WebGPUFreeformGradient.wgsl", "tearMembrane")


def load(slug, key, shape):
    return np.fromfile(os.path.join(data, f"{slug}.{key}"), dtype=np.float32).reshape(shape)


# The energy's matrix for a width × height grid: Gᵀ W G, each row of G a term's coefficients and W its weight.
# `bits` is each texel's: 1 and 2 where a tear crosses the edge to its right and below, 4 near a tear, 8 and 16 where
# that tear is flat. `flat` is those two edges' packed direction and slope hold, as the shader's unpackFlat() reads.
def energy(width, height, bits, flat, natural):
    index = np.arange(width * height).reshape(height, width)
    # Whether the edge from a texel to the one on its right, and to the one below, is in the grid and whole.
    right = np.zeros((height, width), bool)
    right[:, :-1] = (bits[:, :-1] & 1) == 0
    down = np.zeros((height, width), bool)
    down[:-1, :] = (bits[:-1, :] & 2) == 0
    near = (bits & 4) != 0
    membrane = NATURAL_MEMBRANE / max(width, height) ** 2 if natural else 0.0

    rows, columns, coefficients, weights = [], [], [], []
    count = 0

    def add(texels, values, weight):
        nonlocal count
        terms = count + np.arange(texels[0].size)
        for texel, value in zip(texels, values):
            rows.append(terms)
            columns.append(texel.ravel())
            coefficients.append(np.broadcast_to(value, terms.shape).astype(float))
        weights.append(np.broadcast_to(weight, terms.shape).astype(float))
        count += terms.size

    # The squared second differences across and down, of three texels in a line with both edges whole.
    whole = right[:, :-2] & right[:, 1:-1]
    add([index[:, :-2][whole], index[:, 1:-1][whole], index[:, 2:][whole]], [-1, 2, -1], 1.0)
    whole = down[:-2, :] & down[1:-1, :]
    add([index[:-2, :][whole], index[1:-1, :][whole], index[2:, :][whole]], [-1, 2, -1], 1.0)
    # Twice the squared mixed difference of each two-by-two block with its four edges whole.
    whole = right[:-1, :-1] & right[1:, :-1] & down[:-1, :-1] & down[:-1, 1:]
    add([index[:-1, :-1][whole], index[:-1, 1:][whole], index[1:, :-1][whole], index[1:, 1:][whole]], [1, -1, -1, 1], 2.0)
    # The squared first differences on whole edges: the membrane, the faint one between two texels near a tear, and
    # with mirrored edges, the outermost pair of each row and column.
    for axis in (0, 1):
        if axis == 0:
            whole, a, b = right[:, :-1], index[:, :-1], index[:, 1:]
            both = near[:, :-1] & near[:, 1:]
            low = np.broadcast_to(np.arange(width - 1), (height, width - 1))
            last = width - 2
        else:
            whole, a, b = down[:-1, :], index[:-1, :], index[1:, :]
            both = near[:-1, :] & near[1:, :]
            low = np.broadcast_to(np.arange(height - 1)[:, None], (height - 1, width))
            last = height - 2
        weight = np.where(both, max(membrane, TEAR_MEMBRANE), membrane)
        if not natural:
            weight = weight + (low == 0) + (low == last)
        whole = whole & (weight > 0)
        add([a[whole], b[whole]], [1, -1], weight[whole])
    # A flat tear's slope terms, as the shader's addSlopeTerms(): at each texel beside an edge the tear crosses, the
    # squared first difference away from it along its normal, across and down by the normal's share in each.
    for ex, ey in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        ys, xs = np.mgrid[0:height, 0:width]
        ox, oy = xs + ex, ys + ey
        crossed = (ox >= 0) & (ox < width) & (oy >= 0) & (oy < height)
        cx, cy = np.minimum(xs, ox).clip(0, width - 1), np.minimum(ys, oy).clip(0, height - 1)
        crossed &= (bits[cy, cx] & (8 if ex else 16)) != 0
        packed = flat[cy, cx, 0 if ex else 1].astype(np.float64)
        steps = np.floor((packed + 4.0) / 8.0)
        angle, hold = packed - 8.0 * steps, steps / 1000.0
        crossed &= hold > 0
        ys, xs, angle, hold = ys[crossed], xs[crossed], angle[crossed], hold[crossed]
        normal = [-np.sin(angle), np.cos(angle)]
        toward = normal[0] * ex + normal[1] * ey > 0
        normal = [np.where(toward, -n, n) for n in normal]
        texels, values = [index[ys, xs]], [np.zeros(xs.size)]
        for axis in (0, 1):
            share = np.abs(normal[axis])
            step = np.where(normal[axis] > 0, 1, -1)
            qx, qy = (xs + step, ys) if axis == 0 else (xs, ys + step)
            inside = (qx >= 0) & (qx < width) & (qy >= 0) & (qy < height)
            lx, ly = np.minimum(xs, qx).clip(0, width - 1), np.minimum(ys, qy).clip(0, height - 1)
            used = inside & (right[ly, lx] if axis == 0 else down[ly, lx]) & (share >= 1e-6)
            value = np.where(used, share, 0.0)
            texels.append(index[np.where(used, qy, ys), np.where(used, qx, xs)])
            values.append(value)
            values[0] = values[0] - value
        add(texels, values, SLOPE_WEIGHT * hold)

    terms = sp.csr_matrix((np.concatenate(coefficients), (np.concatenate(rows), np.concatenate(columns))),
                          shape=(count, width * height))
    return (terms.T @ sp.diags(np.concatenate(weights)) @ terms).tocsr()


# The exact solution of what a capture held: a texel held fully has its color, and the rest minimize the energy plus
# each one's penalty toward its color, as the shader's penalty() weighs it.
def solve(slug):
    meta = json.load(open(os.path.join(data, f"{slug}.json")))
    width, height = meta["width"], meta["height"]
    color = load(slug, "color", (width * height, 4)).astype(np.float64)
    weight = load(slug, "weight", (width * height, 4))[:, 0].astype(np.float64)
    tears = load(slug, "tears", (height, width, 4))
    bits = tears[:, :, 0].astype(np.int64)
    free = weight < 1.0
    penalty = np.zeros_like(weight)
    penalty[free] = weight[free] / ((1.0 - weight[free]) * (OMEGA / 20.0))
    matrix = (energy(width, height, bits, tears[:, :, 1:3], meta["natural"]) + sp.diags(penalty)).tocsr()
    unknown, held = np.flatnonzero(free), np.flatnonzero(~free)
    rows = matrix[unknown]
    factors = spla.splu(rows[:, unknown].tocsc())
    right = penalty[unknown, None] * color[unknown] - rows[:, held] @ color[held]
    exact = np.array(color)
    exact[unknown] = np.column_stack([factors.solve(right[:, channel]) for channel in range(4)])
    return meta, exact, unknown, int(((bits & 3) != 0).sum())


def main():
    slugs = sys.argv[1:] or sorted(os.path.basename(path)[:-5] for path in glob.glob(os.path.join(data, "*.json")))
    if not slugs:
        sys.exit("Nothing in data/: run capture.py first.")
    print("How far the renderer's solution is from the exact one, in a color's components, over the texels not held")
    print("fully: the mean, what 90% and 99% of them are within, and the furthest, with where it is.")
    for slug in slugs:
        started = time.time()
        meta, exact, unknown, torn = solve(slug)
        width = meta["width"]
        print(f"{slug}: {width} × {meta['height']}, {torn} texels beside a tear"
              f"{', natural edges' if meta['natural'] else ''}"
              f"{', with strengths under 100%, which this does not solve as the renderer does' if meta['partial'] else ''}"
              f" ({time.time() - started:.0f} s)", flush=True)
        for key, label in (("values", "as solved"), ("carried", "no fresh starts")):
            if not os.path.exists(os.path.join(data, f"{slug}.{key}")):
                continue
            off = np.abs(load(slug, key, exact.shape) - exact)[unknown][:, :3].max(axis=1)
            ordered = np.sort(off)
            furthest = unknown[np.argmax(off)]
            print(f"  {label:16s} mean {off.mean():.5f}  90% {ordered[int(0.9 * off.size)]:.5f}  99% {ordered[int(0.99 * off.size)]:.5f}"
                  f"  furthest {off.max():.4f} at ({furthest % width}, {furthest // width})", flush=True)


if __name__ == "__main__":
    main()
