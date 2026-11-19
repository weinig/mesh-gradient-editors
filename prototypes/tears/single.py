#!/usr/bin/env python3
# Step 1 of bringing tears to the GPU: can a solver like the renderer's, in single precision, solve these systems?
#
# Holding the pixel either side of a tear with no slope away from it is the same as holding two pixels either side of
# the curve: the terms that straddle the curve then touch only held pixels, so no term needs dropping. So a curve here
# is a band two pixels deep each side, held hard and left out of the system, as the renderer leaves out its held
# texels. A point is the paper's: its four nearest pixels' bilinear mix, as a penalty. The box's edges are natural, or
# mirrored as today.
#
# Each system is solved three ways: directly in double precision, as the reference; by conjugate gradients
# preconditioned by a multigrid V-cycle, as the renderer's biharmonic is, in double precision; and the same in single.
# The V-cycle has Galerkin coarse levels from cell-centered bilinear interpolation, two Chebyshev steps before and
# after over [1/16, 1] of the row-sum-scaled operator, and a direct solve at 8 × 8.
#
# Single precision has about seven digits, and the smoothest error is divided by the operator's smallest eigenvalue,
# of the order of 1/N⁴. So how the residual is formed decides everything. As the renderer does, the smoothness terms
# are applied to each pixel's differences from its neighbors, so their rounding is in proportion to how much the
# solution varies there, not to its size; a point's penalty is applied to its difference from its color; and the
# residual is formed afresh from the solution every few steps, not only carried along.
#
# Run: python3 single.py [grid size, default 512]
import sys
import time

import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla

import tears as T

T.N = N = int(sys.argv[1]) if len(sys.argv) > 1 else 512

# How deep either side of a curve is held, in pixels: two rows, at any angle.
DEPTH = 2.5
POINT = 1e2
# How many steps conjugate gradients take before the residual is formed afresh.
RESTART = 10


