export interface Vector3 {
  x: number
  y: number
  z: number
}

export interface ColorCorrectionSettings {
  inputSpace: ColorSpace
  gradingSpace: GradingSpace
  exposure: number
  contrast: number
  saturation: number
  temperature: number
  tint: number
  highlights: number
  shadows: number
  vibrance: number
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
  vignetteStrength: number
  vignetteRadius: number
  vignetteSoftness: number
}

export interface TonemapSettings {
  outputSpace: ColorSpace
  tonemap: TonemapOperator
  exposure: number
  whitePoint: number
  paperWhite: number
  peakBrightness: number
  blackLevel: number
  whiteLevel: number
}

export interface ProjectSettings {
  inputFilePath: string
  colorCorrection: ColorCorrectionSettings
  tonemap: TonemapSettings
  presetName: string
  isPresetDirty: boolean
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
  isPresetDirty: boolean
}

export interface ServerInfo {
  hostname: string
  ip: string
  port: number
  path: string
  networkEnabled: boolean
  mdnsUrl?: string
  isHub?: boolean
  appName?: string
}

export interface DiscoveredServer {
  hostname: string
  ip: string
  port: number
  isLeader: boolean
  instanceCount: number
  path?: string
  appName?: string
}

// Input/working color spaces (for textures and grading)
// NOTE: These match exact C# enum names (JsonStringEnumConverter without naming policy)
export type ColorSpace =
  | 'Linear_Rec709'
  | 'Linear_Rec2020'
  | 'ACEScg'
  | 'ACEScc'
  | 'ACEScct'
  | 'sRGB'
  | 'PQ_Rec2020'
  | 'HLG_Rec2020'
  | 'scRGB'

export type GradingSpace = 'Log' | 'Linear'

export type TonemapOperator = 'None' | 'ACES' | 'AgX' | 'GranTurismo' | 'Uncharted2' | 'KhronosPBRNeutral' | 'Lottes' | 'Reinhard' | 'ReinhardExtended' | 'HejlBurgess'

export const COLOR_SPACE_LABELS: Record<ColorSpace, string> = {
  Linear_Rec709: 'Linear Rec.709',
  Linear_Rec2020: 'Linear Rec.2020',
  ACEScg: 'ACEScg',
  ACEScc: 'ACEScc',
  ACEScct: 'ACEScct',
  sRGB: 'sRGB',
  PQ_Rec2020: 'PQ Rec.2020 (HDR10)',
  HLG_Rec2020: 'HLG Rec.2020',
  scRGB: 'scRGB',
}

export const GRADING_SPACE_LABELS: Record<GradingSpace, string> = {
  Log: 'Log (ACEScct)',
  Linear: 'Linear (ACEScg)',
}

export const TONEMAP_LABELS: Record<TonemapOperator, string> = {
  None: 'None',
  ACES: 'ACES',
  AgX: 'AgX',
  GranTurismo: 'Gran Turismo',
  Uncharted2: 'Uncharted 2',
  KhronosPBRNeutral: 'Khronos PBR Neutral',
  Lottes: 'Lottes',
  Reinhard: 'Reinhard',
  ReinhardExtended: 'Reinhard Extended',
  HejlBurgess: 'Hejl-Burgess',
}

export function createDefaultColorCorrection(): ColorCorrectionSettings {
  return {
    inputSpace: 'Linear_Rec709',
    gradingSpace: 'Log',
    exposure: 0,
    contrast: 1,
    saturation: 1,
    temperature: 0,
    tint: 0,
    highlights: 0,
    shadows: 0,
    vibrance: 0,
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
    vignetteStrength: 0,
    vignetteRadius: 0.7,
    vignetteSoftness: 0.3,
  }
}

export function createDefaultTonemap(): TonemapSettings {
  return {
    outputSpace: 'sRGB',
    tonemap: 'None',
    exposure: 0,
    whitePoint: 4,
    paperWhite: 200,
    peakBrightness: 1000,
    blackLevel: 0,
    whiteLevel: 1,
  }
}

export function createDefaultProject(): ProjectSettings {
  return {
    inputFilePath: '',
    colorCorrection: createDefaultColorCorrection(),
    tonemap: createDefaultTonemap(),
    presetName: '',
    isPresetDirty: false,
  }
}
