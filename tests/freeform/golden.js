// What the freeform-gradient() editor's models and CSS gave when these tests were written: for each preset, a hash
// of its CSS and each model's four components summed over a 3 by 3 grid of points; and for the "Stops with spread"
// preset under each choice of Stop size, Spread sets and Edges, the two grid models' first component summed likewise.
// models.js checks the page against these, so a change to the models or the CSS shows. If a change is meant, capture
// them again: see captureGolden() in models.js.
const GOLDEN = {
    presets: {
        "Four corners": { css: "9b544db5", sums: {"spline": [5.0118, 5.3824, 3.9529, 9], "biharmonic": [5.0118, 5.3824, 3.9529, 9], "harmonic": [5.0118, 5.3824, 3.9529, 9]} },
        "Three stops": { css: "37471f64", sums: {"spline": [6.0395, -0.2939, 0.0714, 9], "biharmonic": [5.9837, -0.1027, 0.025, 9], "harmonic": [5.9746, -0.0499, 0.0317, 9]} },
        "Scattered sunset": { css: "5268b8a8", sums: {"spline": [5.006, 0.7703, 0.0332, 9], "biharmonic": [5.1408, 0.8823, 0.0656, 9], "harmonic": [4.8901, 0.7233, -0.0176, 9]} },
        "Overshoot": { css: "3c6be12e", sums: {"spline": [5.0195, 0, 0, 9], "biharmonic": [4.9061, 0, 0, 9], "harmonic": [4.9683, 0, 0, 9]} },
        "Hues around a circle (oklch)": { css: "8f2e33e5", sums: {"spline": [6.75, 1.35, 810, 9], "biharmonic": [6.75, 1.35, 810, 9], "harmonic": [6.75, 1.35, 810, 9]} },
        "Translucent": { css: "8db33d4", sums: {"spline": [3.9555, -0.0682, 0.5298, 5.6979], "biharmonic": [3.8494, 0.0288, 0.512, 5.5774], "harmonic": [3.7783, 0.0755, 0.4991, 5.4914]} },
        "Missing components": { css: "49edd251", sums: {"spline": [2.4231, 2.4231, 4.1538, 9], "biharmonic": [2.634, 2.71, 3.656, 9], "harmonic": [2.8235, 2.8449, 3.3317, 9]} },
        "Stops on a line": { css: "2e8bd8d6", sums: {"spline": [6.3847, 0.5162, 0.0168, 9], "biharmonic": [6.6674, 0.4125, 0.3138, 9], "harmonic": [6.6039, 0.4308, 0.2432, 9]} },
        "Stops in one corner": { css: "13b266af", sums: {"spline": [7.0635, -3.8163, 0.555, 9], "biharmonic": [6.6938, -2.3859, 0.9651, 9], "harmonic": [6.6433, -0.4119, 0.4607, 9]} },
        "Thin box": { css: "edb646a9", sums: {"spline": [6.5972, 0.1679, 0.6195, 9], "biharmonic": [6.4573, 0.0377, 0.3803, 9], "harmonic": [6.4586, 0.026, 0.3898, 9]} },
        "Stretched sunset": { css: "5268b8a8", sums: {"spline": [4.5121, 0.565, -0.1265, 9], "biharmonic": [4.5819, 0.5302, -0.0509, 9], "harmonic": [4.7093, 0.6503, -0.0361, 9]} },
        "Stops just outside the box": { css: "f24d0d06", sums: {"spline": [6.4219, 0.5711, 0.0408, 9], "biharmonic": [6.5428, 0.2114, 0.1328, 9], "harmonic": [6.5013, 0.3751, 0.2525, 9]} },
        "Stops with spread": { css: "f1476b1e", sums: {"spline": [6.4939, 0.3221, 0.6264, 9], "biharmonic": [6.489, 0.2829, 0.4849, 9], "harmonic": [6.5608, 0.0423, 0.5095, 9]} },
        "One stop": { css: "fd763b8b", sums: {"spline": [3.3176, 3.2471, 8.1176, 9], "biharmonic": [3.3176, 3.2471, 8.1176, 9], "harmonic": [3.3176, 3.2471, 8.1176, 9]} },
    },
    options: {
        "points/none/mirrored": [6.489, 6.5608],
        "points/none/open": [6.4762, 6.5805],
        "points/none/free": [6.4935, 6.5739],
        "points/strength/mirrored": [6.4894, 6.582],
        "points/strength/open": [6.4767, 6.599],
        "points/strength/free": [6.4924, 6.5931],
        "points/share/mirrored": [6.489, 6.5984],
        "points/share/open": [6.4762, 6.6211],
        "points/share/free": [6.4935, 6.6134],
        "discs/none/mirrored": [6.443, 6.5193],
        "discs/none/open": [6.4543, 6.5496],
        "discs/none/free": [6.4214, 6.5413],
        "discs/strength/mirrored": [6.443, 6.5193],
        "discs/strength/open": [6.4543, 6.5496],
        "discs/strength/free": [6.4214, 6.5413],
        "discs/share/mirrored": [6.443, 6.5193],
        "discs/share/open": [6.4543, 6.5496],
        "discs/share/free": [6.4214, 6.5413],
    },
};
