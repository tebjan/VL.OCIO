export interface Vector3 {
  x: number
  y: number
  z: number
}

export interface ColorCorrectionSettings {
  exposure: number
  contrast: number
  saturation: number
  temperature: number
  tint: number
  lift: Vector3
  gamma: Vector3
  gain: Vector3
  offset: Vector3
  shadowColor: Vector3
  midtoneColor: Vector3
  highlightColor: Vector3
  highlightSoftClip: number
  shadowSoftClip: number
  highlightKnee: number
  shadowKnee: number
  inputSpace: ColorSpace
  gradingSpace: GradingSpace
  outputSpace: ColorSpace
}

export interface TonemapSettings {
  inputSpace: ColorSpace
  outputSpace: DisplayFormat
  tonemap: TonemapOperator
  exposure: number
  whitePoint: number
  paperWhite: number
  peakBrightness: number
}

export interface ProjectSettings {
  inputFilePath: string
  colorCorrection: ColorCorrectionSettings
  tonemap: TonemapSettings
  presetName: string
}

// Multi-instance support types
export interface InstanceInfo {
  id: string
  displayName: string
  isActive: boolean
}

export interface InstanceState {
  colorCorrection: ColorCorrectionSettings
  tonemap: TonemapSettings
  inputFilePath: string
  presetName: string
}

export interface ServerInfo {
  hostname: string
  ip: string
  port: number
  networkEnabled: boolean
}

// Input/working color spaces (for textures and grading)
// NOTE: These must match C# enum names after JsonNamingPolicy.CamelCase conversion
export type ColorSpace =
  | 'linear_Rec709'
  | 'linear_Rec2020'
  | 'acesCg'
  | 'acesCc'
  | 'acesCct'
  | 'sRgb'       // C# sRGB → camelCase → sRgb
  | 'pQ_Rec2020'
  | 'hlG_Rec2020'
  | 'scRgb'      // C# scRGB → camelCase → scRgb

// Display output formats (what DX/Stride can output)
// NOTE: These must match C# enum names after JsonNamingPolicy.CamelCase conversion
export type DisplayFormat = 'sRgb' | 'linear_Rec709' | 'pQ_Rec2020'

export type GradingSpace = 'log' | 'linear'

export type TonemapOperator = 'none' | 'aces' | 'reinhard' | 'reinhardExtended'

export const COLOR_SPACE_LABELS: Record<ColorSpace, string> = {
  linear_Rec709: 'Linear Rec.709',
  linear_Rec2020: 'Linear Rec.2020',
  acesCg: 'ACEScg',
  acesCc: 'ACEScc',
  acesCct: 'ACEScct',
  sRgb: 'sRGB',
  pQ_Rec2020: 'PQ Rec.2020 (HDR10)',
  hlG_Rec2020: 'HLG Rec.2020',
  scRgb: 'scRGB',
}

export const DISPLAY_FORMAT_LABELS: Record<DisplayFormat, string> = {
  sRgb: 'sRGB (SDR)',
  linear_Rec709: 'Linear HDR (scRGB)',
  pQ_Rec2020: 'PQ HDR (HDR10)',
}

export const GRADING_SPACE_LABELS: Record<GradingSpace, string> = {
  log: 'Log (ACEScct)',
  linear: 'Linear (ACEScg)',
}

export const TONEMAP_LABELS: Record<TonemapOperator, string> = {
  none: 'None',
  aces: 'ACES',
  reinhard: 'Reinhard',
  reinhardExtended: 'Reinhard Extended',
}

export function createDefaultColorCorrection(): ColorCorrectionSettings {
  return {
    exposure: 0,
    contrast: 1,
    saturation: 1,
    temperature: 0,
    tint: 0,
    lift: { x: 0, y: 0, z: 0 },
    gamma: { x: 1, y: 1, z: 1 },
    gain: { x: 1, y: 1, z: 1 },
    offset: { x: 0, y: 0, z: 0 },
    shadowColor: { x: 0, y: 0, z: 0 },
    midtoneColor: { x: 0, y: 0, z: 0 },
    highlightColor: { x: 0, y: 0, z: 0 },
    highlightSoftClip: 0,
    shadowSoftClip: 0,
    highlightKnee: 1,
    shadowKnee: 0.1,
    inputSpace: 'acesCc',
    gradingSpace: 'log',
    outputSpace: 'linear_Rec709',
  }
}

export function createDefaultTonemap(): TonemapSettings {
  return {
    inputSpace: 'linear_Rec709',
    outputSpace: 'sRgb',
    tonemap: 'aces',
    exposure: 0,
    whitePoint: 4,
    paperWhite: 200,
    peakBrightness: 1000,
  }
}

export function createDefaultProject(): ProjectSettings {
  return {
    inputFilePath: '',
    colorCorrection: createDefaultColorCorrection(),
    tonemap: createDefaultTonemap(),
    presetName: 'Default',
  }
}
