// Preview blit shader — renders stage rgba16float texture to canvas.
// Supports multi-image side-by-side layout: each image occupies a horizontal
// slot defined by slotLeft/slotRight in combined-row UV space.
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
    out.uv = vec2<f32>(u, 1.0 - v);
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
    canvasAspect: f32,
    combinedAspect: f32,  // single image: textureAspect; multi: sum of all aspects
    slotLeft: f32,        // left edge in combined-row UV [0,1]
    slotRight: f32,       // right edge in combined-row UV [0,1]
    borderR: f32,
    borderG: f32,
    borderB: f32,
    borderWidth: f32,     // 0 = no border, >0 = border thickness in local UV
};

// sRGB transfer function (IEC 61966-2-1)
fn linearToSRGB(linear: vec3<f32>) -> vec3<f32> {
    let lo = linear * 12.92;
    let hi = 1.055 * pow(linear, vec3<f32>(1.0 / 2.4)) - 0.055;
    return select(hi, lo, linear <= vec3<f32>(0.0031308));
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
    // Aspect ratio correction: fit combined row proportionally inside canvas
    var aspectScale = vec2<f32>(1.0, 1.0);
    if (view.combinedAspect > view.canvasAspect) {
        // Combined row wider than canvas: fit width, letterbox vertically
        aspectScale.y = view.combinedAspect / view.canvasAspect;
    } else {
        // Combined row taller than canvas: fit height, pillarbox horizontally
        aspectScale.x = view.canvasAspect / view.combinedAspect;
    }

    // Transform UV to "world UV" in combined-row space [0,1]
    let worldUV = (in.uv - 0.5) * aspectScale / view.zoom + vec2<f32>(view.panX, view.panY) + 0.5;

    // Remap world UV to local texture UV [0,1] within this image's slot
    let localU = (worldUV.x - view.slotLeft) / (view.slotRight - view.slotLeft);
    let localV = worldUV.y;
    let texUV = clamp(vec2<f32>(localU, localV), vec2<f32>(0.0), vec2<f32>(1.0));

    // Sample unconditionally (textureSample requires uniform control flow)
    let color = textureSample(stageTexture, texSampler, texUV);

    // Discard fragments outside this image's slot
    let inSlot = worldUV.x >= view.slotLeft && worldUV.x <= view.slotRight
              && worldUV.y >= 0.0 && worldUV.y <= 1.0;
    if (!inSlot) {
        discard;
    }

    // Clamp to 0-1, optionally apply linear → sRGB gamma
    let clamped = clamp(color.rgb, vec3<f32>(0.0), vec3<f32>(1.0));
    let display = select(clamped, linearToSRGB(clamped), view.applySRGB > 0.5);

    // Colored border for selected pipeline
    let bw = view.borderWidth;
    if (bw > 0.0) {
        let dx = min(localU, 1.0 - localU);
        let dy = min(localV, 1.0 - localV);
        let edgeDist = min(dx, dy);
        if (edgeDist < bw) {
            let borderColor = vec3<f32>(view.borderR, view.borderG, view.borderB);
            return vec4<f32>(borderColor, 1.0);
        }
    }

    return vec4<f32>(display, color.a);
}
