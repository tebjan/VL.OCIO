// BC quality metrics compute shader
// Compares original vs BC-decompressed textures per pixel.
// Writes 6 floats per pixel: SE_R, SE_G, SE_B, AE_R, AE_G, AE_B
// CPU-side reduction computes MSE, max error, and PSNR.

@group(0) @binding(0) var originalTexture: texture_2d<f32>;
@group(0) @binding(1) var decompressedTexture: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> errorOutput: array<f32>;
@group(0) @binding(3) var<uniform> params: MetricsParams;

struct MetricsParams {
    width: u32,
    height: u32,
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= params.width || gid.y >= params.height) {
        return;
    }

    let coord = vec2<u32>(gid.x, gid.y);
    let orig = textureLoad(originalTexture, coord, 0);
    let decomp = textureLoad(decompressedTexture, coord, 0);
    let delta = orig - decomp;

    let pixelIndex = gid.y * params.width + gid.x;
    let base = pixelIndex * 6u;

    // Squared error per channel (for MSE → PSNR)
    errorOutput[base + 0u] = delta.r * delta.r;
    errorOutput[base + 1u] = delta.g * delta.g;
    errorOutput[base + 2u] = delta.b * delta.b;

    // Absolute error per channel (for max error)
    errorOutput[base + 3u] = abs(delta.r);
    errorOutput[base + 4u] = abs(delta.g);
    errorOutput[base + 5u] = abs(delta.b);
}
