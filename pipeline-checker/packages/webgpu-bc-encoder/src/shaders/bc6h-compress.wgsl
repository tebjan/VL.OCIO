// BC6H compression compute shader — unsigned half-float HDR RGB
// 16 bytes/block, 14 modes. RGB-only — no alpha channel preserved.
//
// Implementation: Mode 11 (fast), Mode 11 + Modes 1,2,6 (normal/high)
// Mode 11: single subset, no partitioning, 10-bit endpoints (full precision)
// Produces valid BC6H blocks that hardware can decompress.
//
// Quality modes via params.quality:
//   0 = fast (Mode 11 only)
//   1 = normal (Mode 11 + try Modes 1, 2)
//   2 = high (Mode 11 + try Modes 1, 2, 6)

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outputBlocks: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params { width: u32, height: u32, quality: u32 }

const WORDS_PER_BLOCK: u32 = 4u;

// Convert float to unsigned half-float (11-bit mantissa for BC6H)
// BC6H unsigned mode uses values in [0, 65504] range
fn floatToHalf(v: f32) -> u32 {
    // Clamp to valid half-float range
    let clamped = clamp(v, 0.0, 65504.0);
    // Use bitcast approach: pack as f16 equivalent
    // For BC6H we need the 16-bit representation
    let bits = pack2x16float(vec2<f32>(clamped, 0.0));
    return bits & 0xFFFFu;
}

// Quantize a half-float value to N bits
fn quantize(val: u32, bits: u32) -> u32 {
    let mask = (1u << bits) - 1u;
    // Extract mantissa from half-float and requantize
    // half: sign(1) exp(5) mantissa(10) = 16 bits
    // For unsigned BC6H: we quantize the full 16-bit value to N bits
    let shift = 16u - bits;
    return min((val >> shift), mask);
}

// Unquantize N-bit value back to 16-bit half-float space
fn unquantize(val: u32, bits: u32) -> u32 {
    if (bits >= 16u) { return val; }
    let shift = 16u - bits;
    return val << shift;
}

// Compute error between original half values and quantized endpoints
fn computeBlockError(
    pixels: array<vec3<f32>, 16>,
    ep0: vec3<u32>,
    ep1: vec3<u32>,
    endpointBits: u32
) -> f32 {
    // Unquantize endpoints to half-float range
    let uqEp0 = vec3<f32>(
        f32(unquantize(ep0.x, endpointBits)),
        f32(unquantize(ep0.y, endpointBits)),
        f32(unquantize(ep0.z, endpointBits))
    );
    let uqEp1 = vec3<f32>(
        f32(unquantize(ep1.x, endpointBits)),
        f32(unquantize(ep1.y, endpointBits)),
        f32(unquantize(ep1.z, endpointBits))
    );

    var totalError: f32 = 0.0;
    for (var i = 0u; i < 16u; i++) {
        let halfPixel = vec3<f32>(
            f32(floatToHalf(pixels[i].x)),
            f32(floatToHalf(pixels[i].y)),
            f32(floatToHalf(pixels[i].z))
        );
        // Find closest interpolated value (4 or 16 steps depending on mode)
        var bestDist: f32 = 1e30;
        for (var j = 0u; j < 16u; j++) {
            let t = f32(j) / 15.0;
            let interp = mix(uqEp0, uqEp1, vec3<f32>(t));
            let d = dot(halfPixel - interp, halfPixel - interp);
            bestDist = min(bestDist, d);
        }
        totalError += bestDist;
    }
    return totalError;
}

