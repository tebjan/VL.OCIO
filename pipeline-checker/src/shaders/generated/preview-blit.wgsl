// Preview blit shader — renders stage rgba32float texture to canvas
// Applies view exposure (display-only) and sRGB gamma for SDR output.
// NOT a pipeline stage — purely a display utility.

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

struct ViewUniforms {
    viewExposure: f32,
    zoom: f32,
    panX: f32,
    panY: f32,
};
@group(0) @binding(1) var<uniform> view: ViewUniforms;

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
    // Transform UV by zoom/pan
    let uv = (in.uv - 0.5) / view.zoom + vec2<f32>(view.panX, view.panY) + 0.5;

    // Out-of-bounds: dark border
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        return vec4<f32>(0.05, 0.05, 0.05, 1.0);
    }

    // Use textureLoad with integer coords (unfilterable-float cannot use textureSample)
    let dims = vec2<f32>(textureDimensions(stageTexture));
    let texCoord = vec2<i32>(clamp(uv * dims, vec2<f32>(0.0), dims - 1.0));
    var color = textureLoad(stageTexture, texCoord, 0);

    // View exposure (does NOT affect pipeline output)
    color = vec4<f32>(color.rgb * exp2(view.viewExposure), color.a);

    // Clamp for SDR display
    color = clamp(color, vec4<f32>(0.0), vec4<f32>(1.0));

    // Linear-to-sRGB gamma
    let srgb = select(
        color.rgb * 12.92,
        pow(color.rgb, vec3<f32>(1.0 / 2.4)) * 1.055 - 0.055,
        color.rgb > vec3<f32>(0.0031308)
    );

    return vec4<f32>(srgb, color.a);
}
