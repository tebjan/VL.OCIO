/**
 * Pipeline settings types — mirrors C# enums and settings classes.
 * Integer-keyed arrays because WGSL uniform buffers use integer values.
 */

// --- HDRColorSpace (9 values, maps to i32 in uniform buffer) ---
export const HDR_COLOR_SPACES = [
  { value: 0, label: 'Linear Rec.709', name: 'Linear_Rec709' },
  { value: 1, label: 'Linear Rec.2020', name: 'Linear_Rec2020' },
  { value: 2, label: 'ACEScg', name: 'ACEScg' },
  { value: 3, label: 'ACEScc', name: 'ACEScc' },
  { value: 4, label: 'ACEScct', name: 'ACEScct' },
  { value: 5, label: 'sRGB', name: 'sRGB' },
  { value: 6, label: 'PQ Rec.2020 (HDR10)', name: 'PQ_Rec2020' },
  { value: 7, label: 'HLG Rec.2020', name: 'HLG_Rec2020' },
  { value: 8, label: 'scRGB', name: 'scRGB' },
] as const;

// --- TonemapOperator (12 values) ---
export const TONEMAP_OPERATORS = [
  { value: 0, label: 'None' },
  { value: 1, label: 'ACES (Fit)' },
  { value: 2, label: 'ACES 1.3' },
  { value: 3, label: 'ACES 2.0' },
  { value: 4, label: 'AgX' },
  { value: 5, label: 'Gran Turismo' },
  { value: 6, label: 'Uncharted 2' },
  { value: 7, label: 'Khronos PBR Neutral' },
  { value: 8, label: 'Lottes' },
  { value: 9, label: 'Reinhard' },
  { value: 10, label: 'Reinhard Extended' },
  { value: 11, label: 'Hejl-Burgess' },
] as const;

// --- GradingSpace (2 values) ---
export const GRADING_SPACES = [
  { value: 0, label: 'Log (ACEScct)' },
  { value: 1, label: 'Linear (ACEScg)' },
] as const;

// --- BC Formats (7 values) ---
export const BC_FORMATS = [
  { value: 0, label: 'BC1 (DXT1)', gpuFormat: 'bc1-rgba-unorm' },
  { value: 1, label: 'BC2 (DXT3)', gpuFormat: 'bc2-rgba-unorm' },
  { value: 2, label: 'BC3 (DXT5)', gpuFormat: 'bc3-rgba-unorm' },
  { value: 3, label: 'BC4 (ATI1)', gpuFormat: 'bc4-r-unorm' },
  { value: 4, label: 'BC5 (ATI2)', gpuFormat: 'bc5-rg-unorm' },
  { value: 5, label: 'BC6H (HDR)', gpuFormat: 'bc6h-rgb-ufloat' },
  { value: 6, label: 'BC7', gpuFormat: 'bc7-rgba-unorm' },
] as const;

// --- ODT Targets ---
export const ODT_TARGETS = [
  { value: 0, label: 'Rec.709 100 nits' },
  { value: 1, label: 'Rec.2020 1000 nits' },
] as const;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Alias for compatibility with ui/ components that use Vector3 name */
export type Vector3 = Vec3;

export interface PipelineSettings {
  // Input (Stages 1-4)
  inputColorSpace: number;
  bcFormat: number;

  // Color Grading (Stage 5)
  gradingSpace: number;
  gradeExposure: number;
  gradeContrast: number;
  gradeSaturation: number;
  gradeTemperature: number;
  gradeTint: number;
  gradeHighlights: number;
  gradeShadows: number;
  gradeVibrance: number;
  gradeLift: Vec3;
  gradeGamma: Vec3;
  gradeGain: Vec3;
  gradeOffset: Vec3;
  gradeShadowColor: Vec3;
  gradeMidtoneColor: Vec3;
  gradeHighlightColor: Vec3;
  gradeHighlightSoftClip: number;
  gradeShadowSoftClip: number;
  gradeHighlightKnee: number;
  gradeShadowKnee: number;

  // Tonemap (Stages 6-7)
  tonemapOperator: number;
  rrtEnabled: boolean;
  odtEnabled: boolean;
  odtTarget: number;
  tonemapExposure: number;
  tonemapWhitePoint: number;
  tonemapPeakBrightness: number;

  // Output (Stages 8-9)
  outputSpace: number;
  outputPaperWhite: number;
  outputPeakBrightness: number;
  outputBlackLevel: number;
  outputWhiteLevel: number;

  // Preview display
  applySRGB: boolean;
}

export function createDefaultSettings(): PipelineSettings {
  return {
    inputColorSpace: 2,  // ACEScg
    bcFormat: 5,
    gradingSpace: 0,
    gradeExposure: 0,
    gradeContrast: 1,
    gradeSaturation: 1,
    gradeTemperature: 0,
    gradeTint: 0,
    gradeHighlights: 0,
    gradeShadows: 0,
    gradeVibrance: 0,
    gradeLift: { x: 0, y: 0, z: 0 },
    gradeGamma: { x: 1, y: 1, z: 1 },
    gradeGain: { x: 1, y: 1, z: 1 },
    gradeOffset: { x: 0, y: 0, z: 0 },
    gradeShadowColor: { x: 0, y: 0, z: 0 },
    gradeMidtoneColor: { x: 0, y: 0, z: 0 },
    gradeHighlightColor: { x: 0, y: 0, z: 0 },
    gradeHighlightSoftClip: 0,
    gradeShadowSoftClip: 0,
    gradeHighlightKnee: 1,
    gradeShadowKnee: 0.1,
    tonemapOperator: 2,  // ACES 1.3 — reference ACES RRT+ODT pipeline
    rrtEnabled: true,
    odtEnabled: true,
    odtTarget: 0,
    tonemapExposure: 0,
    tonemapWhitePoint: 4,
    tonemapPeakBrightness: 100,    // SDR 100 nits target
    outputSpace: 0,
    outputPaperWhite: 100,         // SDR reference white
    outputPeakBrightness: 100,     // SDR peak brightness
    outputBlackLevel: 0,
    outputWhiteLevel: 1,
    applySRGB: true,
  };
}
