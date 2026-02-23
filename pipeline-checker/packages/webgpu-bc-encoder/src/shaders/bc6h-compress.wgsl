// BC6H compression compute shader — unsigned half-float HDR RGB
// 128 bits per 4x4 block, all 14 BC6H modes for maximum quality.
//
// Ported from Microsoft DirectX SDK BC6HEncode.hlsl reference implementation.
// Quantization, unquantization, interpolation weights, and bit packing all match
// the BC6H (BPTC float) specification exactly.
//
// Quality modes via params.quality:
//   0 = fast (idx 10 only — 1-subset, 10-bit, 4-bit indices)
//   1 = normal (idx 10 + 11 + 2-subset modes 0,1,5,9 x 32 partitions)
//   2 = high (all 14 modes x 32 partitions — full exhaustive search)

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outputBlocks: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params { width: u32, height: u32, quality: u32 }

const WORDS_PER_BLOCK: u32 = 4u;

// ─── Lookup Tables ───────────────────────────────────────────────────────────

// 4-bit index assignment: maps position [0,63] -> best 4-bit index [0,15]
var<private> aStep2: array<u32, 64> = array<u32, 64>(
    0u, 0u, 0u, 1u, 1u, 1u, 1u, 2u,
    2u, 2u, 2u, 2u, 3u, 3u, 3u, 3u,
    4u, 4u, 4u, 4u, 5u, 5u, 5u, 5u,
    6u, 6u, 6u, 6u, 6u, 7u, 7u, 7u,
    7u, 8u, 8u, 8u, 8u, 9u, 9u, 9u,
    9u, 10u, 10u, 10u, 10u, 10u, 11u, 11u,
    11u, 11u, 12u, 12u, 12u, 12u, 13u, 13u,
    13u, 13u, 14u, 14u, 14u, 14u, 15u, 15u);

// 3-bit index assignment: maps position [0,63] -> best 3-bit index [0,7]
var<private> aStep1: array<u32, 64> = array<u32, 64>(
    0u, 0u, 0u, 0u, 0u, 1u, 1u, 1u,
    1u, 1u, 1u, 1u, 1u, 1u, 2u, 2u,
    2u, 2u, 2u, 2u, 2u, 2u, 2u, 3u,
    3u, 3u, 3u, 3u, 3u, 3u, 3u, 3u,
    3u, 4u, 4u, 4u, 4u, 4u, 4u, 4u,
    4u, 4u, 5u, 5u, 5u, 5u, 5u, 5u,
    5u, 5u, 5u, 6u, 6u, 6u, 6u, 6u,
    6u, 6u, 6u, 6u, 7u, 7u, 7u, 7u);

// Interpolation weights for 4-bit indices (16 levels)
const aWeight4 = array<u32, 16>(0u, 4u, 9u, 13u, 17u, 21u, 26u, 30u, 34u, 38u, 43u, 47u, 51u, 55u, 60u, 64u);

// Interpolation weights for 3-bit indices (8 levels)
const aWeight3 = array<u32, 8>(0u, 9u, 18u, 27u, 37u, 46u, 55u, 64u);

const RGB2LUM = vec3<f32>(0.2126, 0.7152, 0.0722);

// ─── Mode 10 Partition Tables ────────────────────────────────────────────────

// 32 partition patterns for 2-subset modes.
// Bit i: 0 = subset 0, 1 = subset 1.
const candidateSectionBit = array<u32, 32>(
    0xCCCCu, 0x8888u, 0xEEEEu, 0xECC8u,
    0xC880u, 0xFEECu, 0xFEC8u, 0xEC80u,
    0xC800u, 0xFFECu, 0xFE80u, 0xE800u,
    0xFFE8u, 0xFF00u, 0xFFF0u, 0xF000u,
    0xF710u, 0x008Eu, 0x7100u, 0x08CEu,
    0x008Cu, 0x7310u, 0x3100u, 0x8CCEu,
    0x088Cu, 0x3110u, 0x6666u, 0x366Cu,
    0x17E8u, 0x0FF0u, 0x718Eu, 0x399Cu
);

// Fix-up index for subset 1 (subset 0 anchor is always pixel 0).
const candidateFixUpIndex1D = array<u32, 32>(
    15u, 15u, 15u, 15u, 15u, 15u, 15u, 15u,
    15u, 15u, 15u, 15u, 15u, 15u, 15u, 15u,
    15u,  2u,  8u,  2u,  2u,  8u,  8u, 15u,
     2u,  8u,  2u,  2u,  8u,  8u,  2u,  2u
);

// ─── Mode Configuration Tables ───────────────────────────────────────────────
//
// All 14 BC6H modes (unsigned). Array index is our internal mode number.
//
// Idx | Subsets | Xform | EP bits | Delta (R,G,B) | Idx bits | Mode ID
// ----|---------|-------|---------|---------------|----------|--------
//   0 |    2    |  Yes  |   10    |  (5,5,5)      |    3     | 0x00 (2b)
//   1 |    2    |  Yes  |    7    |  (6,6,6)      |    3     | 0x01 (2b)
//   2 |    2    |  Yes  |   11    |  (5,4,4)      |    3     | 0x02 (5b)
//   3 |    2    |  Yes  |   11    |  (4,5,4)      |    3     | 0x06 (5b)
//   4 |    2    |  Yes  |   11    |  (4,4,5)      |    3     | 0x0A (5b)
//   5 |    2    |  Yes  |    9    |  (5,5,5)      |    3     | 0x0E (5b)
//   6 |    2    |  Yes  |    8    |  (6,5,5)      |    3     | 0x12 (5b)
//   7 |    2    |  Yes  |    8    |  (5,6,5)      |    3     | 0x16 (5b)
//   8 |    2    |  Yes  |    8    |  (5,5,6)      |    3     | 0x1A (5b)
//   9 |    2    |  No   |    6    |    -          |    3     | 0x1E (5b)
//  10 |    1    |  No   |   10    |    -          |    4     | 0x03 (5b)
//  11 |    1    |  Yes  |   11    |  (9,9,9)      |    4     | 0x07 (5b)
//  12 |    1    |  Yes  |   12    |  (8,8,8)      |    4     | 0x0B (5b)
//  13 |    1    |  Yes  |   16    |  (4,4,4)      |    4     | 0x0F (5b)

// candidateModePrec[i] = uint4(epPrec, deltaR, deltaG, deltaB)
// For untransformed modes, delta fields equal epPrec.
const candidateModePrec = array<vec4<u32>, 14>(
    vec4<u32>(10u, 5u, 5u, 5u),   // mode 0
    vec4<u32>(7u, 6u, 6u, 6u),    // mode 1
    vec4<u32>(11u, 5u, 4u, 4u),   // mode 2
    vec4<u32>(11u, 4u, 5u, 4u),   // mode 3
    vec4<u32>(11u, 4u, 4u, 5u),   // mode 4
    vec4<u32>(9u, 5u, 5u, 5u),    // mode 5
    vec4<u32>(8u, 6u, 5u, 5u),    // mode 6
    vec4<u32>(8u, 5u, 6u, 5u),    // mode 7
    vec4<u32>(8u, 5u, 5u, 6u),    // mode 8
    vec4<u32>(6u, 6u, 6u, 6u),    // mode 9 (untransformed)
    vec4<u32>(10u, 10u, 10u, 10u), // mode 10 (untransformed, 1-subset, 4-bit)
    vec4<u32>(11u, 9u, 9u, 9u),   // mode 11 (transformed, 1-subset, 4-bit)
    vec4<u32>(12u, 8u, 8u, 8u),   // mode 12 (transformed, 1-subset, 4-bit)
    vec4<u32>(16u, 4u, 4u, 4u)    // mode 13 (transformed, 1-subset, 4-bit)
);

const candidateModeTransformed = array<u32, 14>(
    1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 0u, 0u, 1u, 1u, 1u
);

// Mode ID values to write into the block header
const candidateModeMemory = array<u32, 14>(
    0x00u, 0x01u, 0x02u, 0x06u, 0x0Au, 0x0Eu, 0x12u, 0x16u, 0x1Au, 0x1Eu, 0x03u, 0x07u, 0x0Bu, 0x0Fu
);

