export interface StageInfo {
  index: number;
  name: string;
  shortName: string;
  enabled: boolean;
  available: boolean;
  thumbnail: GPUTexture | null;
}

export const STAGE_NAMES: ReadonlyArray<{ name: string; shortName: string }> = [
  { name: 'EXR Load', shortName: 'EXR' },
  { name: 'BC Compress', shortName: 'BC Enc' },
  { name: 'BC Decompress', shortName: 'BC Dec' },
  { name: 'Color Grade', shortName: 'Grade' },
  { name: 'RRT', shortName: 'RRT' },
  { name: 'ODT', shortName: 'ODT' },
  { name: 'Output Encode', shortName: 'Output' },
  { name: 'Display Remap', shortName: 'Remap' },
  { name: 'Final Display', shortName: 'Final' },
];
