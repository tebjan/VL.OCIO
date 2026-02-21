// BC1 (DXT1) compression compute shader
// 2 RGB565 color endpoints + 4x4 block of 2-bit interpolation indices = 8 bytes/block
// Algorithm: bounding box min/max endpoints, optimal 4-color palette, closest index selection

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outputBlocks: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params { width: u32, height: u32, quality: u32 }

const WORDS_PER_BLOCK: u32 = 2u;

// Pack float RGB [0,1] to RGB565 u16
fn packRGB565(c: vec3<f32>) -> u32 {
    let r = u32(clamp(c.r * 31.0 + 0.5, 0.0, 31.0));
    let g = u32(clamp(c.g * 63.0 + 0.5, 0.0, 63.0));
    let b = u32(clamp(c.b * 31.0 + 0.5, 0.0, 31.0));
    return (r << 11u) | (g << 5u) | b;
}

// Unpack RGB565 back to float RGB [0,1] for index selection
fn unpackRGB565(c: u32) -> vec3<f32> {
    let r = f32((c >> 11u) & 0x1Fu) / 31.0;
    let g = f32((c >> 5u) & 0x3Fu) / 63.0;
    let b = f32(c & 0x1Fu) / 31.0;
    return vec3<f32>(r, g, b);
}

// Compute squared distance between two colors
fn colorDistSq(a: vec3<f32>, b: vec3<f32>) -> f32 {
    let d = a - b;
    return dot(d, d);
}

@compute @workgroup_size(1, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let blockX = gid.x;
    let blockY = gid.y;
    let blocksPerRow = (params.width + 3u) / 4u;

    // Bounds check
    if (blockX >= blocksPerRow || blockY >= ((params.height + 3u) / 4u)) {
        return;
    }

    // Load 4x4 pixel block with edge clamping
    var pixels: array<vec3<f32>, 16>;
    for (var dy = 0u; dy < 4u; dy++) {
        for (var dx = 0u; dx < 4u; dx++) {
            let px = min(blockX * 4u + dx, params.width - 1u);
            let py = min(blockY * 4u + dy, params.height - 1u);
            let color = textureLoad(sourceTexture, vec2<u32>(px, py), 0);
            // Clamp to [0,1] for LDR encoding
            pixels[dy * 4u + dx] = clamp(color.rgb, vec3<f32>(0.0), vec3<f32>(1.0));
        }
    }

    // Find bounding box endpoints (min/max per channel)
    var minColor = pixels[0];
    var maxColor = pixels[0];
    for (var i = 1u; i < 16u; i++) {
        minColor = min(minColor, pixels[i]);
        maxColor = max(maxColor, pixels[i]);
    }

    // Inset bounding box by 1/16 to improve quality
    let inset = (maxColor - minColor) / 16.0;
    minColor = clamp(minColor + inset, vec3<f32>(0.0), vec3<f32>(1.0));
    maxColor = clamp(maxColor - inset, vec3<f32>(0.0), vec3<f32>(1.0));

    // Quantize endpoints to RGB565
    var ep0 = packRGB565(maxColor);
    var ep1 = packRGB565(minColor);

    // Ensure ep0 > ep1 for 4-color mode (no 1-bit alpha)
    if (ep0 < ep1) {
        let tmp = ep0;
        ep0 = ep1;
        ep1 = tmp;
        let tmpC = minColor;
        minColor = maxColor;
        maxColor = tmpC;
    }
    if (ep0 == ep1) {
        // All pixels same color — indices all 0
        let blockIndex = blockY * blocksPerRow + blockX;
        let offset = blockIndex * WORDS_PER_BLOCK;
        outputBlocks[offset + 0u] = ep0 | (ep1 << 16u);
        outputBlocks[offset + 1u] = 0u;
        return;
    }

    // Reconstruct quantized endpoint colors for accurate index selection
    let c0 = unpackRGB565(ep0);
    let c1 = unpackRGB565(ep1);
    // 4-color palette: c0, c1, (2*c0+c1)/3, (c0+2*c1)/3
    let c2 = (2.0 * c0 + c1) / 3.0;
    let c3 = (c0 + 2.0 * c1) / 3.0;

    // Select best index for each pixel
    var indices: u32 = 0u;
    for (var i = 0u; i < 16u; i++) {
        let p = pixels[i];
        let d0 = colorDistSq(p, c0);
        let d1 = colorDistSq(p, c1);
        let d2 = colorDistSq(p, c2);
        let d3 = colorDistSq(p, c3);

        var bestIdx = 0u;
        var bestDist = d0;
        if (d1 < bestDist) { bestIdx = 1u; bestDist = d1; }
        if (d2 < bestDist) { bestIdx = 2u; bestDist = d2; }
        if (d3 < bestDist) { bestIdx = 3u; }

        indices |= (bestIdx << (i * 2u));
    }

    // Write 8-byte block: [ep0:16 | ep1:16] [indices:32]
    let blockIndex = blockY * blocksPerRow + blockX;
    let offset = blockIndex * WORDS_PER_BLOCK;
    outputBlocks[offset + 0u] = ep0 | (ep1 << 16u);
    outputBlocks[offset + 1u] = indices;
}
