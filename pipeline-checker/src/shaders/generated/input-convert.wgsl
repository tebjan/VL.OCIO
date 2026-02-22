// Stage 4: Input Interpretation — any color space to Linear Rec.709
// Source: ColorSpaceConversion.sdsl
// ALL matrices TRANSPOSED for WGSL column-major layout.

// ============================================================================
// Uniforms — reads from shared PipelineUniforms buffer
// ============================================================================

struct Uniforms {
    inputSpace: i32,       // HDRColorSpace enum (0-8) at byte offset 0
};

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> u: Uniforms;

// ============================================================================
// Constants
// ============================================================================

// ACEScct (S-2016-001)
const ACEScct_A: f32 = 10.5402377416545;
const ACEScct_B: f32 = 0.0729055341958355;
const ACEScct_CUT_LINEAR: f32 = 0.0078125;        // 2^-7
const ACEScct_CUT_LOG: f32 = 0.155251141552511;

// ACEScc
const ACESCC_MAX: f32 = 1.4679964372;

// PQ (ST.2084)
const PQ_m1: f32 = 0.1593017578125;
const PQ_m2: f32 = 78.84375;
const PQ_c1: f32 = 0.8359375;
const PQ_c2: f32 = 18.8515625;
const PQ_c3: f32 = 18.6875;
const PQ_MAX_NITS: f32 = 10000.0;

// HLG (ARIB STD-B67)
const HLG_a: f32 = 0.17883277;
const HLG_b: f32 = 0.28466892;
const HLG_c: f32 = 0.55991073;

// ============================================================================
// Gamut Matrices — ALL TRANSPOSED from SDSL row-major to WGSL column-major
// ============================================================================

// Rec.709 → Rec.2020
const Rec709_to_Rec2020 = mat3x3<f32>(
    vec3<f32>(0.6274039, 0.0690973, 0.0163914),   // column 0
    vec3<f32>(0.3292830, 0.9195404, 0.0880133),    // column 1
    vec3<f32>(0.0433131, 0.0113623, 0.8955953)     // column 2
);

// Rec.2020 → Rec.709
const Rec2020_to_Rec709 = mat3x3<f32>(
    vec3<f32>( 1.6604910, -0.1245505, -0.0181508), // column 0
    vec3<f32>(-0.5876411,  1.1328999, -0.1005789),  // column 1
    vec3<f32>(-0.0728499, -0.0083494,  1.1187297)   // column 2
);

// Rec.709 → AP1 (includes D65→D60 Bradford)
const Rec709_to_AP1 = mat3x3<f32>(
    vec3<f32>(0.6131324, 0.0701934, 0.0206155),    // column 0
    vec3<f32>(0.3395381, 0.9163539, 0.1095697),    // column 1
    vec3<f32>(0.0473296, 0.0134527, 0.8698148)     // column 2
);

// AP1 → Rec.709 (includes D60→D65 Bradford)
const AP1_to_Rec709 = mat3x3<f32>(
    vec3<f32>( 1.7048586, -0.1300768, -0.0239640),  // column 0
    vec3<f32>(-0.6217160,  1.1407357, -0.1289755),   // column 1
    vec3<f32>(-0.0831426, -0.0106589,  1.1529395)    // column 2
);

// Rec.2020 → AP1
const Rec2020_to_AP1 = mat3x3<f32>(
    vec3<f32>(0.9792711, 0.0083406, 0.0058225),    // column 0
    vec3<f32>(0.0125307, 0.9787678, 0.0284863),    // column 1
    vec3<f32>(0.0082013, 0.0128916, 0.9656912)     // column 2
);

// AP1 → Rec.2020
const AP1_to_Rec2020 = mat3x3<f32>(
    vec3<f32>( 1.0211818, -0.0087055, -0.0054779),  // column 0
    vec3<f32>(-0.0130790,  1.0220618, -0.0292020),   // column 1
    vec3<f32>(-0.0081028, -0.0133563,  1.0346800)    // column 2
);

// ============================================================================
// sRGB Transfer Functions (IEC 61966-2-1)
// ============================================================================

fn sRGBToLinear_channel(s: f32) -> f32 {
    if (s <= 0.04045) { return s / 12.92; }
    return pow((s + 0.055) / 1.055, 2.4);
}

fn sRGBToLinear(srgb: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
        sRGBToLinear_channel(srgb.r),
        sRGBToLinear_channel(srgb.g),
        sRGBToLinear_channel(srgb.b)
    );
}

fn LinearToSRGB_channel(l: f32) -> f32 {
    if (l <= 0.0031308) { return l * 12.92; }
    return 1.055 * pow(l, 1.0 / 2.4) - 0.055;
}

fn LinearToSRGB(lin: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
        LinearToSRGB_channel(lin.r),
        LinearToSRGB_channel(lin.g),
        LinearToSRGB_channel(lin.b)
    );
}

// ============================================================================
// ACEScc Transfer Functions (S-2014-003)
// ============================================================================

fn LinearToACEScc(lin: vec3<f32>) -> vec3<f32> {
    let linClamped = max(lin, vec3<f32>(1e-10));
    return (log2(linClamped) + 9.72) / 17.52;
}

fn ACESccToLinear(cc: vec3<f32>) -> vec3<f32> {
    let lin = exp2(cc * 17.52 - 9.72);
    return clamp(lin, vec3<f32>(0.0), vec3<f32>(65504.0));
}

// ============================================================================
// ACEScct Transfer Functions (S-2016-001) — branchless via step()
// ============================================================================

