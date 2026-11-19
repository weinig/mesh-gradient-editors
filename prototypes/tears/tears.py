#!/usr/bin/env python3
# A CPU prototype of tears for the biharmonic model, after Finch, Snyder and Hoppe, "Freeform Vector Graphics with
# Controlled Thin-Plate Splines" (2011), beside an emulation of how the editors' renderer holds curves today.
#
# The paper minimizes a sum of small terms, one for each second difference across, down and diagonally at each pixel
# (Dxx, Dyy, Dxy). Away from any feature they add up to the 13-point biharmonic stencil. A tear drops the terms that
# straddle a curve. A two-sided color curve ("V1 T V2") is a tear, with the pixel either side of each grid edge the
# curve crosses held to its own side's color. The box's edges are natural: terms that would leave the grid are dropped.
#
# Today's renderer instead holds a band of pixels either side of the curve, 1% of the box wide, under the 13-point
# stencil with mirrored edges: bands() here. A flat band also pins the slope across the curve to zero, which the paper
# calls a slope curve ("S"), so the third variant is the paper's "S V1 T V2 S": tears(scene, flat=True) adds a penalty
# on the first difference away from the curve on each side.
#
# Both are solved exactly, in double precision, with a sparse direct solver. Colors are plain numbers per channel;
# nothing here converts between color spaces.
#
# Run: python3 tears.py [grid size, default 256] [output directory]
import os
import sys

import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla
from PIL import Image, ImageDraw

N = int(sys.argv[1]) if len(sys.argv) > 1 else 256
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")

# How far either side of a curve today's renderer holds its colors, and a point its color, in units of the box.
BAND = 0.01


def color(text):
    return np.array([int(text[i:i + 2], 16) / 255 for i in (1, 3, 5)])


# MARK: - Scenes

# A curve is a polyline in the box, 0 to 1 across and down, with a color on its left and right, each given at its
# start and end and mixed along it. With `two_sided` false it's a plain value curve, one color, with no tear.
class Curve:
    def __init__(self, points, left, right=None, two_sided=True, closed=False):
        self.points = np.array(points, dtype=float)
        if closed:
            self.points = np.vstack([self.points, self.points[:1]])
        self.left = color(left)
        self.right = color(right if right is not None else left)
        self.two_sided = two_sided

    # Each straight piece, in pixel coordinates: pixel (i, j)'s center is at (i, j).
    def pieces(self):
        p = self.points * N - 0.5
        return list(zip(p[:-1], p[1:]))


def circle(cx, cy, r, count=96):
    angles = np.linspace(0, 2 * np.pi, count, endpoint=False)
    return [(cx + r * np.cos(a), cy + r * np.sin(a)) for a in angles]


class Scene:
    def __init__(self, name, note, curves=(), points=()):
        self.name, self.note, self.curves, self.points = name, note, list(curves), list(points)


SCENES = [
    Scene("circle", "A closed circle, red inside and blue outside.",
          [Curve(circle(0.5, 0.5, 0.25), "#d33b2c", "#1e88ff", closed=True)]),
    Scene("two-stops", "Two points, black and white. A thin plate through two values is a linear ramp.",
          points=[((0.3, 0.5), "#000000"), ((0.7, 0.5), "#ffffff")]),
    Scene("three-stops", "Three points. A thin plate through three values is a plane.",
          points=[((0.25, 0.3), "#ff3d7f"), ((0.75, 0.35), "#ffd400"), ((0.45, 0.75), "#1b6bff")]),
    Scene("open-line", "One open line, purple on one side and yellow on the other.",
          [Curve([(0.5, 0.2), (0.5, 0.8)], "#7a2cff", "#ffc400")]),
    Scene("thin-stripe", "Two lines 0.8% of the box apart: black outside, white between. Thinner than today's bands.",
          [Curve([(0.496, 0.2), (0.496, 0.8)], "#000000", "#ffffff"),
           Curve([(0.504, 0.2), (0.504, 0.8)], "#ffffff", "#000000")]),
    Scene("crossing", "Two lines that cross, each with its own two colors.",
          [Curve([(0.2, 0.3), (0.8, 0.7)], "#ff3d7f", "#1b6bff"),
           Curve([(0.25, 0.75), (0.75, 0.25)], "#ffd400", "#10a050")]),
    Scene("shapes", "A circle, red inside and blue outside, over a gray box with a white highlight line.",
          [Curve([(0.15, 0.15), (0.85, 0.15), (0.85, 0.85), (0.15, 0.85)], "#3a3a44", "#b9b9c6", closed=True),
           Curve(circle(0.45, 0.55, 0.18), "#d33b2c", "#1e88ff", closed=True),
           Curve([(0.6, 0.25), (0.78, 0.4)], "#ffffff", two_sided=False)]),
]