def assemble(scene, edges, membrane, magnitude):
    system = T.System()
    jj, ii = np.mgrid[0:N, 0:N]
    index = T.index
    held = np.zeros((N, N), dtype=bool)
    total = np.zeros((N, N, 3))
    count = np.zeros((N, N))
    for curve in scene.curves:
        best = np.full((N, N), np.inf)
        side = np.zeros((N, N), dtype=bool)
        for a, b in curve.pieces():
            d = b - a
            t = np.clip(((ii - a[0]) * d[0] + (jj - a[1]) * d[1]) / (d @ d), 0, 1)
            distance = np.hypot(ii - (a[0] + t * d[0]), jj - (a[1] + t * d[1]))
            nearer = distance < best
            best = np.where(nearer, distance, best)
            side = np.where(nearer, d[0] * (jj - a[1]) - d[1] * (ii - a[0]) >= 0, side)
        inside = best <= DEPTH
        total += np.where(inside[..., None], np.where(side[..., None], curve.left, curve.right), 0)
        count += inside
        held |= inside
    colors = np.where(held[..., None], total / np.maximum(count, 1)[..., None], 0)
    point_pixels, point_weights, point_values = [], [], []
    for (x, y), text in scene.points:
        px, py = x * N - 0.5, y * N - 0.5
        i, j = int(np.floor(px)), int(np.floor(py))
        fx, fy = px - i, py - j
        point_pixels.append([index(i, j), index(i + 1, j), index(i, j + 1), index(i + 1, j + 1)])
        point_weights.append([(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy])
        point_values.append(T.color(text))

    inner = np.zeros((N, N), dtype=bool)
    inner[:, 1:-1] = True
    system.add_many(1, [index(ii - 1, jj)[inner], index(ii, jj)[inner], index(ii + 1, jj)[inner]], [-1, 2, -1])
    inner = np.zeros((N, N), dtype=bool)
    inner[1:-1, :] = True
    system.add_many(1, [index(ii, jj - 1)[inner], index(ii, jj)[inner], index(ii, jj + 1)[inner]], [-1, 2, -1])
    inner = np.zeros((N, N), dtype=bool)
    inner[:-1, :-1] = True
    system.add_many(2, [index(ii, jj)[inner], index(ii + 1, jj)[inner], index(ii, jj + 1)[inner], index(ii + 1, jj + 1)[inner]],
                    [1, -1, -1, 1])
    if edges == "mirrored":
        line = np.arange(N)
        for near, far in ((index(0, line), index(1, line)), (index(N - 1, line), index(N - 2, line)),
                          (index(line, 0), index(line, 1)), (index(line, N - 1), index(line, N - 2))):
            system.add_many(1, [near, far], [1, -1])
    if membrane:
        inner = np.zeros((N, N), dtype=bool)
        inner[:, :-1] = True
        system.add_many(membrane, [index(ii, jj)[inner], index(ii + 1, jj)[inner]], [1, -1])
        inner = np.zeros((N, N), dtype=bool)
        inner[:-1, :] = True
        system.add_many(membrane, [index(ii, jj)[inner], index(ii, jj + 1)[inner]], [1, -1])
    if magnitude:
        system.add_many(magnitude, [index(ii, jj).ravel()], [1])

    L = sp.csr_matrix((system.values, (system.rows, system.cols)), shape=(len(system.targets), N * N))
    # The smoothness terms alone: every row sums to the magnitude's weight.
    B = (L.T @ L).tocsr()
    B.sort_indices()
    points = {"pixels": np.array(point_pixels, dtype=int).reshape(-1, 4), "weights": np.array(point_weights).reshape(-1, 4),
              "values": np.array(point_values).reshape(-1, 3)}
    A = B.copy()
    b = np.zeros((N * N, 3))
    for pixels, weights, value in zip(points["pixels"], points["weights"], points["values"]):
        A = A + POINT * sp.csr_matrix((np.outer(weights, weights).ravel(), (np.repeat(pixels, 4), np.tile(pixels, 4))), shape=A.shape)
        b[pixels] += POINT * np.outer(weights, value)
    # Held pixels leave the system: their colors move to the right-hand side.
    h = held.ravel()
    b = b - A @ np.where(h[:, None], colors.reshape(-1, 3), 0)
    free = sp.diags((~h).astype(float))
    A = (free @ A @ free + sp.diags(h.astype(float))).tocsr()
    b[h] = colors.reshape(-1, 3)[h]
    return A, b, h, Operator(B, magnitude, points, h)


# The system as the renderer would apply it, in a given precision: the smoothness terms on differences between pixels,
# and each point's penalty on its difference from its color. `x` holds the held pixels' colors, which don't change.
class Operator:
    def __init__(self, B, magnitude, points, held):
        self.rows = np.repeat(np.arange(B.shape[0]), np.diff(B.indptr))
        self.cols = B.indices
        self.starts = B.indptr[:-1]
        self.data, self.magnitude, self.points, self.free = B.data, magnitude, points, ~held

    def to(self, dtype):
        self.dtype = dtype
        self.values = self.data.astype(dtype)[:, None]
        self.weights = self.points["weights"].astype(dtype)
        self.targets = self.points["values"].astype(dtype)
        self.mask = self.free.astype(dtype)[:, None]
        return self

    def smoothness(self, x):
        y = np.add.reduceat(self.values * (x[self.cols] - x[self.rows]), self.starts, axis=0)
        return y + self.dtype(self.magnitude) * x

    # What's left to solve at x: zero at held pixels.
    def residual(self, x):
        r = -self.smoothness(x)
        pixels = self.points["pixels"]
        if len(pixels):
            miss = self.targets - np.einsum("kc,kcd->kd", self.weights, x[pixels])
            np.add.at(r, pixels, self.dtype(POINT) * self.weights[:, :, None] * miss[:, None, :])
        return (r * self.mask).astype(self.dtype)

    # The system times a correction, which is zero at held pixels.
    def product(self, p):
        y = self.smoothness(p)
        pixels = self.points["pixels"]
        if len(pixels):
            along = np.einsum("kc,kcd->kd", self.weights, p[pixels])
            np.add.at(y, pixels, self.dtype(POINT) * self.weights[:, :, None] * along[:, None, :])
        return (y * self.mask).astype(self.dtype)


# Cell-centered bilinear interpolation from n/2 to n pixels a side.
def prolongation(n):
    rows, cols, values = [], [], []
    for i in range(n):
        I = i // 2
        other = min(max(I + (1 if i % 2 else -1), 0), n // 2 - 1)
        rows += [i, i]
        cols += [I, other]
        values += [0.75, 0.25]
    one = sp.csr_matrix((values, (rows, cols)), shape=(n, n // 2))
    return sp.kron(one, one).tocsr()


class Multigrid:
    def __init__(self, A, held, dtype):
        self.levels = []
        n = N
        keep = sp.diags((~held).astype(float))
        while True:
            level = {"A": A.astype(dtype).tocsr(), "scale": (1 / np.maximum(abs(A).sum(axis=1).A1, 1e-30)).astype(dtype)}
            self.levels.append(level)
            if n <= 8:
                level["inverse"] = np.linalg.pinv(A.toarray()).astype(dtype)
                break
            P = prolongation(n)
            if keep is not None:
                # Held pixels take no correction.
                P = keep @ P
                keep = None
            Ac = (P.T @ A @ P).tocsr()
            # A coarse pixel whose pixels are all held has an empty row.
            empty = np.asarray(abs(Ac).sum(axis=1)).ravel() == 0
            Ac = (Ac + sp.diags(empty.astype(float))).tocsr()
            level["P"] = P.astype(dtype).tocsr()
            level["R"] = P.T.astype(dtype).tocsr()
            A, n = Ac, n // 2
        self.dtype = dtype

    # Chebyshev steps on the row-sum-scaled operator, whose eigenvalues are at most 1, over [1/16, 1].
    def smooth(self, level, x, b, steps=2):
        A, scale = level["A"], level["scale"]
        theta, delta = (1 + 1 / 16) / 2, (1 - 1 / 16) / 2
        sigma = theta / delta
        rho = 1 / sigma
        r = b - A @ x
        d = (scale[:, None] * r) / theta
        for step in range(steps):
            x = x + d
            if step + 1 == steps:
                break
            r = r - A @ d
            rho_next = 1 / (2 * sigma - rho)
            d = rho_next * rho * d + (2 * rho_next / delta) * (scale[:, None] * r)
            rho = rho_next
        return x.astype(self.dtype)

    def cycle(self, b, depth=0):
        level = self.levels[depth]
        if "inverse" in level:
            return level["inverse"] @ b
        x = self.smooth(level, np.zeros_like(b), b)
        r = b - level["A"] @ x
        x = x + level["P"] @ self.cycle(level["R"] @ r, depth + 1)
        return self.smooth(level, x, b)


# Preconditioned conjugate gradients, each channel with its own step, as the renderer's, started afresh from the
# solution's own residual every RESTART steps. Yields x after each step.
def conjugate_gradients(operator, multigrid, x, steps):
    dtype = multigrid.dtype
    operator.to(dtype)
    x = x.astype(dtype)
    for step in range(steps):
        if step % RESTART == 0:
            r = operator.residual(x)
            z = multigrid.cycle(r)
            p = z.copy()
            rz = (r * z).sum(axis=0)
        Ap = operator.product(p)
        pAp = (p * Ap).sum(axis=0)
        alpha = np.where(pAp > 1e-30, rz / np.where(pAp > 1e-30, pAp, 1), 0).astype(dtype)
        x = x + alpha * p
        r = r - alpha * Ap
        z = multigrid.cycle(r)
        rz_next = (r * z).sum(axis=0)
        beta = np.where(rz > 1e-30, rz_next / np.where(rz > 1e-30, rz, 1), 0).astype(dtype)
        p = z + beta * p
        rz = rz_next
        yield step + 1, x


CHECKPOINTS = [10, 20, 40, 80]


def run(scene, edges, membrane=1e-7, magnitude=1e-10, reference=None):
    A, b, held, operator = assemble(scene, edges, membrane, magnitude)
    started = time.time()
    solve = spla.factorized(A.tocsc())
    exact = np.stack([solve(b[:, k]) for k in range(3)], axis=-1)
    line = f"  {edges:8} membrane {membrane:g}: {held.sum()} held, range {exact.min():+.2f} to {exact.max():+.2f}"
    if reference is not None:
        line += f", {np.abs(exact - reference).max():.4f} from the weakest membrane's"
    print(line, flush=True)
    start = np.where(held[:, None], b, b[held].mean(axis=0) if held.any() else 0.5)
    for name, dtype in (("double", np.float64), ("single", np.float32)):
        multigrid = Multigrid(A, held, dtype)
        errors = []
        for step, x in conjugate_gradients(operator, multigrid, start, CHECKPOINTS[-1]):
            if step in CHECKPOINTS:
                errors.append(f"{step}: {np.abs(x - exact).max():.4f}")
        print(f"    {name}, worst error after each count of steps: {', '.join(errors)}", flush=True)
    return exact


def main():
    scenes = {scene.name: scene for scene in T.SCENES}
    print(f"Grid {N}. Errors are the largest difference from the direct double-precision solve, in units where colors run 0 to 1; a step of an 8-bit color is 0.0039.")
    for name in ("circle", "open-line", "crossing", "shapes"):
        print(f"{name}: {scenes[name].note}")
        for edges in ("mirrored", "natural"):
            run(scenes[name], edges)
    for name in ("two-stops", "three-stops"):
        print(f"{name}: {scenes[name].note}")
        run(scenes[name], "mirrored")
        # With natural edges only the regularizers decide what the stops leave free, and single precision can't see
        # a weak one: how strong must the membrane be, and how much does it change the answer?
        weakest = run(scenes[name], "natural", 1e-7, 1e-10)
        for membrane in (1e-5, 1e-4):
            run(scenes[name], "natural", membrane, membrane * 1e-3, weakest)


if __name__ == "__main__":
    main()
