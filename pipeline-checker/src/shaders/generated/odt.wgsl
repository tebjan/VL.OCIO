// Stage 7: ODT (Output Device Transform)
// Source: ACES13_RRT_ODT.sdsl + ACES20_RRT_ODT.sdsl + ColorSpaceConversion.sdsl
// ALL matrices TRANSPOSED for WGSL column-major layout.
//
// Input: AP1 from Stage 6 (ACES 1.3/2.0 RRT) or Linear Rec.709 (all other operators).
// Output: Linear in target display gamut (Rec.709 or Rec.2020).
//
// For tonemapOp 0,1,4-11: no-op passthrough (RRT already output Linear Rec.709).
// For tonemapOp 2 (ACES 1.3): C9 spline + dim surround + ODT desat + gamut convert.
// For tonemapOp 3 (ACES 2.0): simple gamut matrix (AP1 → display).

// ============================================================================
// Uniforms — reads from shared PipelineUniforms buffer
// ============================================================================

struct Uniforms {
    // Stage 4 (not used by ODT)
    _inputSpace: i32,             // byte 0
    // Stage 5 scalars (not used by ODT)
    _gradingSpace: i32,           // byte 4
    _gradeExposure: f32,          // byte 8
    _contrast: f32,               // byte 12
    _saturation: f32,             // byte 16
    _temperature: f32,            // byte 20
    _tint: f32,                   // byte 24
    _highlights: f32,             // byte 28
    _shadows: f32,                // byte 32
    _vibrance: f32,               // byte 36
    _pad0a: f32,                  // byte 40
    _pad0b: f32,                  // byte 44
    // Stage 5 vec3 fields (not used by ODT)
    _lift: vec3<f32>,             // byte 48
    _pad1: f32,                   // byte 60
    _gamma: vec3<f32>,            // byte 64
    _pad2: f32,                   // byte 76
    _gain: vec3<f32>,             // byte 80
    _pad3: f32,                   // byte 92
    _offset: vec3<f32>,           // byte 96
    _pad4: f32,                   // byte 108
    _shadowColor: vec3<f32>,      // byte 112
    _pad5: f32,                   // byte 124
    _midtoneColor: vec3<f32>,     // byte 128
    _pad6: f32,                   // byte 140
    _highlightColor: vec3<f32>,   // byte 144
    _pad7: f32,                   // byte 156
    _highlightSoftClip: f32,      // byte 160
    _shadowSoftClip: f32,         // byte 164
    _highlightKnee: f32,          // byte 168
    _shadowKnee: f32,             // byte 172
    // Stage 6-7: Tonemap
    outputSpace: i32,             // byte 176
    tonemapOp: i32,               // byte 180
};

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> u: Uniforms;

// ============================================================================
// Math Helpers
// ============================================================================

fn log10_f(x: f32) -> f32 {
    return log2(x) * 0.30102999566;
}

fn pow10(x: f32) -> f32 {
    return exp2(x * 3.32192809489);
}

// ============================================================================
// Constants
// ============================================================================

const CINEMA_WHITE: f32 = 48.0;
const CINEMA_BLACK: f32 = 0.02;
const ACES_DIM_SURROUND_GAMMA: f32 = 0.9811;

// ============================================================================
// Gamut Matrices — ALL TRANSPOSED from SDSL row-major to WGSL column-major
// ============================================================================

// Quadratic B-spline basis matrix
const ACES_SPLINE_M = mat3x3<f32>(
    vec3<f32>( 0.5, -1.0,  0.5),
    vec3<f32>(-1.0,  1.0,  0.5),
    vec3<f32>( 0.5,  0.0,  0.0)
);

// AP1 → XYZ (D60 white point) — for dim surround compensation
const ACES_AP1_to_XYZ = mat3x3<f32>(
    vec3<f32>( 0.6624541811,  0.2722287168, -0.0055746495),
    vec3<f32>( 0.1340042065,  0.6740817658,  0.0040607335),
    vec3<f32>( 0.1561876870,  0.0536895174,  1.0103391003)
);

// XYZ → AP1 (D60 white point)
const ACES_XYZ_to_AP1 = mat3x3<f32>(
    vec3<f32>( 1.6410233797, -0.6636628587,  0.0117218943),
    vec3<f32>(-0.3248032942,  1.6153315917, -0.0082844420),
    vec3<f32>(-0.2364246952,  0.0167563477,  0.9883948585)
);