# MARK: - Where curves cross the grid

# For one straight piece from a to b, every grid edge it crosses: the pixels either side, which of them is on the
# piece's left, and how far along the piece (0 to 1) and along the edge the crossing is.
def crossings(a, b):
    lo = np.floor(np.minimum(a, b)).astype(int) - 1
    hi = np.ceil(np.maximum(a, b)).astype(int) + 1
    i0, i1 = max(lo[0], 0), min(hi[0], N - 1)
    j0, j1 = max(lo[1], 0), min(hi[1], N - 1)
    if i0 > i1 or j0 > j1:
        return []
    jj, ii = np.mgrid[j0:j1 + 1, i0:i1 + 1]
    d = b - a
    length2 = d @ d
    if length2 == 0:
        return []
    side = d[0] * (jj - a[1]) - d[1] * (ii - a[0])
    along = ((ii - a[0]) * d[0] + (jj - a[1]) * d[1]) / length2
    found = []
    for di, dj in ((1, 0), (0, 1)):
        s0, s1 = side[:side.shape[0] - dj, :side.shape[1] - di], side[dj:, di:]
        t0, t1 = along[:along.shape[0] - dj, :along.shape[1] - di], along[dj:, di:]
        crosses = (s0 >= 0) != (s1 >= 0)
        with np.errstate(divide="ignore", invalid="ignore"):
            f = np.where(crosses, s0 / (s0 - s1), 0)
        t = t0 + (t1 - t0) * f
        crosses &= (t >= 0) & (t < 1)
        for y, x in zip(*np.nonzero(crosses)):
            p, q = (i0 + x, j0 + y), (i0 + x + di, j0 + y + dj)
            found.append({"p": p, "q": q, "axis": 0 if di else 1, "p_is_left": s0[y, x] >= 0,
                          "t": t[y, x], "f": f[y, x]})
    return found


# MARK: - Least squares

# Collects terms weight * (sum of coefficient * pixel - value)², then solves for the pixels that minimize their sum.
class System:
    def __init__(self):
        self.rows, self.cols, self.values, self.targets = [], [], [], []

    def add(self, weight, pixels, coefficients, value=None):
        row = len(self.targets)
        scale = np.sqrt(weight)
        for (i, j), c in zip(pixels, coefficients):
            self.rows.append(row)
            self.cols.append(j * N + i)
            self.values.append(scale * c)
        self.targets.append(scale * (np.zeros(3) if value is None else value))

    # The same, for many terms at once: `pixels` is a list of index arrays, one for each pixel of the kernel.
    def add_many(self, weight, pixels, coefficients):
        count = len(pixels[0])
        rows = len(self.targets) + np.arange(count)
        scale = np.sqrt(weight)
        for index, c in zip(pixels, coefficients):
            self.rows.extend(rows)
            self.cols.extend(index)
            self.values.extend(np.full(count, scale * c))
        self.targets.extend(np.zeros((count, 3)))

    def solve(self):
        L = sp.csr_matrix((self.values, (self.rows, self.cols)), shape=(len(self.targets), N * N))
        A = (L.T @ L).tocsc()
        b = L.T @ np.array(self.targets)
        solve = spla.factorized(A)
        return np.stack([solve(b[:, k]) for k in range(3)], axis=-1).reshape(N, N, 3)


