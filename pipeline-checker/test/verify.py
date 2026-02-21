#!/usr/bin/env python3
"""Pipeline Checker — per-stage math verification.

Usage:
    python test/verify.py              # Verify all stages
    python test/verify.py --stage 4    # Verify specific stage
    python test/verify.py --verbose    # Show deltas for each test point

Exit codes: 0 = all pass, 1 = failures.
"""
import argparse
import json
import sys
import os
import numpy as np

# =====================================================
# Matrices (row-major / numpy convention)
# Extracted from WGSL column-major by transposing
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

# ACES Fit combined matrices (BT.709 path)
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
    """ACES Fit (Stephen Hill / BakingLab), BT.709 path."""
    v = ACESInputMat @ color
    a = v * (v + 0.0245786) - 0.000090537
    b = v * (0.983729 * v + 0.4329510) + 0.238081
    v = a / b
    return np.clip(ACESOutputMat @ v, 0.0, 1.0)

def reinhard_tonemap(color):
    """Reinhard: color / (color + 1)."""
    return color / (color + 1.0)


# =====================================================
# Display remap
# =====================================================

def display_remap(color, black, white):
    """Linear remap: black + color * (white - black)."""
    return black + color * (white - black)


# =====================================================
# Stage verification functions
# Each returns (computed_results_dict, stage_name)
# =====================================================