// Number of bits used by mode ID
const candidateModeBits = array<u32, 14>(
    2u, 2u, 5u, 5u, 5u, 5u, 5u, 5u, 5u, 5u, 5u, 5u, 5u, 5u
);

// ─── Quantization Functions ──────────────────────────────────────────────────

fn floatToHalf(v: f32) -> u32 {
    let clamped = clamp(v, 0.0, 65504.0);
    let bits = pack2x16float(vec2<f32>(clamped, 0.0));
    return bits & 0xFFFFu;
}

fn startQuantize(fp16: u32) -> u32 {
    return (fp16 << 6u) / 31u;
}

fn quantize(val: u32, prec: u32) -> u32 {
    if (val == 0u) { return 0u; }
    if (val >= 0xFFFFu) { return (1u << prec) - 1u; }
    return (val << prec) >> 16u;
}

fn unquantize(val: u32, prec: u32) -> u32 {
    if (prec >= 15u) { return val; }
    if (val == 0u) { return 0u; }
    if (val == (1u << prec) - 1u) { return 0xFFFFu; }
    return ((val << 16u) + 0x8000u) >> prec;
}

// ─── Bit Packing Helpers ─────────────────────────────────────────────────────

fn setBit(block: ptr<function, vec4<u32>>, pos: u32, val: u32) {
    let word = pos >> 5u;
    let bit = pos & 31u;
    switch (word) {
        case 0u: { (*block).x |= (val & 1u) << bit; }
        case 1u: { (*block).y |= (val & 1u) << bit; }
        case 2u: { (*block).z |= (val & 1u) << bit; }
        case 3u: { (*block).w |= (val & 1u) << bit; }
        default: {}
    }
}

fn setBits(block: ptr<function, vec4<u32>>, startPos: u32, numBits: u32, val: u32) {
    for (var i = 0u; i < numBits; i++) {
        setBit(block, startPos + i, (val >> i) & 1u);
    }
}

// ─── Encode Result ───────────────────────────────────────────────────────────

struct EncodeResult {
    block: vec4<u32>,
    error: f32,
}

// ─── Transformed Mode Delta Helpers ──────────────────────────────────────────

// Sign-extend a value from 'prec' bits to 32-bit signed
fn signExtend(val: u32, prec: u32) -> i32 {
    let signBit = 1u << (prec - 1u);
    if ((val & signBit) != 0u) {
        return i32(val | (0xFFFFFFFFu << prec));
    }
    return i32(val);
}

// Check if a signed delta fits in N-bit signed range: -(1<<(bits-1)) to (1<<(bits-1))-1
fn fitsDeltaBits(delta: i32, bits: u32) -> bool {
    let maxVal = i32(1u << (bits - 1u)) - 1i;
    let minVal = -i32(1u << (bits - 1u));
    return delta >= minVal && delta <= maxVal;
}

// Mask a signed delta to unsigned N-bit representation
fn maskDelta(val: i32, bits: u32) -> u32 {
    return u32(val) & ((1u << bits) - 1u);
}

// ─── Quantization for Transformed Modes ──────────────────────────────────────

// finish_quantize for 1-subset transformed modes (mode indices 11-13):
// Checks that delta (endPoint[1]) fits in the delta precision, clamps if needed.
// Returns true if quantization is bad (delta overflows).
fn finishQuantize1Subset(
    ep0: ptr<function, vec3<u32>>,
    ep1: ptr<function, vec3<u32>>,
    prec: vec4<u32>,
    transformed: bool
) -> bool {
    if (transformed) {
        let dR = i32((*ep1).x);
        let dG = i32((*ep1).y);
        let dB = i32((*ep1).z);
        let maxR = i32(1u << (prec.y - 1u));
        let maxG = i32(1u << (prec.z - 1u));
        let maxB = i32(1u << (prec.w - 1u));

        var bad = false;
        if (dR >= maxR || dR < -maxR) { bad = true; }
        if (dG >= maxG || dG < -maxG) { bad = true; }
        if (dB >= maxB || dB < -maxB) { bad = true; }

        (*ep0) = vec3<u32>((*ep0).x & ((1u << prec.x) - 1u),
                           (*ep0).y & ((1u << prec.x) - 1u),
                           (*ep0).z & ((1u << prec.x) - 1u));

        // Clamp deltas
        (*ep1).x = select(
            select(u32(dR) & ((1u << prec.y) - 1u), u32(1u << prec.y), dR < -maxR),
            (1u << (prec.y - 1u)) - 1u,
            dR >= maxR
        );
        if (dR < -maxR) { (*ep1).x = 1u << (prec.y - 1u); }
        else if (dR >= maxR) { (*ep1).x = (1u << (prec.y - 1u)) - 1u; }
        else { (*ep1).x = u32(dR) & ((1u << prec.y) - 1u); }

        if (dG < -maxG) { (*ep1).y = 1u << (prec.z - 1u); }
        else if (dG >= maxG) { (*ep1).y = (1u << (prec.z - 1u)) - 1u; }
        else { (*ep1).y = u32(dG) & ((1u << prec.z) - 1u); }

        if (dB < -maxB) { (*ep1).z = 1u << (prec.w - 1u); }
        else if (dB >= maxB) { (*ep1).z = (1u << (prec.w - 1u)) - 1u; }
        else { (*ep1).z = u32(dB) & ((1u << prec.w) - 1u); }

        return bad;
    } else {
        (*ep0) = (*ep0) & vec3<u32>((1u << prec.x) - 1u);
        (*ep1) = (*ep1) & vec3<u32>((1u << prec.x) - 1u);
        return false;
    }
}

// finish_quantize for 2-subset transformed modes:
// endPoint[0] = (ep00, ep01) where ep01 is the delta from ep00
// endPoint[1] = (ep10, ep11) both deltas from ep00
fn finishQuantize2Subset(
    ep00: ptr<function, vec3<u32>>,
    ep01: ptr<function, vec3<u32>>,
    ep10: ptr<function, vec3<u32>>,
    ep11: ptr<function, vec3<u32>>,
    prec: vec4<u32>,
    transformed: bool
) -> bool {
    if (transformed) {
        var bad = false;

        // Check ep01 (delta from ep00)
        let d01R = i32((*ep01).x); let d01G = i32((*ep01).y); let d01B = i32((*ep01).z);
        let maxR = i32(1u << (prec.y - 1u));
        let maxG = i32(1u << (prec.z - 1u));
        let maxB = i32(1u << (prec.w - 1u));

        if (d01R >= maxR || d01R < -maxR) { bad = true; }
        if (d01G >= maxG || d01G < -maxG) { bad = true; }
        if (d01B >= maxB || d01B < -maxB) { bad = true; }

        // Check ep10 (delta from ep00)
        let d10R = i32((*ep10).x); let d10G = i32((*ep10).y); let d10B = i32((*ep10).z);
        if (d10R >= maxR || d10R < -maxR) { bad = true; }
        if (d10G >= maxG || d10G < -maxG) { bad = true; }
        if (d10B >= maxB || d10B < -maxB) { bad = true; }

        // Check ep11 (delta from ep00)
        let d11R = i32((*ep11).x); let d11G = i32((*ep11).y); let d11B = i32((*ep11).z);
        if (d11R >= maxR || d11R < -maxR) { bad = true; }
        if (d11G >= maxG || d11G < -maxG) { bad = true; }
        if (d11B >= maxB || d11B < -maxB) { bad = true; }

        // Mask base endpoint
        (*ep00) = (*ep00) & vec3<u32>((1u << prec.x) - 1u);

        // Clamp and mask deltas for ep01
        if (d01R < -maxR) { (*ep01).x = 1u << (prec.y - 1u); }
        else if (d01R >= maxR) { (*ep01).x = (1u << (prec.y - 1u)) - 1u; }
        else { (*ep01).x = u32(d01R) & ((1u << prec.y) - 1u); }

        if (d01G < -maxG) { (*ep01).y = 1u << (prec.z - 1u); }
        else if (d01G >= maxG) { (*ep01).y = (1u << (prec.z - 1u)) - 1u; }
        else { (*ep01).y = u32(d01G) & ((1u << prec.z) - 1u); }

        if (d01B < -maxB) { (*ep01).z = 1u << (prec.w - 1u); }
        else if (d01B >= maxB) { (*ep01).z = (1u << (prec.w - 1u)) - 1u; }
        else { (*ep01).z = u32(d01B) & ((1u << prec.w) - 1u); }

        // Clamp and mask deltas for ep10
        if (d10R < -maxR) { (*ep10).x = 1u << (prec.y - 1u); }
        else if (d10R >= maxR) { (*ep10).x = (1u << (prec.y - 1u)) - 1u; }
        else { (*ep10).x = u32(d10R) & ((1u << prec.y) - 1u); }

        if (d10G < -maxG) { (*ep10).y = 1u << (prec.z - 1u); }
        else if (d10G >= maxG) { (*ep10).y = (1u << (prec.z - 1u)) - 1u; }
        else { (*ep10).y = u32(d10G) & ((1u << prec.z) - 1u); }

        if (d10B < -maxB) { (*ep10).z = 1u << (prec.w - 1u); }
        else if (d10B >= maxB) { (*ep10).z = (1u << (prec.w - 1u)) - 1u; }
        else { (*ep10).z = u32(d10B) & ((1u << prec.w) - 1u); }

        // Clamp and mask deltas for ep11
        if (d11R < -maxR) { (*ep11).x = 1u << (prec.y - 1u); }
        else if (d11R >= maxR) { (*ep11).x = (1u << (prec.y - 1u)) - 1u; }
        else { (*ep11).x = u32(d11R) & ((1u << prec.y) - 1u); }

        if (d11G < -maxG) { (*ep11).y = 1u << (prec.z - 1u); }
        else if (d11G >= maxG) { (*ep11).y = (1u << (prec.z - 1u)) - 1u; }
        else { (*ep11).y = u32(d11G) & ((1u << prec.z) - 1u); }

        if (d11B < -maxB) { (*ep11).z = 1u << (prec.w - 1u); }
        else if (d11B >= maxB) { (*ep11).z = (1u << (prec.w - 1u)) - 1u; }
        else { (*ep11).z = u32(d11B) & ((1u << prec.w) - 1u); }

        return bad;
    } else {
        let mask = (1u << prec.x) - 1u;
        (*ep00) = (*ep00) & vec3<u32>(mask);
        (*ep01) = (*ep01) & vec3<u32>(mask);
        (*ep10) = (*ep10) & vec3<u32>(mask);
        (*ep11) = (*ep11) & vec3<u32>(mask);
        return false;
    }
}

