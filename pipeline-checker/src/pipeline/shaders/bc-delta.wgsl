// Delta overlay — BC compression error visualization.
// Used by BCDecompressStage when "Delta View" is active.
//
// For linear/HDR inputs: applies Reinhard tonemap x/(1+x) to both
// original and decompressed before computing abs difference. This tames
// HDR hot spots while keeping errors proportional in the SDR range
// (Reinhard is near-identity for small values).
//
// For sRGB/log/PQ inputs: raw abs difference (data already has
// perceptual encoding from its transfer function).

@group(0) @binding(0) var originalTex: texture_2d<f32>;
@group(0) @binding(1) var decompressedTex: texture_2d<f32>;
@group(0) @binding(2) var texSampler: sampler;

struct DeltaParams {
    amplification: f32,
    isLinear: f32,   // 1.0 for linear/HDR input, 0.0 for sRGB/log/PQ
    _pad1: f32,
    _pad2: f32,
};
@group(0) @binding(3) var<uniform> params: DeltaParams;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VertexOutput {
    var out: VertexOutput;
    let uv = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    out.position = vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
    out.uv = vec2<f32>(uv.x, 1.0 - uv.y);
    return out;
}

// Reinhard tonemap: tame HDR peaks while staying near-identity in SDR range.
// No sRGB gamma — keeps error proportional to linear values for dark tones.
fn reinhardMap(v: vec3<f32>) -> vec3<f32> {
    let c = max(v, vec3<f32>(0.0));
    return c / (vec3<f32>(1.0) + c);  // [0,inf) -> [0,1)
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
    let orig = textureSample(originalTex, texSampler, in.uv);
    let decomp = textureSample(decompressedTex, texSampler, in.uv);
    // Linear/HDR: Reinhard to tame HDR extremes, keep SDR-range errors proportional
    // sRGB/log/PQ: data already has perceptual encoding, raw diff is fair
    let a = select(orig.rgb, reinhardMap(orig.rgb), params.isLinear > 0.5);
    let b = select(decomp.rgb, reinhardMap(decomp.rgb), params.isLinear > 0.5);
    let delta = abs(a - b) * params.amplification;
    return vec4<f32>(delta, 1.0);
}
