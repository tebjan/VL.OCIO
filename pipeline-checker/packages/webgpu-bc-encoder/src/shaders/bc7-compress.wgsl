// BC7 compression compute shader
// High quality RGBA, 128 bits (16 bytes) per 4x4 block
//
// Implements all 8 BC7 modes for maximum quality:
//   Mode 0: 3 subsets, 4-bit RGB + per-EP P-bit, 3-bit indices, 16 partitions
//   Mode 1: 2 subsets, 6-bit RGB + shared P-bit, 3-bit indices, 64 partitions
//   Mode 2: 3 subsets, 5-bit RGB, no P-bit, 2-bit indices, 64 partitions
//   Mode 3: 2 subsets, 7-bit RGB + per-EP P-bit, 2-bit indices, 64 partitions
//   Mode 4: 1 subset, 5-bit RGB + 6-bit A, 2+3 or 3+2 indices, rotation
//   Mode 5: 1 subset, 7-bit RGB + 8-bit A, 2-bit indices, rotation
//   Mode 6: 1 subset, 7-bit RGBA + per-EP P-bit, 4-bit indices
//   Mode 7: 2 subsets, 5-bit RGBA + per-EP P-bit, 2-bit indices, 64 partitions
//
// Quality modes via params.quality:
//   0 = fast   (Mode 6 only)
//   1 = normal (Mode 6, 1, 3, 5)
//   2 = high   (All 8 modes)

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outputBlocks: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params { width: u32, height: u32, quality: u32 }

const WORDS_PER_BLOCK: u32 = 4u;

// ─── Interpolation weights ───────────────────────────────────────────────────

// 4-bit interpolation weights (16 levels)
const aWeight4 = array<u32, 16>(
    0u, 4u, 9u, 13u, 17u, 21u, 26u, 30u,
    34u, 38u, 43u, 47u, 51u, 55u, 60u, 64u
);

// 3-bit interpolation weights (8 levels)
const aWeight3 = array<u32, 8>(
    0u, 9u, 18u, 27u, 37u, 46u, 55u, 64u
);

// 2-bit interpolation weights (4 levels)
const aWeight2 = array<u32, 4>(
    0u, 21u, 43u, 64u
);

// ─── Index step tables ───────────────────────────────────────────────────────
// Maps position in [0,63] to best N-bit index

// 4-bit index assignment [0,15]
const aStep4 = array<u32, 64>(
    0u, 0u, 0u, 1u, 1u, 1u, 1u, 2u,
    2u, 2u, 2u, 2u, 3u, 3u, 3u, 3u,
    4u, 4u, 4u, 4u, 5u, 5u, 5u, 5u,
    6u, 6u, 6u, 6u, 6u, 7u, 7u, 7u,
    7u, 8u, 8u, 8u, 8u, 9u, 9u, 9u,
    9u, 10u, 10u, 10u, 10u, 10u, 11u, 11u,
    11u, 11u, 12u, 12u, 12u, 12u, 13u, 13u,
    13u, 13u, 14u, 14u, 14u, 14u, 15u, 15u
);

// 3-bit index assignment [0,7]
const aStep3 = array<u32, 64>(
    0u, 0u, 0u, 0u, 0u, 1u, 1u, 1u,
    1u, 1u, 1u, 1u, 1u, 1u, 2u, 2u,
    2u, 2u, 2u, 2u, 2u, 2u, 2u, 3u,
    3u, 3u, 3u, 3u, 3u, 3u, 3u, 3u,
    3u, 4u, 4u, 4u, 4u, 4u, 4u, 4u,
    4u, 4u, 5u, 5u, 5u, 5u, 5u, 5u,
    5u, 5u, 5u, 6u, 6u, 6u, 6u, 6u,
    6u, 6u, 6u, 6u, 7u, 7u, 7u, 7u
);

// 2-bit index assignment [0,3]
const aStep2 = array<u32, 64>(
    0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u,
    0u, 0u, 0u, 1u, 1u, 1u, 1u, 1u,
    1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u,
    1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u,
    1u, 2u, 2u, 2u, 2u, 2u, 2u, 2u,
    2u, 2u, 2u, 2u, 2u, 2u, 2u, 2u,
    2u, 2u, 2u, 2u, 2u, 2u, 3u, 3u,
    3u, 3u, 3u, 3u, 3u, 3u, 3u, 3u
);

// ─── 2-subset partition tables (64 patterns) ─────────────────────────────────

// Each u32 is a 16-bit mask: bit i = subset assignment for pixel i (0 or 1)
const candidateSectionBit = array<u32, 64>(
    0xCCCCu, 0x8888u, 0xEEEEu, 0xECC8u,
    0xC880u, 0xFEECu, 0xFEC8u, 0xEC80u,
    0xC800u, 0xFFECu, 0xFE80u, 0xE800u,
    0xFFE8u, 0xFF00u, 0xFFF0u, 0xF000u,
    0xF710u, 0x008Eu, 0x7100u, 0x08CEu,
    0x008Cu, 0x7310u, 0x3100u, 0x8CCEu,
    0x088Cu, 0x3110u, 0x6666u, 0x366Cu,
    0x17E8u, 0x0FF0u, 0x718Eu, 0x399Cu,
    0xAAAAu, 0xF0F0u, 0x5A5Au, 0x33CCu,
    0x3C3Cu, 0x55AAu, 0x9696u, 0xA55Au,
    0x73CEu, 0x13C8u, 0x324Cu, 0x3BDCu,
    0x6996u, 0xC33Cu, 0x9966u, 0x0660u,
    0x0272u, 0x04E4u, 0x4E40u, 0x2720u,
    0xC936u, 0x936Cu, 0x39C6u, 0x639Cu,
    0x9336u, 0x9CC6u, 0x817Eu, 0xE718u,
    0xCCF0u, 0x0FCCu, 0x7744u, 0xEE22u
);

// Fix-up (anchor) index for subset 1 in 2-subset modes
const candidateFixUpIndex1D = array<u32, 64>(
    15u, 15u, 15u, 15u, 15u, 15u, 15u, 15u,
    15u, 15u, 15u, 15u, 15u, 15u, 15u, 15u,
    15u,  2u,  8u,  2u,  2u,  8u,  8u, 15u,
     2u,  8u,  2u,  2u,  8u,  8u,  2u,  2u,
    15u, 15u,  6u,  8u,  2u,  8u, 15u, 15u,
     2u,  8u,  2u,  2u,  2u, 15u, 15u,  6u,
     6u,  2u,  6u,  8u, 15u, 15u,  2u,  2u,
    15u, 15u, 15u, 15u, 15u,  2u,  2u, 15u
);

// ─── 3-subset partition tables (64 patterns, indices 64-127) ─────────────────

// Each u32 encodes 2 bits per pixel (32 bits total) for 3 subsets (0, 1, 2)
const candidateSectionBit2 = array<u32, 64>(
    0xAA685050u, 0x6A5A5040u, 0x5A5A4200u, 0x5450A0A8u,
    0xA5A50000u, 0xA0A05050u, 0x5555A0A0u, 0x5A5A5050u,
    0xAA550000u, 0xAA555500u, 0xAAAA5500u, 0x90909090u,
    0x94949494u, 0xA4A4A4A4u, 0xA9A59450u, 0x2A0A4250u,
    0xA5945040u, 0x0A425054u, 0xA5A5A500u, 0x55A0A0A0u,
    0xA8A85454u, 0x6A6A4040u, 0xA4A45000u, 0x1A1A0500u,
    0x0050A4A4u, 0xAAA59090u, 0x14696914u, 0x69691400u,
    0xA08585A0u, 0xAA821414u, 0x50A4A450u, 0x6A5A0200u,
    0xA9A58000u, 0x5090A0A8u, 0xA8A09050u, 0x24242424u,
    0x00AA5500u, 0x24924924u, 0x24499224u, 0x50A50A50u,
    0x500AA550u, 0xAAAA4444u, 0x66660000u, 0xA5A0A5A0u,
    0x50A050A0u, 0x69286928u, 0x44AAAA44u, 0x66666600u,
    0xAA444444u, 0x54A854A8u, 0x95809580u, 0x96969600u,
    0xA85454A8u, 0x80959580u, 0xAA141414u, 0x96960000u,
    0xAAAA1414u, 0xA05050A0u, 0xA0A5A5A0u, 0x96000000u,
    0x40804080u, 0xA9A8A9A8u, 0xAAAAAA44u, 0x2A4A5254u
);

// Fix-up indices for 3-subset modes (ordered).
// [i][0] = anchor for subset 1, [i][1] = anchor for subset 2
// Subset 0 anchor is always pixel 0.
// For partition indices 64-127 (3-subset), offset by 64 in this table.
const candidateFixUpIndex1D_3 = array<u32, 128>(
    // First 64 entries (for 2-subset, subset 1 anchor): same as candidateFixUpIndex1D
    15u, 15u, 15u, 15u, 15u, 15u, 15u, 15u,
    15u, 15u, 15u, 15u, 15u, 15u, 15u, 15u,
    15u,  2u,  8u,  2u,  2u,  8u,  8u, 15u,
     2u,  8u,  2u,  2u,  8u,  8u,  2u,  2u,
    15u, 15u,  6u,  8u,  2u,  8u, 15u, 15u,
     2u,  8u,  2u,  2u,  2u, 15u, 15u,  6u,
     6u,  2u,  6u,  8u, 15u, 15u,  2u,  2u,
    15u, 15u, 15u, 15u, 15u,  2u,  2u, 15u,
    // Entries 64-127 (3-subset, anchor for subset 1 — ordered)
     3u,  3u,  8u,  3u,  8u,  3u,  3u,  8u,
     8u,  8u,  6u,  6u,  6u,  5u,  3u,  3u,
     3u,  3u,  8u,  3u,  3u,  3u,  6u,  8u,
     3u,  8u,  6u,  6u,  8u,  5u, 10u,  8u,
     8u,  3u,  3u,  5u,  6u,  8u,  8u, 10u,
     6u,  3u,  8u,  5u,  3u,  6u,  6u,  8u,
     3u,  3u,  5u,  5u,  5u,  8u,  5u, 10u,
     5u, 10u,  8u, 13u,  3u, 12u,  3u,  3u
);

// Anchor for subset 2 in 3-subset modes (ordered), for partition indices 64-127
const candidateFixUpIndex2D_3 = array<u32, 64>(
    15u,  8u, 15u, 15u, 15u, 15u, 15u, 15u,
    15u, 15u, 15u, 15u, 15u, 15u, 15u,  8u,
    15u,  8u, 15u, 15u, 15u,  8u, 15u, 10u,
     5u, 15u,  8u, 10u, 15u, 15u, 15u, 15u,
    15u, 15u, 15u, 10u, 10u, 10u,  9u, 15u,
    15u, 15u, 15u, 15u, 15u, 15u, 15u, 15u,
    15u, 15u, 15u, 15u, 15u, 15u, 15u, 15u,
    15u, 15u, 15u, 15u,  3u, 15u, 15u,  8u
);

// ─── Interpolation helpers ───────────────────────────────────────────────────

fn interpolate4(low: u32, high: u32, index: u32) -> u32 {
    let w = aWeight4[index];
    return ((64u - w) * low + w * high + 32u) >> 6u;
}

fn interpolate3(low: u32, high: u32, index: u32) -> u32 {
    let w = aWeight3[index];
    return ((64u - w) * low + w * high + 32u) >> 6u;
}

fn interpolate2(low: u32, high: u32, index: u32) -> u32 {
    let w = aWeight2[index];
    return ((64u - w) * low + w * high + 32u) >> 6u;
}

// ─── Quantization helpers ────────────────────────────────────────────────────

// Quantize 8-bit value to N-bit precision using BC7 spec formula
fn quantize(color: u32, prec: u32) -> u32 {
    return (((color << 8u) + color) * ((1u << prec) - 1u) + 32768u) >> 16u;
}

// Expand N-bit value to 8-bit precision using BC7 spec formula
fn unquantize(color: u32, prec: u32) -> u32 {
    let c = color << (8u - prec);
    return c | (c >> prec);
}

// ─── Bit packing helpers ─────────────────────────────────────────────────────

