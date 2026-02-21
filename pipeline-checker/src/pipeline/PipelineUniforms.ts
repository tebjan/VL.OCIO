/**
 * Pipeline uniform buffer layout — shared across all stages.
 *
 * Total: ~232 bytes (512-byte buffer with padding).
 * Each stage's WGSL shader reads only the fields it needs, but the full
 * struct is bound to every stage to avoid per-stage buffer management.
 *
 * WGSL struct alignment rules:
 * - f32/i32/u32: 4-byte aligned, 4-byte size
 * - vec3<f32>:   16-byte aligned, 12-byte size (+4 pad)
 * - vec4<f32>:   16-byte aligned, 16-byte size
 *
 * Every vec3 field is followed by 1 float of padding in serialization.
 */

export interface PipelineSettings {
  // Stage 4: Input Interpretation
  inputSpace: number;            // HDRColorSpace enum (0-8)

  // Stage 5: Color Grading
  gradingSpace: number;          // GradingSpace enum (0=Log, 1=Linear)
  gradeExposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
  vibrance: number;
  lift: [number, number, number];
  gamma: [number, number, number];
  gain: [number, number, number];
  offset: [number, number, number];
  shadowColor: [number, number, number];
  midtoneColor: [number, number, number];
  highlightColor: [number, number, number];
  highlightSoftClip: number;
  shadowSoftClip: number;
  highlightKnee: number;
  shadowKnee: number;

  // Stages 6-7: Tonemap (RRT + ODT)
  outputSpace: number;           // HDRColorSpace enum (0-8)
  tonemapOp: number;             // TonemapOperator enum (0-11)
  tonemapExposure: number;
  whitePoint: number;
  paperWhite: number;
  peakBrightness: number;

  // Stage 9: Display Remap
  blackLevel: number;
  whiteLevel: number;

  // Stage toggles (serialized as i32: 0=false, 1=true)
  bcEnabled: boolean;
  rrtEnabled: boolean;
  odtEnabled: boolean;

  // BC settings
  bcFormat: number;              // 0-6 for BC1-BC7
  bcQuality: number;             // 0=fast, 1=normal, 2=high

  // View settings (preview blit only, not a pipeline parameter)
  viewExposure: number;          // EV offset for viewing HDR on SDR display
}

/**
 * Sensible defaults — neutral grading, no tonemap, passthrough.
 */
export const DEFAULT_SETTINGS: PipelineSettings = {
  inputSpace: 0,            // Linear_Rec709
  gradingSpace: 0,          // Log (ACEScct)
  gradeExposure: 0,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  vibrance: 0,
  lift: [0, 0, 0],
  gamma: [1, 1, 1],
  gain: [1, 1, 1],
  offset: [0, 0, 0],
  shadowColor: [0, 0, 0],
  midtoneColor: [0, 0, 0],
  highlightColor: [0, 0, 0],
  highlightSoftClip: 0,
  shadowSoftClip: 0,
  highlightKnee: 0.5,
  shadowKnee: 0.5,
  outputSpace: 0,           // Linear_Rec709
  tonemapOp: 0,             // None
  tonemapExposure: 0,
  whitePoint: 1,
  paperWhite: 203,
  peakBrightness: 1000,
  blackLevel: 0,
  whiteLevel: 1,
  bcEnabled: false,
  rrtEnabled: true,
  odtEnabled: true,
  bcFormat: 0,
  bcQuality: 1,             // normal
  viewExposure: 0,
};