// start_unquantize for 2-subset: sign-extend deltas, then add base
fn startUnquantize2Subset(
    ep00: ptr<function, vec3<i32>>,
    ep01: ptr<function, vec3<i32>>,
    ep10: ptr<function, vec3<i32>>,
    ep11: ptr<function, vec3<i32>>,
    prec: vec4<u32>,
    transformed: bool
) {
    if (transformed) {
        // Sign-extend deltas
        (*ep01).x = signExtend(u32((*ep01).x), prec.y);
        (*ep01).y = signExtend(u32((*ep01).y), prec.z);
        (*ep01).z = signExtend(u32((*ep01).z), prec.w);
        (*ep10).x = signExtend(u32((*ep10).x), prec.y);
        (*ep10).y = signExtend(u32((*ep10).y), prec.z);
        (*ep10).z = signExtend(u32((*ep10).z), prec.w);
        (*ep11).x = signExtend(u32((*ep11).x), prec.y);
        (*ep11).y = signExtend(u32((*ep11).y), prec.z);
        (*ep11).z = signExtend(u32((*ep11).z), prec.w);
        // Add base
        (*ep01) = (*ep01) + (*ep00);
        (*ep10) = (*ep10) + (*ep00);
        (*ep11) = (*ep11) + (*ep00);
    }
}

// start_unquantize for 1-subset
fn startUnquantize1Subset(
    ep0: ptr<function, vec3<i32>>,
    ep1: ptr<function, vec3<i32>>,
    prec: vec4<u32>,
    transformed: bool
) {
    if (transformed) {
        (*ep1).x = signExtend(u32((*ep1).x), prec.y);
        (*ep1).y = signExtend(u32((*ep1).y), prec.z);
        (*ep1).z = signExtend(u32((*ep1).z), prec.w);
        (*ep1) = (*ep1) + (*ep0);
    }
}

fn unquantizeI(val: i32, prec: u32) -> i32 {
    if (prec >= 15u) { return val; }
    if (val == 0i) { return 0i; }
    if (val == i32((1u << prec) - 1u)) { return i32(0xFFFFu); }
    return i32(((u32(val) << 16u) + 0x8000u) >> prec);
}

// ─── Mode 10 Encoder (1-subset, 10-bit endpoints, 4-bit indices) ─────────────
// This is BC6H mode index 10 in our array (spec's "Mode 11" with mode ID 0x03)

fn encodeMode10_1subset(pixPh: array<vec3<f32>, 16>) -> EncodeResult {
    // Find endpoints by luminance
    var epLow = pixPh[0];
    var epHigh = pixPh[0];
    var lumLow = dot(pixPh[0], RGB2LUM);
    var lumHigh = lumLow;

    for (var i = 1u; i < 16u; i++) {
        let lum = dot(pixPh[i], RGB2LUM);
        if (lum < lumLow) {
            lumLow = lum;
            epLow = pixPh[i];
        }
        if (lum > lumHigh) {
            lumHigh = lum;
            epHigh = pixPh[i];
        }
    }

    // Anchor fix: if pixel 0 projects past midpoint, swap endpoints
    var span = epHigh - epLow;
    var spanNormSqr = dot(span, span);
    let dotP0 = dot(span, pixPh[0] - epLow);
    if (spanNormSqr > 0.0 && dotP0 >= 0.0 && u32(dotP0 * 63.49999 / spanNormSqr) > 32u) {
        let tmp = epLow;
        epLow = epHigh;
        epHigh = tmp;
    }

    span = epHigh - epLow;
    spanNormSqr = dot(span, span);

    // Quantize endpoints to 10 bits
    let ep0 = vec3<u32>(quantize(u32(epLow.x), 10u), quantize(u32(epLow.y), 10u), quantize(u32(epLow.z), 10u));
    let ep1 = vec3<u32>(quantize(u32(epHigh.x), 10u), quantize(u32(epHigh.y), 10u), quantize(u32(epHigh.z), 10u));

    // Unquantize for error measurement
    let ep0uq = vec3<f32>(f32(unquantize(ep0.x, 10u)), f32(unquantize(ep0.y, 10u)), f32(unquantize(ep0.z, 10u)));
    let ep1uq = vec3<f32>(f32(unquantize(ep1.x, 10u)), f32(unquantize(ep1.y, 10u)), f32(unquantize(ep1.z, 10u)));

    // Compute indices and error
    var indices: array<u32, 16>;
    var totalError = 0.0;
    for (var i = 0u; i < 16u; i++) {
        let dotProduct = dot(span, pixPh[i] - epLow);
        var idx = 0u;
        if (spanNormSqr <= 0.0 || dotProduct <= 0.0) {
            idx = 0u;
        } else if (dotProduct >= spanNormSqr) {
            idx = aStep2[63];
        } else {
            idx = aStep2[u32(dotProduct * 63.49999 / spanNormSqr)];
        }
        indices[i] = idx;

        let w = aWeight4[idx];
        let decoded = (ep0uq * f32(64u - w) + ep1uq * f32(w) + vec3<f32>(32.0)) / 64.0;
        let diff = pixPh[i] - decoded;
        totalError += dot(diff, diff);
    }

    // Pack Mode 10 block (1-subset, mode ID = 0x03 = 00011)
    var block = vec4<u32>(0u, 0u, 0u, 0u);

    block.x = 0x03u;
    block.x |= (ep0.x & 0x3FFu) << 5u;
    block.x |= (ep0.y & 0x3FFu) << 15u;
    block.x |= (ep0.z & 0x7Fu) << 25u;

    block.y = (ep0.z >> 7u) & 0x7u;
    block.y |= (ep1.x & 0x3FFu) << 3u;
    block.y |= (ep1.y & 0x3FFu) << 13u;
    block.y |= (ep1.z & 0x1FFu) << 23u;

    block.z = (ep1.z >> 9u) & 1u;
    block.z |= (indices[0] & 7u) << 1u;
    for (var i = 1u; i < 8u; i++) {
        block.z |= (indices[i] & 0xFu) << (i * 4u);
    }

    for (var i = 8u; i < 16u; i++) {
        block.w |= (indices[i] & 0xFu) << ((i - 8u) * 4u);
    }

    return EncodeResult(block, totalError);
}

