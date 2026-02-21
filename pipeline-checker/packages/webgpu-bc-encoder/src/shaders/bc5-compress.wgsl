// BC5 compression compute shader
// Two independent BC4 blocks (R and G channels) = 16 bytes/block
// Layout: [64-bit BC4 red][64-bit BC4 green]

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outputBlocks: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params { width: u32, height: u32, quality: u32 }

const WORDS_PER_BLOCK: u32 = 4u;

// Encode a single BC4 channel block (shared with bc4-compress)
fn encodeChannelBlock(blockX: u32, blockY: u32, channel: u32) -> vec2<u32> {
    var values: array<f32, 16>;
    for (var dy = 0u; dy < 4u; dy++) {
        for (var dx = 0u; dx < 4u; dx++) {
            let px = min(blockX * 4u + dx, params.width - 1u);
            let py = min(blockY * 4u + dy, params.height - 1u);
            let color = textureLoad(sourceTexture, vec2<u32>(px, py), 0);
            if (channel == 0u) { values[dy * 4u + dx] = clamp(color.r, 0.0, 1.0); }
            else { values[dy * 4u + dx] = clamp(color.g, 0.0, 1.0); }
        }
    }

    var minVal = values[0];
    var maxVal = values[0];
    for (var i = 1u; i < 16u; i++) {
        minVal = min(minVal, values[i]);
        maxVal = max(maxVal, values[i]);
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
        let v = values[i];
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

    let redBlock = encodeChannelBlock(blockX, blockY, 0u);
    let greenBlock = encodeChannelBlock(blockX, blockY, 1u);

    // Write 16-byte block: [BC4_red][BC4_green]
    let blockIndex = blockY * blocksPerRow + blockX;
    let offset = blockIndex * WORDS_PER_BLOCK;
    outputBlocks[offset + 0u] = redBlock.x;
    outputBlocks[offset + 1u] = redBlock.y;
    outputBlocks[offset + 2u] = greenBlock.x;
    outputBlocks[offset + 3u] = greenBlock.y;
}