// ODT desaturation (factor 0.93)
const ODT_SAT_MAT = mat3x3<f32>(
    vec3<f32>(0.949056, 0.019056, 0.019056),
    vec3<f32>(0.0471857, 0.9771860, 0.0471857),
    vec3<f32>(0.00375827, 0.00375827, 0.93375800)
);

// AP1 → Rec.709 (includes D60→D65 Bradford)
const AP1_to_Rec709 = mat3x3<f32>(
    vec3<f32>( 1.7048586, -0.1300768, -0.0239640),
    vec3<f32>(-0.6217160,  1.1407357, -0.1289755),
    vec3<f32>(-0.0831426, -0.0106589,  1.1529395)
);

// AP1 → Rec.2020 (includes D60→D65 Bradford)
const AP1_to_Rec2020 = mat3x3<f32>(
    vec3<f32>( 1.0211818, -0.0087055, -0.0054779),
    vec3<f32>(-0.0130790,  1.0220618, -0.0292020),
    vec3<f32>(-0.0081028, -0.0133563,  1.0346800)
);

// ============================================================================
// ACES Segmented Spline C5 (needed by C9 for reference points)
// ============================================================================

fn aces_spline_c5_fwd(x: f32) -> f32 {
    var coefsLow = array<f32, 6>(
        -4.0000000000, -4.0000000000, -3.1573765773,
        -0.4852499958,  1.8477324706,  1.8477324706
    );
    var coefsHigh = array<f32, 6>(
        -0.7185482425,  2.0810307172,  3.6681241237,
         4.0000000000,  4.0000000000,  4.0000000000
    );
    let logMinX = log10_f(0.18 * exp2(-15.0));
    let logMidX = log10_f(0.18);
    let logMaxX = log10_f(0.18 * exp2(18.0));

    let logx = log10_f(max(x, 1e-10));
    var logy: f32;

    if (logx <= logMinX) {
        logy = log10_f(0.0001);
    } else if (logx < logMidX) {
        let knot_coord = 3.0 * (logx - logMinX) / (logMidX - logMinX);
        let j = min(i32(knot_coord), 3);
        let t = knot_coord - f32(j);
        let cf = vec3<f32>(coefsLow[j], coefsLow[j + 1], coefsLow[j + 2]);
        logy = dot(vec3<f32>(t * t, t, 1.0), ACES_SPLINE_M * cf);
    } else if (logx < logMaxX) {
        let knot_coord = 3.0 * (logx - logMidX) / (logMaxX - logMidX);
        let j = min(i32(knot_coord), 3);
        let t = knot_coord - f32(j);
        let cf = vec3<f32>(coefsHigh[j], coefsHigh[j + 1], coefsHigh[j + 2]);
        logy = dot(vec3<f32>(t * t, t, 1.0), ACES_SPLINE_M * cf);
    } else {
        logy = log10_f(10000.0);
    }

    return pow10(logy);
}

// ============================================================================
// ACES Segmented Spline C9 — 48 nits (SDR)
// ============================================================================

fn aces_spline_c9_fwd_48nits(x: f32) -> f32 {
    var coefsLow = array<f32, 10>(
        -1.6989700043, -1.6989700043, -1.4779000000, -1.2291000000, -0.8648000000,
        -0.4480000000,  0.0051800000,  0.4511080334,  0.9113744414,  0.9113744414
    );
    var coefsHigh = array<f32, 10>(
         0.5154386965,  0.8470437783,  1.1358000000,  1.3802000000,  1.5197000000,
         1.5985000000,  1.6467000000,  1.6746091357,  1.6878733390,  1.6878733390
    );
    let logMinX = log10_f(aces_spline_c5_fwd(0.18 * pow(2.0, -6.5)));
    let logMidX = log10_f(aces_spline_c5_fwd(0.18));
    let logMaxX = log10_f(aces_spline_c5_fwd(0.18 * pow(2.0, 6.5)));
    let logMinY = log10_f(0.02);
    let logMaxY = log10_f(48.0);

    let logx = log10_f(max(x, 1e-4));
    var logy: f32;

    if (logx <= logMinX) {
        logy = logx * 0.0 + (logMinY - 0.0 * logMinX);
    } else if (logx < logMidX) {
        let knot_coord = 7.0 * (logx - logMinX) / (logMidX - logMinX);
        let j = min(i32(knot_coord), 7);
        let t = knot_coord - f32(j);
        let cf = vec3<f32>(coefsLow[j], coefsLow[j + 1], coefsLow[j + 2]);
        logy = dot(vec3<f32>(t * t, t, 1.0), ACES_SPLINE_M * cf);
    } else if (logx < logMaxX) {
        let knot_coord = 7.0 * (logx - logMidX) / (logMaxX - logMidX);
        let j = min(i32(knot_coord), 7);
        let t = knot_coord - f32(j);
        let cf = vec3<f32>(coefsHigh[j], coefsHigh[j + 1], coefsHigh[j + 2]);
        logy = dot(vec3<f32>(t * t, t, 1.0), ACES_SPLINE_M * cf);
    } else {
        logy = logx * 0.04 + (logMaxY - 0.04 * logMaxX);
    }

    return pow10(logy);
}

