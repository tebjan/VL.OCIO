// sRGB → Linear conversion pass.
// Used before BC6H compression when input is sRGB, since BC6H stores linear HDR data.

@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var texSampler: sampler;

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

// Inverse sRGB transfer function (IEC 61966-2-1)
fn sRGBToLinear(srgb: vec3<f32>) -> vec3<f32> {
    let lo = srgb / 12.92;
    let hi = pow((srgb + 0.055) / 1.055, vec3<f32>(2.4));
    return select(hi, lo, srgb <= vec3<f32>(0.04045));
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
    let color = textureSample(inputTex, texSampler, in.uv);
    let linear = sRGBToLinear(color.rgb);
    return vec4<f32>(linear, color.a);
}