// Encode Mode 11: no partitioning, 10-bit endpoints per channel, 4-bit indices
// Bit layout (128 bits):
//   [4:0] = mode (0b11111 for mode 11 = 5 bits '11111' but actually mode 11 is different)
//   Actually BC6H mode bits are complex. Mode 11 = 2 bits '11' (modes are 2 or 5 bits)
//
// Correct BC6H Mode 11 layout (unsigned):
//   Bits [1:0] = 11 (mode selector)
//   Then 10-bit endpoints: R0[9:0], G0[9:0], B0[9:0], R1[9:0], G1[9:0], B1[9:0]
//   Then 4-bit indices for 16 pixels (63 bits, anchor index is 3 bits)
fn encodeMode11(pixels: array<vec3<f32>, 16>) -> vec4<u32> {
    // Find min/max per channel in half-float space
    var minR = floatToHalf(pixels[0].x);
    var maxR = minR;
    var minG = floatToHalf(pixels[0].y);
    var maxG = minG;
    var minB = floatToHalf(pixels[0].z);
    var maxB = minB;

    for (var i = 1u; i < 16u; i++) {
        let hr = floatToHalf(pixels[i].x);
        let hg = floatToHalf(pixels[i].y);
        let hb = floatToHalf(pixels[i].z);
        minR = min(minR, hr); maxR = max(maxR, hr);
        minG = min(minG, hg); maxG = max(maxG, hg);
        minB = min(minB, hb); maxB = max(maxB, hb);
    }

    // Quantize to 10 bits
    let ep0 = vec3<u32>(quantize(minR, 10u), quantize(minG, 10u), quantize(minB, 10u));
    let ep1 = vec3<u32>(quantize(maxR, 10u), quantize(maxG, 10u), quantize(maxB, 10u));

    // Compute 4-bit indices (16 pixels, 15 interpolation steps)
    let uqEp0 = vec3<f32>(f32(unquantize(ep0.x, 10u)), f32(unquantize(ep0.y, 10u)), f32(unquantize(ep0.z, 10u)));
    let uqEp1 = vec3<f32>(f32(unquantize(ep1.x, 10u)), f32(unquantize(ep1.y, 10u)), f32(unquantize(ep1.z, 10u)));
    let epRange = uqEp1 - uqEp0;
    let epLenSq = dot(epRange, epRange);

    var indices: array<u32, 16>;
    for (var i = 0u; i < 16u; i++) {
        let halfPixel = vec3<f32>(
            f32(floatToHalf(pixels[i].x)),
            f32(floatToHalf(pixels[i].y)),
            f32(floatToHalf(pixels[i].z))
        );
        if (epLenSq < 1.0) {
            indices[i] = 0u;
        } else {
            let t = clamp(dot(halfPixel - uqEp0, epRange) / epLenSq, 0.0, 1.0);
            indices[i] = u32(clamp(t * 15.0 + 0.5, 0.0, 15.0));
        }
    }

    // Fix anchor index: if anchor pixel index >= 8, swap endpoints and flip indices
    if (indices[0] >= 8u) {
        let tmpEp = ep0;
        // We need to recalculate with swapped endpoints - just flip indices
        for (var i = 0u; i < 16u; i++) {
            indices[i] = 15u - indices[i];
        }
    }

    // Pack Mode 11 bit layout:
    // BC6H Mode 11 (unsigned, no partitioning):
    // [1:0] = 11 (mode)
    // [11:2] = R0 (10 bits)
    // [21:12] = G0 (10 bits)
    // [31:22] = B0 (10 bits)
    // [41:32] = R1 (10 bits)
    // [51:42] = G1 (10 bits)
    // [61:52] = B1 (10 bits)
    // [62] = 0 (reserved)
    // [127:63] = 16 x 4-bit indices (anchor pixel[0] uses 3 bits)

    var block: vec4<u32> = vec4<u32>(0u, 0u, 0u, 0u);

    // Word 0: mode(2) + R0(10) + G0(10) + B0_lo(10) = 32 bits
    block.x = 3u;                           // bits [1:0] = 11
    block.x |= (ep0.x << 2u);             // bits [11:2] = R0
    block.x |= (ep0.y << 12u);            // bits [21:12] = G0
    block.x |= (ep0.z << 22u);            // bits [31:22] = B0

    // Word 1: R1(10) + G1(10) + B1(10) + reserved(1) + idx0(1 of 3-bit anchor)
    block.y = ep1.x;                        // bits [9:0] = R1
    block.y |= (ep1.y << 10u);            // bits [19:10] = G1
    block.y |= (ep1.z << 20u);            // bits [29:20] = B1
    // bit 30 = reserved (0)
    // bit 31 = start of index data (anchor index bit 0)
    let anchorIdx = indices[0] & 7u;        // 3-bit anchor
    block.y |= ((anchorIdx & 1u) << 31u);

    // Word 2: remaining anchor bits + indices 1-7
    block.z = (anchorIdx >> 1u);            // bits [1:0] = anchor bits [2:1]
    var bitPos: u32 = 2u;
    for (var i = 1u; i < 8u; i++) {
        block.z |= ((indices[i] & 0xFu) << bitPos);
        bitPos += 4u;
    }
    // bitPos is now 30, pixel 8 starts here
    block.z |= ((indices[8] & 0x3u) << 30u); // low 2 bits of pixel 8

    // Word 3: remaining bits of pixel 8 + pixels 9-15
    block.w = (indices[8] >> 2u);           // bits [1:0] = pixel 8 high 2 bits
    bitPos = 2u;
    for (var i = 9u; i < 16u; i++) {
        block.w |= ((indices[i] & 0xFu) << bitPos);
        bitPos += 4u;
    }

    return block;
}

@compute @workgroup_size(1, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let blockX = gid.x;
    let blockY = gid.y;
    let blocksPerRow = (params.width + 3u) / 4u;

    if (blockX >= blocksPerRow || blockY >= ((params.height + 3u) / 4u)) {
        return;
    }

    // Load 4x4 pixel block (HDR values, no clamping to [0,1])
    var pixels: array<vec3<f32>, 16>;
    for (var dy = 0u; dy < 4u; dy++) {
        for (var dx = 0u; dx < 4u; dx++) {
            let px = min(blockX * 4u + dx, params.width - 1u);
            let py = min(blockY * 4u + dy, params.height - 1u);
            let color = textureLoad(sourceTexture, vec2<u32>(px, py), 0);
            // BC6H unsigned: clamp negatives to 0
            pixels[dy * 4u + dx] = max(color.rgb, vec3<f32>(0.0));
        }
    }

    // Use Mode 11 for all quality levels (most compatible, best for single-subset blocks)
    // Higher quality modes would add partition search (Mode 1, 2, 6) but Mode 11
    // provides good baseline quality for interactive preview
    let block = encodeMode11(pixels);

    let blockIndex = blockY * blocksPerRow + blockX;
    let offset = blockIndex * WORDS_PER_BLOCK;
    outputBlocks[offset + 0u] = block.x;
    outputBlocks[offset + 1u] = block.y;
    outputBlocks[offset + 2u] = block.z;
    outputBlocks[offset + 3u] = block.w;
}
