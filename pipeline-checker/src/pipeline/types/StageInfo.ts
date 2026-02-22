export interface StageInfo {
  index: number;
  name: string;
  shortName: string;
  description: string;
  enabled: boolean;
  available: boolean;
  thumbnail: GPUTexture | null;
}

export const STAGE_NAMES: ReadonlyArray<{ name: string; shortName: string; description: string }> = [
  { name: 'EXR Load', shortName: 'EXR', description: 'Loads the raw EXR image data as scene-linear floating-point pixels' },
  { name: 'BC Compress', shortName: 'BC Enc', description: 'Compresses the image to BCn block format (GPU texture compression)' },
  { name: 'BC Decompress', shortName: 'BC Dec', description: 'Decompresses BCn data back to RGBA for further processing' },
  { name: 'Color Grade', shortName: 'Grade', description: 'Applies creative color grading (exposure, contrast, lift/gamma/gain)' },
  { name: 'RRT', shortName: 'RRT', description: 'Reference Rendering Transform -- maps scene-linear to display-ready values' },
  { name: 'ODT', shortName: 'ODT', description: 'Output Device Transform -- adapts for target display (SDR/HDR)' },
  { name: 'Output Encode', shortName: 'Output', description: 'Applies output encoding (gamma curve, PQ, HLG)' },
  { name: 'Display Remap', shortName: 'Remap', description: 'Remaps display values for final viewing conditions' },
  { name: 'Final Display', shortName: 'Final', description: 'The final image as it appears on your monitor' },
];
