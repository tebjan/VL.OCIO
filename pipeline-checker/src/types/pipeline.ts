import type { PipelineSettings } from './settings';

export interface StageState {
  enabled: boolean;
}

export interface PipelineState {
  stages: StageState[];          // 10 stages
  selectedStageIndex: number;
  settings: PipelineSettings;
}