// ─── 1-Subset Transformed Mode Encoder (modes 11, 12, 13) ───────────────────

fn encode1SubsetTransformed(
    pixPh: array<vec3<f32>, 16>,
    modeIdx: u32
) -> EncodeResult {
    let prec = candidateModePrec[modeIdx];

    // Find endpoints by luminance
    var epLow = pixPh[0];
    var epHigh = pixPh[0];
    var lumLow = dot(pixPh[0], RGB2LUM);
    var lumHigh = lumLow;

    for (var i = 1u; i < 16u; i++) {
        let lum = dot(pixPh[i], RGB2LUM);
        if (lum < lumLow) { lumLow = lum; epLow = pixPh[i]; }
        if (lum > lumHigh) { lumHigh = lum; epHigh = pixPh[i]; }
    }

    // Anchor fix
    var span = epHigh - epLow;
    var spanNormSqr = dot(span, span);
    let dotP0 = dot(span, pixPh[0] - epLow);
    if (spanNormSqr > 0.0 && dotP0 >= 0.0 && u32(dotP0 * 63.49999 / spanNormSqr) > 32u) {
        let tmp = epLow; epLow = epHigh; epHigh = tmp;
    }

    span = epHigh - epLow;
    spanNormSqr = dot(span, span);

    // Quantize to epPrec
    var ep0q = vec3<u32>(quantize(u32(epLow.x), prec.x), quantize(u32(epLow.y), prec.x), quantize(u32(epLow.z), prec.x));
    var ep1q = vec3<u32>(quantize(u32(epHigh.x), prec.x), quantize(u32(epHigh.y), prec.x), quantize(u32(epHigh.z), prec.x));

    // Compute deltas
    ep1q = vec3<u32>(
        u32(i32(ep1q.x) - i32(ep0q.x)),
        u32(i32(ep1q.y) - i32(ep0q.y)),
        u32(i32(ep1q.z) - i32(ep0q.z))
    );

    // Finish quantize
    let bad = finishQuantize1Subset(&ep0q, &ep1q, prec, true);

    // Unquantize for error measurement
    var e0 = vec3<i32>(i32(ep0q.x), i32(ep0q.y), i32(ep0q.z));
    var e1 = vec3<i32>(i32(ep1q.x), i32(ep1q.y), i32(ep1q.z));
    startUnquantize1Subset(&e0, &e1, prec, true);

    let e0u = vec3<i32>(unquantizeI(e0.x, prec.x), unquantizeI(e0.y, prec.x), unquantizeI(e0.z, prec.x));
    let e1u = vec3<i32>(unquantizeI(e1.x, prec.x), unquantizeI(e1.y, prec.x), unquantizeI(e1.z, prec.x));

    // Compute 4-bit indices and error
    var indices: array<u32, 16>;
    var totalError = 0.0;
    for (var i = 0u; i < 16u; i++) {
        let dotProduct = dot(span, pixPh[i] - epLow);
        var idx = 0u;
        if (spanNormSqr <= 0.0 || dotProduct <= 0.0) {
            idx = 0u;
        } else if (dotProduct >= spanNormSqr) {
            idx = aStep2[63];
        } else {
            idx = aStep2[u32(dotProduct * 63.49999 / spanNormSqr)];
        }
        indices[i] = idx;

        let w = i32(aWeight4[idx]);
        let decoded = vec3<f32>(
            f32((e0u.x * (64 - w) + e1u.x * w + 32) >> 6),
            f32((e0u.y * (64 - w) + e1u.y * w + 32) >> 6),
            f32((e0u.z * (64 - w) + e1u.z * w + 32) >> 6)
        );
        let diff = pixPh[i] - decoded;
        totalError += dot(diff, diff);
    }

    if (bad) {
        totalError = 1e20;
    }

    // Pack block — 1-subset modes share the same layout for ep + indices
    var block = vec4<u32>(0u, 0u, 0u, 0u);

    let modeId = candidateModeMemory[modeIdx];
    let modeBits = candidateModeBits[modeIdx];

    // Mode ID
    setBits(&block, 0u, modeBits, modeId);

    if (modeIdx == 11u) {
        // Mode 12 in spec: 11-bit ep0, 9-bit delta
        // Mode ID = 0x07 (5 bits: 00111)
        // ep0.r[9:0] at bits 5-14
        setBits(&block, 5u, 10u, ep0q.x & 0x3FFu);
        // ep0.g[9:0] at bits 15-24
        setBits(&block, 15u, 10u, ep0q.y & 0x3FFu);
        // ep0.b[9:0] at bits 25-34
        setBits(&block, 25u, 10u, ep0q.z & 0x3FFu);
        // ep1.r[8:0] at bits 35-43
        setBits(&block, 35u, 9u, ep1q.x & 0x1FFu);
        // ep0.r[10] at bit 44
        setBit(&block, 44u, (ep0q.x >> 10u) & 1u);
        // ep1.g[8:0] at bits 45-53
        setBits(&block, 45u, 9u, ep1q.y & 0x1FFu);
        // ep0.g[10] at bit 54
        setBit(&block, 54u, (ep0q.y >> 10u) & 1u);
        // ep1.b[8:0] at bits 55-63
        setBits(&block, 55u, 9u, ep1q.z & 0x1FFu);
        // ep0.b[10] at bit 64
        setBit(&block, 64u, (ep0q.z >> 10u) & 1u);
    } else if (modeIdx == 12u) {
        // Mode 13 in spec: 12-bit ep0, 8-bit delta
        // Mode ID = 0x0B (5 bits: 01011)
        setBits(&block, 5u, 10u, ep0q.x & 0x3FFu);
        setBits(&block, 15u, 10u, ep0q.y & 0x3FFu);
        setBits(&block, 25u, 10u, ep0q.z & 0x3FFu);
        // ep1.r[7:0] at bits 35-42
        setBits(&block, 35u, 8u, ep1q.x & 0xFFu);
        // ep0.r[11] at bit 43
        setBit(&block, 43u, (ep0q.x >> 11u) & 1u);
        // ep0.r[10] at bit 44
        setBit(&block, 44u, (ep0q.x >> 10u) & 1u);
        // ep1.g[7:0] at bits 45-52
        setBits(&block, 45u, 8u, ep1q.y & 0xFFu);
        // ep0.g[11] at bit 53
        setBit(&block, 53u, (ep0q.y >> 11u) & 1u);
        // ep0.g[10] at bit 54
        setBit(&block, 54u, (ep0q.y >> 10u) & 1u);
        // ep1.b[7:0] at bits 55-62
        setBits(&block, 55u, 8u, ep1q.z & 0xFFu);
        // ep0.b[11] at bit 63
        setBit(&block, 63u, (ep0q.z >> 11u) & 1u);
        // ep0.b[10] at bit 64
        setBit(&block, 64u, (ep0q.z >> 10u) & 1u);
    } else if (modeIdx == 13u) {
        // Mode 14 in spec: 16-bit ep0, 4-bit delta
        // Mode ID = 0x0F (5 bits: 01111)
        setBits(&block, 5u, 10u, ep0q.x & 0x3FFu);
        setBits(&block, 15u, 10u, ep0q.y & 0x3FFu);
        setBits(&block, 25u, 10u, ep0q.z & 0x3FFu);
        // ep1.r[3:0] at bits 35-38
        setBits(&block, 35u, 4u, ep1q.x & 0xFu);
        // ep0.r[15:10] at bits 39-44 (reversed per reference)
        setBit(&block, 39u, (ep0q.x >> 15u) & 1u);
        setBit(&block, 40u, (ep0q.x >> 14u) & 1u);
        setBit(&block, 41u, (ep0q.x >> 13u) & 1u);
        setBit(&block, 42u, (ep0q.x >> 12u) & 1u);
        setBit(&block, 43u, (ep0q.x >> 11u) & 1u);
        setBit(&block, 44u, (ep0q.x >> 10u) & 1u);
        // ep1.g[3:0] at bits 45-48
        setBits(&block, 45u, 4u, ep1q.y & 0xFu);
        // ep0.g[15:10] at bits 49-54 (reversed per reference)
        setBit(&block, 49u, (ep0q.y >> 15u) & 1u);
        setBit(&block, 50u, (ep0q.y >> 14u) & 1u);
        setBit(&block, 51u, (ep0q.y >> 13u) & 1u);
        setBit(&block, 52u, (ep0q.y >> 12u) & 1u);
        setBit(&block, 53u, (ep0q.y >> 11u) & 1u);
        setBit(&block, 54u, (ep0q.y >> 10u) & 1u);
        // ep1.b[3:0] at bits 55-58
        setBits(&block, 55u, 4u, ep1q.z & 0xFu);
        // ep0.b[15:10] at bits 59-64 (reversed per reference)
        setBit(&block, 59u, (ep0q.z >> 15u) & 1u);
        setBit(&block, 60u, (ep0q.z >> 14u) & 1u);
        setBit(&block, 61u, (ep0q.z >> 13u) & 1u);
        setBit(&block, 62u, (ep0q.z >> 12u) & 1u);
        setBit(&block, 63u, (ep0q.z >> 11u) & 1u);
        setBit(&block, 64u, (ep0q.z >> 10u) & 1u);
    }

    // 4-bit indices start at bit 65, anchor pixel 0 has 3-bit index
    var bitPos = 65u;
    setBits(&block, bitPos, 3u, indices[0] & 7u);
    bitPos += 3u;
    for (var i = 1u; i < 16u; i++) {
        setBits(&block, bitPos, 4u, indices[i] & 0xFu);
        bitPos += 4u;
    }

    return EncodeResult(block, totalError);
}