fn setBits(block: ptr<function, vec4<u32>>, startBit: u32, numBits: u32, value: u32) {
    let mask = (1u << numBits) - 1u;
    let val = value & mask;
    let wordIdx = startBit >> 5u;
    let bitIdx = startBit & 31u;

    if (wordIdx == 0u) {
        (*block).x |= val << bitIdx;
        if (bitIdx + numBits > 32u) {
            (*block).y |= val >> (32u - bitIdx);
        }
    } else if (wordIdx == 1u) {
        (*block).y |= val << bitIdx;
        if (bitIdx + numBits > 32u) {
            (*block).z |= val >> (32u - bitIdx);
        }
    } else if (wordIdx == 2u) {
        (*block).z |= val << bitIdx;
        if (bitIdx + numBits > 32u) {
            (*block).w |= val >> (32u - bitIdx);
        }
    } else {
        (*block).w |= val << bitIdx;
    }
}

// ─── Result struct ───────────────────────────────────────────────────────────

struct EncodeResult {
    block: vec4<u32>,
    error: f32,
}

// ─── Shared helpers for index computation ────────────────────────────────────

fn computeIndex4(pixel: vec4<f32>, epLow: vec4<f32>, epRange: vec4<f32>, epLenSq: f32) -> u32 {
    if (epLenSq < 1e-10) { return 0u; }
    let dotP = dot(pixel - epLow, epRange);
    if (dotP <= 0.0) { return 0u; }
    if (dotP >= epLenSq) { return 15u; }
    return aStep4[u32(dotP * 63.49999 / epLenSq)];
}

fn computeIndex3_rgb(pixel: vec3<f32>, epLow: vec3<f32>, epRange: vec3<f32>, epLenSq: f32) -> u32 {
    if (epLenSq < 1e-10) { return 0u; }
    let dotP = dot(pixel - epLow, epRange);
    if (dotP <= 0.0) { return 0u; }
    if (dotP >= epLenSq) { return 7u; }
    return aStep3[u32(dotP * 63.49999 / epLenSq)];
}

fn computeIndex2_rgb(pixel: vec3<f32>, epLow: vec3<f32>, epRange: vec3<f32>, epLenSq: f32) -> u32 {
    if (epLenSq < 1e-10) { return 0u; }
    let dotP = dot(pixel - epLow, epRange);
    if (dotP <= 0.0) { return 0u; }
    if (dotP >= epLenSq) { return 3u; }
    return aStep2[u32(dotP * 63.49999 / epLenSq)];
}

fn computeIndex2_rgba(pixel: vec4<f32>, epLow: vec4<f32>, epRange: vec4<f32>, epLenSq: f32) -> u32 {
    if (epLenSq < 1e-10) { return 0u; }
    let dotP = dot(pixel - epLow, epRange);
    if (dotP <= 0.0) { return 0u; }
    if (dotP >= epLenSq) { return 3u; }
    return aStep2[u32(dotP * 63.49999 / epLenSq)];
}

fn computeIndex3_scalar(pixel: f32, epLow: f32, epRange: f32, epLenSq: f32) -> u32 {
    if (epLenSq < 1e-10) { return 0u; }
    let dotP = (pixel - epLow) * epRange;
    if (dotP <= 0.0) { return 0u; }
    if (dotP >= epLenSq) { return 7u; }
    return aStep3[u32(dotP * 63.49999 / epLenSq)];
}

fn computeIndex2_scalar(pixel: f32, epLow: f32, epRange: f32, epLenSq: f32) -> u32 {
    if (epLenSq < 1e-10) { return 0u; }
    let dotP = (pixel - epLow) * epRange;
    if (dotP <= 0.0) { return 0u; }
    if (dotP >= epLenSq) { return 3u; }
    return aStep2[u32(dotP * 63.49999 / epLenSq)];
}

// ─── Get subset for 3-subset partition ───────────────────────────────────────