# Weights, per term. The thin plate's is 1. Holds are firm, and the regularizers, which only decide what a region with
# too few colors does, are tiny: a membrane, then the magnitude, as in the paper's section 5.
HOLD = 1e4
SLOPE = 1e4
MEMBRANE = 1e-7
MAGNITUDE = 1e-10

index = lambda i, j: j * N + i


# MARK: - Tears, as in the paper

def tears(scene, flat=False, mirrored=False):
    # Which grid edges a tear crosses: torn[0][j, i] is the edge from (i, j) to (i + 1, j), torn[1] the edge down.
    torn = [np.zeros((N, N), dtype=bool), np.zeros((N, N), dtype=bool)]
    system = System()
    for curve in scene.curves:
        for a, b in curve.pieces():
            for c in crossings(a, b):
                (pi, pj), q = c["p"], c["q"]
                if curve.two_sided:
                    torn[c["axis"]][pj, pi] = True
    # Whether the edge from pixel p one step along `axis` in direction `step` is in the grid and whole.
    def whole(p, axis, step):
        q = (p[0] + step, p[1]) if axis == 0 else (p[0], p[1] + step)
        if not (0 <= q[0] < N and 0 <= q[1] < N):
            return None
        first = (min(p[0], q[0]), min(p[1], q[1]))
        return None if torn[axis][first[1], first[0]] else q

    for curve in scene.curves:
        pieces = curve.pieces()
        for k, (a, b) in enumerate(pieces):
            d = (b - a) / np.hypot(*(b - a))
            for c in crossings(a, b):
                p, q = c["p"], c["q"]
                if curve.two_sided:
                    # The pixel either side of the tear, to its own side's color.
                    left, right = (p, q) if c["p_is_left"] else (q, p)
                    system.add(HOLD, [left], [1], curve.left)
                    system.add(HOLD, [right], [1], curve.right)
                    if flat:
                        # No slope away from the curve on either side: the paper's generalized first difference,
                        # along the normal, on the pixel beside the tear and its neighbors further from it.
                        for pixel, normal in ((left, np.array([-d[1], d[0]])), (right, np.array([d[1], -d[0]]))):
                            pixels, coefficients = [pixel], [0.0]
                            for axis in (0, 1):
                                if abs(normal[axis]) < 1e-9:
                                    continue
                                neighbor = whole(pixel, axis, 1 if normal[axis] > 0 else -1)
                                if neighbor is None:
                                    continue
                                pixels.append(neighbor)
                                coefficients.append(abs(normal[axis]))
                                coefficients[0] -= abs(normal[axis])
                            if len(pixels) > 1:
                                system.add(SLOPE, pixels, coefficients)
                elif not torn[c["axis"]][p[1], p[0]]:
                    # A value curve: the two pixels' mix at the crossing, to its color.
                    system.add(HOLD, [p, q], [1 - c["f"], c["f"]], curve.left)
    for (x, y), text in scene.points:
        # A point: the four nearest pixels' bilinear mix, to its color.
        px, py = x * N - 0.5, y * N - 0.5
        i, j = int(np.floor(px)), int(np.floor(py))
        fx, fy = px - i, py - j
        system.add(HOLD, [(i, j), (i + 1, j), (i, j + 1), (i + 1, j + 1)],
                   [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy], color(text))

    jj, ii = np.mgrid[0:N, 0:N]
    tx, ty = torn
    # Dxx on (i - 1, i, i + 1), where both its edges are whole. Terms that would leave the grid aren't there.
    keep = np.zeros((N, N), dtype=bool)
    keep[:, 1:-1] = ~tx[:, :-2] & ~tx[:, 1:-1]
    system.add_many(1, [index(ii - 1, jj)[keep], index(ii, jj)[keep], index(ii + 1, jj)[keep]], [-1, 2, -1])
    # Dyy, the same down.
    keep = np.zeros((N, N), dtype=bool)
    keep[1:-1, :] = ~ty[:-2, :] & ~ty[1:-1, :]
    system.add_many(1, [index(ii, jj - 1)[keep], index(ii, jj)[keep], index(ii, jj + 1)[keep]], [-1, 2, -1])
    if mirrored:
        # The box's edges as the renderer has them today, not natural: the second differences at the edge pixels,
        # with the pixel past the edge the edge pixel's own mirror.
        line = np.arange(N)
        for near, far, whole_edge in ((index(0, line), index(1, line), ~tx[:, 0]), (index(N - 1, line), index(N - 2, line), ~tx[:, N - 2]),
                                      (index(line, 0), index(line, 1), ~ty[0, :]), (index(line, N - 1), index(line, N - 2), ~ty[N - 2, :])):
            system.add_many(1, [near[whole_edge], far[whole_edge]], [1, -1])
    # Dxy on the 2 × 2 block from (i, j), where all four of its edges are whole, counted twice.
    keep = np.zeros((N, N), dtype=bool)
    keep[:-1, :-1] = ~tx[:-1, :-1] & ~tx[1:, :-1] & ~ty[:-1, :-1] & ~ty[:-1, 1:]
    system.add_many(2, [index(ii, jj)[keep], index(ii + 1, jj)[keep], index(ii, jj + 1)[keep], index(ii + 1, jj + 1)[keep]],
                    [1, -1, -1, 1])
    # The membrane, on whole edges, and the magnitude.
    keep = np.zeros((N, N), dtype=bool)
    keep[:, :-1] = ~tx[:, :-1]
    system.add_many(MEMBRANE, [index(ii, jj)[keep], index(ii + 1, jj)[keep]], [1, -1])
    keep = np.zeros((N, N), dtype=bool)
    keep[:-1, :] = ~ty[:-1, :]
    system.add_many(MEMBRANE, [index(ii, jj)[keep], index(ii, jj + 1)[keep]], [1, -1])
    system.add_many(MAGNITUDE, [index(ii, jj).ravel()], [1])
    return system.solve(), torn


