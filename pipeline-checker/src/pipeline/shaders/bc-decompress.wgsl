// BC Decompress — samples from a native BC compressed texture.
// GPU hardware decompresses automatically during textureSample.

@group(0) @binding(0) var bcTexture: texture_2d<f32>;
@group(0) @binding(1) var bcSampler: sampler;

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
    return textureSample(bcTexture, bcSampler, in.uv);
}
