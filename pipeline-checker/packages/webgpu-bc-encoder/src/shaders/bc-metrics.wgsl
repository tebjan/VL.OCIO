// BC quality metrics compute shader — placeholder
// TODO (task 5.4): Implement per-channel PSNR, MSE, and max error computation
//
// Compares original vs BC-decompressed textures:
//   - Per-pixel: abs(original - decompressed) → reduction for max error
//   - Per-channel: sum of squared errors → PSNR = 10 * log10(1.0 / MSE)
//   - Output: [PSNR_R, PSNR_G, PSNR_B, PSNR_combined,
//              maxError_R, maxError_G, maxError_B, maxError_combined,
//              MSE_R, MSE_G, MSE_B]

@group(0) @binding(0) var originalTexture: texture_2d<f32>;
@group(0) @binding(1) var decompressedTexture: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> results: array<f32>;
@group(0) @binding(3) var<uniform> params: MetricsParams;

struct MetricsParams { width: u32, height: u32 }

@compute @workgroup_size(1, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    _ = gid;
    _ = originalTexture;
    _ = decompressedTexture;
    _ = results;
    _ = params;
}