# MARK: - Bands, as the renderer holds curves today

def bands(scene):
    system = System()
    jj, ii = np.mgrid[0:N, 0:N]
    radius = BAND * N
    held = np.zeros((N, N), dtype=bool)
    total = np.zeros((N, N, 3))
    count = np.zeros((N, N))
    for curve in scene.curves:
        # Each pixel within the band takes its side from the nearest piece.
        best = np.full((N, N), np.inf)
        side = np.zeros((N, N), dtype=bool)
        for a, b in curve.pieces():
            d = b - a
            t = np.clip(((ii - a[0]) * d[0] + (jj - a[1]) * d[1]) / (d @ d), 0, 1)
            distance = np.hypot(ii - (a[0] + t * d[0]), jj - (a[1] + t * d[1]))
            nearer = distance < best
            best = np.where(nearer, distance, best)
            side = np.where(nearer, d[0] * (jj - a[1]) - d[1] * (ii - a[0]) >= 0, side)
        inside = best <= max(radius, 0.75)
        colors = np.where(side[..., None], curve.left, curve.right)
        total += np.where(inside[..., None], colors, 0)
        count += inside
        held |= inside
    for (x, y), text in scene.points:
        inside = np.hypot(ii - (x * N - 0.5), jj - (y * N - 0.5)) <= max(radius, 0.75)
        total += np.where(inside[..., None], color(text), 0)
        count += inside
        held |= inside
    # Where bands overlap, the mean of their colors.
    for j, i in zip(*np.nonzero(held)):
        system.add(HOLD, [(i, j)], [1], total[j, i] / count[j, i])
    # The Laplacian with mirrored edges, squared: the 13-point stencil the renderer solves.
    mirror = lambda v: np.where(v < 0, -v - 1, np.where(v >= N, 2 * N - v - 1, v))
    pixels = [index(ii, jj).ravel()] + [index(mirror(ii + di), mirror(jj + dj)).ravel()
                                        for di, dj in ((-1, 0), (1, 0), (0, -1), (0, 1))]
    system.add_many(1, pixels, [4, -1, -1, -1, -1])
    system.add_many(MAGNITUDE, [index(ii, jj).ravel()], [1])
    return system.solve(), held