// ─── 2-Subset Mode Encoder (modes 0-9) ──────────────────────────────────────

fn encode2Subset(
    pixPh: array<vec3<f32>, 16>,
    modeIdx: u32,
    partitionIndex: u32
) -> EncodeResult {
    let prec = candidateModePrec[modeIdx];
    let transformed = candidateModeTransformed[modeIdx] == 1u;
    let pattern = candidateSectionBit[partitionIndex];
    let fixupIdx = candidateFixUpIndex1D[partitionIndex];

    // Find luminance min/max endpoints per subset
    var ep0Low = pixPh[0];
    var ep0High = pixPh[0];
    var ep1Low = vec3<f32>(0.0);
    var ep1High = vec3<f32>(0.0);
    var ep0LumLow = dot(pixPh[0], RGB2LUM);
    var ep0LumHigh = ep0LumLow;
    var ep1LumLow = 1e20;
    var ep1LumHigh = -1e20;
    var s1Init = false;

    // Initialize subset 0 properly: only include pixels that belong to subset 0
    var s0Init = false;
    for (var i = 0u; i < 16u; i++) {
        let subset = (pattern >> i) & 1u;
        let lum = dot(pixPh[i], RGB2LUM);
        if (subset == 0u) {
            if (!s0Init) {
                ep0Low = pixPh[i]; ep0High = pixPh[i];
                ep0LumLow = lum; ep0LumHigh = lum;
                s0Init = true;
            } else {
                if (lum < ep0LumLow) { ep0LumLow = lum; ep0Low = pixPh[i]; }
                if (lum > ep0LumHigh) { ep0LumHigh = lum; ep0High = pixPh[i]; }
            }
        } else {
            if (!s1Init) {
                ep1Low = pixPh[i]; ep1High = pixPh[i];
                ep1LumLow = lum; ep1LumHigh = lum;
                s1Init = true;
            } else {
                if (lum < ep1LumLow) { ep1LumLow = lum; ep1Low = pixPh[i]; }
                if (lum > ep1LumHigh) { ep1LumHigh = lum; ep1High = pixPh[i]; }
            }
        }
    }

    // Anchor fix per subset
    var span0 = ep0High - ep0Low;
    var spanSqr0 = dot(span0, span0);
    if (spanSqr0 > 0.0) {
        let d = dot(span0, pixPh[0] - ep0Low);
        if (d >= 0.0 && u32(d * 63.49999 / spanSqr0) > 32u) {
            let tmp = ep0Low; ep0Low = ep0High; ep0High = tmp;
        }
    }

    var span1 = ep1High - ep1Low;
    var spanSqr1 = dot(span1, span1);
    if (spanSqr1 > 0.0) {
        let d = dot(span1, pixPh[fixupIdx] - ep1Low);
        if (d >= 0.0 && u32(d * 63.49999 / spanSqr1) > 32u) {
            let tmp = ep1Low; ep1Low = ep1High; ep1High = tmp;
        }
    }

    span0 = ep0High - ep0Low;
    spanSqr0 = dot(span0, span0);
    span1 = ep1High - ep1Low;
    spanSqr1 = dot(span1, span1);

    // Quantize all 4 endpoints to epPrec
    var e00 = vec3<u32>(quantize(u32(ep0Low.x), prec.x), quantize(u32(ep0Low.y), prec.x), quantize(u32(ep0Low.z), prec.x));
    var e01 = vec3<u32>(quantize(u32(ep0High.x), prec.x), quantize(u32(ep0High.y), prec.x), quantize(u32(ep0High.z), prec.x));
    var e10 = vec3<u32>(quantize(u32(ep1Low.x), prec.x), quantize(u32(ep1Low.y), prec.x), quantize(u32(ep1Low.z), prec.x));
    var e11 = vec3<u32>(quantize(u32(ep1High.x), prec.x), quantize(u32(ep1High.y), prec.x), quantize(u32(ep1High.z), prec.x));

    // Compute deltas if transformed
    if (transformed) {
        e01 = vec3<u32>(u32(i32(e01.x) - i32(e00.x)), u32(i32(e01.y) - i32(e00.y)), u32(i32(e01.z) - i32(e00.z)));
        e10 = vec3<u32>(u32(i32(e10.x) - i32(e00.x)), u32(i32(e10.y) - i32(e00.y)), u32(i32(e10.z) - i32(e00.z)));
        e11 = vec3<u32>(u32(i32(e11.x) - i32(e00.x)), u32(i32(e11.y) - i32(e00.y)), u32(i32(e11.z) - i32(e00.z)));
    }

    // Finish quantize (clamp deltas, detect overflow)
    let bad = finishQuantize2Subset(&e00, &e01, &e10, &e11, prec, transformed);

    // Unquantize for error measurement
    var ue00 = vec3<i32>(i32(e00.x), i32(e00.y), i32(e00.z));
    var ue01 = vec3<i32>(i32(e01.x), i32(e01.y), i32(e01.z));
    var ue10 = vec3<i32>(i32(e10.x), i32(e10.y), i32(e10.z));
    var ue11 = vec3<i32>(i32(e11.x), i32(e11.y), i32(e11.z));

    startUnquantize2Subset(&ue00, &ue01, &ue10, &ue11, prec, transformed);

    let ue00u = vec3<i32>(unquantizeI(ue00.x, prec.x), unquantizeI(ue00.y, prec.x), unquantizeI(ue00.z, prec.x));
    let ue01u = vec3<i32>(unquantizeI(ue01.x, prec.x), unquantizeI(ue01.y, prec.x), unquantizeI(ue01.z, prec.x));
    let ue10u = vec3<i32>(unquantizeI(ue10.x, prec.x), unquantizeI(ue10.y, prec.x), unquantizeI(ue10.z, prec.x));
    let ue11u = vec3<i32>(unquantizeI(ue11.x, prec.x), unquantizeI(ue11.y, prec.x), unquantizeI(ue11.z, prec.x));

    // Compute 3-bit indices and error
    var indices: array<u32, 16>;
    var totalError = 0.0;

    for (var i = 0u; i < 16u; i++) {
        let subset = (pattern >> i) & 1u;
        var span_v: vec3<f32>;
        var spanSqr: f32;
        var low: vec3<f32>;
        var lowUQ: vec3<i32>;
        var highUQ: vec3<i32>;

        if (subset == 0u) {
            span_v = span0; spanSqr = spanSqr0; low = ep0Low; lowUQ = ue00u; highUQ = ue01u;
        } else {
            span_v = span1; spanSqr = spanSqr1; low = ep1Low; lowUQ = ue10u; highUQ = ue11u;
        }

        let dotProduct = dot(span_v, pixPh[i] - low);
        var idx = 0u;
        if (spanSqr <= 0.0 || dotProduct <= 0.0) {
            idx = 0u;
        } else if (dotProduct >= spanSqr) {
            idx = aStep1[63];
        } else {
            idx = aStep1[u32(dotProduct * 63.49999 / spanSqr)];
        }
        indices[i] = idx;

        let w = i32(aWeight3[idx]);
        let decoded = vec3<f32>(
            f32((lowUQ.x * (64 - w) + highUQ.x * w + 32) >> 6),
            f32((lowUQ.y * (64 - w) + highUQ.y * w + 32) >> 6),
            f32((lowUQ.z * (64 - w) + highUQ.z * w + 32) >> 6)
        );
        let diff = pixPh[i] - decoded;
        totalError += dot(diff, diff);
    }

    if (bad) {
        totalError = 1e20;
    }

    // ─── Pack block ──────────────────────────────────────────────────────
    var block = vec4<u32>(0u, 0u, 0u, 0u);

    // Bit packing is mode-specific and matches the DirectX reference exactly.
    // Each mode has a scattered bit layout defined by the BC6H specification.
    //
    // Naming convention from reference:
    //   endPoint[0][0] = e00 (subset 0, low)     endPoint[0][1] = e01 (subset 0, high / delta)
    //   endPoint[1][0] = e10 (subset 1, low / delta)     endPoint[1][1] = e11 (subset 1, high / delta)

    if (modeIdx == 0u) {
        // Mode 0: ID=0x00 (2 bits), ep=10-bit, delta=5-bit, 2-subset, 3-bit indices
        setBits(&block, 0u, 2u, 0x00u);
        setBit(&block, 2u, (e10.y >> 4u) & 1u);
        setBit(&block, 3u, (e10.z >> 4u) & 1u);
        setBit(&block, 4u, (e11.z >> 4u) & 1u);
        setBits(&block, 5u, 10u, e00.x);
        setBits(&block, 15u, 10u, e00.y);
        setBits(&block, 25u, 7u, e00.z & 0x7Fu);
        setBits(&block, 32u, 3u, (e00.z >> 7u) & 0x7u);
        setBits(&block, 35u, 5u, e01.x & 0x1Fu);
        setBit(&block, 40u, (e11.y >> 4u) & 1u);
        setBits(&block, 41u, 4u, e10.y & 0xFu);
        setBits(&block, 45u, 5u, e01.y & 0x1Fu);
        setBit(&block, 50u, (e11.z >> 0u) & 1u);
        setBits(&block, 51u, 4u, e11.y & 0xFu);
        setBits(&block, 55u, 5u, e01.z & 0x1Fu);
        setBit(&block, 60u, (e11.z >> 1u) & 1u);
        setBits(&block, 61u, 3u, e10.z & 0x7u);
        setBit(&block, 64u, (e10.z >> 3u) & 1u);
        setBits(&block, 65u, 5u, e10.x & 0x1Fu);
        setBit(&block, 70u, (e11.z >> 2u) & 1u);
        setBits(&block, 71u, 5u, e11.x & 0x1Fu);
        setBit(&block, 76u, (e11.z >> 3u) & 1u);
        setBits(&block, 77u, 5u, partitionIndex);
    } else if (modeIdx == 1u) {
        // Mode 1: ID=0x01 (2 bits), ep=7-bit, delta=6-bit, 2-subset, 3-bit indices
        setBits(&block, 0u, 2u, 0x01u);
        setBit(&block, 2u, (e10.y >> 5u) & 1u);
        setBit(&block, 3u, (e11.y >> 4u) & 1u);
        setBit(&block, 4u, (e11.y >> 5u) & 1u);
        setBits(&block, 5u, 7u, e00.x & 0x7Fu);
        setBit(&block, 12u, (e11.z >> 0u) & 1u);
        setBit(&block, 13u, (e11.z >> 1u) & 1u);
        setBit(&block, 14u, (e10.z >> 4u) & 1u);
        setBits(&block, 15u, 7u, e00.y & 0x7Fu);
        setBit(&block, 22u, (e10.z >> 5u) & 1u);
        setBit(&block, 23u, (e11.z >> 2u) & 1u);
        setBit(&block, 24u, (e10.y >> 4u) & 1u);
        setBits(&block, 25u, 7u, e00.z & 0x7Fu);
        setBit(&block, 32u, (e11.z >> 3u) & 1u);
        setBit(&block, 33u, (e11.z >> 5u) & 1u);
        setBit(&block, 34u, (e11.z >> 4u) & 1u);
        setBits(&block, 35u, 6u, e01.x & 0x3Fu);
        setBits(&block, 41u, 4u, e10.y & 0xFu);
        setBits(&block, 45u, 6u, e01.y & 0x3Fu);
        setBits(&block, 51u, 4u, e11.y & 0xFu);
        setBits(&block, 55u, 6u, e01.z & 0x3Fu);
        setBits(&block, 61u, 3u, e10.z & 0x7u);
        setBit(&block, 64u, (e10.z >> 3u) & 1u);
        setBits(&block, 65u, 6u, e10.x & 0x3Fu);
        setBits(&block, 71u, 6u, e11.x & 0x3Fu);
        setBits(&block, 77u, 5u, partitionIndex);
    } else if (modeIdx == 2u) {
        // Mode 2: ID=0x02 (5 bits), ep=11-bit, delta=(5,4,4), 2-subset, 3-bit
        setBits(&block, 0u, 5u, 0x02u);
        setBits(&block, 5u, 10u, e00.x & 0x3FFu);
        setBits(&block, 15u, 10u, e00.y & 0x3FFu);
        setBits(&block, 25u, 7u, e00.z & 0x7Fu);
        setBits(&block, 32u, 3u, (e00.z >> 7u) & 0x7u);
        setBits(&block, 35u, 5u, e01.x & 0x1Fu);
        setBit(&block, 40u, (e00.x >> 10u) & 1u);
        setBits(&block, 41u, 4u, e10.y & 0xFu);
        setBits(&block, 45u, 4u, e01.y & 0xFu);
        setBit(&block, 49u, (e00.y >> 10u) & 1u);
        setBit(&block, 50u, (e11.z >> 0u) & 1u);
        setBits(&block, 51u, 4u, e11.y & 0xFu);
        setBits(&block, 55u, 4u, e01.z & 0xFu);
        setBit(&block, 59u, (e00.z >> 10u) & 1u);
        setBit(&block, 60u, (e11.z >> 1u) & 1u);
        setBits(&block, 61u, 3u, e10.z & 0x7u);
        setBit(&block, 64u, (e10.z >> 3u) & 1u);
        setBits(&block, 65u, 5u, e10.x & 0x1Fu);
        setBit(&block, 70u, (e11.z >> 2u) & 1u);
        setBits(&block, 71u, 5u, e11.x & 0x1Fu);
        setBit(&block, 76u, (e11.z >> 3u) & 1u);
        setBits(&block, 77u, 5u, partitionIndex);
    } else if (modeIdx == 3u) {
        // Mode 3: ID=0x06 (5 bits), ep=11-bit, delta=(4,5,4), 2-subset, 3-bit
        setBits(&block, 0u, 5u, 0x06u);
        setBits(&block, 5u, 10u, e00.x & 0x3FFu);
        setBits(&block, 15u, 10u, e00.y & 0x3FFu);
        setBits(&block, 25u, 7u, e00.z & 0x7Fu);
        setBits(&block, 32u, 3u, (e00.z >> 7u) & 0x7u);
        setBits(&block, 35u, 4u, e01.x & 0xFu);
        setBit(&block, 39u, (e00.x >> 10u) & 1u);
        setBit(&block, 40u, (e11.y >> 4u) & 1u);
        setBits(&block, 41u, 4u, e10.y & 0xFu);
        setBits(&block, 45u, 5u, e01.y & 0x1Fu);
        setBit(&block, 50u, (e00.y >> 10u) & 1u);
        setBits(&block, 51u, 4u, e11.y & 0xFu);
        setBits(&block, 55u, 4u, e01.z & 0xFu);
        setBit(&block, 59u, (e00.z >> 10u) & 1u);
        setBit(&block, 60u, (e11.z >> 1u) & 1u);
        setBits(&block, 61u, 3u, e10.z & 0x7u);
        setBit(&block, 64u, (e10.z >> 3u) & 1u);
        setBits(&block, 65u, 4u, e10.x & 0xFu);
        setBit(&block, 69u, (e11.z >> 0u) & 1u);
        setBit(&block, 70u, (e11.z >> 2u) & 1u);
        setBits(&block, 71u, 4u, e11.x & 0xFu);
        setBit(&block, 75u, (e10.y >> 4u) & 1u);
        setBit(&block, 76u, (e11.z >> 3u) & 1u);
        setBits(&block, 77u, 5u, partitionIndex);
    } else if (modeIdx == 4u) {
        // Mode 4: ID=0x0A (5 bits), ep=11-bit, delta=(4,4,5), 2-subset, 3-bit
        setBits(&block, 0u, 5u, 0x0Au);
        setBits(&block, 5u, 10u, e00.x & 0x3FFu);
        setBits(&block, 15u, 10u, e00.y & 0x3FFu);
        setBits(&block, 25u, 7u, e00.z & 0x7Fu);
        setBits(&block, 32u, 3u, (e00.z >> 7u) & 0x7u);
        setBits(&block, 35u, 4u, e01.x & 0xFu);
        setBit(&block, 39u, (e00.x >> 10u) & 1u);
        setBit(&block, 40u, (e10.z >> 4u) & 1u);
        setBits(&block, 41u, 4u, e10.y & 0xFu);
        setBits(&block, 45u, 4u, e01.y & 0xFu);
        setBit(&block, 49u, (e00.y >> 10u) & 1u);
        setBit(&block, 50u, (e11.z >> 0u) & 1u);
        setBits(&block, 51u, 4u, e11.y & 0xFu);
        setBits(&block, 55u, 5u, e01.z & 0x1Fu);
        setBit(&block, 60u, (e00.z >> 10u) & 1u);
        setBits(&block, 61u, 3u, e10.z & 0x7u);
        setBit(&block, 64u, (e10.z >> 3u) & 1u);
        setBits(&block, 65u, 4u, e10.x & 0xFu);
        setBit(&block, 69u, (e11.z >> 1u) & 1u);
        setBit(&block, 70u, (e11.z >> 2u) & 1u);
        setBits(&block, 71u, 4u, e11.x & 0xFu);
        setBit(&block, 75u, (e11.z >> 4u) & 1u);
        setBit(&block, 76u, (e11.z >> 3u) & 1u);
        setBits(&block, 77u, 5u, partitionIndex);
    } else if (modeIdx == 5u) {
        // Mode 5: ID=0x0E (5 bits), ep=9-bit, delta=5-bit, 2-subset, 3-bit
        setBits(&block, 0u, 5u, 0x0Eu);
        setBits(&block, 5u, 9u, e00.x & 0x1FFu);
        setBit(&block, 14u, (e10.z >> 4u) & 1u);
        setBits(&block, 15u, 9u, e00.y & 0x1FFu);
        setBit(&block, 24u, (e10.y >> 4u) & 1u);
        setBits(&block, 25u, 7u, e00.z & 0x7Fu);
        setBits(&block, 32u, 2u, (e00.z >> 7u) & 0x3u);
        setBit(&block, 34u, (e11.z >> 4u) & 1u);
        setBits(&block, 35u, 5u, e01.x & 0x1Fu);
        setBit(&block, 40u, (e11.y >> 4u) & 1u);
        setBits(&block, 41u, 4u, e10.y & 0xFu);
        setBits(&block, 45u, 5u, e01.y & 0x1Fu);
        setBit(&block, 50u, (e11.z >> 0u) & 1u);
        setBits(&block, 51u, 4u, e11.y & 0xFu);
        setBits(&block, 55u, 5u, e01.z & 0x1Fu);
        setBit(&block, 60u, (e11.z >> 1u) & 1u);
        setBits(&block, 61u, 3u, e10.z & 0x7u);
        setBit(&block, 64u, (e10.z >> 3u) & 1u);
        setBits(&block, 65u, 5u, e10.x & 0x1Fu);
        setBit(&block, 70u, (e11.z >> 2u) & 1u);
        setBits(&block, 71u, 5u, e11.x & 0x1Fu);
        setBit(&block, 76u, (e11.z >> 3u) & 1u);
        setBits(&block, 77u, 5u, partitionIndex);
    } else if (modeIdx == 6u) {
        // Mode 6: ID=0x12 (5 bits), ep=8-bit, delta=(6,5,5), 2-subset, 3-bit
        setBits(&block, 0u, 5u, 0x12u);
        setBits(&block, 5u, 8u, e00.x & 0xFFu);
        setBit(&block, 13u, (e11.y >> 4u) & 1u);
        setBit(&block, 14u, (e10.z >> 4u) & 1u);
        setBits(&block, 15u, 8u, e00.y & 0xFFu);
        setBit(&block, 23u, (e11.z >> 2u) & 1u);
        setBit(&block, 24u, (e10.y >> 4u) & 1u);
        setBits(&block, 25u, 7u, e00.z & 0x7Fu);
        setBit(&block, 32u, (e00.z >> 7u) & 1u);
        setBit(&block, 33u, (e11.z >> 3u) & 1u);
        setBit(&block, 34u, (e11.z >> 4u) & 1u);
        setBits(&block, 35u, 6u, e01.x & 0x3Fu);
        setBits(&block, 41u, 4u, e10.y & 0xFu);
        setBits(&block, 45u, 5u, e01.y & 0x1Fu);
        setBit(&block, 50u, (e11.z >> 0u) & 1u);
        setBits(&block, 51u, 4u, e11.y & 0xFu);
        setBits(&block, 55u, 5u, e01.z & 0x1Fu);
        setBit(&block, 60u, (e11.z >> 1u) & 1u);
        setBits(&block, 61u, 3u, e10.z & 0x7u);
        setBit(&block, 64u, (e10.z >> 3u) & 1u);
        setBits(&block, 65u, 6u, e10.x & 0x3Fu);
        setBits(&block, 71u, 6u, e11.x & 0x3Fu);
        setBits(&block, 77u, 5u, partitionIndex);
    } else if (modeIdx == 7u) {
        // Mode 7: ID=0x16 (5 bits), ep=8-bit, delta=(5,6,5), 2-subset, 3-bit
        setBits(&block, 0u, 5u, 0x16u);
        setBits(&block, 5u, 8u, e00.x & 0xFFu);
        setBit(&block, 13u, (e11.z >> 0u) & 1u);
        setBit(&block, 14u, (e10.z >> 4u) & 1u);
        setBits(&block, 15u, 8u, e00.y & 0xFFu);
        setBit(&block, 23u, (e10.y >> 5u) & 1u);
        setBit(&block, 24u, (e10.y >> 4u) & 1u);
        setBits(&block, 25u, 7u, e00.z & 0x7Fu);
        setBit(&block, 32u, (e00.z >> 7u) & 1u);
        setBit(&block, 33u, (e11.y >> 5u) & 1u);
        setBit(&block, 34u, (e11.z >> 4u) & 1u);
        setBits(&block, 35u, 5u, e01.x & 0x1Fu);
        setBit(&block, 40u, (e11.y >> 4u) & 1u);
        setBits(&block, 41u, 4u, e10.y & 0xFu);
        setBits(&block, 45u, 6u, e01.y & 0x3Fu);
        setBits(&block, 51u, 4u, e11.y & 0xFu);
        setBits(&block, 55u, 5u, e01.z & 0x1Fu);
        setBit(&block, 60u, (e11.z >> 1u) & 1u);
        setBits(&block, 61u, 3u, e10.z & 0x7u);
        setBit(&block, 64u, (e10.z >> 3u) & 1u);
        setBits(&block, 65u, 5u, e10.x & 0x1Fu);
        setBit(&block, 70u, (e11.z >> 2u) & 1u);
        setBits(&block, 71u, 5u, e11.x & 0x1Fu);
        setBit(&block, 76u, (e11.z >> 3u) & 1u);
        setBits(&block, 77u, 5u, partitionIndex);
    } else if (modeIdx == 8u) {
        // Mode 8: ID=0x1A (5 bits), ep=8-bit, delta=(5,5,6), 2-subset, 3-bit
        setBits(&block, 0u, 5u, 0x1Au);
        setBits(&block, 5u, 8u, e00.x & 0xFFu);
        setBit(&block, 13u, (e11.z >> 1u) & 1u);
        setBit(&block, 14u, (e10.z >> 4u) & 1u);
        setBits(&block, 15u, 8u, e00.y & 0xFFu);
        setBit(&block, 23u, (e10.z >> 5u) & 1u);
        setBit(&block, 24u, (e10.y >> 4u) & 1u);
        setBits(&block, 25u, 7u, e00.z & 0x7Fu);
        setBit(&block, 32u, (e00.z >> 7u) & 1u);
        setBit(&block, 33u, (e11.z >> 5u) & 1u);
        setBit(&block, 34u, (e11.z >> 4u) & 1u);
        setBits(&block, 35u, 5u, e01.x & 0x1Fu);
        setBit(&block, 40u, (e11.y >> 4u) & 1u);
        setBits(&block, 41u, 4u, e10.y & 0xFu);
        setBits(&block, 45u, 5u, e01.y & 0x1Fu);
        setBit(&block, 50u, (e11.z >> 0u) & 1u);
        setBits(&block, 51u, 4u, e11.y & 0xFu);
        setBits(&block, 55u, 6u, e01.z & 0x3Fu);
        setBits(&block, 61u, 3u, e10.z & 0x7u);
        setBit(&block, 64u, (e10.z >> 3u) & 1u);
        setBits(&block, 65u, 5u, e10.x & 0x1Fu);
        setBit(&block, 70u, (e11.z >> 2u) & 1u);
        setBits(&block, 71u, 5u, e11.x & 0x1Fu);
        setBit(&block, 76u, (e11.z >> 3u) & 1u);
        setBits(&block, 77u, 5u, partitionIndex);
    } else { // modeIdx == 9u
        // Mode 9: ID=0x1E (5 bits), ep=6-bit, untransformed, 2-subset, 3-bit
        setBits(&block, 0u, 5u, 0x1Eu);
        setBits(&block, 5u, 6u, e00.x);
        setBit(&block, 11u, (e11.y >> 4u) & 1u);
        setBits(&block, 12u, 2u, e11.z & 3u);
        setBit(&block, 14u, (e10.z >> 4u) & 1u);
        setBits(&block, 15u, 6u, e00.y);
        setBit(&block, 21u, (e10.y >> 5u) & 1u);
        setBit(&block, 22u, (e10.z >> 5u) & 1u);
        setBit(&block, 23u, (e11.z >> 2u) & 1u);
        setBit(&block, 24u, (e10.y >> 4u) & 1u);
        setBits(&block, 25u, 6u, e00.z);
        setBit(&block, 31u, (e11.y >> 5u) & 1u);
        setBit(&block, 32u, (e11.z >> 3u) & 1u);
        setBit(&block, 33u, (e11.z >> 5u) & 1u);
        setBit(&block, 34u, (e11.z >> 4u) & 1u);
        setBits(&block, 35u, 6u, e01.x);
        setBits(&block, 41u, 4u, e10.y & 0xFu);
        setBits(&block, 45u, 6u, e01.y);
        setBits(&block, 51u, 4u, e11.y & 0xFu);
        setBits(&block, 55u, 6u, e01.z);
        setBits(&block, 61u, 3u, e10.z & 7u);
        setBit(&block, 64u, (e10.z >> 3u) & 1u);
        setBits(&block, 65u, 6u, e10.x);
        setBits(&block, 71u, 6u, e11.x);
        setBits(&block, 77u, 5u, partitionIndex);
    }

    // 3-bit indices starting at bit 82
    var bitPos = 82u;
    for (var i = 0u; i < 16u; i++) {
        if (i == 0u || i == fixupIdx) {
            setBits(&block, bitPos, 2u, indices[i] & 3u);
            bitPos += 2u;
        } else {
            setBits(&block, bitPos, 3u, indices[i] & 7u);
            bitPos += 3u;
        }
    }

    return EncodeResult(block, totalError);
}

