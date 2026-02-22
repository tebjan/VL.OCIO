// Preview blit shader — renders stage rgba16float texture to canvas.
// Faithful display: raw pixel values clamped to 0-1. No gamma, no exposure, no transforms.
// Uses textureSample with linear filtering for correct downscaling in thumbnails.

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VertexOutput {
    var out: VertexOutput;
    let u = f32((i << 1u) & 2u);
    let v = f32(i & 2u);
    out.position = vec4<f32>(u * 2.0 - 1.0, v * 2.0 - 1.0, 0.0, 1.0);
    out.uv = vec2<f32>(u, v);
    return out;
}

@group(0) @binding(0) var stageTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> view: ViewUniforms;
@group(0) @binding(2) var texSampler: sampler;

struct ViewUniforms {
    viewExposure: f32,
    zoom: f32,
    panX: f32,
    panY: f32,
    applySRGB: f32,
};

// sRGB transfer function (IEC 61966-2-1)
fn linearToSRGB(linear: vec3<f32>) -> vec3<f32> {
    let lo = linear * 12.92;
    let hi = 1.055 * pow(linear, vec3<f32>(1.0 / 2.4)) - 0.055;
    return select(hi, lo, linear <= vec3<f32>(0.0031308));
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
    // Transform UV by zoom/pan
    let uv = (in.uv - 0.5) / view.zoom + vec2<f32>(view.panX, view.panY) + 0.5;

    // Sample unconditionally (textureSample requires uniform control flow)
    let clampedUV = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
    let color = textureSample(stageTexture, texSampler, clampedUV);

    // Clamp to 0-1, optionally apply linear → sRGB gamma
    let clamped = clamp(color.rgb, vec3<f32>(0.0), vec3<f32>(1.0));
    let display = select(clamped, linearToSRGB(clamped), view.applySRGB > 0.5);

    // Out-of-bounds: dark border (applied after sampling to keep uniform control flow)
    let border = vec4<f32>(0.05, 0.05, 0.05, 1.0);
    let oob = uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0;
    return select(vec4<f32>(display, color.a), border, oob);
}
