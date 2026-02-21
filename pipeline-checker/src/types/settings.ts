/**
 * Pipeline settings types — mirrors C# enums and settings classes.
 * Task 7.5 will add the full enum constants (HDR_COLOR_SPACES, TONEMAP_OPERATORS, etc.)
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

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
}

export function createDefaultSettings(): PipelineSettings {
  return {
    inputColorSpace: 0,
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
    tonemapOperator: 0,
    rrtEnabled: true,
    odtEnabled: true,
    odtTarget: 0,
    tonemapExposure: 0,
    tonemapWhitePoint: 4,
    tonemapPeakBrightness: 1000,
    outputSpace: 0,
    outputPaperWhite: 200,
    outputPeakBrightness: 1000,
    outputBlackLevel: 0,
    outputWhiteLevel: 1,
  };
}
