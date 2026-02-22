// Stage 5: Color Grading — Log (ACEScct) or Linear (ACEScg) workflow
// Source: HDRGrade.sdsl + ColorSpaceConversion.sdsl
// ALL matrices TRANSPOSED for WGSL column-major layout.
// Pipeline: Linear Rec.709 → Linear AP1 → Grading → Linear AP1 → Linear Rec.709

// ============================================================================
// Uniforms — reads from shared PipelineUniforms buffer
// Must match PipelineUniforms.ts byte offsets exactly.
// ============================================================================

struct Uniforms {
    inputSpace: i32,           // offset 0
    gradingSpace: i32,         // offset 4
    exposure: f32,             // offset 8
    contrast: f32,             // offset 12
    saturation: f32,           // offset 16
    temperature: f32,          // offset 20
    tint: f32,                 // offset 24
    highlights: f32,           // offset 28
    shadows: f32,              // offset 32
    vibrance: f32,             // offset 36
    // implicit 8 bytes padding (40-47) for vec3 alignment
    lift: vec3<f32>,           // offset 48
    _pad1: f32,                // offset 60
    gamma: vec3<f32>,          // offset 64
    _pad2: f32,                // offset 76
    gain: vec3<f32>,           // offset 80
    _pad3: f32,                // offset 92
    offset_val: vec3<f32>,     // offset 96
    _pad4: f32,                // offset 108
    shadowColor: vec3<f32>,    // offset 112
    _pad5: f32,                // offset 124
    midtoneColor: vec3<f32>,   // offset 128
    _pad6: f32,                // offset 140
    highlightColor: vec3<f32>, // offset 144
    _pad7: f32,                // offset 156
    highlightSoftClip: f32,    // offset 160
    shadowSoftClip: f32,       // offset 164
    highlightKnee: f32,        // offset 168
    shadowKnee: f32,           // offset 172
};

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> u: Uniforms;

// ============================================================================
// Constants
// ============================================================================

const ACESCCT_MIDGRAY: f32 = 0.4135884;
const ACESCC_MIN: f32 = -0.3584474886;
const ACESCC_MAX: f32 = 1.4679964372;
const ACESCC_RANGE: f32 = 1.8264439258;   // ACESCC_MAX - ACESCC_MIN
const AP1_LUMA = vec3<f32>(0.2722287, 0.6740818, 0.0536895);
const LINEAR_MIDGRAY: f32 = 0.18;

// ACEScct constants
const ACEScct_A: f32 = 10.5402377416545;
const ACEScct_B: f32 = 0.0729055341958355;
const ACEScct_CUT_LINEAR: f32 = 0.0078125;
const ACEScct_CUT_LOG: f32 = 0.155251141552511;

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
// Gamut Matrices — TRANSPOSED for WGSL column-major
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

// Rec.2020 → Rec.709
const Rec2020_to_Rec709 = mat3x3<f32>(
    vec3<f32>( 1.6604910, -0.1245505, -0.0181508),
    vec3<f32>(-0.5876411,  1.1328999, -0.1005789),
    vec3<f32>(-0.0728499, -0.0083494,  1.1187297)
);

// ============================================================================
// Transfer Functions
// ============================================================================

// sRGB (IEC 61966-2-1)
fn sRGBToLinear_channel(s: f32) -> f32 {
    if (s <= 0.04045) { return s / 12.92; }
    return pow((s + 0.055) / 1.055, 2.4);
}
fn sRGBToLinear(srgb: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(sRGBToLinear_channel(srgb.r), sRGBToLinear_channel(srgb.g), sRGBToLinear_channel(srgb.b));
}

// ACEScc (S-2014-003)
fn LinearToACEScc(lin: vec3<f32>) -> vec3<f32> {
    let linClamped = max(lin, vec3<f32>(1e-10));
    return (log2(linClamped) + 9.72) / 17.52;
}
fn ACESccToLinear(cc: vec3<f32>) -> vec3<f32> {
    return clamp(exp2(cc * 17.52 - 9.72), vec3<f32>(0.0), vec3<f32>(65504.0));
}

// ACEScct (S-2016-001)
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
    return clamp(mix(linearSeg, logSeg, useLog), vec3<f32>(0.0), vec3<f32>(65504.0));
}

// PQ (ST.2084)
fn PQToLinear(N: vec3<f32>) -> vec3<f32> {
    let Nm2 = pow(max(N, vec3<f32>(0.0)), vec3<f32>(1.0 / PQ_m2));
    return pow(max(Nm2 - PQ_c1, vec3<f32>(0.0)) / (PQ_c2 - PQ_c3 * Nm2), vec3<f32>(1.0 / PQ_m1));
}