// ============================================================================
// ACES Segmented Spline C9 — 1000 nits (HDR)
// ============================================================================

fn aces_spline_c9_fwd_1000nits(x: f32) -> f32 {
    var coefsLow = array<f32, 10>(
        -4.9706219331, -3.0293780669, -2.1262000000, -1.5105000000, -1.0578000000,
        -0.4668000000,  0.1193800000,  0.7088134201,  1.2911865799,  1.2911865799
    );
    var coefsHigh = array<f32, 10>(
         0.8089132070,  1.1910867930,  1.5683000000,  1.9483000000,  2.3083000000,
         2.6384000000,  2.8595000000,  2.9872608805,  3.0127391195,  3.0127391195
    );
    let logMinX = log10_f(aces_spline_c5_fwd(0.18 * pow(2.0, -12.0)));
    let logMidX = log10_f(aces_spline_c5_fwd(0.18));
    let logMaxX = log10_f(aces_spline_c5_fwd(0.18 * pow(2.0, 10.0)));
    let logMinY = log10_f(0.0001);
    let logMaxY = log10_f(1000.0);

    let logx = log10_f(max(x, 1e-4));
    var logy: f32;

    if (logx <= logMinX) {
        logy = logx * 3.0 + (logMinY - 3.0 * logMinX);
    } else if (logx < logMidX) {
        let knot_coord = 7.0 * (logx - logMinX) / (logMidX - logMinX);
        let j = min(i32(knot_coord), 7);
        let t = knot_coord - f32(j);
        let cf = vec3<f32>(coefsLow[j], coefsLow[j + 1], coefsLow[j + 2]);
        logy = dot(vec3<f32>(t * t, t, 1.0), ACES_SPLINE_M * cf);
    } else if (logx < logMaxX) {
        let knot_coord = 7.0 * (logx - logMidX) / (logMaxX - logMidX);
        let j = min(i32(knot_coord), 7);
        let t = knot_coord - f32(j);
        let cf = vec3<f32>(coefsHigh[j], coefsHigh[j + 1], coefsHigh[j + 2]);
        logy = dot(vec3<f32>(t * t, t, 1.0), ACES_SPLINE_M * cf);
    } else {
        logy = logx * 0.06 + (logMaxY - 0.06 * logMaxX);
    }

    return pow10(logy);
}

// ============================================================================
// ACES Display Helpers
// ============================================================================

// Normalize luminance from [Ymin, Ymax] to [0, 1]
fn aces_Y_2_linCV(Y: vec3<f32>, Ymax: f32, Ymin: f32) -> vec3<f32> {
    return (Y - Ymin) / (Ymax - Ymin);
}

// Dim surround compensation (dark cinema → dim monitor)
// Converts from dark surround viewing to dim surround viewing.
fn aces_darkSurround_to_dimSurround(linearCV: vec3<f32>) -> vec3<f32> {
    let XYZ = ACES_AP1_to_XYZ * linearCV;
    let divisor = max(dot(XYZ, vec3<f32>(1.0, 1.0, 1.0)), 1e-4);
    let xyY = vec3<f32>(XYZ.xy / divisor, XYZ.y);
    let Y_dim = pow(max(xyY.z, 0.0), ACES_DIM_SURROUND_GAMMA);
    let m = Y_dim / max(xyY.y, 1e-4);
    let XYZ_out = vec3<f32>(xyY.x * m, Y_dim, (1.0 - xyY.x - xyY.y) * m);
    return ACES_XYZ_to_AP1 * XYZ_out;
}

// ============================================================================
// ACES 1.3 ODT — Rec.709 100 nits (SDR)
// Input: RRT output in AP1
// Output: LINEAR Rec.709
// ============================================================================