fn LinearToACEScct(lin: vec3<f32>) -> vec3<f32> {
    let linClamped = max(lin, vec3<f32>(1e-10));
    let linearSeg = ACEScct_A * linClamped + ACEScct_B;
    let logSeg = (log2(linClamped) + 9.72) / 17.52;
    let useLog = step(vec3<f32>(ACEScct_CUT_LINEAR), linClamped);
    return mix(linearSeg, logSeg, useLog);
}

fn ACEScctToLinear(cct: vec3<f32>) -> vec3<f32> {
    let linearSeg = (cct - ACEScct_B) / ACEScct_A;
    let logSeg = exp2(cct * 17.52 - 9.72);
    let useLog = step(vec3<f32>(ACEScct_CUT_LOG), cct);
    let lin = mix(linearSeg, logSeg, useLog);
    return clamp(lin, vec3<f32>(0.0), vec3<f32>(65504.0));
}

// ============================================================================
// PQ (ST.2084) Transfer Functions
// Returns/expects normalized 0-1 where 1.0 = 10000 nits
// ============================================================================

fn LinearToPQ(L: vec3<f32>) -> vec3<f32> {
    let Y = max(L, vec3<f32>(0.0));
    let Ym1 = pow(Y, vec3<f32>(PQ_m1));
    return pow((PQ_c1 + PQ_c2 * Ym1) / (1.0 + PQ_c3 * Ym1), vec3<f32>(PQ_m2));
}

fn PQToLinear(N: vec3<f32>) -> vec3<f32> {
    let Nm2 = pow(max(N, vec3<f32>(0.0)), vec3<f32>(1.0 / PQ_m2));
    return pow(max(Nm2 - PQ_c1, vec3<f32>(0.0)) / (PQ_c2 - PQ_c3 * Nm2), vec3<f32>(1.0 / PQ_m1));
}

// ============================================================================
// HLG (BT.2100 / ARIB STD-B67) Transfer Functions — branchless via step()
// Returns/expects normalized scene-linear (1.0 = reference white)
// ============================================================================

fn LinearToHLG(L: vec3<f32>) -> vec3<f32> {
    let Lc = max(L, vec3<f32>(0.0));
    let sqrtSeg = sqrt(3.0 * Lc);
    let logSeg = HLG_a * log(max(12.0 * Lc - HLG_b, vec3<f32>(1e-10))) + HLG_c;
    let useLog = step(vec3<f32>(1.0 / 12.0), Lc);
    return mix(sqrtSeg, logSeg, useLog);
}

fn HLGToLinear(V: vec3<f32>) -> vec3<f32> {
    let sqrtSeg = (V * V) / 3.0;
    let logSeg = (exp((V - HLG_c) / HLG_a) + HLG_b) / 12.0;
    let useLog = step(vec3<f32>(0.5), V);
    return mix(sqrtSeg, logSeg, useLog);
}

// ============================================================================
// Hub Conversion Functions
// Space enum: 0=Linear709, 1=Linear2020, 2=ACEScg, 3=ACEScc,
//             4=ACEScct, 5=sRGB, 6=PQ2020, 7=HLG2020, 8=scRGB
// ============================================================================

fn ToLinearRec709(color: vec3<f32>, space: i32) -> vec3<f32> {
    if (space == 0) { return color; }                                          // Linear Rec.709
    if (space == 1) { return Rec2020_to_Rec709 * color; }                      // Linear Rec.2020
    if (space == 2) { return AP1_to_Rec709 * color; }                          // ACEScg
    if (space == 3) { return AP1_to_Rec709 * ACESccToLinear(color); }          // ACEScc
    if (space == 4) { return AP1_to_Rec709 * ACEScctToLinear(color); }         // ACEScct
    if (space == 5) { return sRGBToLinear(color); }                            // sRGB
    if (space == 6) { return Rec2020_to_Rec709 * (PQToLinear(color) * PQ_MAX_NITS); }  // PQ Rec.2020
    if (space == 7) { return Rec2020_to_Rec709 * (HLGToLinear(color) * 12.0); }         // HLG Rec.2020
    return color * 80.0;                                                       // scRGB
}

fn FromLinearRec709(color: vec3<f32>, space: i32) -> vec3<f32> {
    if (space == 0) { return color; }                                          // Linear Rec.709
    if (space == 1) { return Rec709_to_Rec2020 * color; }                      // Linear Rec.2020
    if (space == 2) { return Rec709_to_AP1 * color; }                          // ACEScg
    if (space == 3) { return LinearToACEScc(Rec709_to_AP1 * color); }          // ACEScc
    if (space == 4) { return LinearToACEScct(Rec709_to_AP1 * color); }         // ACEScct
    if (space == 5) { return LinearToSRGB(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0))); } // sRGB
    if (space == 6) { return LinearToPQ(Rec709_to_Rec2020 * color * 200.0 / PQ_MAX_NITS); } // PQ Rec.2020
    if (space == 7) { return LinearToHLG(clamp(Rec709_to_Rec2020 * color / 12.0, vec3<f32>(0.0), vec3<f32>(1.0))); } // HLG Rec.2020
    return color / 80.0;                                                       // scRGB
}

fn ConvertColorSpace(color: vec3<f32>, fromSpace: i32, toSpace: i32) -> vec3<f32> {
    if (fromSpace == toSpace) { return color; }
    let linear709 = ToLinearRec709(color, fromSpace);
    return FromLinearRec709(linear709, toSpace);
}

// ============================================================================
// Fragment shader
// ============================================================================

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
    let texCoord = vec2<i32>(in.uv * vec2<f32>(textureDimensions(inputTexture)));
    let tex0col = textureLoad(inputTexture, texCoord, 0);
    // Passthrough: Stage 5 (Color Grade) handles inputSpace conversion via DecodeInput()
    return tex0col;
}