// HLG (BT.2100)
fn HLGToLinear(V: vec3<f32>) -> vec3<f32> {
    let sqrtSeg = (V * V) / 3.0;
    let logSeg = (exp((V - HLG_c) / HLG_a) + HLG_b) / 12.0;
    let useLog = step(vec3<f32>(0.5), V);
    return mix(sqrtSeg, logSeg, useLog);
}

// ============================================================================
// Hub: ToLinearRec709
// ============================================================================

fn ToLinearRec709(color: vec3<f32>, space: i32) -> vec3<f32> {
    if (space == 0) { return color; }
    if (space == 1) { return Rec2020_to_Rec709 * color; }
    if (space == 2) { return AP1_to_Rec709 * color; }
    if (space == 3) { return AP1_to_Rec709 * ACESccToLinear(color); }
    if (space == 4) { return AP1_to_Rec709 * ACEScctToLinear(color); }
    if (space == 5) { return sRGBToLinear(color); }
    if (space == 6) { return Rec2020_to_Rec709 * (PQToLinear(color) * PQ_MAX_NITS); }
    if (space == 7) { return Rec2020_to_Rec709 * (HLGToLinear(color) * 12.0); }
    return color * 80.0;
}

// ============================================================================
// DecodeInput: any HDRColorSpace → Linear AP1
// ============================================================================

fn DecodeInput(color: vec3<f32>, inputSpace: i32) -> vec3<f32> {
    if (inputSpace == 2) { return color; }                              // ACEScg passthrough
    if (inputSpace == 3) { return ACESccToLinear(color); }              // ACEScc
    if (inputSpace == 4) { return ACEScctToLinear(color); }             // ACEScct
    return Rec709_to_AP1 * ToLinearRec709(color, inputSpace);           // All others via hub
}

// ============================================================================
// Zone Weighting
// ============================================================================

fn GetZoneWeights(luma: f32) -> vec3<f32> {
    let shadow = 1.0 - smoothstep(0.0, 0.5, luma);
    let highlight = smoothstep(0.35, 0.65, luma);
    let mid = 1.0 - shadow - highlight;
    return vec3<f32>(shadow, mid, highlight);
}

// ============================================================================
// Soft Clipping (branchless)
// ============================================================================

fn ApplySoftClip(val: vec3<f32>, hKnee: f32, hStr: f32, sKnee: f32, sStr: f32) -> vec3<f32> {
    var v = val;
    // Highlight compression
    let hExcess = max(v - hKnee, vec3<f32>(0.0));
    let hComp = hKnee + hExcess / (1.0 + hExcess * hStr);
    v = mix(v, hComp, step(vec3<f32>(hKnee), v) * step(0.001, hStr));
    // Shadow compression
    let sDeficit = max(vec3<f32>(sKnee) - v, vec3<f32>(0.0));
    let sComp = sKnee - sDeficit / (1.0 + sDeficit * sStr);
    v = mix(v, sComp, step(v, vec3<f32>(sKnee)) * step(0.001, sStr));
    return v;
}

// ============================================================================
// Log Grading (ACEScct — DaVinci Resolve style)
// ============================================================================

fn ApplyGradingLog(linearAP1: vec3<f32>) -> vec3<f32> {
    // Convert to ACEScct log space
    var cc = LinearToACEScct(linearAP1);

    // Exposure: additive in log = stops
    cc += u.exposure / 17.52;

    // White Balance
    cc.r += u.temperature * 0.03;
    cc.b -= u.temperature * 0.03;
    cc.g += u.tint * 0.02;

    // Contrast: pivot around ACEScct mid-gray
    cc = (cc - ACESCCT_MIDGRAY) * u.contrast + ACESCCT_MIDGRAY;

    // Lift/Gamma/Gain (ASC-CDL in log)
    cc += u.lift * 0.1;
    cc *= u.gain;
    var norm = clamp((cc - ACESCC_MIN) / ACESCC_RANGE, vec3<f32>(0.0), vec3<f32>(1.0));
    norm = pow(max(norm, vec3<f32>(0.0001)), vec3<f32>(1.0) / max(u.gamma, vec3<f32>(0.01)));
    cc = norm * ACESCC_RANGE + ACESCC_MIN;

    // Color Wheels
    let luma = (cc.r + cc.g + cc.b) / 3.0;
    let normLuma = clamp((luma - ACESCC_MIN) / ACESCC_RANGE, 0.0, 1.0);
    let weights = GetZoneWeights(normLuma);
    cc += u.shadowColor * weights.x * 0.1;
    cc += u.midtoneColor * weights.y * 0.1;
    cc += u.highlightColor * weights.z * 0.1;

    // Highlights/Shadows: zone-weighted additive
    cc += u.shadows * weights.x * 0.15;
    cc += u.highlights * weights.z * 0.15;

    // Post-grade offset
    cc += u.offset_val * 0.1;

    // Saturation (via linear for accuracy)
    var lin = ACEScctToLinear(cc);
    let lumaLin = dot(lin, AP1_LUMA);
    let lumaCC = LinearToACEScct(vec3<f32>(lumaLin));
    cc = mix(lumaCC, cc, u.saturation);

    // Vibrance: boost under-saturated, protect already-saturated
    if (abs(u.vibrance) > 0.001) {
        let linV = ACEScctToLinear(cc);
        let lumaV = dot(linV, AP1_LUMA);
        let maxChan = max(linV.r, max(linV.g, linV.b));
        let satEst = clamp((maxChan - lumaV) / max(lumaV, 0.001), 0.0, 1.0);
        let vibAmt = u.vibrance * (1.0 - satEst);
        let lumaVCC = LinearToACEScct(vec3<f32>(lumaV));
        cc = mix(lumaVCC, cc, 1.0 + vibAmt);
    }

    // Soft clip
    cc = ApplySoftClip(cc, u.highlightKnee, u.highlightSoftClip, u.shadowKnee, u.shadowSoftClip);

    // Convert back to linear AP1
    return ACEScctToLinear(cc);
}

