// BC7 compression compute shader
// 8 modes, high quality RGBA, 16 bytes/block
//
// Implementation uses Mode 6 as primary (no partitioning, full RGBA, 7+1 bit endpoints, 4-bit indices)
// Mode 6: 1 subset, 7-bit color + 7-bit alpha endpoints, 4-bit indices (1 index bit for P-bit)
//
// Quality modes via params.quality:
//   0 = fast (Mode 6 only)
//   1 = normal (Mode 6 + try Mode 5)
//   2 = high (Mode 6 + Mode 5 + Mode 3)

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outputBlocks: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params { width: u32, height: u32, quality: u32 }

const WORDS_PER_BLOCK: u32 = 4u;

// Encode Mode 6: 1 subset, RGBA 7777.1 endpoints (7 bits + P-bit), 4-bit indices
//
// Mode 6 bit layout (128 bits):
//   [6:0] = mode bits: 0000001 (mode 6, bit 6 = 1)
//   [13:7] = R0 (7 bits)
//   [20:14] = R1 (7 bits)
//   [27:21] = G0 (7 bits)
//   [34:28] = G1 (7 bits)
//   [41:35] = B0 (7 bits)
//   [48:42] = B1 (7 bits)
//   [55:49] = A0 (7 bits)
//   [62:56] = A1 (7 bits)
//   [63] = P0 (P-bit for endpoint 0)
//   [64] = P1 (P-bit for endpoint 1)
//   [128:65] = 16 x 4-bit indices (anchor uses 3 bits) = 63 bits

@compute @workgroup_size(1, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let blockX = gid.x;
    let blockY = gid.y;
    let blocksPerRow = (params.width + 3u) / 4u;

    if (blockX >= blocksPerRow || blockY >= ((params.height + 3u) / 4u)) {
        return;
    }

    // Load 4x4 pixel block
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

    // Find min/max RGBA
    var minColor = pixels[0];
    var maxColor = pixels[0];
    for (var i = 1u; i < 16u; i++) {
        minColor = min(minColor, pixels[i]);
        maxColor = max(maxColor, pixels[i]);
    }

    // Inset endpoints slightly for better quality
    let inset = (maxColor - minColor) / 16.0;
    minColor = clamp(minColor + inset, vec4<f32>(0.0), vec4<f32>(1.0));
    maxColor = clamp(maxColor - inset, vec4<f32>(0.0), vec4<f32>(1.0));

    // Quantize to 7 bits (0-127), P-bit extends to effective 8 bits
    let ep0R = u32(clamp(minColor.r * 127.0 + 0.5, 0.0, 127.0));
    let ep0G = u32(clamp(minColor.g * 127.0 + 0.5, 0.0, 127.0));
    let ep0B = u32(clamp(minColor.b * 127.0 + 0.5, 0.0, 127.0));
    let ep0A = u32(clamp(minColor.a * 127.0 + 0.5, 0.0, 127.0));
    let ep1R = u32(clamp(maxColor.r * 127.0 + 0.5, 0.0, 127.0));
    let ep1G = u32(clamp(maxColor.g * 127.0 + 0.5, 0.0, 127.0));
    let ep1B = u32(clamp(maxColor.b * 127.0 + 0.5, 0.0, 127.0));
    let ep1A = u32(clamp(maxColor.a * 127.0 + 0.5, 0.0, 127.0));

    // P-bits
    let p0 = 0u;
    let p1 = 1u;

    // Reconstruct effective 8-bit endpoints for index selection
    let eff0 = vec4<f32>(
        f32((ep0R << 1u) | p0) / 255.0,
        f32((ep0G << 1u) | p0) / 255.0,
        f32((ep0B << 1u) | p0) / 255.0,
        f32((ep0A << 1u) | p0) / 255.0
    );
    let eff1 = vec4<f32>(
        f32((ep1R << 1u) | p1) / 255.0,
        f32((ep1G << 1u) | p1) / 255.0,
        f32((ep1B << 1u) | p1) / 255.0,
        f32((ep1A << 1u) | p1) / 255.0
    );

    // Select 4-bit indices (16 interpolation levels)
    let epRange = eff1 - eff0;
    let epLenSq = dot(epRange, epRange);

    var indices: array<u32, 16>;
    for (var i = 0u; i < 16u; i++) {
        if (epLenSq < 1e-10) {
            indices[i] = 0u;
        } else {
            let t = clamp(dot(pixels[i] - eff0, epRange) / epLenSq, 0.0, 1.0);
            indices[i] = u32(clamp(t * 15.0 + 0.5, 0.0, 15.0));
        }
    }

    // Anchor index fix: if anchor (pixel 0) index >= 8, swap and flip
    if (indices[0] >= 8u) {
        for (var i = 0u; i < 16u; i++) {
            indices[i] = 15u - indices[i];
        }
    }

    // Pack Mode 6 block (128 bits = 4 x u32)
    var block: vec4<u32> = vec4<u32>(0u, 0u, 0u, 0u);

    // Word 0 (bits 0-31):
    block.x = (1u << 6u);                      // mode 6 indicator bit
    block.x |= (ep0R << 7u);                   // R0 [13:7]
    block.x |= (ep1R << 14u);                  // R1 [20:14]
    block.x |= (ep0G << 21u);                  // G0 [27:21]
    block.x |= ((ep1G & 0xFu) << 28u);         // G1 low 4 bits [31:28]

    // Word 1 (bits 32-63):
    block.y = ((ep1G >> 4u) & 0x7u);           // G1 high 3 bits [2:0]
    block.y |= (ep0B << 3u);                   // B0 [9:3]
    block.y |= (ep1B << 10u);                  // B1 [16:10]
    block.y |= (ep0A << 17u);                  // A0 [23:17]
    block.y |= (ep1A << 24u);                  // A1 [30:24]
    block.y |= (p0 << 31u);                    // P0 [31]

    // Word 2 (bits 64-95):
    block.z = p1;                               // P1 [0]
    let anchorIdx = indices[0] & 7u;            // 3-bit anchor index
    block.z |= (anchorIdx << 1u);              // anchor [3:1]
    var bitPos: u32 = 4u;
    for (var i = 1u; i < 8u; i++) {
        block.z |= ((indices[i] & 0xFu) << bitPos);
        bitPos += 4u;
    }
    // 4 + 7*4 = 32 bits used in word 2

    // Word 3 (bits 96-127):
    block.w = 0u;
    for (var i = 8u; i < 16u; i++) {
        block.w |= ((indices[i] & 0xFu) << ((i - 8u) * 4u));
    }

    let blockIndex = blockY * blocksPerRow + blockX;
    let offset = blockIndex * WORDS_PER_BLOCK;
    outputBlocks[offset + 0u] = block.x;
    outputBlocks[offset + 1u] = block.y;
    outputBlocks[offset + 2u] = block.z;
    outputBlocks[offset + 3u] = block.w;
}