fn ACES13_ODT_Rec709_100nits(rrtOutput: vec3<f32>) -> vec3<f32> {
    // ODT tone curve (48 nits cinema white)
    let rgbPost = vec3<f32>(
        aces_spline_c9_fwd_48nits(rrtOutput.r),
        aces_spline_c9_fwd_48nits(rrtOutput.g),
        aces_spline_c9_fwd_48nits(rrtOutput.b)
    );

    // Normalize to display range [CINEMA_BLACK, CINEMA_WHITE] → [0, 1]
    var linearCV = aces_Y_2_linCV(rgbPost, CINEMA_WHITE, CINEMA_BLACK);

    // Dim surround compensation (dark cinema → dim monitor)
    linearCV = aces_darkSurround_to_dimSurround(linearCV);

    // ODT desaturation
    linearCV = ODT_SAT_MAT * linearCV;

    // AP1 → Rec.709, clamped to [0, 1]
    return clamp(AP1_to_Rec709 * linearCV, vec3<f32>(0.0), vec3<f32>(1.0));
}

// ============================================================================
// ACES 1.3 ODT — Rec.2020 1000 nits (HDR)
// Input: RRT output in AP1
// Output: LINEAR Rec.2020 (normalized: 1.0 = 1000 nits)
// ============================================================================

fn ACES13_ODT_Rec2020_1000nits(rrtOutput: vec3<f32>) -> vec3<f32> {
    // ODT tone curve (1000 nits)
    let rgbPost = vec3<f32>(
        aces_spline_c9_fwd_1000nits(rrtOutput.r),
        aces_spline_c9_fwd_1000nits(rrtOutput.g),
        aces_spline_c9_fwd_1000nits(rrtOutput.b)
    );

    // Normalize to display range [0.0001, 1000] → [0, 1]
    var linearCV = aces_Y_2_linCV(rgbPost, 1000.0, 0.0001);

    // ODT desaturation (no dim surround for HDR viewing)
    linearCV = ODT_SAT_MAT * linearCV;

    // AP1 → Rec.2020, clamped to >= 0
    return max(AP1_to_Rec2020 * linearCV, vec3<f32>(0.0));
}

// ============================================================================
// ACES 2.0 ODT — Simple gamut conversion (no Hellwig CAM)
// Input: Normalized AP1 [0-1] from ACES20_RRT
// Output: LINEAR in target display gamut
// ============================================================================

fn ACES20_ODT_Rec709(ap1: vec3<f32>) -> vec3<f32> {
    return clamp(AP1_to_Rec709 * ap1, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn ACES20_ODT_Rec2020(ap1: vec3<f32>) -> vec3<f32> {
    return max(AP1_to_Rec2020 * ap1, vec3<f32>(0.0));
}

// ============================================================================
// ODT Target Routing Helper
// ============================================================================

// Returns true for Rec.2020 output targets
fn isRec2020Target(outputSpace: i32) -> bool {
    // Linear_Rec2020=1, PQ_Rec2020=6, HLG_Rec2020=7
    return outputSpace == 1 || outputSpace == 6 || outputSpace == 7;
}

// ============================================================================
// Fragment Shader
// ============================================================================

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
    let texCoord = vec2<i32>(in.uv * vec2<f32>(textureDimensions(inputTexture)));
    let tex0col = textureLoad(inputTexture, texCoord, 0);
    let color = tex0col.rgb;

    // Non-ACES operators (0,1,4-11): no-op passthrough
    // RRT already output Linear Rec.709 for these operators
    if (u.tonemapOp != 2 && u.tonemapOp != 3) {
        return tex0col;
    }

    // ACES 1.3 ODT: C9 spline + dim surround + desat + gamut convert
    if (u.tonemapOp == 2) {
        if (isRec2020Target(u.outputSpace)) {
            return vec4<f32>(ACES13_ODT_Rec2020_1000nits(color), tex0col.a);
        } else {
            return vec4<f32>(ACES13_ODT_Rec709_100nits(color), tex0col.a);
        }
    }

    // ACES 2.0 ODT: simple gamut matrix
    if (isRec2020Target(u.outputSpace)) {
        return vec4<f32>(ACES20_ODT_Rec2020(color), tex0col.a);
    } else {
        return vec4<f32>(ACES20_ODT_Rec709(color), tex0col.a);
    }
}