// ============================================================================
// Linear Grading (ACEScg — Nuke/VFX style)
// ============================================================================

fn ApplyGradingLinear(linearAP1: vec3<f32>) -> vec3<f32> {
    var lin = linearAP1;

    // Exposure: multiplicative (camera-like)
    lin *= pow(2.0, u.exposure);

    // White Balance: multiplicative gains
    lin.r *= 1.0 + u.temperature * 0.1;
    lin.b *= 1.0 - u.temperature * 0.1;
    lin.g *= 1.0 + u.tint * 0.05;

    // Gain then Offset (Nuke order)
    lin *= u.gain;
    lin += u.offset_val * 0.1;

    // Gamma: power function
    lin = pow(max(lin, vec3<f32>(0.0)), vec3<f32>(1.0) / max(u.gamma, vec3<f32>(0.01)));

    // Contrast: power curve around 18% gray
    lin = LINEAR_MIDGRAY * pow(max(lin / LINEAR_MIDGRAY, vec3<f32>(0.0001)), vec3<f32>(u.contrast));

    // Color Wheels (based on linear luminance)
    let luma = dot(lin, AP1_LUMA);
    let normLuma = clamp(luma / 2.0, 0.0, 1.0);
    let weights = GetZoneWeights(normLuma);
    lin += u.shadowColor * weights.x * 0.1;
    lin += u.midtoneColor * weights.y * 0.1;
    lin += u.highlightColor * weights.z * 0.1;

    // Highlights/Shadows: zone-weighted multiplicative
    lin *= 1.0 + u.shadows * weights.x * 0.5;
    lin *= 1.0 + u.highlights * weights.z * 0.5;

    // Lift: additive shadow adjustment
    lin += u.lift * 0.1;

    // Saturation (in linear)
    lin = mix(vec3<f32>(luma), lin, u.saturation);

    // Vibrance: boost under-saturated, protect already-saturated
    if (abs(u.vibrance) > 0.001) {
        let lumaV = dot(lin, AP1_LUMA);
        let maxChan = max(lin.r, max(lin.g, lin.b));
        let satEst = clamp((maxChan - lumaV) / max(lumaV, 0.001), 0.0, 1.0);
        let vibAmt = u.vibrance * (1.0 - satEst);
        lin = mix(vec3<f32>(lumaV), lin, 1.0 + vibAmt);
    }

    // Soft clip (scaled for linear space)
    lin = ApplySoftClip(lin, u.highlightKnee * 2.0, u.highlightSoftClip,
                        u.shadowKnee * 0.1, u.shadowSoftClip);

    return lin;
}

// ============================================================================
// Fragment shader
// ============================================================================

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
    let texCoord = vec2<i32>(in.uv * vec2<f32>(textureDimensions(inputTexture)));
    let tex0col = textureLoad(inputTexture, texCoord, 0);
    let color = tex0col.rgb;

    // Decode input to Linear AP1
    var linearAP1 = DecodeInput(color, u.inputSpace);

    // Apply grading in chosen space
    if (u.gradingSpace == 0) {
        linearAP1 = ApplyGradingLog(linearAP1);
    } else {
        linearAP1 = ApplyGradingLinear(linearAP1);
    }

    // Convert back to Linear Rec.709 for downstream stages
    let result = AP1_to_Rec709 * linearAP1;

    return vec4<f32>(result, tex0col.a);
}
