import type { PipelineSettings } from './settings';

export interface StageState {
  enabled: boolean;
}

export interface PipelineState {
  stages: StageState[];          // 10 stages
  selectedStageIndex: number;
  settings: PipelineSettings;
}

// --- Heightmap 3D visualization types ---

export enum HeightMode {
  RGBLength = 0,
  Luminance709 = 1,
  Red = 2,
  Green = 3,
  Blue = 4,
  MaxChannel = 5,
  AP1Luminance = 6,
}

export const HEIGHT_MODE_LABELS: Record<HeightMode, string> = {
  [HeightMode.RGBLength]: 'RGB Length',
  [HeightMode.Luminance709]: 'Luminance (Rec.709)',
  [HeightMode.Red]: 'Red',
  [HeightMode.Green]: 'Green',
  [HeightMode.Blue]: 'Blue',
  [HeightMode.MaxChannel]: 'Max Channel',
  [HeightMode.AP1Luminance]: 'AP1 Luminance',
};

export type DownsampleFactor = 1 | 2 | 4 | 8 | 16 | 32 | 64;
export type MSAASamples = 0 | 2 | 4;

export interface HeightmapSettings {
  heightMode: HeightMode;
  heightScale: number;          // 0.01 - 2.0, default 0.25
  exponent: number;             // 0.1 - 5.0, default 1.0
  stopsMode: boolean;           // default false
  perceptualMode: boolean;      // default false
  rangeMin: number;             // -1.0 - 10.0, default 0.0
  rangeMax: number;             // 0.01 - 100.0, default 1.0
  downsample: DownsampleFactor; // 1 | 2 | 4 | 8 | 16, default 4
  msaa: MSAASamples;            // 1 | 4, default 4
}

export function createDefaultHeightmapSettings(): HeightmapSettings {
  return {
    heightMode: HeightMode.RGBLength,
    heightScale: 0.25,
    exponent: 1.0,
    stopsMode: false,
    perceptualMode: false,
    rangeMin: 0.0,
    rangeMax: 1.0,
    downsample: 4,
    msaa: 4,
  };
}
