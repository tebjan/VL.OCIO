// Stage 8: Output Encoding
// Source: ColorSpaceConversion.sdsl (FromLinearRec709) + HDRTonemap.sdsl (output section)
// ALL matrices TRANSPOSED for WGSL column-major layout.
//
// Input: Linear Rec.709 (standard) or display-linear in target gamut (ACES 1.3/2.0).
// Output: Encoded values in target color space.
//
// Standard path (tonemapOp 0,1,4-11): FromLinearRec709 for spaces 0-5, HDR for 6-8.
// ACES path (tonemapOp 2,3): ODT already output display-linear in correct gamut,
//   skip gamut conversion, apply only transfer function.


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
    _tonemapExposure: f32,        // byte 184
    _whitePoint: f32,             // byte 188
    paperWhite: f32,              // byte 192
    peakBrightness: f32,          // byte 196
};

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> u: Uniforms;

// ============================================================================
// Constants
// ============================================================================

// ACEScct constants
const ACEScct_A: f32 = 10.5402377416545;
const ACEScct_B: f32 = 0.0729055341958355;
const ACEScct_CUT_LINEAR: f32 = 0.0078125;

// PQ (ST.2084) constants
const PQ_m1: f32 = 0.1593017578125;
const PQ_m2: f32 = 78.84375;
const PQ_c1: f32 = 0.8359375;
const PQ_c2: f32 = 18.8515625;
const PQ_c3: f32 = 18.6875;
const PQ_MAX_NITS: f32 = 10000.0;

// HLG (BT.2100) constants
const HLG_a: f32 = 0.17883277;
const HLG_b: f32 = 0.28466892;
const HLG_c: f32 = 0.55991073;

// ============================================================================
// Gamut Matrices — TRANSPOSED from SDSL row-major to WGSL column-major
// ============================================================================

// Rec.709 → Rec.2020
const Rec709_to_Rec2020 = mat3x3<f32>(
    vec3<f32>( 0.6274039,  0.0690973,  0.0163914),
    vec3<f32>( 0.3292830,  0.9195404,  0.0880133),
    vec3<f32>( 0.0433131,  0.0113623,  0.8955953)
);

// Rec.709 → AP1 (includes D65→D60 Bradford)
const Rec709_to_AP1 = mat3x3<f32>(
    vec3<f32>( 0.6131324,  0.0701934,  0.0206155),
    vec3<f32>( 0.3395381,  0.9163539,  0.1095697),
    vec3<f32>( 0.0473296,  0.0134527,  0.8698148)
);


// ============================================================================
// Transfer Functions — Encode (Linear → Encoded)
// ============================================================================

// IEC 61966-2-1 (sRGB) — per channel
fn LinearToSRGB_ch(l: f32) -> f32 {
    if (l <= 0.0031308) { return l * 12.92; }
    return 1.055 * pow(l, 1.0 / 2.4) - 0.055;
}

fn LinearToSRGB(lin: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
        LinearToSRGB_ch(lin.r),
        LinearToSRGB_ch(lin.g),
        LinearToSRGB_ch(lin.b)
    );
}

// ACES S-2014-003 (ACEScc) — log2 encode
fn LinearToACEScc(lin: vec3<f32>) -> vec3<f32> {
    let linClamped = max(lin, vec3<f32>(1e-10));
    return (log2(linClamped) + 9.72) / 17.52;
}

// ACES S-2016-001 (ACEScct) — branchless log/linear with toe
fn LinearToACEScct(lin: vec3<f32>) -> vec3<f32> {
    let linClamped = max(lin, vec3<f32>(1e-10));
    let linearSeg = ACEScct_A * linClamped + ACEScct_B;
    let logSeg = (log2(linClamped) + 9.72) / 17.52;
    let useLog = step(vec3<f32>(ACEScct_CUT_LINEAR), linClamped);
    return mix(linearSeg, logSeg, useLog);
}

// SMPTE ST 2084 (PQ) — normalized input [0-1] where 1.0 = 10000 nits
fn LinearToPQ(L: vec3<f32>) -> vec3<f32> {
    let Y = max(L, vec3<f32>(0.0));
    let Ym1 = pow(Y, vec3<f32>(PQ_m1));
    return pow((PQ_c1 + PQ_c2 * Ym1) / (1.0 + PQ_c3 * Ym1), vec3<f32>(PQ_m2));
}

