// BC3 compression compute shader
// BC1 color block + BC4-style interpolated alpha = 16 bytes/block
// Layout: [64-bit BC4 alpha][64-bit BC1 color]

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outputBlocks: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params { width: u32, height: u32, quality: u32 }

const WORDS_PER_BLOCK: u32 = 4u;

fn packRGB565(c: vec3<f32>) -> u32 {
    let r = u32(clamp(c.r * 31.0 + 0.5, 0.0, 31.0));
    let g = u32(clamp(c.g * 63.0 + 0.5, 0.0, 63.0));
    let b = u32(clamp(c.b * 31.0 + 0.5, 0.0, 31.0));
    return (r << 11u) | (g << 5u) | b;
}

fn unpackRGB565(c: u32) -> vec3<f32> {
    let r = f32((c >> 11u) & 0x1Fu) / 31.0;
    let g = f32((c >> 5u) & 0x3Fu) / 63.0;
    let b = f32(c & 0x1Fu) / 31.0;
    return vec3<f32>(r, g, b);
}

fn colorDistSq(a: vec3<f32>, b: vec3<f32>) -> f32 {
    let d = a - b;
    return dot(d, d);
}

// Encode BC4-style alpha block returning 2 x u32
fn encodeAlphaBlock(alphaValues: array<f32, 16>) -> vec2<u32> {
    var minVal = alphaValues[0];
    var maxVal = alphaValues[0];
    for (var i = 1u; i < 16u; i++) {
        minVal = min(minVal, alphaValues[i]);
        maxVal = max(maxVal, alphaValues[i]);
    }

    var ep0 = u32(clamp(maxVal * 255.0 + 0.5, 0.0, 255.0));
    var ep1 = u32(clamp(minVal * 255.0 + 0.5, 0.0, 255.0));

    if (ep0 == ep1) {
        if (ep0 < 255u) { ep0 = ep0 + 1u; }
        else { ep1 = ep1 - 1u; }
    }
    if (ep0 < ep1) {
        let tmp = ep0;
        ep0 = ep1;
        ep1 = tmp;
    }

    let f0 = f32(ep0) / 255.0;
    let f1 = f32(ep1) / 255.0;
    var palette: array<f32, 8>;
    palette[0] = f0;
    palette[1] = f1;
    palette[2] = (6.0 * f0 + 1.0 * f1) / 7.0;
    palette[3] = (5.0 * f0 + 2.0 * f1) / 7.0;
    palette[4] = (4.0 * f0 + 3.0 * f1) / 7.0;
    palette[5] = (3.0 * f0 + 4.0 * f1) / 7.0;
    palette[6] = (2.0 * f0 + 5.0 * f1) / 7.0;
    palette[7] = (1.0 * f0 + 6.0 * f1) / 7.0;

    var idxBits0: u32 = 0u;
    var idxBits1: u32 = 0u;
    for (var i = 0u; i < 16u; i++) {
        let v = alphaValues[i];
        var bestIdx = 0u;
        var bestDist = abs(v - palette[0]);
        for (var j = 1u; j < 8u; j++) {
            let d = abs(v - palette[j]);
            if (d < bestDist) { bestIdx = j; bestDist = d; }
        }
        let bitPos = i * 3u;
        if (bitPos < 32u) {
            idxBits0 |= (bestIdx << bitPos);
            if (bitPos + 3u > 32u) { idxBits1 |= (bestIdx >> (32u - bitPos)); }
        } else {
            idxBits1 |= (bestIdx << (bitPos - 32u));
        }
    }

    let word0 = ep0 | (ep1 << 8u) | (idxBits0 << 16u);
    let word1 = (idxBits0 >> 16u) | (idxBits1 << 16u);
    return vec2<u32>(word0, word1);
}

@compute @workgroup_size(1, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let blockX = gid.x;
    let blockY = gid.y;
    let blocksPerRow = (params.width + 3u) / 4u;

    if (blockX >= blocksPerRow || blockY >= ((params.height + 3u) / 4u)) {
        return;
    }

    // Load 4x4 block
    var pixels: array<vec4<f32>, 16>;
    for (var dy = 0u; dy < 4u; dy++) {
        for (var dx = 0u; dx < 4u; dx++) {
            let px = min(blockX * 4u + dx, params.width - 1u);
            let py = min(blockY * 4u + dy, params.height - 1u);
            pixels[dy * 4u + dx] = clamp(textureLoad(sourceTexture, vec2<u32>(px, py), 0), vec4<f32>(0.0), vec4<f32>(1.0));
        }
    }

    // --- Alpha block: BC4-style interpolated ---
    var alphaValues: array<f32, 16>;
    for (var i = 0u; i < 16u; i++) {
        alphaValues[i] = pixels[i].a;
    }
    let alphaBlock = encodeAlphaBlock(alphaValues);

    // --- Color block: BC1-style ---
    var minColor = pixels[0].rgb;
    var maxColor = pixels[0].rgb;
    for (var i = 1u; i < 16u; i++) {
        minColor = min(minColor, pixels[i].rgb);
        maxColor = max(maxColor, pixels[i].rgb);
    }
    let inset = (maxColor - minColor) / 16.0;
    minColor = clamp(minColor + inset, vec3<f32>(0.0), vec3<f32>(1.0));
    maxColor = clamp(maxColor - inset, vec3<f32>(0.0), vec3<f32>(1.0));

    var ep0 = packRGB565(maxColor);
    var ep1 = packRGB565(minColor);
    if (ep0 < ep1) {
        let tmp = ep0;
        ep0 = ep1;
        ep1 = tmp;
    }

    let c0 = unpackRGB565(ep0);
    let c1 = unpackRGB565(ep1);
    let c2 = select((2.0 * c0 + c1) / 3.0, c0, ep0 == ep1);
    let c3 = select((c0 + 2.0 * c1) / 3.0, c1, ep0 == ep1);

    var indices: u32 = 0u;
    for (var i = 0u; i < 16u; i++) {
        let p = pixels[i].rgb;
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

    // Write 16-byte block: [alpha_word0][alpha_word1][color_endpoints][color_indices]
    let blockIndex = blockY * blocksPerRow + blockX;
    let offset = blockIndex * WORDS_PER_BLOCK;
    outputBlocks[offset + 0u] = alphaBlock.x;
    outputBlocks[offset + 1u] = alphaBlock.y;
    outputBlocks[offset + 2u] = ep0 | (ep1 << 16u);
    outputBlocks[offset + 3u] = indices;
}
