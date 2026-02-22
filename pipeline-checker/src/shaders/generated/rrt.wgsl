// Stage 6: RRT (Reference Rendering Transform / Tonemap Curve)
// Source: TonemapOperators.sdsl + ACES13_RRT_ODT.sdsl + ACES20_RRT_ODT.sdsl
// ALL matrices TRANSPOSED for WGSL column-major layout.
//
// Input: Linear Rec.709 from Stage 5 (color grade).
// Output: Linear Rec.709 for operators 0,1,4-11; AP1 for operators 2,3 (ACES full pipeline).
// 12 tonemap operators: None, ACES Fit, ACES 1.3, ACES 2.0, AgX, Gran Turismo,
//   Uncharted 2, Khronos PBR, Lottes, Reinhard, Reinhard Extended, Hejl-Burgess.


// ============================================================================
// Uniforms — reads from shared PipelineUniforms buffer
// ============================================================================

struct Uniforms {
    // Stage 4 (not used)
    _inputSpace: i32,             // byte 0
    // Stage 5 scalars (not used)
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
    // Stage 5 vec3 fields (not used)
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
    tonemapExposure: f32,         // byte 184
    whitePoint: f32,              // byte 188
    paperWhite: f32,              // byte 192
    peakBrightness: f32,          // byte 196
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
// ACES Constants
// ============================================================================

// ACES 1.3 RRT
const RRT_GLOW_GAIN: f32 = 0.05;
const RRT_GLOW_MID: f32 = 0.08;
const RRT_RED_SCALE: f32 = 0.82;
const RRT_RED_PIVOT: f32 = 0.03;
const RRT_RED_HUE: f32 = 0.0;
const RRT_RED_WIDTH: f32 = 135.0;

// ACES 2.0 Daniele Evo
const DANIELE_N_R: f32 = 100.0;
const DANIELE_G: f32 = 1.15;
const DANIELE_C: f32 = 0.18;
const DANIELE_C_D: f32 = 10.013;
const DANIELE_W_G: f32 = 0.14;
const DANIELE_T_1: f32 = 0.04;
const DANIELE_R_HIT_MIN: f32 = 128.0;
const DANIELE_R_HIT_MAX: f32 = 896.0;

// ============================================================================
// Gamut Matrices — ALL TRANSPOSED from SDSL row-major to WGSL column-major
// ============================================================================

// Rec.709 → AP1 (includes D65→D60 Bradford)
const Rec709_to_AP1 = mat3x3<f32>(
    vec3<f32>( 0.6131324,  0.0701934,  0.0206155),
    vec3<f32>( 0.3395381,  0.9163539,  0.1095697),
    vec3<f32>( 0.0473296,  0.0134527,  0.8698148)
);

// AP1 → Rec.709 (includes D60→D65 Bradford)
const AP1_to_Rec709 = mat3x3<f32>(
    vec3<f32>( 1.7048586, -0.1300768, -0.0239640),
    vec3<f32>(-0.6217160,  1.1407357, -0.1289755),
    vec3<f32>(-0.0831426, -0.0106589,  1.1529395)
);

// AP0 → AP1
const ACES_AP0_to_AP1 = mat3x3<f32>(
    vec3<f32>( 1.4514393161, -0.0765537734,  0.0083161484),
    vec3<f32>(-0.2365107469,  1.1762296998, -0.0060324498),
    vec3<f32>(-0.2149285693, -0.0996759264,  0.9977163014)
);

// AP1 → AP0
const ACES_AP1_to_AP0 = mat3x3<f32>(
    vec3<f32>( 0.6954522414,  0.0447945634, -0.0055258826),
    vec3<f32>( 0.1406786965,  0.8596711185,  0.0040252103),
    vec3<f32>( 0.1638690622,  0.0955343182,  1.0015006723)
);

// Quadratic B-spline basis matrix
const ACES_SPLINE_M = mat3x3<f32>(
    vec3<f32>( 0.5, -1.0,  0.5),
    vec3<f32>(-1.0,  1.0,  0.5),
    vec3<f32>( 0.5,  0.0,  0.0)
);

// RRT desaturation (factor 0.96)
const RRT_SAT_MAT = mat3x3<f32>(
    vec3<f32>(0.9708890, 0.0108892, 0.0108892),
    vec3<f32>(0.0269633, 0.9869630, 0.0269633),
    vec3<f32>(0.00214758, 0.00214758, 0.96214800)
);

// ODT desaturation (factor 0.93)
const ODT_SAT_MAT = mat3x3<f32>(
    vec3<f32>(0.949056, 0.019056, 0.019056),
    vec3<f32>(0.0471857, 0.9771860, 0.0471857),
    vec3<f32>(0.00375827, 0.00375827, 0.93375800)
);

// ACES Fit: combined sRGB→AP1 + RRT_SAT (BT.709 path)
const ACESInputMat = mat3x3<f32>(
    vec3<f32>(0.59719, 0.07600, 0.02840),
    vec3<f32>(0.35458, 0.90834, 0.13383),
    vec3<f32>(0.04823, 0.01566, 0.83777)
);

// ACES Fit: combined ODT_SAT + AP1→sRGB (BT.709 path)
const ACESOutputMat = mat3x3<f32>(
    vec3<f32>( 1.60475, -0.10208, -0.00327),
    vec3<f32>(-0.53108,  1.10813, -0.07276),
    vec3<f32>(-0.07367, -0.00605,  1.07602)
);

// AgX: BT.709 → AgX primaries
const agx_mat = mat3x3<f32>(
    vec3<f32>(0.842479062253094,  0.0423282422610123, 0.0423756549057051),
    vec3<f32>(0.0784335999999992, 0.878468636469772,  0.0784336),
    vec3<f32>(0.0792237451477643, 0.0791661274605434, 0.879142973793104)
);

// AgX: AgX primaries → BT.709
const agx_mat_inv = mat3x3<f32>(
    vec3<f32>( 1.19687900512017,   -0.0980208811401368, -0.0990297440797205),
    vec3<f32>(-0.0528968517574562,  1.15190312990417,   -0.0989611768448433),
    vec3<f32>(-0.0529716355144438, -0.0980434501171241,  1.15107367264116)
);

// ============================================================================
// ACES 1.3 Helper Functions
// ============================================================================

fn aces_rgb_2_saturation(rgb: vec3<f32>) -> f32 {
    let mi = min(min(rgb.r, rgb.g), rgb.b);
    let ma = max(max(rgb.r, rgb.g), rgb.b);
    return (max(ma, 1e-4) - max(mi, 1e-4)) / max(ma, 1e-2);
}

fn aces_rgb_2_yc(rgb: vec3<f32>) -> f32 {
    let ycRadiusWeight = 1.75;
    let k = max(rgb.b * (rgb.b - rgb.g) + rgb.g * (rgb.g - rgb.r) + rgb.r * (rgb.r - rgb.b), 0.0);
    return (rgb.b + rgb.g + rgb.r + ycRadiusWeight * sqrt(k)) / 3.0;
}

fn aces_rgb_2_hue(rgb: vec3<f32>) -> f32 {
    var hue: f32;
    if (rgb.r == rgb.g && rgb.g == rgb.b) {
        hue = 0.0;
    } else {
        hue = (180.0 / 3.14159265) * atan2(
            sqrt(3.0) * (rgb.g - rgb.b),
            2.0 * rgb.r - rgb.g - rgb.b
        );
    }
    if (hue < 0.0) { hue += 360.0; }
    return hue;
}

fn aces_center_hue(hue: f32, centerH: f32) -> f32 {
    var h = hue - centerH;
    if (h < -180.0) { h += 360.0; }
    else if (h > 180.0) { h -= 360.0; }
    return h;
}

fn aces_sigmoid_shaper(x: f32) -> f32 {
    let t = max(1.0 - abs(x / 2.0), 0.0);
    return (1.0 + sign(x) * (1.0 - t * t)) / 2.0;
}

fn aces_glow_fwd(ycIn: f32, glowGainIn: f32, glowMid: f32) -> f32 {
    if (ycIn <= 2.0 / 3.0 * glowMid) {
        return glowGainIn;
    } else if (ycIn >= 2.0 * glowMid) {
        return 0.0;
    } else {
        return glowGainIn * (glowMid / ycIn - 0.5);
    }
}

// ============================================================================
// ACES 1.3 Segmented Spline C5 (RRT tone curve)
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
// ACES 1.3 RRT
// ============================================================================

// ACES 1.3 RRT
const RRT_GLOW_GAIN: f32 = 0.05;
const RRT_GLOW_MID: f32 = 0.08;
const RRT_RED_SCALE: f32 = 0.82;
const RRT_RED_PIVOT: f32 = 0.03;
const RRT_RED_HUE: f32 = 0.0;
const RRT_RED_WIDTH: f32 = 135.0;

// ============================================================================
// ACES 2.0 Daniele Evo Tonescale
// ============================================================================

// Gamut Matrices — ALL TRANSPOSED from SDSL row-major to WGSL column-major
// ============================================================================

// Rec.709 → AP1 (includes D65→D60 Bradford)
const Rec709_to_AP1 = mat3x3<f32>(
    vec3<f32>( 0.6131324,  0.0701934,  0.0206155),
    vec3<f32>( 0.3395381,  0.9163539,  0.1095697),
    vec3<f32>( 0.0473296,  0.0134527,  0.8698148)
);

// AP1 → Rec.709 (includes D60→D65 Bradford)
const AP1_to_Rec709 = mat3x3<f32>(
    vec3<f32>( 1.7048590, -0.1300768, -0.0239640),
    vec3<f32>(-0.6217160,  1.1407360, -0.1289755),
    vec3<f32>(-0.0831426, -0.0106589,  1.1529400)
);

// AP0 → AP1
const ACES_AP0_to_AP1 = mat3x3<f32>(
    vec3<f32>( 1.4514390, -0.0765538,  0.0083161),
    vec3<f32>(-0.2365108,  1.1762300, -0.0060325),
    vec3<f32>(-0.2149286, -0.0996759,  0.9977163)
);

// AP1 → AP0
const ACES_AP1_to_AP0 = mat3x3<f32>(
    vec3<f32>( 0.6954522,  0.0447946, -0.0055259),
    vec3<f32>( 0.1406787,  0.8596711,  0.0040252),
    vec3<f32>( 0.1638691,  0.0955343,  1.0015010)
);

// Quadratic B-spline basis matrix
const ACES_SPLINE_M = mat3x3<f32>(
    vec3<f32>( 0.5, -1.0,  0.5),
    vec3<f32>(-1.0,  1.0,  0.5),
    vec3<f32>( 0.5,  0.0,  0.0)
);

// RRT desaturation (factor 0.96)
const RRT_SAT_MAT = mat3x3<f32>(
    vec3<f32>(0.9708890, 0.0108892, 0.0108892),
    vec3<f32>(0.0269633, 0.9869630, 0.0269633),
    vec3<f32>(0.00214758, 0.00214758, 0.96214800)
);

// ODT desaturation (factor 0.93)
const ODT_SAT_MAT = mat3x3<f32>(
    vec3<f32>(0.949056, 0.019056, 0.019056),
    vec3<f32>(0.0471857, 0.9771860, 0.0471857),
    vec3<f32>(0.00375827, 0.00375827, 0.93375800)
);

// ACES Fit: combined sRGB→AP1 + RRT_SAT (BT.709 path)
const ACESInputMat = mat3x3<f32>(
    vec3<f32>(0.59719, 0.07600, 0.02840),
    vec3<f32>(0.35458, 0.90834, 0.13383),
    vec3<f32>(0.04823, 0.01566, 0.83777)
);

// ACES Fit: combined ODT_SAT + AP1→sRGB (BT.709 path)
const ACESOutputMat = mat3x3<f32>(
    vec3<f32>( 1.60475, -0.10208, -0.00327),
    vec3<f32>(-0.53108,  1.10813, -0.07276),
    vec3<f32>(-0.07367, -0.00605,  1.07602)
);

// AgX: BT.709 → AgX primaries
const agx_mat = mat3x3<f32>(
    vec3<f32>(0.842479062253094,  0.0423282422610123, 0.0423756549057051),
    vec3<f32>(0.0784335999999992, 0.878468636469772,  0.0784336),
    vec3<f32>(0.0792237451477643, 0.0791661274605434, 0.879142973793104)
);

// AgX: AgX primaries → BT.709
const agx_mat_inv = mat3x3<f32>(
    vec3<f32>( 1.19687900512017,   -0.0980208811401368, -0.0990297440797205),
    vec3<f32>(-0.0528968517574562,  1.15190312990417,   -0.0989611768448433),
    vec3<f32>(-0.0529716355144438, -0.0980434501171241,  1.15107367264116)
);

// ============================================================================
// ACES 1.3 Helper Functions
// ============================================================================

fn aces_rgb_2_saturation(rgb: vec3<f32>) -> f32 {
    let mi = min(min(rgb.r, rgb.g), rgb.b);
    let ma = max(max(rgb.r, rgb.g), rgb.b);
    return (max(ma, 1e-4) - max(mi, 1e-4)) / max(ma, 1e-2);
}

fn aces_rgb_2_yc(rgb: vec3<f32>) -> f32 {
    let ycRadiusWeight = 1.75;
    let k = max(rgb.b * (rgb.b - rgb.g) + rgb.g * (rgb.g - rgb.r) + rgb.r * (rgb.r - rgb.b), 0.0);
    return (rgb.b + rgb.g + rgb.r + ycRadiusWeight * sqrt(k)) / 3.0;
}

fn aces_rgb_2_hue(rgb: vec3<f32>) -> f32 {
    var hue: f32;
    if (rgb.r == rgb.g && rgb.g == rgb.b) {
        hue = 0.0;
    } else {
        hue = (180.0 / 3.14159265) * atan2(
            sqrt(3.0) * (rgb.g - rgb.b),
            2.0 * rgb.r - rgb.g - rgb.b
        );
    }
    if (hue < 0.0) { hue += 360.0; }
    return hue;
}

fn aces_center_hue(hue: f32, centerH: f32) -> f32 {
    var h = hue - centerH;
    if (h < -180.0) { h += 360.0; }
    else if (h > 180.0) { h -= 360.0; }
    return h;
}

fn aces_sigmoid_shaper(x: f32) -> f32 {
    let t = max(1.0 - abs(x / 2.0), 0.0);
    return (1.0 + sign(x) * (1.0 - t * t)) / 2.0;
}

fn aces_glow_fwd(ycIn: f32, glowGainIn: f32, glowMid: f32) -> f32 {
    if (ycIn <= 2.0 / 3.0 * glowMid) {
        return glowGainIn;
    } else if (ycIn >= 2.0 * glowMid) {
        return 0.0;
    } else {
        return glowGainIn * (glowMid / ycIn - 0.5);
    }
}

// ============================================================================
// ACES 1.3 Segmented Spline C5 (RRT tone curve)
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
// ACES 1.3 RRT
// ============================================================================

// ACES 1.3 RRT
const RRT_GLOW_GAIN: f32 = 0.05;
const RRT_GLOW_MID: f32 = 0.08;
const RRT_RED_SCALE: f32 = 0.82;
const RRT_RED_PIVOT: f32 = 0.03;
const RRT_RED_HUE: f32 = 0.0;
const RRT_RED_WIDTH: f32 = 135.0;

// ============================================================================
// ACES 2.0 Daniele Evo Tonescale
// ============================================================================

// Gamut Matrices — ALL TRANSPOSED from SDSL row-major to WGSL column-major
// ============================================================================

// Rec.709 → AP1 (includes D65→D60 Bradford)
const Rec709_to_AP1 = mat3x3<f32>(
    vec3<f32>( 0,6131324,  0,0701934,  0,0206155),
    vec3<f32>( 0,3395381,  0,9163539,  0,1095697),
    vec3<f32>( 0,0473296,  0,0134527,  0,8698148)
);

// AP1 → Rec.709 (includes D60→D65 Bradford)
const AP1_to_Rec709 = mat3x3<f32>(
    vec3<f32>( 1,7048590, -0,1300768, -0,0239640),
    vec3<f32>(-0,6217160,  1,1407360, -0,1289755),
    vec3<f32>(-0,0831426, -0,0106589,  1,1529400)
);

// AP0 → AP1
const ACES_AP0_to_AP1 = mat3x3<f32>(
    vec3<f32>( 1,4514390, -0,0765538,  0,0083161),
    vec3<f32>(-0,2365108,  1,1762300, -0,0060325),
    vec3<f32>(-0,2149286, -0,0996759,  0,9977163)
);

// AP1 → AP0
const ACES_AP1_to_AP0 = mat3x3<f32>(
    vec3<f32>( 0,6954522,  0,0447946, -0,0055259),
    vec3<f32>( 0,1406787,  0,8596711,  0,0040252),
    vec3<f32>( 0,1638691,  0,0955343,  1,0015010)
);

// Quadratic B-spline basis matrix
const ACES_SPLINE_M = mat3x3<f32>(
    vec3<f32>( 0.5, -1.0,  0.5),
    vec3<f32>(-1.0,  1.0,  0.5),
    vec3<f32>( 0.5,  0.0,  0.0)
);

// RRT desaturation (factor 0.96)
const RRT_SAT_MAT = mat3x3<f32>(
    vec3<f32>(0.9708890, 0.0108892, 0.0108892),
    vec3<f32>(0.0269633, 0.9869630, 0.0269633),
    vec3<f32>(0.00214758, 0.00214758, 0.96214800)
);

// ODT desaturation (factor 0.93)
const ODT_SAT_MAT = mat3x3<f32>(
    vec3<f32>(0.949056, 0.019056, 0.019056),
    vec3<f32>(0.0471857, 0.9771860, 0.0471857),
    vec3<f32>(0.00375827, 0.00375827, 0.93375800)
);

// ACES Fit: combined sRGB→AP1 + RRT_SAT (BT.709 path)
const ACESInputMat = mat3x3<f32>(
    vec3<f32>(0.59719, 0.07600, 0.02840),
    vec3<f32>(0.35458, 0.90834, 0.13383),
    vec3<f32>(0.04823, 0.01566, 0.83777)
);

// ACES Fit: combined ODT_SAT + AP1→sRGB (BT.709 path)
const ACESOutputMat = mat3x3<f32>(
    vec3<f32>( 1.60475, -0.10208, -0.00327),
    vec3<f32>(-0.53108,  1.10813, -0.07276),
    vec3<f32>(-0.07367, -0.00605,  1.07602)
);

// AgX: BT.709 → AgX primaries
const agx_mat = mat3x3<f32>(
    vec3<f32>(0.842479062253094,  0.0423282422610123, 0.0423756549057051),
    vec3<f32>(0.0784335999999992, 0.878468636469772,  0.0784336),
    vec3<f32>(0.0792237451477643, 0.0791661274605434, 0.879142973793104)
);

// AgX: AgX primaries → BT.709
const agx_mat_inv = mat3x3<f32>(
    vec3<f32>( 1.19687900512017,   -0.0980208811401368, -0.0990297440797205),
    vec3<f32>(-0.0528968517574562,  1.15190312990417,   -0.0989611768448433),
    vec3<f32>(-0.0529716355144438, -0.0980434501171241,  1.15107367264116)
);

// ============================================================================
// ACES 1.3 Helper Functions
// ============================================================================

fn aces_rgb_2_saturation(rgb: vec3<f32>) -> f32 {
    let mi = min(min(rgb.r, rgb.g), rgb.b);
    let ma = max(max(rgb.r, rgb.g), rgb.b);
    return (max(ma, 1e-4) - max(mi, 1e-4)) / max(ma, 1e-2);
}

fn aces_rgb_2_yc(rgb: vec3<f32>) -> f32 {
    let ycRadiusWeight = 1.75;
    let k = max(rgb.b * (rgb.b - rgb.g) + rgb.g * (rgb.g - rgb.r) + rgb.r * (rgb.r - rgb.b), 0.0);
    return (rgb.b + rgb.g + rgb.r + ycRadiusWeight * sqrt(k)) / 3.0;
}

fn aces_rgb_2_hue(rgb: vec3<f32>) -> f32 {
    var hue: f32;
    if (rgb.r == rgb.g && rgb.g == rgb.b) {
        hue = 0.0;
    } else {
        hue = (180.0 / 3.14159265) * atan2(
            sqrt(3.0) * (rgb.g - rgb.b),
            2.0 * rgb.r - rgb.g - rgb.b
        );
    }
    if (hue < 0.0) { hue += 360.0; }
    return hue;
}

fn aces_center_hue(hue: f32, centerH: f32) -> f32 {
    var h = hue - centerH;
    if (h < -180.0) { h += 360.0; }
    else if (h > 180.0) { h -= 360.0; }
    return h;
}

fn aces_sigmoid_shaper(x: f32) -> f32 {
    let t = max(1.0 - abs(x / 2.0), 0.0);
    return (1.0 + sign(x) * (1.0 - t * t)) / 2.0;
}

fn aces_glow_fwd(ycIn: f32, glowGainIn: f32, glowMid: f32) -> f32 {
    if (ycIn <= 2.0 / 3.0 * glowMid) {
        return glowGainIn;
    } else if (ycIn >= 2.0 * glowMid) {
        return 0.0;
    } else {
        return glowGainIn * (glowMid / ycIn - 0.5);
    }
}

// ============================================================================
// ACES 1.3 Segmented Spline C5 (RRT tone curve)
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
// ACES 1.3 RRT
// ============================================================================

// ACES 1.3 RRT
const RRT_GLOW_GAIN: f32 = 0.05;
const RRT_GLOW_MID: f32 = 0.08;
const RRT_RED_SCALE: f32 = 0.82;
const RRT_RED_PIVOT: f32 = 0.03;
const RRT_RED_HUE: f32 = 0.0;
const RRT_RED_WIDTH: f32 = 135.0;

// ============================================================================
// ACES 2.0 Daniele Evo Tonescale
// ============================================================================

// Gamut Matrices — ALL TRANSPOSED from SDSL row-major to WGSL column-major
// ============================================================================

// Rec.709 → AP1 (includes D65→D60 Bradford)
const Rec709_to_AP1 = mat3x3<f32>(
    vec3<f32>(0.6131324, 0.0701934, 0.0206155),
    vec3<f32>(0.3395381, 0.9163539, 0.1095697),
    vec3<f32>(0.0473296, 0.0134527, 0.8698148)
);

// AP1 → Rec.709 (includes D60→D65 Bradford)
const AP1_to_Rec709 = mat3x3<f32>(
    vec3<f32>( 1.7048586, -0.1300768, -0.0239640),
    vec3<f32>(-0.6217160,  1.1407357, -0.1289755),
    vec3<f32>(-0.0831426, -0.0106589,  1.1529395)
);

// AP0 → AP1
const ACES_AP0_to_AP1 = mat3x3<f32>(
    vec3<f32>( 1.4514393161, -0.0765537734,  0.0083161484),
    vec3<f32>(-0.2365107469,  1.1762296998, -0.0060324498),
    vec3<f32>(-0.2149285693, -0.0996759264,  0.9977163014)
);

// AP1 → AP0
const ACES_AP1_to_AP0 = mat3x3<f32>(
    vec3<f32>( 0.6954522414,  0.0447945634, -0.0055258826),
    vec3<f32>( 0.1406786965,  0.8596711185,  0.0040252103),
    vec3<f32>( 0.1638690622,  0.0955343182,  1.0015006723)
);

// Quadratic B-spline basis matrix
const ACES_SPLINE_M = mat3x3<f32>(
    vec3<f32>( 0.5, -1.0,  0.5),
    vec3<f32>(-1.0,  1.0,  0.5),
    vec3<f32>( 0.5,  0.0,  0.0)
);

// RRT desaturation (factor 0.96)
const RRT_SAT_MAT = mat3x3<f32>(
    vec3<f32>(0.9708890, 0.0108892, 0.0108892),
    vec3<f32>(0.0269633, 0.9869630, 0.0269633),
    vec3<f32>(0.00214758, 0.00214758, 0.96214800)
);

// ODT desaturation (factor 0.93)
const ODT_SAT_MAT = mat3x3<f32>(
    vec3<f32>(0.949056, 0.019056, 0.019056),
    vec3<f32>(0.0471857, 0.9771860, 0.0471857),
    vec3<f32>(0.00375827, 0.00375827, 0.93375800)
);

// ACES Fit: combined sRGB→AP1 + RRT_SAT (BT.709 path)
const ACESInputMat = mat3x3<f32>(
    vec3<f32>(0.59719, 0.07600, 0.02840),
    vec3<f32>(0.35458, 0.90834, 0.13383),
    vec3<f32>(0.04823, 0.01566, 0.83777)
);

// ACES Fit: combined ODT_SAT + AP1→sRGB (BT.709 path)
const ACESOutputMat = mat3x3<f32>(
    vec3<f32>( 1.60475, -0.10208, -0.00327),
    vec3<f32>(-0.53108,  1.10813, -0.07276),
    vec3<f32>(-0.07367, -0.00605,  1.07602)
);

// AgX: BT.709 → AgX primaries
const agx_mat = mat3x3<f32>(
    vec3<f32>(0.842479062253094,  0.0423282422610123, 0.0423756549057051),
    vec3<f32>(0.0784335999999992, 0.878468636469772,  0.0784336),
    vec3<f32>(0.0792237451477643, 0.0791661274605434, 0.879142973793104)
);

// AgX: AgX primaries → BT.709
const agx_mat_inv = mat3x3<f32>(
    vec3<f32>( 1.19687900512017,   -0.0980208811401368, -0.0990297440797205),
    vec3<f32>(-0.0528968517574562,  1.15190312990417,   -0.0989611768448433),
    vec3<f32>(-0.0529716355144438, -0.0980434501171241,  1.15107367264116)
);

// ============================================================================
// ACES 1.3 Helper Functions
// ============================================================================

fn aces_rgb_2_saturation(rgb: vec3<f32>) -> f32 {
    let mi = min(min(rgb.r, rgb.g), rgb.b);
    let ma = max(max(rgb.r, rgb.g), rgb.b);
    return (max(ma, 1e-4) - max(mi, 1e-4)) / max(ma, 1e-2);
}

fn aces_rgb_2_yc(rgb: vec3<f32>) -> f32 {
    let ycRadiusWeight = 1.75;
    let k = max(rgb.b * (rgb.b - rgb.g) + rgb.g * (rgb.g - rgb.r) + rgb.r * (rgb.r - rgb.b), 0.0);
    return (rgb.b + rgb.g + rgb.r + ycRadiusWeight * sqrt(k)) / 3.0;
}

fn aces_rgb_2_hue(rgb: vec3<f32>) -> f32 {
    var hue: f32;
    if (rgb.r == rgb.g && rgb.g == rgb.b) {
        hue = 0.0;
    } else {
        hue = (180.0 / 3.14159265) * atan2(
            sqrt(3.0) * (rgb.g - rgb.b),
            2.0 * rgb.r - rgb.g - rgb.b
        );
    }
    if (hue < 0.0) { hue += 360.0; }
    return hue;
}

fn aces_center_hue(hue: f32, centerH: f32) -> f32 {
    var h = hue - centerH;
    if (h < -180.0) { h += 360.0; }
    else if (h > 180.0) { h -= 360.0; }
    return h;
}

fn aces_sigmoid_shaper(x: f32) -> f32 {
    let t = max(1.0 - abs(x / 2.0), 0.0);
    return (1.0 + sign(x) * (1.0 - t * t)) / 2.0;
}

fn aces_glow_fwd(ycIn: f32, glowGainIn: f32, glowMid: f32) -> f32 {
    if (ycIn <= 2.0 / 3.0 * glowMid) {
        return glowGainIn;
    } else if (ycIn >= 2.0 * glowMid) {
        return 0.0;
    } else {
        return glowGainIn * (glowMid / ycIn - 0.5);
    }
}

// ============================================================================
// ACES 1.3 Segmented Spline C5 (RRT tone curve)
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
// ACES 1.3 RRT
// Input: ACEScg (linear AP1)
// Output: RRT-processed values in AP1 (ready for ODT in Stage 7)
// ============================================================================

fn ACES13_RRT(acescg: vec3<f32>) -> vec3<f32> {
    // Convert AP1 → AP0 for glow and red modifier
    var aces = ACES_AP1_to_AP0 * acescg;

    // Glow module: boost colorfulness in darks
    let sat = aces_rgb_2_saturation(aces);
    let ycIn = aces_rgb_2_yc(aces);
    let s = aces_sigmoid_shaper((sat - 0.4) / 0.2);
    let addedGlow = 1.0 + aces_glow_fwd(ycIn, RRT_GLOW_GAIN * s, RRT_GLOW_MID);
    aces *= addedGlow;

    // Red modifier: reduce over-saturated reds
    let hue = aces_rgb_2_hue(aces);
    let centeredHue = aces_center_hue(hue, RRT_RED_HUE);
    var hueWeight = smoothstep(0.0, 1.0, 1.0 - abs(2.0 * centeredHue / RRT_RED_WIDTH));
    hueWeight *= hueWeight;
    aces.r += hueWeight * sat * (RRT_RED_PIVOT - aces.r) * (1.0 - RRT_RED_SCALE);

    // Convert AP0 → AP1, clamp negatives
    var rgbPre = max(ACES_AP0_to_AP1 * max(aces, vec3<f32>(0.0)), vec3<f32>(0.0));

    // RRT desaturation
    rgbPre = RRT_SAT_MAT * rgbPre;

    // RRT tone curve (C5 spline, per channel)
    return vec3<f32>(
        aces_spline_c5_fwd(rgbPre.r),
        aces_spline_c5_fwd(rgbPre.g),
        aces_spline_c5_fwd(rgbPre.b)
    );
}

// ============================================================================
// ACES 2.0 Daniele Evo Tonescale
// ============================================================================

// Derives tonescale parameters from peak luminance.
// Returns vec4(s_2, u_2, m_2, t_1).
fn aces20_tonescale_init(peakLuminance: f32) -> vec4<f32> {
    let n = peakLuminance;
    let n_r = DANIELE_N_R;
    let g = DANIELE_G;
    let t_1 = DANIELE_T_1;

    let r_hit = DANIELE_R_HIT_MIN + (DANIELE_R_HIT_MAX - DANIELE_R_HIT_MIN)
              * (log2(n / n_r) / log2(10000.0 / 100.0));

    let m_0 = n / n_r;
    let m_1 = 0.5 * (m_0 + sqrt(m_0 * (m_0 + 4.0 * t_1)));
    let u_val = pow((r_hit / m_1) / ((r_hit / m_1) + 1.0), g);
    let w_i = log2(n / 100.0);
    let c_t = DANIELE_C_D / n_r * (1.0 + w_i * DANIELE_W_G);
    let g_ip = 0.5 * (c_t + sqrt(c_t * (c_t + 4.0 * t_1)));
    let ratio = pow(g_ip / (m_1 / u_val), 1.0 / g);
    let g_ipp2 = -m_1 * ratio / (ratio - 1.0);
    let w_2 = DANIELE_C / g_ipp2;
    let s_2 = w_2 * m_1;
    let u_2 = pow((r_hit / m_1) / ((r_hit / m_1) + w_2), g);
    let m_2 = m_1 / u_2;

    return vec4<f32>(s_2, u_2, m_2, t_1);
}

// Per-channel tonescale forward.
// tsP = output of aces20_tonescale_init().
fn aces20_tonescale_fwd(x: f32, tsP: vec4<f32>) -> f32 {
    let s_2 = tsP.x;
    let m_2 = tsP.z;
    let g = DANIELE_G;
    let t_1 = tsP.w;

    let f = m_2 * pow(max(0.0, x) / (x + s_2), g);
    let h = max(0.0, f * f / (f + t_1));
    return h * DANIELE_N_R;
}

// Input: ACEScg (linear AP1), peakLuminance in nits
// Output: Normalized AP1 [0-1] where 1.0 = peakLuminance
fn ACES20_RRT(acescg: vec3<f32>, peakLuminance: f32) -> vec3<f32> {
    let tsP = aces20_tonescale_init(peakLuminance);
    let tonemapped = vec3<f32>(
        aces20_tonescale_fwd(acescg.r, tsP),
        aces20_tonescale_fwd(acescg.g, tsP),
        aces20_tonescale_fwd(acescg.b, tsP)
    );
    return tonemapped / peakLuminance;
}

// ============================================================================
// ACES Fit Tonemap (Stephen Hill / BakingLab)
// ============================================================================

fn ACESTonemap(color: vec3<f32>, inputSpace: i32) -> vec3<f32> {
    var v: vec3<f32>;
    if (inputSpace == 2) {
        // ACEScg: direct AP1 path (RRT saturation only)
        v = RRT_SAT_MAT * color;
    } else {
        // BT.709: combined gamut conversion + RRT saturation
        v = ACESInputMat * color;
    }

    // RRT+ODT curve
    let a = v * (v + 0.0245786) - 0.000090537;
    let b = v * (0.983729 * v + 0.4329510) + 0.238081;
    v = a / b;

    if (inputSpace == 2) {
        v = ODT_SAT_MAT * v;
        return clamp(AP1_to_Rec709 * v, vec3<f32>(0.0), vec3<f32>(1.0));
    } else {
        return clamp(ACESOutputMat * v, vec3<f32>(0.0), vec3<f32>(1.0));
    }
}

// ============================================================================
// Reinhard Tonemap
// ============================================================================

fn ReinhardTonemap(color: vec3<f32>) -> vec3<f32> {
    return color / (color + 1.0);
}

// ============================================================================
// Reinhard Extended Tonemap
// ============================================================================

fn ReinhardExtendedTonemap(color: vec3<f32>, wp: f32) -> vec3<f32> {
    let numerator = color * (1.0 + color / (wp * wp));
    return numerator / (1.0 + color);
}

// ============================================================================
// Uncharted 2 / Hable Filmic Tonemap
// ============================================================================

fn Uncharted2Tonemap(color: vec3<f32>) -> vec3<f32> {
    let A = 0.15;  // Shoulder strength
    let B = 0.50;  // Linear strength
    let C = 0.10;  // Linear angle
    let D = 0.20;  // Toe strength
    let E = 0.02;  // Toe numerator
    let F = 0.30;  // Toe denominator
    let W = 11.2;  // Linear white point

    let curr = ((color * (A * color + C * B) + D * E) / (color * (A * color + B) + D * F)) - E / F;
    let whiteScale = 1.0 / (((W * (A * W + C * B) + D * E) / (W * (A * W + B) + D * F)) - E / F);
    return curr * whiteScale;
}

// ============================================================================
// Khronos PBR Neutral Tonemap
// ============================================================================

fn KhronosPBRTonemap(color_in: vec3<f32>) -> vec3<f32> {
    var color = max(color_in, vec3<f32>(0.0));
    let startCompression = 0.8 - 0.04;
    let desaturation = 0.15;

    let x = min(color.r, min(color.g, color.b));
    var offset_val: f32;
    if (x < 0.08) { offset_val = x - 6.25 * x * x; } else { offset_val = 0.04; }
    color -= offset_val;

    let peak = max(color.r, max(color.g, color.b));
    if (peak < startCompression) {
        return color;
    }

    let d = 1.0 - startCompression;
    let newPeak = 1.0 - d * d / (peak + d - startCompression);
    color *= newPeak / peak;

    let g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
    return mix(color, vec3<f32>(newPeak), g);
}

// ============================================================================
// Hejl-Burgess Tonemap
// ============================================================================

fn HejlBurgessTonemap(color_in: vec3<f32>) -> vec3<f32> {
    let color = max(color_in - 0.004, vec3<f32>(0.0));
    let display = (color * (6.2 * color + 0.5)) / (color * (6.2 * color + 1.7) + 0.06);
    return pow(display, vec3<f32>(2.2));
}

// ============================================================================
// Gran Turismo / Uchimura Tonemap
// ============================================================================

fn GranTurismoTonemap(color: vec3<f32>) -> vec3<f32> {
    let P = 1.0;   // Max display brightness
    let a = 1.0;   // Contrast
    let m = 0.22;  // Linear section start
    let l = 0.4;   // Linear section length
    let c = 1.33;  // Black tightness
    let b = 0.0;   // Pedestal

    let l0 = ((P - m) * l) / a;
    let S0 = m + l0;
    let S1 = m + a * l0;
    let C2 = (a * P) / (P - S1);
    let CP = -C2 / P;

    let w0 = 1.0 - smoothstep(vec3<f32>(0.0), vec3<f32>(m), color);
    let w2 = step(vec3<f32>(m + l0), color);
    let w1 = 1.0 - w0 - w2;

    let T = m * pow(max(color / m, vec3<f32>(0.0)), vec3<f32>(c)) + b;
    let S = P - (P - S1) * exp(CP * (color - S0));
    let L = m + a * (color - m);

    return T * w0 + L * w1 + S * w2;
}

// ============================================================================
// Lottes Tonemap
// ============================================================================

fn LottesTonemap(color: vec3<f32>) -> vec3<f32> {
    let a = 1.6;
    let d = 0.977;
    let hdrMax = 8.0;

    let lumaCoeff = vec3<f32>(0.2126, 0.7152, 0.0722);
    let luma = dot(color, lumaCoeff);
    var toneMappedLuma = (luma * (1.0 + luma / (hdrMax * hdrMax))) / (1.0 + luma);
    toneMappedLuma = pow(toneMappedLuma, d);

    return color * (toneMappedLuma / max(luma, 1e-5));
}

// ============================================================================
// AgX Tonemap (Troy Sobotka, exact analytical sigmoid)
// ============================================================================

fn AgXSigmoid(v: vec3<f32>) -> vec3<f32> {
    let threshold = 0.6060606060606061;  // 20/33
    let a_up = 69.86278913545539;
    let a_down = 59.507875;
    let b_up = 3.25;
    let b_down = 3.0;
    let c_up = -0.30769230769230771;
    let c_down = -0.33333333333333333;

    let mask = step(v, vec3<f32>(threshold));
    let a_val = a_up + (a_down - a_up) * mask;
    let b_val = b_up + (b_down - b_up) * mask;
    let c_val = c_up + (c_down - c_up) * mask;

    return vec3<f32>(0.5) + (2.0 * v - 2.0 * threshold)
         * pow(vec3<f32>(1.0) + a_val * pow(abs(v - threshold), b_val), c_val);
}

fn AgXTonemap(color_in: vec3<f32>) -> vec3<f32> {
    let min_ev = -12.47393;
    let max_ev = 4.026069;
    let dynamic_range = max_ev - min_ev;

    // Apply inset matrix (compress primaries toward achromatic)
    var color = agx_mat * color_in;

    // Log2 encoding, normalize to [0, 1]
    color = clamp(log2(max(color, vec3<f32>(1e-10))), vec3<f32>(min_ev), vec3<f32>(max_ev));
    color = (color - min_ev) / dynamic_range;

    // Exact analytical sigmoid
    color = AgXSigmoid(color);

    // Outset matrix (expand chromaticity back out)
    color = agx_mat_inv * color;

    // Linearize (sigmoid outputs gamma 2.2 encoded)
    return pow(max(color, vec3<f32>(0.0)), vec3<f32>(2.2));
}

// ============================================================================
// Tonemap Dispatcher
// ============================================================================

fn ApplyTonemap(color: vec3<f32>, op: i32, exposure: f32, wp: f32) -> vec3<f32> {
    let c = color * exp2(exposure);

    if (op == 0)  { return c; }                                  // None
    if (op == 1)  { return ACESTonemap(c, 0); }                  // ACES Fit (BT.709)
    if (op == 4)  { return AgXTonemap(c); }                      // AgX
    if (op == 5)  { return GranTurismoTonemap(c); }              // Gran Turismo
    if (op == 6)  { return Uncharted2Tonemap(c); }               // Uncharted 2
    if (op == 7)  { return KhronosPBRTonemap(c); }               // Khronos PBR
    if (op == 8)  { return LottesTonemap(c); }                   // Lottes
    if (op == 9)  { return ReinhardTonemap(c); }                 // Reinhard
    if (op == 10) { return ReinhardExtendedTonemap(c, wp); }     // Reinhard Extended
    if (op == 11) { return HejlBurgessTonemap(c); }              // Hejl-Burgess
    return c;                                                     // Fallback
}

// ============================================================================
// Fragment Shader
// ============================================================================




@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
    let texCoord = vec2<i32>(in.uv * vec2<f32>(textureDimensions(inputTexture)));
    let tex0col = textureLoad(inputTexture, texCoord, 0);
    let color = tex0col.rgb;

    // ACES 1.3/2.0: full RRT pipeline, output AP1 for Stage 7 ODT
    if (u.tonemapOp == 2 || u.tonemapOp == 3) {
        // Convert Linear Rec.709 → AP1
        var acescg = Rec709_to_AP1 * color;
        acescg *= exp2(u.tonemapExposure);

        var result: vec3<f32>;
        if (u.tonemapOp == 2) {
            result = ACES13_RRT(acescg);
        } else {
            result = ACES20_RRT(acescg, u.peakBrightness);
        }
        return vec4<f32>(result, tex0col.a);
    }

    // All other operators: dispatch → Linear Rec.709
    let result = ApplyTonemap(color, u.tonemapOp, u.tonemapExposure, u.whitePoint);
    return vec4<f32>(result, tex0col.a);
}
