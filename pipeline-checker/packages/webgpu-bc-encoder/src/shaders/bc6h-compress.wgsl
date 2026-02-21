// BC6H compression compute shader — placeholder
// TODO (task 5.2): Port from block_compression repo + Betsy BC6H reference
// BC6H: HDR RGB, half-float, 14 modes, 16 bytes/block
// RGB-only — no alpha channel preserved
//
// Quality modes:
//   fast:   Mode 11 only
//   normal: Top partition candidates
//   high:   Exhaustive mode search

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outputBlocks: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params { width: u32, height: u32, quality: u32 }

@compute @workgroup_size(1, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let blockX = gid.x;
    let blockY = gid.y;
    _ = blockX;
    _ = blockY;
    _ = params;
    _ = sourceTexture;
    _ = outputBlocks;
}
