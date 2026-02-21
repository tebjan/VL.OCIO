"""Compute golden reference values for pipeline verification.
Run: python test/compute_reference.py > test/fixtures/reference-values.json
"""
import numpy as np
import json

# =====================================================
# Matrices (row-major / numpy convention)
# =====================================================

AP1_to_Rec709 = np.array([
    [ 1.7048586, -0.6217160, -0.0831426],
    [-0.1300768,  1.1407357, -0.0106589],
    [-0.0239640, -0.1289755,  1.1529395]
])

Rec709_to_AP1 = np.array([
    [0.6131324, 0.3395381, 0.0473296],
    [0.0701934, 0.9163539, 0.0134527],
    [0.0206155, 0.1095697, 0.8698148]
])

Rec2020_to_Rec709 = np.array([
    [ 1.6604910, -0.5876411, -0.0728499],
    [-0.1245505,  1.1328999, -0.0083494],
    [-0.0181508, -0.1005789,  1.1187297]
])

Rec709_to_Rec2020 = np.array([
    [0.6274039, 0.3292830, 0.0433131],
    [0.0690973, 0.9195404, 0.0113623],
    [0.0163914, 0.0880133, 0.8955953]
])

ACESInputMat = np.array([
    [0.59719, 0.35458, 0.04823],
    [0.07600, 0.90834, 0.01566],
    [0.02840, 0.13383, 0.83777]
])

ACESOutputMat = np.array([
    [ 1.60475, -0.53108, -0.07367],
    [-0.10208,  1.10813, -0.00605],
    [-0.00327, -0.07276,  1.07602]
])


# =====================================================
# Transfer functions
# =====================================================

def linear_to_srgb_ch(l):
    if l <= 0.0031308:
        return l * 12.92
    return 1.055 * (l ** (1.0 / 2.4)) - 0.055

def linear_to_srgb(rgb):
    return np.array([linear_to_srgb_ch(c) for c in rgb])


# =====================================================
# Tonemap operators
# =====================================================

def aces_fit_tonemap_bt709(color):
    v = ACESInputMat @ color
    a = v * (v + 0.0245786) - 0.000090537
    b = v * (0.983729 * v + 0.4329510) + 0.238081
    v = a / b
    return np.clip(ACESOutputMat @ v, 0.0, 1.0)

def reinhard_tonemap(color):
    return color / (color + 1.0)


# =====================================================
# Display remap
# =====================================================

def display_remap(color, black, white):
    return black + color * (white - black)


# =====================================================
# Test points
# =====================================================

test_points = {
    "midgray":    np.array([0.18, 0.18, 0.18]),
    "white":      np.array([1.0, 1.0, 1.0]),
    "bright_hdr": np.array([5.0, 3.0, 1.0]),
    "near_black": np.array([0.01, 0.005, 0.008]),
}

def fmt(arr):
    return {
        "R": round(float(arr[0]), 10),
        "G": round(float(arr[1]), 10),
        "B": round(float(arr[2]), 10)
    }


# =====================================================
# Compute expected results
# =====================================================

# Stage 4: ACEScg -> Linear Rec.709
stage4 = {}
for name, pt in test_points.items():
    stage4[name] = fmt(AP1_to_Rec709 @ pt)

# Stage 5: Default grading = passthrough
stage5 = {}
for name, pt in test_points.items():
    stage5[name] = fmt(pt)

# Stage 6: ACES Fit (op=1, BT.709 path)
stage6_aces = {}
for name, pt in test_points.items():
    stage6_aces[name] = fmt(aces_fit_tonemap_bt709(pt))

# Stage 6: Reinhard (op=9)
stage6_reinhard = {}
for name, pt in test_points.items():
    stage6_reinhard[name] = fmt(reinhard_tonemap(pt))

# Stage 8: Linear Rec.709 -> sRGB (outputSpace=5, standard path)
stage8 = {}
for name, pt in test_points.items():
    clamped = np.clip(pt, 0.0, 1.0)
    stage8[name] = fmt(linear_to_srgb(clamped))

# Stage 9: Display remap (black=0.05, white=0.95)
stage9 = {}
for name, pt in test_points.items():
    stage9[name] = fmt(display_remap(pt, 0.05, 0.95))

# Stage 9: Default remap = identity
stage9_default = {}
for name, pt in test_points.items():
    stage9_default[name] = fmt(display_remap(pt, 0.0, 1.0))


# =====================================================
# Build JSON
# =====================================================

data = {
    "testPoints": {
        "midgray":    {"R": 0.18, "G": 0.18, "B": 0.18, "A": 1.0},
        "white":      {"R": 1.0, "G": 1.0, "B": 1.0, "A": 1.0},
        "bright_hdr": {"R": 5.0, "G": 3.0, "B": 1.0, "A": 1.0},
        "near_black": {"R": 0.01, "G": 0.005, "B": 0.008, "A": 1.0},
    },
    "stageExpected": {
        "stage4_inputConvert_ACEScg": {
            "settings": {"inputSpace": 2},
            "description": "ACEScg (AP1) -> Linear Rec.709 via AP1_to_Rec709 matrix",
            "tolerance": 0.0001,
            "results": stage4,
        },
        "stage5_colorGrade_defaults": {
            "settings": {"gradingSpace": 0, "exposure": 0.0, "contrast": 1.0, "saturation": 1.0},
            "description": "Default grading settings = passthrough",
            "tolerance": 0.001,
            "results": stage5,
        },
        "stage6_rrt_acesFit": {
            "settings": {"tonemapOp": 1, "tonemapExposure": 0.0, "whitePoint": 4.0},
            "description": "ACES Fit tonemap (Stephen Hill), BT.709 path",
            "tolerance": 0.01,
            "results": stage6_aces,
        },
        "stage6_rrt_reinhard": {
            "settings": {"tonemapOp": 9, "tonemapExposure": 0.0},
            "description": "Reinhard tonemap: color / (color + 1)",
            "tolerance": 0.001,
            "results": stage6_reinhard,
        },
        "stage8_outputEncode_srgb": {
            "settings": {"outputSpace": 5, "tonemapOp": 0},
            "description": "Linear Rec.709 -> sRGB (IEC 61966-2-1)",
            "tolerance": 0.001,
            "results": stage8,
        },
        "stage9_displayRemap": {
            "settings": {"blackLevel": 0.05, "whiteLevel": 0.95},
            "description": "Linear remap: black + color * (white - black)",
            "tolerance": 0.0001,
            "results": stage9,
        },
        "stage9_displayRemap_default": {
            "settings": {"blackLevel": 0.0, "whiteLevel": 1.0},
            "description": "Default remap = identity passthrough",
            "tolerance": 0.0001,
            "results": stage9_default,
        },
    }
}

print(json.dumps(data, indent=2))
