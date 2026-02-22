import type { LoadedFileType } from '../components/DropZone';
import type { PipelineRenderer } from '../pipeline/PipelineRenderer';
import type { ImageMetadata } from '../components/MetadataPanel';
import type { PipelineSettings } from './settings';
import type { StageState } from './pipeline';

export type PipelineId = string;

export const PIPELINE_COLORS = [
  { name: 'Cyan',  hex: '#00bcd4', rgb: [0, 0.74, 0.83] as const },
  { name: 'Amber', hex: '#ffab00', rgb: [1, 0.67, 0] as const },
  { name: 'Pink',  hex: '#e91e63', rgb: [0.91, 0.12, 0.39] as const },
  { name: 'Green', hex: '#4caf50', rgb: [0.30, 0.69, 0.31] as const },
] as const;

export const MAX_PIPELINES = 4;

export interface PipelineInstance {
  id: PipelineId;
  colorIndex: number;
  fileName: string | null;
  fileType: LoadedFileType;
  fileHandle?: FileSystemFileHandle;
  renderer: PipelineRenderer;
  sourceTexture: GPUTexture;
  settings: PipelineSettings;
  stageStates: StageState[];
  selectedStageIndex: number;
  unavailableStages: Set<number>;
  metadata: ImageMetadata;
}