fn getSubset3(bits2: u32, pixelIdx: u32) -> u32 {
    return (bits2 >> (pixelIdx * 2u)) & 3u;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODE 6: 1 subset, RGBA 7-bit + per-EP P-bit (effective 8-bit), 4-bit indices
// ═══════════════════════════════════════════════════════════════════════════════

fn encodeMode6(pix255: ptr<function, array<vec4<f32>, 16>>) -> EncodeResult {
    // Find min/max RGBA in [0,255]
    var minCol = (*pix255)[0];
    var maxCol = (*pix255)[0];
    for (var i = 1u; i < 16u; i++) {
        minCol = min(minCol, (*pix255)[i]);
        maxCol = max(maxCol, (*pix255)[i]);
    }

    // Inset
    let inset = (maxCol - minCol) / 16.0;
    minCol = clamp(minCol + inset, vec4<f32>(0.0), vec4<f32>(255.0));
    maxCol = clamp(maxCol - inset, vec4<f32>(0.0), vec4<f32>(255.0));

    // Try all 4 P-bit combos
    var bestError = 1e30;
    var bestBlock = vec4<u32>(0u);

    for (var pCombo = 0u; pCombo < 4u; pCombo++) {
        let p0 = pCombo & 1u;
        let p1 = (pCombo >> 1u) & 1u;

        // Mode 6: 7-bit color + per-endpoint P-bit = effective 8-bit
        // Take 8-bit value, force LSB to P-bit. Top 7 bits are the stored endpoint.
        var ep0R = (u32(clamp(minCol.r + 0.5, 0.0, 255.0)) & 0xFEu) | p0;
        var ep0G = (u32(clamp(minCol.g + 0.5, 0.0, 255.0)) & 0xFEu) | p0;
        var ep0B = (u32(clamp(minCol.b + 0.5, 0.0, 255.0)) & 0xFEu) | p0;
        var ep0A = (u32(clamp(minCol.a + 0.5, 0.0, 255.0)) & 0xFEu) | p0;
        var ep1R = (u32(clamp(maxCol.r + 0.5, 0.0, 255.0)) & 0xFEu) | p1;
        var ep1G = (u32(clamp(maxCol.g + 0.5, 0.0, 255.0)) & 0xFEu) | p1;
        var ep1B = (u32(clamp(maxCol.b + 0.5, 0.0, 255.0)) & 0xFEu) | p1;
        var ep1A = (u32(clamp(maxCol.a + 0.5, 0.0, 255.0)) & 0xFEu) | p1;

        // Effective 8-bit = the value itself (7 MSBs + P-bit LSB = full 8-bit)
        let eff0 = vec4<f32>(f32(ep0R), f32(ep0G), f32(ep0B), f32(ep0A));
        let eff1 = vec4<f32>(f32(ep1R), f32(ep1G), f32(ep1B), f32(ep1A));

        let epRange = eff1 - eff0;
        let epLenSq = dot(epRange, epRange);

        // Compute indices
        var indices: array<u32, 16>;
        for (var i = 0u; i < 16u; i++) {
            indices[i] = computeIndex4((*pix255)[i], eff0, epRange, epLenSq);
        }

        // Anchor fix: pixel 0 MSB must be 0
        if (indices[0] >= 8u) {
            var tmp: u32;
            tmp = ep0R; ep0R = ep1R; ep1R = tmp;
            tmp = ep0G; ep0G = ep1G; ep1G = tmp;
            tmp = ep0B; ep0B = ep1B; ep1B = tmp;
            tmp = ep0A; ep0A = ep1A; ep1A = tmp;
            for (var i = 0u; i < 16u; i++) { indices[i] = 15u - indices[i]; }
        }

        // Error
        var totalError = 0.0;
        for (var i = 0u; i < 16u; i++) {
            let rr = f32(interpolate4(ep0R, ep1R, indices[i]));
            let gg = f32(interpolate4(ep0G, ep1G, indices[i]));
            let bb = f32(interpolate4(ep0B, ep1B, indices[i]));
            let aa = f32(interpolate4(ep0A, ep1A, indices[i]));
            let d = (*pix255)[i] - vec4<f32>(rr, gg, bb, aa);
            totalError += dot(d, d);
        }

        if (totalError < bestError) {
            bestError = totalError;

            // Extract 7-bit values (strip P-bit)
            let e0R = ep0R >> 1u; let e0G = ep0G >> 1u; let e0B = ep0B >> 1u; let e0A = ep0A >> 1u;
            let e1R = ep1R >> 1u; let e1G = ep1G >> 1u; let e1B = ep1B >> 1u; let e1A = ep1A >> 1u;
            let pb0 = ep0R & 1u;
            let pb1 = ep1R & 1u;

            var block = vec4<u32>(0u, 0u, 0u, 0u);
            // Mode 6 bit = bit 6
            block.x = (1u << 6u);
            block.x |= (e0R << 7u);           // R0 [13:7]
            block.x |= (e1R << 14u);          // R1 [20:14]
            block.x |= (e0G << 21u);          // G0 [27:21]
            block.x |= ((e1G & 0xFu) << 28u); // G1 low 4 [31:28]

            block.y = ((e1G >> 4u) & 0x7u);   // G1 high 3 [2:0]
            block.y |= (e0B << 3u);            // B0 [9:3]
            block.y |= (e1B << 10u);           // B1 [16:10]
            block.y |= (e0A << 17u);           // A0 [23:17]
            block.y |= (e1A << 24u);           // A1 [30:24]
            block.y |= (pb0 << 31u);           // P0 [31]

            block.z = pb1;                     // P1 [0]
            let anchorIdx = indices[0] & 7u;   // 3-bit (MSB guaranteed 0)
            block.z |= (anchorIdx << 1u);      // [3:1]
            var bitPos = 4u;
            for (var i = 1u; i < 8u; i++) {
                block.z |= ((indices[i] & 0xFu) << bitPos);
                bitPos += 4u;
            }
            for (var i = 8u; i < 16u; i++) {
                block.w |= ((indices[i] & 0xFu) << ((i - 8u) * 4u));
            }

            bestBlock = block;
        }
    }

    return EncodeResult(bestBlock, bestError);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODE 1: 2 subsets, RGB 6-bit + shared P-bit, 3-bit indices, 64 partitions
// ═══════════════════════════════════════════════════════════════════════════════

// Expand Mode 1 endpoint: 6-bit + shared p-bit = 7-bit, then expand to 8-bit
fn expandMode1Endpoint(ep6: u32, pbit: u32) -> u32 {
    let val7 = (ep6 << 1u) | pbit;
    return (val7 << 1u) | (val7 >> 6u);
}

fn tryMode1Partition(
    pix255: ptr<function, array<vec4<f32>, 16>>,
    partitionBits: u32,
    fixupIdx: u32,
    p0: u32,
    p1: u32,
) -> EncodeResult {
    // Find per-subset min/max RGB
    var s0Min = vec3<f32>(255.0);
    var s0Max = vec3<f32>(0.0);
    var s1Min = vec3<f32>(255.0);
    var s1Max = vec3<f32>(0.0);
    var s0Count = 0u;
    var s1Count = 0u;

    for (var i = 0u; i < 16u; i++) {
        let rgb = (*pix255)[i].rgb;
        if (((partitionBits >> i) & 1u) == 0u) {
            s0Min = min(s0Min, rgb); s0Max = max(s0Max, rgb); s0Count += 1u;
        } else {
            s1Min = min(s1Min, rgb); s1Max = max(s1Max, rgb); s1Count += 1u;
        }
    }
    if (s0Count == 0u) { s0Min = vec3<f32>(0.0); s0Max = vec3<f32>(0.0); }
    if (s1Count == 0u) { s1Min = vec3<f32>(0.0); s1Max = vec3<f32>(0.0); }

    // Inset
    let inset0 = (s0Max - s0Min) / 16.0;
    let s0MinI = clamp(s0Min + inset0, vec3<f32>(0.0), vec3<f32>(255.0));
    let s0MaxI = clamp(s0Max - inset0, vec3<f32>(0.0), vec3<f32>(255.0));
    let inset1 = (s1Max - s1Min) / 16.0;
    let s1MinI = clamp(s1Min + inset1, vec3<f32>(0.0), vec3<f32>(255.0));
    let s1MaxI = clamp(s1Max - inset1, vec3<f32>(0.0), vec3<f32>(255.0));

    // Quantize to 6 bits
    var ep0R = u32(clamp(s0MinI.r / 255.0 * 63.0 + 0.5, 0.0, 63.0));
    var ep0G = u32(clamp(s0MinI.g / 255.0 * 63.0 + 0.5, 0.0, 63.0));
    var ep0B = u32(clamp(s0MinI.b / 255.0 * 63.0 + 0.5, 0.0, 63.0));
    var ep1R = u32(clamp(s0MaxI.r / 255.0 * 63.0 + 0.5, 0.0, 63.0));
    var ep1G = u32(clamp(s0MaxI.g / 255.0 * 63.0 + 0.5, 0.0, 63.0));
    var ep1B = u32(clamp(s0MaxI.b / 255.0 * 63.0 + 0.5, 0.0, 63.0));
    var ep2R = u32(clamp(s1MinI.r / 255.0 * 63.0 + 0.5, 0.0, 63.0));
    var ep2G = u32(clamp(s1MinI.g / 255.0 * 63.0 + 0.5, 0.0, 63.0));
    var ep2B = u32(clamp(s1MinI.b / 255.0 * 63.0 + 0.5, 0.0, 63.0));
    var ep3R = u32(clamp(s1MaxI.r / 255.0 * 63.0 + 0.5, 0.0, 63.0));
    var ep3G = u32(clamp(s1MaxI.g / 255.0 * 63.0 + 0.5, 0.0, 63.0));
    var ep3B = u32(clamp(s1MaxI.b / 255.0 * 63.0 + 0.5, 0.0, 63.0));

    // Effective 8-bit endpoints
    var eff0 = vec3<f32>(f32(expandMode1Endpoint(ep0R, p0)), f32(expandMode1Endpoint(ep0G, p0)), f32(expandMode1Endpoint(ep0B, p0)));
    var eff1 = vec3<f32>(f32(expandMode1Endpoint(ep1R, p0)), f32(expandMode1Endpoint(ep1G, p0)), f32(expandMode1Endpoint(ep1B, p0)));
    var eff2 = vec3<f32>(f32(expandMode1Endpoint(ep2R, p1)), f32(expandMode1Endpoint(ep2G, p1)), f32(expandMode1Endpoint(ep2B, p1)));
    var eff3 = vec3<f32>(f32(expandMode1Endpoint(ep3R, p1)), f32(expandMode1Endpoint(ep3G, p1)), f32(expandMode1Endpoint(ep3B, p1)));

    let s0Range = eff1 - eff0;
    let s0LenSq = dot(s0Range, s0Range);
    let s1Range = eff3 - eff2;
    let s1LenSq = dot(s1Range, s1Range);

    // Compute indices
    var indices: array<u32, 16>;
    for (var i = 0u; i < 16u; i++) {
        let rgb = (*pix255)[i].rgb;
        if (((partitionBits >> i) & 1u) == 0u) {
            indices[i] = computeIndex3_rgb(rgb, eff0, s0Range, s0LenSq);
        } else {
            indices[i] = computeIndex3_rgb(rgb, eff2, s1Range, s1LenSq);
        }
    }

    // Anchor fix subset 0 (pixel 0): MSB must be 0 (3-bit => < 4)
    if (indices[0] >= 4u) {
        var tmp: u32;
        tmp = ep0R; ep0R = ep1R; ep1R = tmp;
        tmp = ep0G; ep0G = ep1G; ep1G = tmp;
        tmp = ep0B; ep0B = ep1B; ep1B = tmp;
        for (var i = 0u; i < 16u; i++) {
            if (((partitionBits >> i) & 1u) == 0u) { indices[i] = 7u - indices[i]; }
        }
    }

    // Anchor fix subset 1 (fixupIdx)
    if (indices[fixupIdx] >= 4u) {
        var tmp: u32;
        tmp = ep2R; ep2R = ep3R; ep3R = tmp;
        tmp = ep2G; ep2G = ep3G; ep3G = tmp;
        tmp = ep2B; ep2B = ep3B; ep3B = tmp;
        for (var i = 0u; i < 16u; i++) {
            if (((partitionBits >> i) & 1u) == 1u) { indices[i] = 7u - indices[i]; }
        }
    }

    // Recompute effective endpoints
    let fin0R = expandMode1Endpoint(ep0R, p0); let fin0G = expandMode1Endpoint(ep0G, p0); let fin0B = expandMode1Endpoint(ep0B, p0);
    let fin1R = expandMode1Endpoint(ep1R, p0); let fin1G = expandMode1Endpoint(ep1G, p0); let fin1B = expandMode1Endpoint(ep1B, p0);
    let fin2R = expandMode1Endpoint(ep2R, p1); let fin2G = expandMode1Endpoint(ep2G, p1); let fin2B = expandMode1Endpoint(ep2B, p1);
    let fin3R = expandMode1Endpoint(ep3R, p1); let fin3G = expandMode1Endpoint(ep3G, p1); let fin3B = expandMode1Endpoint(ep3B, p1);

    // Error
    var totalError = 0.0;
    for (var i = 0u; i < 16u; i++) {
        var rr: f32; var gg: f32; var bb: f32;
        if (((partitionBits >> i) & 1u) == 0u) {
            rr = f32(interpolate3(fin0R, fin1R, indices[i]));
            gg = f32(interpolate3(fin0G, fin1G, indices[i]));
            bb = f32(interpolate3(fin0B, fin1B, indices[i]));
        } else {
            rr = f32(interpolate3(fin2R, fin3R, indices[i]));
            gg = f32(interpolate3(fin2G, fin3G, indices[i]));
            bb = f32(interpolate3(fin2B, fin3B, indices[i]));
        }
        let dr = (*pix255)[i].r - rr;
        let dg = (*pix255)[i].g - gg;
        let db = (*pix255)[i].b - bb;
        let da = (*pix255)[i].a - 255.0; // Mode 1 = opaque
        totalError += dr * dr + dg * dg + db * db + da * da;
    }

    // Pack
    var block = vec4<u32>(0u, 0u, 0u, 0u);
    block.x = 0x02u; // mode 1 = bit 1 set
    // partition [7:2] filled by caller
    block.x |= (ep0R & 0x3Fu) << 8u;
    block.x |= (ep1R & 0x3Fu) << 14u;
    block.x |= (ep2R & 0x3Fu) << 20u;
    block.x |= (ep3R & 0x3Fu) << 26u;

    block.y = (ep0G & 0x3Fu);
    block.y |= (ep1G & 0x3Fu) << 6u;
    block.y |= (ep2G & 0x3Fu) << 12u;
    block.y |= (ep3G & 0x3Fu) << 18u;
    block.y |= (ep0B & 0x3Fu) << 24u;
    block.y |= (ep1B & 0x3u) << 30u;

    block.z = (ep1B >> 2u) & 0xFu;
    block.z |= (ep2B & 0x3Fu) << 4u;
    block.z |= (ep3B & 0x3Fu) << 10u;
    block.z |= (p0 & 1u) << 16u;
    block.z |= (p1 & 1u) << 17u;

    // Pack indices starting at bit 82 (word 2 bit 18)
    var idxBitPos = 18u;
    var currentWord = 2u;
    for (var i = 0u; i < 16u; i++) {
        var numBits = 3u;
        var idxVal = indices[i] & 0x7u;
        if (i == 0u || i == fixupIdx) {
            numBits = 2u;
            idxVal = indices[i] & 0x3u;
        }
        if (currentWord == 2u) {
            if (idxBitPos + numBits <= 32u) {
                block.z |= idxVal << idxBitPos;
                idxBitPos += numBits;
                if (idxBitPos >= 32u) { idxBitPos = 0u; currentWord = 3u; }
            } else {
                let bitsInZ = 32u - idxBitPos;
                block.z |= (idxVal & ((1u << bitsInZ) - 1u)) << idxBitPos;
                block.w |= idxVal >> bitsInZ;
                idxBitPos = numBits - bitsInZ;
                currentWord = 3u;
            }
        } else {
            block.w |= idxVal << idxBitPos;
            idxBitPos += numBits;
        }
    }

    return EncodeResult(block, totalError);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODE 3: 2 subsets, RGB 7-bit + per-EP P-bit, 2-bit indices, 64 partitions
// ═══════════════════════════════════════════════════════════════════════════════

fn tryMode3Partition(
    pix255: ptr<function, array<vec4<f32>, 16>>,
    partitionBits: u32,
    fixupIdx: u32,
    p0lo: u32, p0hi: u32,
    p1lo: u32, p1hi: u32,
) -> EncodeResult {
    // Find per-subset min/max RGB
    var s0Min = vec3<f32>(255.0); var s0Max = vec3<f32>(0.0);
    var s1Min = vec3<f32>(255.0); var s1Max = vec3<f32>(0.0);
    var s0Count = 0u; var s1Count = 0u;

    for (var i = 0u; i < 16u; i++) {
        let rgb = (*pix255)[i].rgb;
        if (((partitionBits >> i) & 1u) == 0u) {
            s0Min = min(s0Min, rgb); s0Max = max(s0Max, rgb); s0Count += 1u;
        } else {
            s1Min = min(s1Min, rgb); s1Max = max(s1Max, rgb); s1Count += 1u;
        }
    }
    if (s0Count == 0u) { s0Min = vec3<f32>(0.0); s0Max = vec3<f32>(0.0); }
    if (s1Count == 0u) { s1Min = vec3<f32>(0.0); s1Max = vec3<f32>(0.0); }

    // Inset
    let inset0 = (s0Max - s0Min) / 16.0;
    let s0MinI = clamp(s0Min + inset0, vec3<f32>(0.0), vec3<f32>(255.0));
    let s0MaxI = clamp(s0Max - inset0, vec3<f32>(0.0), vec3<f32>(255.0));
    let inset1 = (s1Max - s1Min) / 16.0;
    let s1MinI = clamp(s1Min + inset1, vec3<f32>(0.0), vec3<f32>(255.0));
    let s1MaxI = clamp(s1Max - inset1, vec3<f32>(0.0), vec3<f32>(255.0));

    // Mode 3: 7-bit color + per-EP P-bit = 8-bit effective
    // Quantize to 8-bit (7+pbit), then apply P-bits
    // The quantized value is the full 8 bits with P-bit as LSB
    var ep0R = (u32(clamp(s0MinI.r + 0.5, 0.0, 255.0)) & 0xFEu) | p0lo;
    var ep0G = (u32(clamp(s0MinI.g + 0.5, 0.0, 255.0)) & 0xFEu) | p0lo;
    var ep0B = (u32(clamp(s0MinI.b + 0.5, 0.0, 255.0)) & 0xFEu) | p0lo;
    var ep1R = (u32(clamp(s0MaxI.r + 0.5, 0.0, 255.0)) & 0xFEu) | p0hi;
    var ep1G = (u32(clamp(s0MaxI.g + 0.5, 0.0, 255.0)) & 0xFEu) | p0hi;
    var ep1B = (u32(clamp(s0MaxI.b + 0.5, 0.0, 255.0)) & 0xFEu) | p0hi;
    var ep2R = (u32(clamp(s1MinI.r + 0.5, 0.0, 255.0)) & 0xFEu) | p1lo;
    var ep2G = (u32(clamp(s1MinI.g + 0.5, 0.0, 255.0)) & 0xFEu) | p1lo;
    var ep2B = (u32(clamp(s1MinI.b + 0.5, 0.0, 255.0)) & 0xFEu) | p1lo;
    var ep3R = (u32(clamp(s1MaxI.r + 0.5, 0.0, 255.0)) & 0xFEu) | p1hi;
    var ep3G = (u32(clamp(s1MaxI.g + 0.5, 0.0, 255.0)) & 0xFEu) | p1hi;
    var ep3B = (u32(clamp(s1MaxI.b + 0.5, 0.0, 255.0)) & 0xFEu) | p1hi;

    // Effective = the 8-bit value itself (7 bits + P-bit = 8 bits, identity unquantize)
    let eff0 = vec3<f32>(f32(ep0R), f32(ep0G), f32(ep0B));
    let eff1 = vec3<f32>(f32(ep1R), f32(ep1G), f32(ep1B));
    let eff2 = vec3<f32>(f32(ep2R), f32(ep2G), f32(ep2B));
    let eff3 = vec3<f32>(f32(ep3R), f32(ep3G), f32(ep3B));

    let s0Range = eff1 - eff0;
    let s0LenSq = dot(s0Range, s0Range);
    let s1Range = eff3 - eff2;
    let s1LenSq = dot(s1Range, s1Range);

    // 2-bit indices
    var indices: array<u32, 16>;
    for (var i = 0u; i < 16u; i++) {
        let rgb = (*pix255)[i].rgb;
        if (((partitionBits >> i) & 1u) == 0u) {
            indices[i] = computeIndex2_rgb(rgb, eff0, s0Range, s0LenSq);
        } else {
            indices[i] = computeIndex2_rgb(rgb, eff2, s1Range, s1LenSq);
        }
    }

    // Anchor fix subset 0 (pixel 0): 2-bit => MSB must be 0 => < 2
    if (indices[0] >= 2u) {
        var tmp: u32;
        tmp = ep0R; ep0R = ep1R; ep1R = tmp;
        tmp = ep0G; ep0G = ep1G; ep1G = tmp;
        tmp = ep0B; ep0B = ep1B; ep1B = tmp;
        for (var i = 0u; i < 16u; i++) {
            if (((partitionBits >> i) & 1u) == 0u) { indices[i] = 3u - indices[i]; }
        }
    }
    // Anchor fix subset 1
    if (indices[fixupIdx] >= 2u) {
        var tmp: u32;
        tmp = ep2R; ep2R = ep3R; ep3R = tmp;
        tmp = ep2G; ep2G = ep3G; ep3G = tmp;
        tmp = ep2B; ep2B = ep3B; ep3B = tmp;
        for (var i = 0u; i < 16u; i++) {
            if (((partitionBits >> i) & 1u) == 1u) { indices[i] = 3u - indices[i]; }
        }
    }

    // Error
    var totalError = 0.0;
    for (var i = 0u; i < 16u; i++) {
        var rr: f32; var gg: f32; var bb: f32;
        if (((partitionBits >> i) & 1u) == 0u) {
            rr = f32(interpolate2(ep0R, ep1R, indices[i]));
            gg = f32(interpolate2(ep0G, ep1G, indices[i]));
            bb = f32(interpolate2(ep0B, ep1B, indices[i]));
        } else {
            rr = f32(interpolate2(ep2R, ep3R, indices[i]));
            gg = f32(interpolate2(ep2G, ep3G, indices[i]));
            bb = f32(interpolate2(ep2B, ep3B, indices[i]));
        }
        let dr = (*pix255)[i].r - rr;
        let dg = (*pix255)[i].g - gg;
        let db = (*pix255)[i].b - bb;
        let da = (*pix255)[i].a - 255.0;
        totalError += dr * dr + dg * dg + db * db + da * da;
    }

    // Pack Mode 3
    // Bit layout:
    //   [3:0]   mode = 0x08 (bit 3 set)
    //   [9:4]   partition (6 bits)
    //   [16:10] R0 (7 bits) ... [37:31] R3 (7 bits)
    //   ...endpoints interleaved...
    //   [97:94] P-bits (4 bits: ep0,ep1,ep2,ep3)
    //   [127:98] indices (30 bits: 2 anchors x 1-bit + 14 others x 2-bit)
    var block = vec4<u32>(0u, 0u, 0u, 0u);

    // Mode 3: 7-bit endpoints, need to extract 7-bit value = top 7 bits of 8-bit
    let q0R = ep0R >> 1u; let q0G = ep0G >> 1u; let q0B = ep0B >> 1u;
    let q1R = ep1R >> 1u; let q1G = ep1G >> 1u; let q1B = ep1B >> 1u;
    let q2R = ep2R >> 1u; let q2G = ep2G >> 1u; let q2B = ep2B >> 1u;
    let q3R = ep3R >> 1u; let q3G = ep3G >> 1u; let q3B = ep3B >> 1u;
    let pb0 = ep0R & 1u; let pb1 = ep1R & 1u;
    let pb2 = ep2R & 1u; let pb3 = ep3R & 1u;

    // Use setBits for clean cross-word packing
    // Mode 3 = bit 3 set = 0x08, bits [3:0]
    setBits(&block, 0u, 4u, 0x08u);
    // Partition [9:4]
    // (partition filled by caller — we leave bits 4-9 as 0)

    // Endpoints: 4x 7-bit R, 4x 7-bit G, 4x 7-bit B = 84 bits starting at bit 10
    setBits(&block, 10u, 7u, q0R);
    setBits(&block, 17u, 7u, q1R);
    setBits(&block, 24u, 7u, q2R);
    setBits(&block, 31u, 7u, q3R);
    setBits(&block, 38u, 7u, q0G);
    setBits(&block, 45u, 7u, q1G);
    setBits(&block, 52u, 7u, q2G);
    setBits(&block, 59u, 7u, q3G);
    setBits(&block, 66u, 7u, q0B);
    setBits(&block, 73u, 7u, q1B);
    setBits(&block, 80u, 7u, q2B);
    setBits(&block, 87u, 7u, q3B);

    // P-bits at bit 94
    setBits(&block, 94u, 1u, pb0);
    setBits(&block, 95u, 1u, pb1);
    setBits(&block, 96u, 1u, pb2);
    setBits(&block, 97u, 1u, pb3);

    // Indices at bit 98: anchor pixel 0 = 1-bit, fixup = 1-bit, rest = 2-bit
    // Total: 2 x 1 + 14 x 2 = 30 bits [127:98]
    var idxBit = 98u;
    for (var i = 0u; i < 16u; i++) {
        if (i == 0u || i == fixupIdx) {
            setBits(&block, idxBit, 1u, indices[i] & 1u);
            idxBit += 1u;
        } else {
            setBits(&block, idxBit, 2u, indices[i] & 3u);
            idxBit += 2u;
        }
    }

    return EncodeResult(block, totalError);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODE 7: 2 subsets, RGBA 5-bit + per-EP P-bit, 2-bit indices, 64 partitions
// ═══════════════════════════════════════════════════════════════════════════════

fn tryMode7Partition(
    pix255: ptr<function, array<vec4<f32>, 16>>,
    partitionBits: u32,
    fixupIdx: u32,
    p0lo: u32, p0hi: u32,
    p1lo: u32, p1hi: u32,
) -> EncodeResult {
    // Find per-subset min/max RGBA
    var s0Min = vec4<f32>(255.0); var s0Max = vec4<f32>(0.0);
    var s1Min = vec4<f32>(255.0); var s1Max = vec4<f32>(0.0);
    var s0Count = 0u; var s1Count = 0u;

    for (var i = 0u; i < 16u; i++) {
        let rgba = (*pix255)[i];
        if (((partitionBits >> i) & 1u) == 0u) {
            s0Min = min(s0Min, rgba); s0Max = max(s0Max, rgba); s0Count += 1u;
        } else {
            s1Min = min(s1Min, rgba); s1Max = max(s1Max, rgba); s1Count += 1u;
        }
    }
    if (s0Count == 0u) { s0Min = vec4<f32>(0.0); s0Max = vec4<f32>(0.0); }
    if (s1Count == 0u) { s1Min = vec4<f32>(0.0); s1Max = vec4<f32>(0.0); }

    let inset0 = (s0Max - s0Min) / 16.0;
    let s0MinI = clamp(s0Min + inset0, vec4<f32>(0.0), vec4<f32>(255.0));
    let s0MaxI = clamp(s0Max - inset0, vec4<f32>(0.0), vec4<f32>(255.0));
    let inset1 = (s1Max - s1Min) / 16.0;
    let s1MinI = clamp(s1Min + inset1, vec4<f32>(0.0), vec4<f32>(255.0));
    let s1MaxI = clamp(s1Max - inset1, vec4<f32>(0.0), vec4<f32>(255.0));

    // Mode 7: 5-bit RGBA + per-EP P-bit = 6-bit effective
    // Quantize to 6-bit precision (5 bits + pbit)
    var ep0R = (quantize(u32(s0MinI.r + 0.5), 6u) & 0xFEu) | p0lo;
    var ep0G = (quantize(u32(s0MinI.g + 0.5), 6u) & 0xFEu) | p0lo;
    var ep0B = (quantize(u32(s0MinI.b + 0.5), 6u) & 0xFEu) | p0lo;
    var ep0A = (quantize(u32(s0MinI.a + 0.5), 6u) & 0xFEu) | p0lo;
    var ep1R = (quantize(u32(s0MaxI.r + 0.5), 6u) & 0xFEu) | p0hi;
    var ep1G = (quantize(u32(s0MaxI.g + 0.5), 6u) & 0xFEu) | p0hi;
    var ep1B = (quantize(u32(s0MaxI.b + 0.5), 6u) & 0xFEu) | p0hi;
    var ep1A = (quantize(u32(s0MaxI.a + 0.5), 6u) & 0xFEu) | p0hi;
    var ep2R = (quantize(u32(s1MinI.r + 0.5), 6u) & 0xFEu) | p1lo;
    var ep2G = (quantize(u32(s1MinI.g + 0.5), 6u) & 0xFEu) | p1lo;
    var ep2B = (quantize(u32(s1MinI.b + 0.5), 6u) & 0xFEu) | p1lo;
    var ep2A = (quantize(u32(s1MinI.a + 0.5), 6u) & 0xFEu) | p1lo;
    var ep3R = (quantize(u32(s1MaxI.r + 0.5), 6u) & 0xFEu) | p1hi;
    var ep3G = (quantize(u32(s1MaxI.g + 0.5), 6u) & 0xFEu) | p1hi;
    var ep3B = (quantize(u32(s1MaxI.b + 0.5), 6u) & 0xFEu) | p1hi;
    var ep3A = (quantize(u32(s1MaxI.a + 0.5), 6u) & 0xFEu) | p1hi;

    // Unquantize 6-bit to 8-bit
    let eff0 = vec4<f32>(f32(unquantize(ep0R, 6u)), f32(unquantize(ep0G, 6u)), f32(unquantize(ep0B, 6u)), f32(unquantize(ep0A, 6u)));
    let eff1 = vec4<f32>(f32(unquantize(ep1R, 6u)), f32(unquantize(ep1G, 6u)), f32(unquantize(ep1B, 6u)), f32(unquantize(ep1A, 6u)));
    let eff2 = vec4<f32>(f32(unquantize(ep2R, 6u)), f32(unquantize(ep2G, 6u)), f32(unquantize(ep2B, 6u)), f32(unquantize(ep2A, 6u)));
    let eff3 = vec4<f32>(f32(unquantize(ep3R, 6u)), f32(unquantize(ep3G, 6u)), f32(unquantize(ep3B, 6u)), f32(unquantize(ep3A, 6u)));

    let s0Range = eff1 - eff0;
    let s0LenSq = dot(s0Range, s0Range);
    let s1Range = eff3 - eff2;
    let s1LenSq = dot(s1Range, s1Range);

    // 2-bit indices (RGBA)
    var indices: array<u32, 16>;
    for (var i = 0u; i < 16u; i++) {
        if (((partitionBits >> i) & 1u) == 0u) {
            indices[i] = computeIndex2_rgba((*pix255)[i], eff0, s0Range, s0LenSq);
        } else {
            indices[i] = computeIndex2_rgba((*pix255)[i], eff2, s1Range, s1LenSq);
        }
    }

    // Anchor fixes
    if (indices[0] >= 2u) {
        var tmp: u32;
        tmp = ep0R; ep0R = ep1R; ep1R = tmp;
        tmp = ep0G; ep0G = ep1G; ep1G = tmp;
        tmp = ep0B; ep0B = ep1B; ep1B = tmp;
        tmp = ep0A; ep0A = ep1A; ep1A = tmp;
        for (var i = 0u; i < 16u; i++) {
            if (((partitionBits >> i) & 1u) == 0u) { indices[i] = 3u - indices[i]; }
        }
    }
    if (indices[fixupIdx] >= 2u) {
        var tmp: u32;
        tmp = ep2R; ep2R = ep3R; ep3R = tmp;
        tmp = ep2G; ep2G = ep3G; ep3G = tmp;
        tmp = ep2B; ep2B = ep3B; ep3B = tmp;
        tmp = ep2A; ep2A = ep3A; ep3A = tmp;
        for (var i = 0u; i < 16u; i++) {
            if (((partitionBits >> i) & 1u) == 1u) { indices[i] = 3u - indices[i]; }
        }
    }

    // Error
    let f0R = unquantize(ep0R, 6u); let f0G = unquantize(ep0G, 6u); let f0B = unquantize(ep0B, 6u); let f0A = unquantize(ep0A, 6u);
    let f1R = unquantize(ep1R, 6u); let f1G = unquantize(ep1G, 6u); let f1B = unquantize(ep1B, 6u); let f1A = unquantize(ep1A, 6u);
    let f2R = unquantize(ep2R, 6u); let f2G = unquantize(ep2G, 6u); let f2B = unquantize(ep2B, 6u); let f2A = unquantize(ep2A, 6u);
    let f3R = unquantize(ep3R, 6u); let f3G = unquantize(ep3G, 6u); let f3B = unquantize(ep3B, 6u); let f3A = unquantize(ep3A, 6u);

    var totalError = 0.0;
    for (var i = 0u; i < 16u; i++) {
        var rr: f32; var gg: f32; var bb: f32; var aa: f32;
        if (((partitionBits >> i) & 1u) == 0u) {
            rr = f32(interpolate2(f0R, f1R, indices[i]));
            gg = f32(interpolate2(f0G, f1G, indices[i]));
            bb = f32(interpolate2(f0B, f1B, indices[i]));
            aa = f32(interpolate2(f0A, f1A, indices[i]));
        } else {
            rr = f32(interpolate2(f2R, f3R, indices[i]));
            gg = f32(interpolate2(f2G, f3G, indices[i]));
            bb = f32(interpolate2(f2B, f3B, indices[i]));
            aa = f32(interpolate2(f2A, f3A, indices[i]));
        }
        let d = (*pix255)[i] - vec4<f32>(rr, gg, bb, aa);
        totalError += dot(d, d);
    }

    // Pack Mode 7
    // Bit layout:
    //   [7:0]     mode = 0x80 (bit 7 set)
    //   [13:8]    partition
    //   [18:14]   R0(5) ... [33:29] R3(5) = 4x5=20 bits
    //   Similarly G, B, A each 4x5=20 bits
    //   P-bits (4 bits)
    //   Indices (30 bits)
    var block = vec4<u32>(0u, 0u, 0u, 0u);
    setBits(&block, 0u, 8u, 0x80u); // mode 7

    // Extract 5-bit endpoint values (strip P-bit)
    let q0R = ep0R >> 1u; let q0G = ep0G >> 1u; let q0B = ep0B >> 1u; let q0A = ep0A >> 1u;
    let q1R = ep1R >> 1u; let q1G = ep1G >> 1u; let q1B = ep1B >> 1u; let q1A = ep1A >> 1u;
    let q2R = ep2R >> 1u; let q2G = ep2G >> 1u; let q2B = ep2B >> 1u; let q2A = ep2A >> 1u;
    let q3R = ep3R >> 1u; let q3G = ep3G >> 1u; let q3B = ep3B >> 1u; let q3A = ep3A >> 1u;

    // Partition bits [13:8] filled by caller

    // R endpoints: bits 14-33 (4 x 5 = 20)
    setBits(&block, 14u, 5u, q0R); setBits(&block, 19u, 5u, q1R);
    setBits(&block, 24u, 5u, q2R); setBits(&block, 29u, 5u, q3R);
    // G endpoints: bits 34-53
    setBits(&block, 34u, 5u, q0G); setBits(&block, 39u, 5u, q1G);
    setBits(&block, 44u, 5u, q2G); setBits(&block, 49u, 5u, q3G);
    // B endpoints: bits 54-73
    setBits(&block, 54u, 5u, q0B); setBits(&block, 59u, 5u, q1B);
    setBits(&block, 64u, 5u, q2B); setBits(&block, 69u, 5u, q3B);
    // A endpoints: bits 74-93
    setBits(&block, 74u, 5u, q0A); setBits(&block, 79u, 5u, q1A);
    setBits(&block, 84u, 5u, q2A); setBits(&block, 89u, 5u, q3A);

    // P-bits: bits 94-97
    let pb0 = ep0R & 1u; let pb1 = ep1R & 1u;
    let pb2 = ep2R & 1u; let pb3 = ep3R & 1u;
    setBits(&block, 94u, 1u, pb0); setBits(&block, 95u, 1u, pb1);
    setBits(&block, 96u, 1u, pb2); setBits(&block, 97u, 1u, pb3);

    // Indices: bit 98, 2 anchors x 1-bit + 14 x 2-bit = 30 bits
    var idxBit = 98u;
    for (var i = 0u; i < 16u; i++) {
        if (i == 0u || i == fixupIdx) {
            setBits(&block, idxBit, 1u, indices[i] & 1u);
            idxBit += 1u;
        } else {
            setBits(&block, idxBit, 2u, indices[i] & 3u);
            idxBit += 2u;
        }
    }

    return EncodeResult(block, totalError);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODE 0: 3 subsets, RGB 4-bit + per-EP P-bit, 3-bit indices, 16 partitions
// ═══════════════════════════════════════════════════════════════════════════════

fn tryMode0Partition(
    pix255: ptr<function, array<vec4<f32>, 16>>,
    partIdx: u32,  // 0..15
    p0lo: u32, p0hi: u32,
    p1lo: u32, p1hi: u32,
    p2lo: u32, p2hi: u32,
) -> EncodeResult {
    let bits2 = candidateSectionBit2[partIdx]; // 3-subset partition table
    let anchor1 = candidateFixUpIndex1D_3[64u + partIdx]; // subset 1 anchor
    let anchor2 = candidateFixUpIndex2D_3[partIdx]; // subset 2 anchor

    // Find per-subset min/max RGB
    var sMin: array<vec3<f32>, 3>;
    var sMax: array<vec3<f32>, 3>;
    var sCount: array<u32, 3>;
    sMin[0] = vec3<f32>(255.0); sMin[1] = vec3<f32>(255.0); sMin[2] = vec3<f32>(255.0);
    sMax[0] = vec3<f32>(0.0);   sMax[1] = vec3<f32>(0.0);   sMax[2] = vec3<f32>(0.0);
    sCount[0] = 0u; sCount[1] = 0u; sCount[2] = 0u;

    for (var i = 0u; i < 16u; i++) {
        let rgb = (*pix255)[i].rgb;
        let subset = getSubset3(bits2, i);
        if (subset == 0u) {
            sMin[0] = min(sMin[0], rgb); sMax[0] = max(sMax[0], rgb); sCount[0] += 1u;
        } else if (subset == 1u) {
            sMin[1] = min(sMin[1], rgb); sMax[1] = max(sMax[1], rgb); sCount[1] += 1u;
        } else {
            sMin[2] = min(sMin[2], rgb); sMax[2] = max(sMax[2], rgb); sCount[2] += 1u;
        }
    }
    for (var s = 0u; s < 3u; s++) {
        if (sCount[s] == 0u) { sMin[s] = vec3<f32>(0.0); sMax[s] = vec3<f32>(0.0); }
    }

    // Inset
    var sMinI: array<vec3<f32>, 3>;
    var sMaxI: array<vec3<f32>, 3>;
    for (var s = 0u; s < 3u; s++) {
        let ins = (sMax[s] - sMin[s]) / 16.0;
        sMinI[s] = clamp(sMin[s] + ins, vec3<f32>(0.0), vec3<f32>(255.0));
        sMaxI[s] = clamp(sMax[s] - ins, vec3<f32>(0.0), vec3<f32>(255.0));
    }

    // Mode 0: 4-bit color + per-EP P-bit = 5-bit effective
    // Quantize to 5-bit, apply P-bit as LSB
    var epR: array<u32, 6>; // low0, high0, low1, high1, low2, high2
    var epG: array<u32, 6>;
    var epB: array<u32, 6>;
    let pbits = array<u32, 6>(p0lo, p0hi, p1lo, p1hi, p2lo, p2hi);

    for (var s = 0u; s < 3u; s++) {
        let loR = (quantize(u32(sMinI[s].r + 0.5), 5u) & 0xFEu) | pbits[s * 2u];
        let loG = (quantize(u32(sMinI[s].g + 0.5), 5u) & 0xFEu) | pbits[s * 2u];
        let loB = (quantize(u32(sMinI[s].b + 0.5), 5u) & 0xFEu) | pbits[s * 2u];
        let hiR = (quantize(u32(sMaxI[s].r + 0.5), 5u) & 0xFEu) | pbits[s * 2u + 1u];
        let hiG = (quantize(u32(sMaxI[s].g + 0.5), 5u) & 0xFEu) | pbits[s * 2u + 1u];
        let hiB = (quantize(u32(sMaxI[s].b + 0.5), 5u) & 0xFEu) | pbits[s * 2u + 1u];
        epR[s * 2u] = loR; epR[s * 2u + 1u] = hiR;
        epG[s * 2u] = loG; epG[s * 2u + 1u] = hiG;
        epB[s * 2u] = loB; epB[s * 2u + 1u] = hiB;
    }

    // Unquantize to 8-bit for interpolation
    var effR: array<u32, 6>;
    var effG: array<u32, 6>;
    var effB: array<u32, 6>;
    for (var e = 0u; e < 6u; e++) {
        effR[e] = unquantize(epR[e], 5u);
        effG[e] = unquantize(epG[e], 5u);
        effB[e] = unquantize(epB[e], 5u);
    }

    // Compute 3-bit indices
    var eff_low: array<vec3<f32>, 3>;
    var eff_high: array<vec3<f32>, 3>;
    var range: array<vec3<f32>, 3>;
    var lenSq: array<f32, 3>;
    for (var s = 0u; s < 3u; s++) {
        eff_low[s] = vec3<f32>(f32(effR[s * 2u]), f32(effG[s * 2u]), f32(effB[s * 2u]));
        eff_high[s] = vec3<f32>(f32(effR[s * 2u + 1u]), f32(effG[s * 2u + 1u]), f32(effB[s * 2u + 1u]));
        range[s] = eff_high[s] - eff_low[s];
        lenSq[s] = dot(range[s], range[s]);
    }

    var indices: array<u32, 16>;
    for (var i = 0u; i < 16u; i++) {
        let subset = getSubset3(bits2, i);
        indices[i] = computeIndex3_rgb((*pix255)[i].rgb, eff_low[subset], range[subset], lenSq[subset]);
    }

    // Anchor fixes: 3 anchors (pixel 0, anchor1, anchor2)
    // Subset 0: anchor = pixel 0
    if (indices[0] >= 4u) {
        var tmp: u32;
        tmp = epR[0]; epR[0] = epR[1]; epR[1] = tmp;
        tmp = epG[0]; epG[0] = epG[1]; epG[1] = tmp;
        tmp = epB[0]; epB[0] = epB[1]; epB[1] = tmp;
        for (var i = 0u; i < 16u; i++) {
            if (getSubset3(bits2, i) == 0u) { indices[i] = 7u - indices[i]; }
        }
    }
    // Subset 1: anchor = anchor1
    if (indices[anchor1] >= 4u) {
        var tmp: u32;
        tmp = epR[2]; epR[2] = epR[3]; epR[3] = tmp;
        tmp = epG[2]; epG[2] = epG[3]; epG[3] = tmp;
        tmp = epB[2]; epB[2] = epB[3]; epB[3] = tmp;
        for (var i = 0u; i < 16u; i++) {
            if (getSubset3(bits2, i) == 1u) { indices[i] = 7u - indices[i]; }
        }
    }
    // Subset 2: anchor = anchor2
    if (indices[anchor2] >= 4u) {
        var tmp: u32;
        tmp = epR[4]; epR[4] = epR[5]; epR[5] = tmp;
        tmp = epG[4]; epG[4] = epG[5]; epG[5] = tmp;
        tmp = epB[4]; epB[4] = epB[5]; epB[5] = tmp;
        for (var i = 0u; i < 16u; i++) {
            if (getSubset3(bits2, i) == 2u) { indices[i] = 7u - indices[i]; }
        }
    }

    // Recompute effective endpoints after swaps
    for (var e = 0u; e < 6u; e++) {
        effR[e] = unquantize(epR[e], 5u);
        effG[e] = unquantize(epG[e], 5u);
        effB[e] = unquantize(epB[e], 5u);
    }

    // Error
    var totalError = 0.0;
    for (var i = 0u; i < 16u; i++) {
        let subset = getSubset3(bits2, i);
        let loIdx = subset * 2u;
        let rr = f32(interpolate3(effR[loIdx], effR[loIdx + 1u], indices[i]));
        let gg = f32(interpolate3(effG[loIdx], effG[loIdx + 1u], indices[i]));
        let bb = f32(interpolate3(effB[loIdx], effB[loIdx + 1u], indices[i]));
        let dr = (*pix255)[i].r - rr;
        let dg = (*pix255)[i].g - gg;
        let db = (*pix255)[i].b - bb;
        let da = (*pix255)[i].a - 255.0;
        totalError += dr * dr + dg * dg + db * db + da * da;
    }

    // Pack Mode 0
    // Bit layout:
    //   [0]      mode = 1 (bit 0 set)
    //   [4:1]    partition (4 bits, 0-15)
    //   [28:5]   6x R endpoints (4-bit each) = 24 bits
    //   [52:29]  6x G endpoints (4-bit each) = 24 bits
    //   [76:53]  6x B endpoints (4-bit each) = 24 bits
    //   [82:77]  6x P-bits
    //   [127:83] indices (45 bits: 3 anchors x 2-bit + 13 others x 3-bit)
    var block = vec4<u32>(0u, 0u, 0u, 0u);
    setBits(&block, 0u, 1u, 1u); // mode 0
    setBits(&block, 1u, 4u, partIdx);

    // 4-bit endpoint values (strip P-bit)
    for (var e = 0u; e < 6u; e++) {
        let r4 = epR[e] >> 1u;
        let g4 = epG[e] >> 1u;
        let b4 = epB[e] >> 1u;
        setBits(&block, 5u + e * 4u, 4u, r4);
        setBits(&block, 29u + e * 4u, 4u, g4);
        setBits(&block, 53u + e * 4u, 4u, b4);
    }

    // P-bits
    for (var e = 0u; e < 6u; e++) {
        setBits(&block, 77u + e, 1u, epR[e] & 1u);
    }

    // Indices starting at bit 83
    // 3 anchors (pixel 0, anchor1, anchor2) get 2-bit indices, rest get 3-bit
    // Need to use ordered anchors for sequential packing
    var orderedAnchors: array<u32, 3>;
    orderedAnchors[0] = 0u;
    if (anchor1 <= anchor2) {
        orderedAnchors[1] = anchor1;
        orderedAnchors[2] = anchor2;
    } else {
        orderedAnchors[1] = anchor2;
        orderedAnchors[2] = anchor1;
    }

    var idxBit = 83u;
    for (var i = 0u; i < 16u; i++) {
        var isAnchor = false;
        if (i == 0u || i == anchor1 || i == anchor2) {
            isAnchor = true;
        }
        if (isAnchor) {
            setBits(&block, idxBit, 2u, indices[i] & 3u);
            idxBit += 2u;
        } else {
            setBits(&block, idxBit, 3u, indices[i] & 7u);
            idxBit += 3u;
        }
    }

    return EncodeResult(block, totalError);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODE 2: 3 subsets, RGB 5-bit, no P-bit, 2-bit indices, 64 partitions
// ═══════════════════════════════════════════════════════════════════════════════

fn tryMode2Partition(
    pix255: ptr<function, array<vec4<f32>, 16>>,
    partIdx: u32,  // 0..63
) -> EncodeResult {
    let bits2 = candidateSectionBit2[partIdx];
    let anchor1 = candidateFixUpIndex1D_3[64u + partIdx];
    let anchor2 = candidateFixUpIndex2D_3[partIdx];

    // Find per-subset min/max RGB
    var sMin: array<vec3<f32>, 3>;
    var sMax: array<vec3<f32>, 3>;
    var sCount: array<u32, 3>;
    sMin[0] = vec3<f32>(255.0); sMin[1] = vec3<f32>(255.0); sMin[2] = vec3<f32>(255.0);
    sMax[0] = vec3<f32>(0.0);   sMax[1] = vec3<f32>(0.0);   sMax[2] = vec3<f32>(0.0);
    sCount[0] = 0u; sCount[1] = 0u; sCount[2] = 0u;

    for (var i = 0u; i < 16u; i++) {
        let rgb = (*pix255)[i].rgb;
        let subset = getSubset3(bits2, i);
        if (subset == 0u) {
            sMin[0] = min(sMin[0], rgb); sMax[0] = max(sMax[0], rgb); sCount[0] += 1u;
        } else if (subset == 1u) {
            sMin[1] = min(sMin[1], rgb); sMax[1] = max(sMax[1], rgb); sCount[1] += 1u;
        } else {
            sMin[2] = min(sMin[2], rgb); sMax[2] = max(sMax[2], rgb); sCount[2] += 1u;
        }
    }
    for (var s = 0u; s < 3u; s++) {
        if (sCount[s] == 0u) { sMin[s] = vec3<f32>(0.0); sMax[s] = vec3<f32>(0.0); }
    }

    var sMinI: array<vec3<f32>, 3>;
    var sMaxI: array<vec3<f32>, 3>;
    for (var s = 0u; s < 3u; s++) {
        let ins = (sMax[s] - sMin[s]) / 16.0;
        sMinI[s] = clamp(sMin[s] + ins, vec3<f32>(0.0), vec3<f32>(255.0));
        sMaxI[s] = clamp(sMax[s] - ins, vec3<f32>(0.0), vec3<f32>(255.0));
    }

    // Mode 2: 5-bit color, no P-bit
    var epR: array<u32, 6>;
    var epG: array<u32, 6>;
    var epB: array<u32, 6>;
    for (var s = 0u; s < 3u; s++) {
        epR[s * 2u] = quantize(u32(sMinI[s].r + 0.5), 5u);
        epG[s * 2u] = quantize(u32(sMinI[s].g + 0.5), 5u);
        epB[s * 2u] = quantize(u32(sMinI[s].b + 0.5), 5u);
        epR[s * 2u + 1u] = quantize(u32(sMaxI[s].r + 0.5), 5u);
        epG[s * 2u + 1u] = quantize(u32(sMaxI[s].g + 0.5), 5u);
        epB[s * 2u + 1u] = quantize(u32(sMaxI[s].b + 0.5), 5u);
    }

    // Unquantize to 8-bit
    var effR: array<u32, 6>;
    var effG: array<u32, 6>;
    var effB: array<u32, 6>;
    for (var e = 0u; e < 6u; e++) {
        effR[e] = unquantize(epR[e], 5u);
        effG[e] = unquantize(epG[e], 5u);
        effB[e] = unquantize(epB[e], 5u);
    }

    var eff_low: array<vec3<f32>, 3>;
    var eff_high: array<vec3<f32>, 3>;
    var range: array<vec3<f32>, 3>;
    var lenSq: array<f32, 3>;
    for (var s = 0u; s < 3u; s++) {
        eff_low[s] = vec3<f32>(f32(effR[s * 2u]), f32(effG[s * 2u]), f32(effB[s * 2u]));
        eff_high[s] = vec3<f32>(f32(effR[s * 2u + 1u]), f32(effG[s * 2u + 1u]), f32(effB[s * 2u + 1u]));
        range[s] = eff_high[s] - eff_low[s];
        lenSq[s] = dot(range[s], range[s]);
    }

    // 2-bit indices
    var indices: array<u32, 16>;
    for (var i = 0u; i < 16u; i++) {
        let subset = getSubset3(bits2, i);
        indices[i] = computeIndex2_rgb((*pix255)[i].rgb, eff_low[subset], range[subset], lenSq[subset]);
    }

    // Anchor fixes
    if (indices[0] >= 2u) {
        var tmp: u32;
        tmp = epR[0]; epR[0] = epR[1]; epR[1] = tmp;
        tmp = epG[0]; epG[0] = epG[1]; epG[1] = tmp;
        tmp = epB[0]; epB[0] = epB[1]; epB[1] = tmp;
        for (var i = 0u; i < 16u; i++) {
            if (getSubset3(bits2, i) == 0u) { indices[i] = 3u - indices[i]; }
        }
    }
    if (indices[anchor1] >= 2u) {
        var tmp: u32;
        tmp = epR[2]; epR[2] = epR[3]; epR[3] = tmp;
        tmp = epG[2]; epG[2] = epG[3]; epG[3] = tmp;
        tmp = epB[2]; epB[2] = epB[3]; epB[3] = tmp;
        for (var i = 0u; i < 16u; i++) {
            if (getSubset3(bits2, i) == 1u) { indices[i] = 3u - indices[i]; }
        }
    }
    if (indices[anchor2] >= 2u) {
        var tmp: u32;
        tmp = epR[4]; epR[4] = epR[5]; epR[5] = tmp;
        tmp = epG[4]; epG[4] = epG[5]; epG[5] = tmp;
        tmp = epB[4]; epB[4] = epB[5]; epB[5] = tmp;
        for (var i = 0u; i < 16u; i++) {
            if (getSubset3(bits2, i) == 2u) { indices[i] = 3u - indices[i]; }
        }
    }

    // Recompute
    for (var e = 0u; e < 6u; e++) {
        effR[e] = unquantize(epR[e], 5u);
        effG[e] = unquantize(epG[e], 5u);
        effB[e] = unquantize(epB[e], 5u);
    }

    // Error
    var totalError = 0.0;
    for (var i = 0u; i < 16u; i++) {
        let subset = getSubset3(bits2, i);
        let loIdx = subset * 2u;
        let rr = f32(interpolate2(effR[loIdx], effR[loIdx + 1u], indices[i]));
        let gg = f32(interpolate2(effG[loIdx], effG[loIdx + 1u], indices[i]));
        let bb = f32(interpolate2(effB[loIdx], effB[loIdx + 1u], indices[i]));
        let dr = (*pix255)[i].r - rr;
        let dg = (*pix255)[i].g - gg;
        let db = (*pix255)[i].b - bb;
        let da = (*pix255)[i].a - 255.0;
        totalError += dr * dr + dg * dg + db * db + da * da;
    }

    // Pack Mode 2
    // Bit layout:
    //   [2:0]     mode = 0x04 (bit 2 set)
    //   [8:3]     partition (6 bits)
    //   [38:9]    6x R endpoints (5-bit each) = 30 bits
    //   [68:39]   6x G endpoints = 30 bits
    //   [98:69]   6x B endpoints = 30 bits
    //   No P-bits
    //   [127:99]  indices (29 bits: 3 anchors x 1-bit + 13 others x 2-bit)
    var block = vec4<u32>(0u, 0u, 0u, 0u);
    setBits(&block, 0u, 3u, 0x04u); // mode 2
    setBits(&block, 3u, 6u, partIdx);

    for (var e = 0u; e < 6u; e++) {
        setBits(&block, 9u + e * 5u, 5u, epR[e]);
        setBits(&block, 39u + e * 5u, 5u, epG[e]);
        setBits(&block, 69u + e * 5u, 5u, epB[e]);
    }

    // Indices at bit 99
    var idxBit = 99u;
    for (var i = 0u; i < 16u; i++) {
        var isAnchor = false;
        if (i == 0u || i == anchor1 || i == anchor2) { isAnchor = true; }
        if (isAnchor) {
            setBits(&block, idxBit, 1u, indices[i] & 1u);
            idxBit += 1u;
        } else {
            setBits(&block, idxBit, 2u, indices[i] & 3u);
            idxBit += 2u;
        }
    }

    return EncodeResult(block, totalError);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODE 5: 1 subset, RGB 7-bit + A 8-bit, 2-bit color + 2-bit alpha indices
// ═══════════════════════════════════════════════════════════════════════════════

fn tryMode5Rotation(
    pix255: ptr<function, array<vec4<f32>, 16>>,
    rotation: u32,
) -> EncodeResult {
    // Apply rotation: swap a channel with alpha
    var rpix: array<vec4<f32>, 16>;
    for (var i = 0u; i < 16u; i++) {
        rpix[i] = (*pix255)[i];
        if (rotation == 1u) {
            let tmp = rpix[i].r; rpix[i].r = rpix[i].a; rpix[i].a = tmp;
        } else if (rotation == 2u) {
            let tmp = rpix[i].g; rpix[i].g = rpix[i].a; rpix[i].a = tmp;
        } else if (rotation == 3u) {
            let tmp = rpix[i].b; rpix[i].b = rpix[i].a; rpix[i].a = tmp;
        }
    }

    // Find min/max RGB and A separately
    var minRGB = rpix[0].rgb;
    var maxRGB = rpix[0].rgb;
    var minA = rpix[0].a;
    var maxA = rpix[0].a;
    for (var i = 1u; i < 16u; i++) {
        minRGB = min(minRGB, rpix[i].rgb);
        maxRGB = max(maxRGB, rpix[i].rgb);
        minA = min(minA, rpix[i].a);
        maxA = max(maxA, rpix[i].a);
    }

    let insetRGB = (maxRGB - minRGB) / 16.0;
    minRGB = clamp(minRGB + insetRGB, vec3<f32>(0.0), vec3<f32>(255.0));
    maxRGB = clamp(maxRGB - insetRGB, vec3<f32>(0.0), vec3<f32>(255.0));
    let insetA = (maxA - minA) / 16.0;
    minA = clamp(minA + insetA, 0.0, 255.0);
    maxA = clamp(maxA - insetA, 0.0, 255.0);

    // Mode 5: 7-bit RGB (quantize then expand), 8-bit alpha (full precision)
    var ep0R = quantize(u32(minRGB.r + 0.5), 7u);
    var ep0G = quantize(u32(minRGB.g + 0.5), 7u);
    var ep0B = quantize(u32(minRGB.b + 0.5), 7u);
    var ep1R = quantize(u32(maxRGB.r + 0.5), 7u);
    var ep1G = quantize(u32(maxRGB.g + 0.5), 7u);
    var ep1B = quantize(u32(maxRGB.b + 0.5), 7u);
    var ep0A = u32(clamp(minA + 0.5, 0.0, 255.0));
    var ep1A = u32(clamp(maxA + 0.5, 0.0, 255.0));

    // Unquantize RGB to 8-bit
    let eff0R = unquantize(ep0R, 7u); let eff0G = unquantize(ep0G, 7u); let eff0B = unquantize(ep0B, 7u);
    let eff1R = unquantize(ep1R, 7u); let eff1G = unquantize(ep1G, 7u); let eff1B = unquantize(ep1B, 7u);
    // Alpha is 8-bit: identity
    let eff0A = ep0A;
    let eff1A = ep1A;

    let rgbLow = vec3<f32>(f32(eff0R), f32(eff0G), f32(eff0B));
    let rgbHigh = vec3<f32>(f32(eff1R), f32(eff1G), f32(eff1B));
    let rgbRange = rgbHigh - rgbLow;
    let rgbLenSq = dot(rgbRange, rgbRange);

    let aLow = f32(eff0A);
    let aHigh = f32(eff1A);
    let aRange = aHigh - aLow;
    let aLenSq = aRange * aRange;

    // Separate 2-bit indices for color and alpha
    var colorIndices: array<u32, 16>;
    var alphaIndices: array<u32, 16>;
    for (var i = 0u; i < 16u; i++) {
        colorIndices[i] = computeIndex2_rgb(rpix[i].rgb, rgbLow, rgbRange, rgbLenSq);
        alphaIndices[i] = computeIndex2_scalar(rpix[i].a, aLow, aRange, aLenSq);
    }

    // Anchor fix for color (pixel 0)
    if (colorIndices[0] >= 2u) {
        var tmp: u32;
        tmp = ep0R; ep0R = ep1R; ep1R = tmp;
        tmp = ep0G; ep0G = ep1G; ep1G = tmp;
        tmp = ep0B; ep0B = ep1B; ep1B = tmp;
        for (var i = 0u; i < 16u; i++) { colorIndices[i] = 3u - colorIndices[i]; }
    }

    // Anchor fix for alpha (pixel 0)
    if (alphaIndices[0] >= 2u) {
        let tmp = ep0A; ep0A = ep1A; ep1A = tmp;
        for (var i = 0u; i < 16u; i++) { alphaIndices[i] = 3u - alphaIndices[i]; }
    }

    // Recompute effective endpoints
    let fin0R = unquantize(ep0R, 7u); let fin0G = unquantize(ep0G, 7u); let fin0B = unquantize(ep0B, 7u);
    let fin1R = unquantize(ep1R, 7u); let fin1G = unquantize(ep1G, 7u); let fin1B = unquantize(ep1B, 7u);
    let fin0A = ep0A;
    let fin1A = ep1A;

    // Error (in un-rotated space)
    var totalError = 0.0;
    for (var i = 0u; i < 16u; i++) {
        let rr = f32(interpolate2(fin0R, fin1R, colorIndices[i]));
        let gg = f32(interpolate2(fin0G, fin1G, colorIndices[i]));
        let bb = f32(interpolate2(fin0B, fin1B, colorIndices[i]));
        let aa = f32(interpolate2(fin0A, fin1A, alphaIndices[i]));
        // Un-rotate for error computation
        var reconR = rr; var reconG = gg; var reconB = bb; var reconA = aa;
        if (rotation == 1u) { let t = reconR; reconR = reconA; reconA = t; }
        else if (rotation == 2u) { let t = reconG; reconG = reconA; reconA = t; }
        else if (rotation == 3u) { let t = reconB; reconB = reconA; reconA = t; }
        let d = (*pix255)[i] - vec4<f32>(reconR, reconG, reconB, reconA);
        totalError += dot(d, d);
    }

    // Pack Mode 5
    // Bit layout:
    //   [5:0]     mode = 0x20 (bit 5 set)
    //   [7:6]     rotation (2 bits)
    //   [14:8]    R0 (7 bits)
    //   [21:15]   R1 (7 bits)
    //   [28:22]   G0
    //   [35:29]   G1
    //   [42:36]   B0
    //   [49:43]   B1
    //   [57:50]   A0 (8 bits)
    //   [65:58]   A1 (8 bits)
    //   [66]      color index 0 (1-bit anchor)
    //   ...       color indices 1-15 (2-bit each) = 30 bits
    //   [97]      alpha index 0 (1-bit anchor)
    //   ...       alpha indices 1-15 (2-bit each) = 30 bits
    var block = vec4<u32>(0u, 0u, 0u, 0u);
    setBits(&block, 0u, 6u, 0x20u); // mode 5
    setBits(&block, 6u, 2u, rotation);

    setBits(&block, 8u, 7u, ep0R);
    setBits(&block, 15u, 7u, ep1R);
    setBits(&block, 22u, 7u, ep0G);
    setBits(&block, 29u, 7u, ep1G);
    setBits(&block, 36u, 7u, ep0B);
    setBits(&block, 43u, 7u, ep1B);
    setBits(&block, 50u, 8u, ep0A);
    setBits(&block, 58u, 8u, ep1A);

    // Color indices at bit 66: pixel 0 = 1-bit, rest = 2-bit = 31 bits total
    var idxBit = 66u;
    setBits(&block, idxBit, 1u, colorIndices[0] & 1u); idxBit += 1u;
    for (var i = 1u; i < 16u; i++) {
        setBits(&block, idxBit, 2u, colorIndices[i] & 3u); idxBit += 2u;
    }
    // Alpha indices at bit 97: pixel 0 = 1-bit, rest = 2-bit = 31 bits total
    // idxBit should be 97
    setBits(&block, idxBit, 1u, alphaIndices[0] & 1u); idxBit += 1u;
    for (var i = 1u; i < 16u; i++) {
        setBits(&block, idxBit, 2u, alphaIndices[i] & 3u); idxBit += 2u;
    }

    return EncodeResult(block, totalError);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODE 4: 1 subset, RGB 5-bit + A 6-bit, split index widths, rotation
// ═══════════════════════════════════════════════════════════════════════════════

fn tryMode4Rotation(
    pix255: ptr<function, array<vec4<f32>, 16>>,
    rotation: u32,
    indexSelector: u32, // 0: 2-bit color / 3-bit alpha, 1: 3-bit color / 2-bit alpha
) -> EncodeResult {
    // Apply rotation
    var rpix: array<vec4<f32>, 16>;
    for (var i = 0u; i < 16u; i++) {
        rpix[i] = (*pix255)[i];
        if (rotation == 1u) { let tmp = rpix[i].r; rpix[i].r = rpix[i].a; rpix[i].a = tmp; }
        else if (rotation == 2u) { let tmp = rpix[i].g; rpix[i].g = rpix[i].a; rpix[i].a = tmp; }
        else if (rotation == 3u) { let tmp = rpix[i].b; rpix[i].b = rpix[i].a; rpix[i].a = tmp; }
    }

    // Find min/max
    var minRGB = rpix[0].rgb; var maxRGB = rpix[0].rgb;
    var minA = rpix[0].a; var maxA = rpix[0].a;
    for (var i = 1u; i < 16u; i++) {
        minRGB = min(minRGB, rpix[i].rgb); maxRGB = max(maxRGB, rpix[i].rgb);
        minA = min(minA, rpix[i].a); maxA = max(maxA, rpix[i].a);
    }

    let insetRGB = (maxRGB - minRGB) / 16.0;
    minRGB = clamp(minRGB + insetRGB, vec3<f32>(0.0), vec3<f32>(255.0));
    maxRGB = clamp(maxRGB - insetRGB, vec3<f32>(0.0), vec3<f32>(255.0));
    let insetA = (maxA - minA) / 16.0;
    minA = clamp(minA + insetA, 0.0, 255.0);
    maxA = clamp(maxA - insetA, 0.0, 255.0);

    // Mode 4: 5-bit RGB, 6-bit alpha
    var ep0R = quantize(u32(minRGB.r + 0.5), 5u);
    var ep0G = quantize(u32(minRGB.g + 0.5), 5u);
    var ep0B = quantize(u32(minRGB.b + 0.5), 5u);
    var ep1R = quantize(u32(maxRGB.r + 0.5), 5u);
    var ep1G = quantize(u32(maxRGB.g + 0.5), 5u);
    var ep1B = quantize(u32(maxRGB.b + 0.5), 5u);
    var ep0A = quantize(u32(minA + 0.5), 6u);
    var ep1A = quantize(u32(maxA + 0.5), 6u);

    let eff0R = unquantize(ep0R, 5u); let eff0G = unquantize(ep0G, 5u); let eff0B = unquantize(ep0B, 5u);
    let eff1R = unquantize(ep1R, 5u); let eff1G = unquantize(ep1G, 5u); let eff1B = unquantize(ep1B, 5u);
    let eff0A = unquantize(ep0A, 6u);
    let eff1A = unquantize(ep1A, 6u);

    let rgbLow = vec3<f32>(f32(eff0R), f32(eff0G), f32(eff0B));
    let rgbHigh = vec3<f32>(f32(eff1R), f32(eff1G), f32(eff1B));
    let rgbRange = rgbHigh - rgbLow;
    let rgbLenSq = dot(rgbRange, rgbRange);
    let aLow = f32(eff0A); let aHigh = f32(eff1A);
    let aRange = aHigh - aLow;
    let aLenSq = aRange * aRange;

    // Compute indices with appropriate precision per index_selector:
    // index_selector=0: RGB gets 2-bit, Alpha gets 3-bit
    // index_selector=1: RGB gets 3-bit, Alpha gets 2-bit
    var rgbIndices: array<u32, 16>;
    var aIndices: array<u32, 16>;
    for (var i = 0u; i < 16u; i++) {
        if (indexSelector == 0u) {
            rgbIndices[i] = computeIndex2_rgb(rpix[i].rgb, rgbLow, rgbRange, rgbLenSq);
            aIndices[i] = computeIndex3_scalar(rpix[i].a, aLow, aRange, aLenSq);
        } else {
            rgbIndices[i] = computeIndex3_rgb(rpix[i].rgb, rgbLow, rgbRange, rgbLenSq);
            aIndices[i] = computeIndex2_scalar(rpix[i].a, aLow, aRange, aLenSq);
        }
    }

    // Anchor fix for RGB (pixel 0)
    let rgbMaxIdx = select(3u, 7u, indexSelector == 1u);
    let rgbHalfIdx = select(2u, 4u, indexSelector == 1u);
    if (rgbIndices[0] >= rgbHalfIdx) {
        var tmp: u32;
        tmp = ep0R; ep0R = ep1R; ep1R = tmp;
        tmp = ep0G; ep0G = ep1G; ep1G = tmp;
        tmp = ep0B; ep0B = ep1B; ep1B = tmp;
        for (var i = 0u; i < 16u; i++) { rgbIndices[i] = rgbMaxIdx - rgbIndices[i]; }
    }

    // Anchor fix for alpha (pixel 0)
    let aMaxIdx = select(7u, 3u, indexSelector == 1u);
    let aHalfIdx = select(4u, 2u, indexSelector == 1u);
    if (aIndices[0] >= aHalfIdx) {
        let tmp = ep0A; ep0A = ep1A; ep1A = tmp;
        for (var i = 0u; i < 16u; i++) { aIndices[i] = aMaxIdx - aIndices[i]; }
    }

    // Recompute
    let fin0R = unquantize(ep0R, 5u); let fin0G = unquantize(ep0G, 5u); let fin0B = unquantize(ep0B, 5u);
    let fin1R = unquantize(ep1R, 5u); let fin1G = unquantize(ep1G, 5u); let fin1B = unquantize(ep1B, 5u);
    let fin0A = unquantize(ep0A, 6u); let fin1A = unquantize(ep1A, 6u);

    // Error
    var totalError = 0.0;
    for (var i = 0u; i < 16u; i++) {
        var rr: f32; var gg: f32; var bb: f32; var aa: f32;
        if (indexSelector == 0u) {
            rr = f32(interpolate2(fin0R, fin1R, rgbIndices[i]));
            gg = f32(interpolate2(fin0G, fin1G, rgbIndices[i]));
            bb = f32(interpolate2(fin0B, fin1B, rgbIndices[i]));
            aa = f32(interpolate3(fin0A, fin1A, aIndices[i]));
        } else {
            rr = f32(interpolate3(fin0R, fin1R, rgbIndices[i]));
            gg = f32(interpolate3(fin0G, fin1G, rgbIndices[i]));
            bb = f32(interpolate3(fin0B, fin1B, rgbIndices[i]));
            aa = f32(interpolate2(fin0A, fin1A, aIndices[i]));
        }
        // Un-rotate for error
        var reconR = rr; var reconG = gg; var reconB = bb; var reconA = aa;
        if (rotation == 1u) { let t = reconR; reconR = reconA; reconA = t; }
        else if (rotation == 2u) { let t = reconG; reconG = reconA; reconA = t; }
        else if (rotation == 3u) { let t = reconB; reconB = reconA; reconA = t; }
        let d = (*pix255)[i] - vec4<f32>(reconR, reconG, reconB, reconA);
        totalError += dot(d, d);
    }

    // Per the BC7 spec, the block layout is fixed:
    // First index stream = always 2-bit (1-bit anchor + 15 x 2-bit = 31 bits)
    // Second index stream = always 3-bit (2-bit anchor + 15 x 3-bit = 47 bits)
    // When index_selector=0: first stream = color, second = alpha (no swap needed)
    // When index_selector=1: first stream = alpha, second = color (swap needed)
    // Following the reference: swap the indices so colorIndices/alphaIndices match
    // the block stream order (stream1=2-bit, stream2=3-bit)
    var colorIndices: array<u32, 16>;
    var alphaIndices: array<u32, 16>;
    if (indexSelector == 0u) {
        // color is 2-bit (stream1), alpha is 3-bit (stream2) — no swap
        for (var i = 0u; i < 16u; i++) {
            colorIndices[i] = rgbIndices[i];
            alphaIndices[i] = aIndices[i];
        }
    } else {
        // color is 3-bit, alpha is 2-bit — swap so stream1(2-bit)=alpha, stream2(3-bit)=color
        // But block_package4 calls them "color_index" for stream1 and "alpha_index" for stream2
        // The reference swaps: color_index = alpha, alpha_index = color
        for (var i = 0u; i < 16u; i++) {
            colorIndices[i] = aIndices[i];   // 2-bit alpha goes to stream1 ("color")
            alphaIndices[i] = rgbIndices[i]; // 3-bit rgb goes to stream2 ("alpha")
        }
    }

    // Pack Mode 4
    // Bit layout:
    //   [4:0]     mode = 0x10 (bit 4 set)
    //   [6:5]     rotation (2 bits)
    //   [7]       index selector (1 bit)
    //   [12:8]    R0 (5 bits)
    //   [17:13]   R1 (5 bits)
    //   [22:18]   G0
    //   [27:23]   G1
    //   [32:28]   B0
    //   [37:33]   B1
    //   [43:38]   A0 (6 bits)
    //   [49:44]   A1 (6 bits)
    //   [50-80]   color indices (31 bits: 1 anchor + 15x2 or 2 anchor + 15x3)
    //   [81-127]  alpha indices (47 bits)
    var block = vec4<u32>(0u, 0u, 0u, 0u);
    setBits(&block, 0u, 5u, 0x10u);
    setBits(&block, 5u, 2u, rotation);
    setBits(&block, 7u, 1u, indexSelector);

    setBits(&block, 8u, 5u, ep0R); setBits(&block, 13u, 5u, ep1R);
    setBits(&block, 18u, 5u, ep0G); setBits(&block, 23u, 5u, ep1G);
    setBits(&block, 28u, 5u, ep0B); setBits(&block, 33u, 5u, ep1B);
    setBits(&block, 38u, 6u, ep0A); setBits(&block, 44u, 6u, ep1A);

    // Index streams at bit 50 — fixed layout regardless of index_selector:
    // Stream 1 ("color" in ref): always 2-bit, anchor = 1-bit = 31 bits
    // Stream 2 ("alpha" in ref): always 3-bit, anchor = 2-bit = 47 bits
    // We've already swapped colorIndices/alphaIndices above to match this layout.
    var idxBit = 50u;
    // Stream 1: 2-bit indices (colorIndices after swap always holds 2-bit values)
    setBits(&block, idxBit, 1u, colorIndices[0] & 1u); idxBit += 1u;
    for (var i = 1u; i < 16u; i++) {
        setBits(&block, idxBit, 2u, colorIndices[i] & 3u); idxBit += 2u;
    }
    // Stream 2: 3-bit indices (alphaIndices after swap always holds 3-bit values)
    setBits(&block, idxBit, 2u, alphaIndices[0] & 3u); idxBit += 2u;
    for (var i = 1u; i < 16u; i++) {
        setBits(&block, idxBit, 3u, alphaIndices[i] & 7u); idxBit += 3u;
    }

    return EncodeResult(block, totalError);
}

// ─── Main entry point ────────────────────────────────────────────────────────

@compute @workgroup_size(1, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let blockX = gid.x;
    let blockY = gid.y;
    let blocksPerRow = (params.width + 3u) / 4u;

    if (blockX >= blocksPerRow || blockY >= ((params.height + 3u) / 4u)) {
        return;
    }

    // Load 4x4 pixel block, clamp to [0,1]
    var pixels: array<vec4<f32>, 16>;
    for (var dy = 0u; dy < 4u; dy++) {
        for (var dx = 0u; dx < 4u; dx++) {
            let px = min(blockX * 4u + dx, params.width - 1u);
            let py = min(blockY * 4u + dy, params.height - 1u);
            pixels[dy * 4u + dx] = clamp(
                textureLoad(sourceTexture, vec2<u32>(px, py), 0),
                vec4<f32>(0.0), vec4<f32>(1.0)
            );
        }
    }

    // Precompute pixels in [0,255] space
    var pix255: array<vec4<f32>, 16>;
    for (var i = 0u; i < 16u; i++) {
        pix255[i] = pixels[i] * 255.0;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Always try Mode 6 (fastest, best for smooth RGBA blocks)
    // ═══════════════════════════════════════════════════════════════════════════
    var bestResult = encodeMode6(&pix255);

    // ═══════════════════════════════════════════════════════════════════════════
    // Quality >= 1: try Mode 1, Mode 3, Mode 5
    // ═══════════════════════════════════════════════════════════════════════════
    if (params.quality >= 1u) {
        // Mode 1: 2-subset, 6-bit RGB + shared P-bit, 3-bit indices
        for (var partIdx = 0u; partIdx < 64u; partIdx++) {
            let partBits = candidateSectionBit[partIdx];
            let fixup = candidateFixUpIndex1D[partIdx];

            let result01 = tryMode1Partition(&pix255, partBits, fixup, 0u, 1u);
            if (result01.error < bestResult.error) {
                bestResult.error = result01.error;
                bestResult.block = result01.block;
                bestResult.block.x |= (partIdx & 0x3Fu) << 2u;
            }

            let result10 = tryMode1Partition(&pix255, partBits, fixup, 1u, 0u);
            if (result10.error < bestResult.error) {
                bestResult.error = result10.error;
                bestResult.block = result10.block;
                bestResult.block.x |= (partIdx & 0x3Fu) << 2u;
            }
        }

        // Mode 3: 2-subset, 7-bit RGB + per-EP P-bit, 2-bit indices
        for (var partIdx = 0u; partIdx < 64u; partIdx++) {
            let partBits = candidateSectionBit[partIdx];
            let fixup = candidateFixUpIndex1D[partIdx];

            // Try 4 P-bit combos (per-endpoint)
            for (var p = 0u; p < 4u; p++) {
                let plo = p & 1u;
                let phi = (p >> 1u) & 1u;
                let result = tryMode3Partition(&pix255, partBits, fixup, plo, phi, plo, phi);
                if (result.error < bestResult.error) {
                    bestResult.error = result.error;
                    bestResult.block = result.block;
                    // Set partition in bits [9:4]
                    setBits(&bestResult.block, 4u, 6u, partIdx);
                }
            }
        }

        // Mode 5: 1-subset, 7-bit RGB + 8-bit A, 2-bit indices, rotation
        for (var rot = 0u; rot < 4u; rot++) {
            let result = tryMode5Rotation(&pix255, rot);
            if (result.error < bestResult.error) {
                bestResult = result;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Quality >= 2: try all remaining modes (0, 2, 4, 7)
    // ═══════════════════════════════════════════════════════════════════════════
    if (params.quality >= 2u) {
        // Mode 0: 3-subset, 4-bit RGB + per-EP P-bit, 3-bit indices, 16 partitions
        for (var partIdx = 0u; partIdx < 16u; partIdx++) {
            for (var p = 0u; p < 4u; p++) {
                let plo = p & 1u;
                let phi = (p >> 1u) & 1u;
                let result = tryMode0Partition(&pix255, partIdx, plo, phi, plo, phi, plo, phi);
                if (result.error < bestResult.error) {
                    bestResult = result;
                }
            }
        }

        // Mode 2: 3-subset, 5-bit RGB, no P-bit, 2-bit indices, 64 partitions
        for (var partIdx = 0u; partIdx < 64u; partIdx++) {
            let result = tryMode2Partition(&pix255, partIdx);
            if (result.error < bestResult.error) {
                bestResult = result;
            }
        }

        // Mode 4: 1-subset, 5-bit RGB + 6-bit A, rotation + index selector
        for (var rot = 0u; rot < 4u; rot++) {
            for (var idxSel = 0u; idxSel < 2u; idxSel++) {
                let result = tryMode4Rotation(&pix255, rot, idxSel);
                if (result.error < bestResult.error) {
                    bestResult = result;
                }
            }
        }

        // Mode 7: 2-subset, 5-bit RGBA + per-EP P-bit, 2-bit indices
        for (var partIdx = 0u; partIdx < 64u; partIdx++) {
            let partBits = candidateSectionBit[partIdx];
            let fixup = candidateFixUpIndex1D[partIdx];

            for (var p = 0u; p < 4u; p++) {
                let plo = p & 1u;
                let phi = (p >> 1u) & 1u;
                let result = tryMode7Partition(&pix255, partBits, fixup, plo, phi, plo, phi);
                if (result.error < bestResult.error) {
                    bestResult.error = result.error;
                    bestResult.block = result.block;
                    // Set partition in bits [13:8]
                    setBits(&bestResult.block, 8u, 6u, partIdx);
                }
            }
        }
    }

    // Write output
    let blockIndex = blockY * blocksPerRow + blockX;
    let offset = blockIndex * WORDS_PER_BLOCK;
    outputBlocks[offset + 0u] = bestResult.block.x;
    outputBlocks[offset + 1u] = bestResult.block.y;
    outputBlocks[offset + 2u] = bestResult.block.z;
    outputBlocks[offset + 3u] = bestResult.block.w;
}
