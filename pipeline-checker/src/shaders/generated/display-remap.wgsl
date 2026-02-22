// Stage 9: Display Remap
// Source: HDRTonemap.sdsl (RemapDisplayRange)
//
// Trivial linear remap compensating for display hardware where
// black is not 0 and white is not 1. With default values
// (blackLevel=0, whiteLevel=1) this is a no-op.


// ============================================================================
// Uniforms — reads from shared PipelineUniforms buffer
// ============================================================================

struct Uniforms {
    // Stage 4 (not used)
    _inputSpace: i32,             // byte 0
    // Stage 5 scalars (not used)
    _gradingSpace: i32,           // byte 4
    _gradeExposure: f32,          // byte 8
    _contrast: f32,               // byte 12
    _saturation: f32,             // byte 16
    _temperature: f32,            // byte 20
    _tint: f32,                   // byte 24
    _highlights: f32,             // byte 28
    _shadows: f32,                // byte 32
    _vibrance: f32,               // byte 36
    _pad0a: f32,                  // byte 40
    _pad0b: f32,                  // byte 44
    // Stage 5 vec3 fields (not used)
    _lift: vec3<f32>,             // byte 48
    _pad1: f32,                   // byte 60
    _gamma: vec3<f32>,            // byte 64
    _pad2: f32,                   // byte 76
    _gain: vec3<f32>,             // byte 80
    _pad3: f32,                   // byte 92
    _offset: vec3<f32>,           // byte 96
    _pad4: f32,                   // byte 108
    _shadowColor: vec3<f32>,      // byte 112
    _pad5: f32,                   // byte 124
    _midtoneColor: vec3<f32>,     // byte 128
    _pad6: f32,                   // byte 140
    _highlightColor: vec3<f32>,   // byte 144
    _pad7: f32,                   // byte 156
    _highlightSoftClip: f32,      // byte 160
    _shadowSoftClip: f32,         // byte 164
    _highlightKnee: f32,          // byte 168
    _shadowKnee: f32,             // byte 172
    // Stage 6-7 (not used)
    _outputSpace: i32,            // byte 176
    _tonemapOp: i32,              // byte 180
    _tonemapExposure: f32,        // byte 184
    _whitePoint: f32,             // byte 188
    _paperWhite: f32,             // byte 192
    _peakBrightness: f32,         // byte 196
    // Stage 9: Display Remap
    blackLevel: f32,              // byte 200
    whiteLevel: f32,              // byte 204
};

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> u: Uniforms;

// ============================================================================
// Display Remap
// ============================================================================

fn RemapDisplayRange(color: vec3<f32>, blackLevel: f32, whiteLevel: f32) -> vec3<f32> {
    return blackLevel + color * (whiteLevel - blackLevel);
}


// ============================================================================
// Fragment Shader
// ============================================================================

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
    let texCoord = vec2<i32>(in.uv * vec2<f32>(textureDimensions(inputTexture)));
    let tex0col = textureLoad(inputTexture, texCoord, 0);
    let result = RemapDisplayRange(tex0col.rgb, u.blackLevel, u.whiteLevel);
    return vec4<f32>(result, tex0col.a);
}
