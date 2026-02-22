/**
 * Bidirectional mapping between ui/ project string enum values
 * and pipeline-checker numeric GPU uniform indices.
 */

// String types matching ui/src/types/settings.ts exactly
export type ColorSpaceString =
  | 'Linear_Rec709'
  | 'Linear_Rec2020'
  | 'ACEScg'
  | 'ACEScc'
  | 'ACEScct'
  | 'sRGB'
  | 'PQ_Rec2020'
  | 'HLG_Rec2020'
  | 'scRGB';

export type TonemapString =
  | 'None'
  | 'ACES'
  | 'ACES13'
  | 'ACES20'
  | 'AgX'
  | 'GranTurismo'
  | 'Uncharted2'
  | 'KhronosPBRNeutral'
  | 'Lottes'
  | 'Reinhard'
  | 'ReinhardExtended'
  | 'HejlBurgess';

export type GradingSpaceString = 'Log' | 'Linear';

// Lookup arrays — index matches HDR_COLOR_SPACES[i].value
const COLOR_SPACE_NAMES: ColorSpaceString[] = [
  'Linear_Rec709', 'Linear_Rec2020', 'ACEScg', 'ACEScc', 'ACEScct',
  'sRGB', 'PQ_Rec2020', 'HLG_Rec2020', 'scRGB',
];

// Index matches TONEMAP_OPERATORS[i].value
const TONEMAP_NAMES: TonemapString[] = [
  'None', 'ACES', 'ACES13', 'ACES20', 'AgX', 'GranTurismo',
  'Uncharted2', 'KhronosPBRNeutral', 'Lottes', 'Reinhard',
  'ReinhardExtended', 'HejlBurgess',
];

// Index matches GRADING_SPACES[i].value
const GRADING_SPACE_NAMES: GradingSpaceString[] = ['Log', 'Linear'];

// --- Label records matching ui/src/types/settings.ts exactly ---

export const COLOR_SPACE_LABELS: Record<ColorSpaceString, string> = {
  Linear_Rec709: 'Linear Rec.709',
  Linear_Rec2020: 'Linear Rec.2020',
  ACEScg: 'ACEScg',
  ACEScc: 'ACEScc',
  ACEScct: 'ACEScct',
  sRGB: 'sRGB',
  PQ_Rec2020: 'PQ Rec.2020 (HDR10)',
  HLG_Rec2020: 'HLG Rec.2020',
  scRGB: 'scRGB',
};

export const TONEMAP_LABELS: Record<TonemapString, string> = {
  None: 'None',
  ACES: 'ACES (Fit)',
  ACES13: 'ACES 1.3',
  ACES20: 'ACES 2.0',
  AgX: 'AgX',
  GranTurismo: 'Gran Turismo',
  Uncharted2: 'Uncharted 2',
  KhronosPBRNeutral: 'Khronos PBR Neutral',
  Lottes: 'Lottes',
  Reinhard: 'Reinhard',
  ReinhardExtended: 'Reinhard Extended',
  HejlBurgess: 'Hejl-Burgess',
};

export const GRADING_SPACE_LABELS: Record<GradingSpaceString, string> = {
  Log: 'Log (ACEScct)',
  Linear: 'Linear (ACEScg)',
};

// --- Bidirectional mapping functions ---

export function colorSpaceToIndex(name: ColorSpaceString): number {
  const idx = COLOR_SPACE_NAMES.indexOf(name);
  return idx >= 0 ? idx : 0;
}

export function indexToColorSpace(index: number): ColorSpaceString {
  const clamped = Math.max(0, Math.min(index, COLOR_SPACE_NAMES.length - 1));
  return COLOR_SPACE_NAMES[clamped];
}

export function tonemapToIndex(name: TonemapString): number {
  const idx = TONEMAP_NAMES.indexOf(name);
  return idx >= 0 ? idx : 0;
}

export function indexToTonemap(index: number): TonemapString {
  const clamped = Math.max(0, Math.min(index, TONEMAP_NAMES.length - 1));
  return TONEMAP_NAMES[clamped];
}

export function gradingSpaceToIndex(name: GradingSpaceString): number {
  const idx = GRADING_SPACE_NAMES.indexOf(name);
  return idx >= 0 ? idx : 0;
}

export function indexToGradingSpace(index: number): GradingSpaceString {
  const clamped = Math.max(0, Math.min(index, GRADING_SPACE_NAMES.length - 1));
  return GRADING_SPACE_NAMES[clamped];
}