// ITU-R BT.2100 (HLG) — branchless sqrt/log
fn LinearToHLG(L: vec3<f32>) -> vec3<f32> {
    let Lc = max(L, vec3<f32>(0.0));
    let sqrtSeg = sqrt(3.0 * Lc);
    let logSeg = HLG_a * log(max(12.0 * Lc - HLG_b, vec3<f32>(1e-10))) + HLG_c;
    let useLog = step(vec3<f32>(1.0 / 12.0), Lc);
    return mix(sqrtSeg, logSeg, useLog);
}

// ============================================================================
// FromLinearRec709 — standard non-HDR output encoding (spaces 0-5)
// ============================================================================

fn FromLinearRec709(color: vec3<f32>, space: i32) -> vec3<f32> {
    if (space == 0) { return color; }                                                          // Linear Rec.709
    if (space == 1) { return Rec709_to_Rec2020 * color; }                                      // Linear Rec.2020
    if (space == 2) { return Rec709_to_AP1 * color; }                                          // ACEScg
    if (space == 3) { return LinearToACEScc(Rec709_to_AP1 * color); }                          // ACEScc
    if (space == 4) { return LinearToACEScct(Rec709_to_AP1 * color); }                         // ACEScct
    if (space == 5) { return LinearToSRGB(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0))); }     // sRGB
    return color;
}

// ============================================================================
// Helpers
// ============================================================================

fn isRec2020Target(outputSpace: i32) -> bool {
    return outputSpace == 1 || outputSpace == 6 || outputSpace == 7;
}

// Derive ACES peak luminance for PQ/scRGB encoding
fn getACESPeakNits(tonemapOp: i32, outputSpace: i32, peakBrightness: f32) -> f32 {
    if (tonemapOp == 2) { // ACES 1.3: fixed peak from ODT variant
        if (isRec2020Target(outputSpace)) { return 1000.0; }
        return 100.0;
    }
    return peakBrightness; // ACES 2.0: user-defined peak
}

// ============================================================================
// Fragment Shader
// ============================================================================




@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
    let texCoord = vec2<i32>(in.uv * vec2<f32>(textureDimensions(inputTexture)));
    let tex0col = textureLoad(inputTexture, texCoord, 0);
    let color = tex0col.rgb;

    // ----------------------------------------------------------------
    // ACES 1.3/2.0 special path: ODT already output display-linear
    // in the correct gamut. Skip gamut conversion, apply only OETF.
    // ----------------------------------------------------------------
    if (u.tonemapOp == 2 || u.tonemapOp == 3) {
        if (u.outputSpace == 5) { // sRGB
            return vec4<f32>(LinearToSRGB(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0))), tex0col.a);
        }
        if (u.outputSpace == 6) { // PQ Rec.2020
            let peakNits = getACESPeakNits(u.tonemapOp, u.outputSpace, u.peakBrightness);
            return vec4<f32>(LinearToPQ(clamp(color * peakNits / PQ_MAX_NITS, vec3<f32>(0.0), vec3<f32>(1.0))), tex0col.a);
        }
        if (u.outputSpace == 7) { // HLG Rec.2020
            return vec4<f32>(LinearToHLG(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0))), tex0col.a);
        }
        if (u.outputSpace == 8) { // scRGB
            let peakNits = getACESPeakNits(u.tonemapOp, u.outputSpace, u.peakBrightness);
            return vec4<f32>(color * (peakNits / 80.0), tex0col.a);
        }
        // Linear outputs (0, 1, 2, 3, 4): passthrough
        return tex0col;
    }

    // ----------------------------------------------------------------
    // Standard path: operators 0, 1, 4-11
    // Input is Linear Rec.709 from Stage 6 (RRT).
    // ----------------------------------------------------------------

    // HDR outputs: gamut convert + paper white + transfer function
    if (u.outputSpace == 6) { // PQ Rec.2020
        let rec2020 = Rec709_to_Rec2020 * color;
        return vec4<f32>(LinearToPQ(rec2020 * u.paperWhite / PQ_MAX_NITS), tex0col.a);
    }
    if (u.outputSpace == 7) { // HLG Rec.2020
        let rec2020 = Rec709_to_Rec2020 * color;
        let peak = max(u.peakBrightness, 1.0);
        return vec4<f32>(LinearToHLG(clamp(rec2020 * u.paperWhite / peak, vec3<f32>(0.0), vec3<f32>(1.0))), tex0col.a);
    }
    if (u.outputSpace == 8) { // scRGB
        return vec4<f32>(color * (u.paperWhite / 80.0), tex0col.a);
    }

    // Non-HDR outputs (0-5): standard FromLinearRec709
    let result = FromLinearRec709(color, u.outputSpace);
    return vec4<f32>(result, tex0col.a);
}
