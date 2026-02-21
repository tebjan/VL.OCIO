// Delta overlay — abs(original - decompressed) * amplification
// Used by BCDecompressStage when "Delta View" is active.
// Shows BC compression artifacts amplified for visibility.

@group(0) @binding(0) var originalTex: texture_2d<f32>;
@group(0) @binding(1) var decompressedTex: texture_2d<f32>;
@group(0) @binding(2) var texSampler: sampler;

struct DeltaParams {
    amplification: f32,
    _pad0: f32,
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

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
    let orig = textureSample(originalTex, texSampler, in.uv);
    let decomp = textureSample(decompressedTex, texSampler, in.uv);
    let delta = abs(orig - decomp) * params.amplification;
    return vec4<f32>(delta.rgb, 1.0);
}