// ─── Main Compute Entry ─────────────────────────────────────────────────────

@compute @workgroup_size(1, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let blockX = gid.x;
    let blockY = gid.y;
    let blocksPerRow = (params.width + 3u) / 4u;

    if (blockX >= blocksPerRow || blockY >= ((params.height + 3u) / 4u)) {
        return;
    }

    // Load 4x4 pixel block
    var pixels: array<vec3<f32>, 16>;
    for (var dy = 0u; dy < 4u; dy++) {
        for (var dx = 0u; dx < 4u; dx++) {
            let px = min(blockX * 4u + dx, params.width - 1u);
            let py = min(blockY * 4u + dy, params.height - 1u);
            let color = textureLoad(sourceTexture, vec2<u32>(px, py), 0);
            pixels[dy * 4u + dx] = max(color.rgb, vec3<f32>(0.0));
        }
    }

    // Convert to quantization space
    var pixPh: array<vec3<f32>, 16>;
    for (var i = 0u; i < 16u; i++) {
        pixPh[i] = vec3<f32>(
            f32(startQuantize(floatToHalf(pixels[i].x))),
            f32(startQuantize(floatToHalf(pixels[i].y))),
            f32(startQuantize(floatToHalf(pixels[i].z)))
        );
    }

    // ─── Quality 0: Mode 10 only (1-subset, 10-bit, 4-bit indices) ──────
    var best = encodeMode10_1subset(pixPh);

    if (params.quality >= 1u) {
        // ─── Quality 1: Add Mode 9 (untransformed 2-subset) and some good transformed modes
        // Try 1-subset transformed modes 11 (most useful for smooth gradients)
        let m11 = encode1SubsetTransformed(pixPh, 11u);
        if (m11.error < best.error) { best = m11; }

        // Try 2-subset modes: Mode 1 (7-bit, 6-bit delta — good all-rounder)
        // and Mode 0 (10-bit, 5-bit delta), Mode 5 (9-bit, 5-bit delta)
        for (var p = 0u; p < 32u; p++) {
            let m1 = encode2Subset(pixPh, 1u, p);
            if (m1.error < best.error) { best = m1; }

            let m0 = encode2Subset(pixPh, 0u, p);
            if (m0.error < best.error) { best = m0; }

            let m5 = encode2Subset(pixPh, 5u, p);
            if (m5.error < best.error) { best = m5; }

            // Mode 9 (untransformed 6-bit)
            let m9 = encode2Subset(pixPh, 9u, p);
            if (m9.error < best.error) { best = m9; }
        }
    }

    if (params.quality >= 2u) {
        // ─── Quality 2: All 14 modes ────────────────────────────────────

        // 1-subset transformed modes 12, 13
        let m12 = encode1SubsetTransformed(pixPh, 12u);
        if (m12.error < best.error) { best = m12; }
        let m13 = encode1SubsetTransformed(pixPh, 13u);
        if (m13.error < best.error) { best = m13; }

        // All remaining 2-subset modes: 2, 3, 4, 6, 7, 8
        for (var p = 0u; p < 32u; p++) {
            let m2 = encode2Subset(pixPh, 2u, p);
            if (m2.error < best.error) { best = m2; }
            let m3 = encode2Subset(pixPh, 3u, p);
            if (m3.error < best.error) { best = m3; }
            let m4 = encode2Subset(pixPh, 4u, p);
            if (m4.error < best.error) { best = m4; }
            let m6 = encode2Subset(pixPh, 6u, p);
            if (m6.error < best.error) { best = m6; }
            let m7 = encode2Subset(pixPh, 7u, p);
            if (m7.error < best.error) { best = m7; }
            let m8 = encode2Subset(pixPh, 8u, p);
            if (m8.error < best.error) { best = m8; }
        }
    }

    // Write output
    let blockIndex = blockY * blocksPerRow + blockX;
    let offset = blockIndex * WORDS_PER_BLOCK;
    outputBlocks[offset + 0u] = best.block.x;
    outputBlocks[offset + 1u] = best.block.y;
    outputBlocks[offset + 2u] = best.block.z;
    outputBlocks[offset + 3u] = best.block.w;
}