def verify_stage4(test_points, settings):
    """Stage 4: Input Convert — color space to Linear Rec.709."""
    input_space = settings["inputSpace"]
    results = {}
    for name, pt in test_points.items():
        if input_space == 2:  # ACEScg
            results[name] = AP1_to_Rec709 @ pt
        elif input_space == 1:  # Linear Rec.2020
            results[name] = Rec2020_to_Rec709 @ pt
        elif input_space == 0:  # Linear Rec.709 (passthrough)
            results[name] = pt.copy()
        elif input_space == 5:  # sRGB
            results[name] = np.array([
                (c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
                for c in pt
            ])
        else:
            results[name] = pt.copy()
    return results


def verify_stage5(test_points, settings):
    """Stage 5: Color Grade — with default settings, passthrough."""
    exposure = settings.get("exposure", 0.0)
    results = {}
    for name, pt in test_points.items():
        result = pt * (2.0 ** exposure)
        results[name] = result
    return results


def verify_stage6(test_points, settings):
    """Stage 6: RRT / Tonemap."""
    op = settings["tonemapOp"]
    exposure = settings.get("tonemapExposure", 0.0)
    wp = settings.get("whitePoint", 4.0)
    results = {}
    for name, pt in test_points.items():
        c = pt * (2.0 ** exposure)
        if op == 1:  # ACES Fit (BT.709 path)
            results[name] = aces_fit_tonemap_bt709(c)
        elif op == 9:  # Reinhard
            results[name] = reinhard_tonemap(c)
        elif op == 0:  # None
            results[name] = c
        else:
            results[name] = c
    return results


def verify_stage8(test_points, settings):
    """Stage 8: Output Encoding."""
    output_space = settings["outputSpace"]
    tonemap_op = settings.get("tonemapOp", 0)
    results = {}
    for name, pt in test_points.items():
        if output_space == 5:  # sRGB (standard path, non-ACES)
            clamped = np.clip(pt, 0.0, 1.0)
            results[name] = linear_to_srgb(clamped)
        elif output_space == 0:  # Linear Rec.709 passthrough
            results[name] = pt.copy()
        else:
            results[name] = pt.copy()
    return results


def verify_stage9(test_points, settings):
    """Stage 9: Display Remap."""
    black = settings["blackLevel"]
    white = settings["whiteLevel"]
    results = {}
    for name, pt in test_points.items():
        results[name] = display_remap(pt, black, white)
    return results


# Map scenario prefix to verification function
STAGE_VERIFIERS = {
    "stage4": verify_stage4,
    "stage5": verify_stage5,
    "stage6": verify_stage6,
    "stage8": verify_stage8,
    "stage9": verify_stage9,
}

# Map --stage N to prefix
STAGE_NUM_TO_PREFIX = {
    4: "stage4",
    5: "stage5",
    6: "stage6",
    8: "stage8",
    9: "stage9",
}


def load_reference_values():
    """Load reference-values.json from fixtures directory."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    ref_path = os.path.join(script_dir, "fixtures", "reference-values.json")
    with open(ref_path, "r") as f:
        return json.load(f)


def compare_results(computed, expected, tolerance, verbose=False):
    """Compare computed vs expected results. Returns (pass_count, fail_count, messages)."""
    passes = 0
    fails = 0
    messages = []

    for point_name, expected_rgb in expected.items():
        if point_name not in computed:
            fails += 1
            messages.append(f"  MISSING: {point_name}")
            continue

        comp = computed[point_name]
        exp = np.array([expected_rgb["R"], expected_rgb["G"], expected_rgb["B"]])

        deltas = np.abs(comp - exp)
        max_delta = np.max(deltas)

        if max_delta <= tolerance:
            passes += 1
            if verbose:
                messages.append(
                    f"  PASS: {point_name:12s}  "
                    f"computed=({comp[0]:.6f}, {comp[1]:.6f}, {comp[2]:.6f})  "
                    f"max_delta={max_delta:.2e}"
                )
        else:
            fails += 1
            messages.append(
                f"  FAIL: {point_name:12s}  "
                f"computed=({comp[0]:.6f}, {comp[1]:.6f}, {comp[2]:.6f})  "
                f"expected=({exp[0]:.6f}, {exp[1]:.6f}, {exp[2]:.6f})  "
                f"max_delta={max_delta:.2e} > tolerance={tolerance}"
            )

    return passes, fails, messages


def run_verification(stage_filter=None, verbose=False):
    """Run verification for all or filtered stages. Returns (total_pass, total_fail)."""
    data = load_reference_values()

    # Parse test points into numpy arrays
    test_points = {}
    for name, rgba in data["testPoints"].items():
        test_points[name] = np.array([rgba["R"], rgba["G"], rgba["B"]])

    total_pass = 0
    total_fail = 0

    for scenario_name, scenario in data["stageExpected"].items():
        # Determine stage prefix
        stage_prefix = scenario_name.split("_")[0]

        # Filter by stage number if specified
        if stage_filter is not None:
            target_prefix = STAGE_NUM_TO_PREFIX.get(stage_filter)
            if target_prefix and stage_prefix != target_prefix:
                continue

        # Find verifier
        verifier = STAGE_VERIFIERS.get(stage_prefix)
        if verifier is None:
            print(f"WARNING: No verifier for {scenario_name}")
            continue

        # Compute results
        settings = scenario["settings"]
        tolerance = scenario["tolerance"]
        expected = scenario["results"]

        computed = verifier(test_points, settings)

        # Compare
        passes, fails, messages = compare_results(
            computed, expected, tolerance, verbose
        )
        total_pass += passes
        total_fail += fails

        # Report
        status = "PASS" if fails == 0 else "FAIL"
        print(f"[{status}] {scenario_name}: {scenario['description']}")
        print(f"       {passes} passed, {fails} failed (tolerance={tolerance})")
        for msg in messages:
            print(msg)

    return total_pass, total_fail


def main():
    parser = argparse.ArgumentParser(description="VL.OCIO Pipeline Checker — verification")
    parser.add_argument("--stage", type=int, help="Verify specific stage (4, 5, 6, 8, 9)")
    parser.add_argument("--verbose", action="store_true", help="Show deltas for passing tests")
    args = parser.parse_args()

    print("=" * 60)
    print("VL.OCIO Pipeline Checker — Math Verification")
    print("=" * 60)
    print()

    total_pass, total_fail = run_verification(
        stage_filter=args.stage,
        verbose=args.verbose,
    )

    print()
    print("-" * 60)
    print(f"TOTAL: {total_pass} passed, {total_fail} failed")

    if total_fail > 0:
        print("RESULT: FAIL")
        sys.exit(1)
    else:
        print("RESULT: PASS")
        sys.exit(0)


if __name__ == "__main__":
    main()