# MARK: - Pictures and numbers

def picture(values):
    return Image.fromarray((np.clip(values, 0, 1) * 255 + 0.5).astype(np.uint8))


# The three channels along the middle row, over the range they cover, with 0 and 1 marked.
def plot(rows, width, height=110):
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    lo = min(-0.25, min(r.min() for r in rows))
    hi = max(1.25, max(r.max() for r in rows))
    y = lambda v: (hi - v) / (hi - lo) * (height - 1)
    draw.rectangle([0, y(1), width, y(0)], fill=(240, 240, 240))
    for row, dash in zip(rows, (False, True)):
        for k, ink in enumerate([(220, 40, 40), (30, 160, 60), (40, 90, 230)]):
            points = [(x * (width - 1) / (len(row) - 1), y(row[x, k])) for x in range(len(row))]
            if dash:
                for start in range(0, len(points) - 1, 6):
                    draw.line(points[start:start + 4], fill=ink, width=1)
            else:
                draw.line(points, fill=ink, width=2)
    return image


def main():
    os.makedirs(OUT, exist_ok=True)
    scale = max(1, 384 // N)
    size = N * scale
    sheets = []
    for scene in SCENES:
        today, held = bands(scene)
        torn_values, torn = tears(scene)
        flat_values, _ = tears(scene, flat=True)
        row = N // 2
        sheet = Image.new("RGB", (3 * size + 60, size + 175), "white")
        draw = ImageDraw.Draw(sheet)
        draw.text((0, 4), f"{scene.name}: {scene.note}", fill="black")
        for column, (label, values) in enumerate((("Bands, as today", today), ("Tears", torn_values), ("Tears, flat sides", flat_values))):
            x = column * (size + 30)
            draw.text((x, 24), f"{label}: {values.min():+.2f} to {values.max():+.2f}", fill="black")
            sheet.paste(picture(values).resize((size, size), Image.NEAREST), (x, 42))
            sheet.paste(plot([values[row]], size), (x, size + 57))
        sheet.save(os.path.join(OUT, f"{scene.name}.png"))
        sheets.append(sheet)
        describe = lambda v: f"range {v.min():+.3f} to {v.max():+.3f}, {100 * np.mean((v < -1 / 512) | (v > 1 + 1 / 512)):.1f}% of values past 0 to 1"
        print(f"{scene.name}: {scene.note}")
        print(f"  bands: {describe(today)}; {held.sum()} pixels held")
        print(f"  tears: {describe(torn_values)}; {torn[0].sum() + torn[1].sum()} edges torn")
        print(f"  tears, flat sides: {describe(flat_values)}")
        print(f"  tears, flat sides, mirrored edges: {describe(tears(scene, flat=True, mirrored=True)[0])}")
        print(f"  tears, mirrored edges: {describe(tears(scene, mirrored=True)[0])}")
        if scene.name in ("two-stops", "three-stops"):
            # How far each is from the plane that best fits it.
            jj, ii = np.mgrid[0:N, 0:N]
            basis = np.stack([np.ones(N * N), ii.ravel(), jj.ravel()], axis=1)
            for name, values in (("bands", today), ("tears", torn_values)):  # Points have no sides to flatten.
                flat = values.reshape(-1, 3)
                fit = basis @ np.linalg.lstsq(basis, flat, rcond=None)[0]
                print(f"  {name}: at most {np.abs(flat - fit).max():.4f} from a plane")
    # Every scene on one page.
    page = Image.new("RGB", (sheets[0].width + 20, sum(sheet.height + 20 for sheet in sheets)), "white")
    y = 10
    for sheet in sheets:
        page.paste(sheet, (10, y))
        y += sheet.height + 20
    page.save(os.path.join(OUT, "all.png"))


main()