/**
 * Serialize PipelineSettings into a 512-byte ArrayBuffer matching
 * the WGSL PipelineUniforms struct layout.
 *
 * The Float32Array and Int32Array share the same backing buffer.
 * Indices are in units of 4 bytes (float32/int32 size).
 *
 * WGSL byte offsets (all vec3 fields padded to 16 bytes):
 *   [0]  inputSpace (i32)
 *   [4]  gradingSpace (i32)
 *   [8]  gradeExposure, [12] contrast
 *   [16] saturation, [20] temperature, [24] tint, [28] highlights
 *   [32] shadows, [36] vibrance
 *   [40-44] _pad0 (vec2 padding to align lift at offset 48)
 *   [48-56] lift (vec3), [60] _pad1
 *   [64-72] gamma (vec3), [76] _pad2
 *   [80-88] gain (vec3), [92] _pad3
 *   [96-104] offset (vec3), [108] _pad4
 *   [112-120] shadowColor (vec3), [124] _pad5
 *   [128-136] midtoneColor (vec3), [140] _pad6
 *   [144-152] highlightColor (vec3), [156] _pad7
 *   [160] highlightSoftClip, [164] shadowSoftClip
 *   [168] highlightKnee, [172] shadowKnee
 *   [176] outputSpace (i32), [180] tonemapOp (i32)
 *   [184] tonemapExposure, [188] whitePoint
 *   [192] paperWhite, [196] peakBrightness
 *   [200] blackLevel, [204] whiteLevel
 *   [208] bcEnabled (i32), [212] rrtEnabled (i32), [216] odtEnabled (i32)
 *   [220] bcFormat (i32), [224] bcQuality (i32)
 *   [228] viewExposure
 */
export function serializeUniforms(s: PipelineSettings): Float32Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(512);
  const f = new Float32Array(buffer);
  const i = new Int32Array(buffer);

  // Stage 4: Input
  i[0] = s.inputSpace;

  // Stage 5: Grading scalars
  i[1] = s.gradingSpace;
  f[2] = s.gradeExposure;
  f[3] = s.contrast;
  f[4] = s.saturation;
  f[5] = s.temperature;
  f[6] = s.tint;
  f[7] = s.highlights;
  f[8] = s.shadows;
  f[9] = s.vibrance;
  // f[10], f[11] = padding (_pad0 — aligns lift to offset 48)

  // Stage 5: vec3 fields (each 3 floats + 1 pad)
  f[12] = s.lift[0]; f[13] = s.lift[1]; f[14] = s.lift[2]; // f[15] = pad
  f[16] = s.gamma[0]; f[17] = s.gamma[1]; f[18] = s.gamma[2]; // f[19] = pad
  f[20] = s.gain[0]; f[21] = s.gain[1]; f[22] = s.gain[2]; // f[23] = pad
  f[24] = s.offset[0]; f[25] = s.offset[1]; f[26] = s.offset[2]; // f[27] = pad
  f[28] = s.shadowColor[0]; f[29] = s.shadowColor[1]; f[30] = s.shadowColor[2]; // f[31] = pad
  f[32] = s.midtoneColor[0]; f[33] = s.midtoneColor[1]; f[34] = s.midtoneColor[2]; // f[35] = pad
  f[36] = s.highlightColor[0]; f[37] = s.highlightColor[1]; f[38] = s.highlightColor[2]; // f[39] = pad

  // Stage 5: remaining scalars
  f[40] = s.highlightSoftClip;
  f[41] = s.shadowSoftClip;
  f[42] = s.highlightKnee;
  f[43] = s.shadowKnee;

  // Stages 6-7: Tonemap
  i[44] = s.outputSpace;
  i[45] = s.tonemapOp;
  f[46] = s.tonemapExposure;
  f[47] = s.whitePoint;
  f[48] = s.paperWhite;
  f[49] = s.peakBrightness;

  // Stage 9: Display Remap
  f[50] = s.blackLevel;
  f[51] = s.whiteLevel;

  // Toggles (i32: 0=false, 1=true)
  i[52] = s.bcEnabled ? 1 : 0;
  i[53] = s.rrtEnabled ? 1 : 0;
  i[54] = s.odtEnabled ? 1 : 0;

  // BC settings
  i[55] = s.bcFormat;
  i[56] = s.bcQuality;

  // View
  f[57] = s.viewExposure;

  return f;
}
