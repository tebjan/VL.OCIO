import { PipelineRow } from './PipelineRow';
import { GhostRow } from './GhostRow';
import { STAGE_NAMES } from '../pipeline/types/StageInfo';
import type { PipelineInstance, PipelineId } from '../types/PipelineInstance';
import { MAX_PIPELINES } from '../types/PipelineInstance';

export interface PipelineFilmstripAreaProps {
  pipelines: PipelineInstance[];
  selectedPipelineId: PipelineId | null;
  onSelectPipeline: (id: PipelineId) => void;
  onRemovePipeline: (id: PipelineId) => void;
  onStageSelect: (index: number, pipelineId?: PipelineId) => void;
  onStageToggle: (index: number, enabled: boolean, pipelineId?: PipelineId) => void;
  device: GPUDevice;
  format: GPUTextureFormat;
  renderVersion: number;
  getStageTextures: (pipeline: PipelineInstance) => (GPUTexture | null)[];
  isDragging?: boolean;
}

/** Derive StageInfo[] from a PipelineInstance's state */
function deriveStages(inst: PipelineInstance) {
  return inst.stageStates.map((state, i) => ({
    index: i,
    name: STAGE_NAMES[i].name,
    shortName: STAGE_NAMES[i].shortName,
    description: STAGE_NAMES[i].description,
    enabled: state.enabled,
    available: !inst.unavailableStages.has(i),
    thumbnail: null,
  }));
}

export function PipelineFilmstripArea({
  pipelines,
  selectedPipelineId,
  onSelectPipeline,
  onRemovePipeline,
  onStageSelect,
  onStageToggle,
  device,
  format,
  renderVersion,
  getStageTextures,
  isDragging,
}: PipelineFilmstripAreaProps) {
  const canRemove = pipelines.length > 1;

  return (
    <div style={{ flexShrink: 0 }}>
      {pipelines.map((pipeline) => (
        <PipelineRow
          key={pipeline.id}
          pipeline={pipeline}
          stages={deriveStages(pipeline)}
          isSelected={pipeline.id === selectedPipelineId}
          onSelect={() => onSelectPipeline(pipeline.id)}
          onRemove={canRemove ? () => onRemovePipeline(pipeline.id) : undefined}
          device={device}
          format={format}
          stageTextures={getStageTextures(pipeline)}
          renderVersion={renderVersion}
          onStageSelect={(i) => onStageSelect(i, pipeline.id)}
          onStageToggle={(i, enabled) => onStageToggle(i, enabled, pipeline.id)}
        />
      ))}
      {pipelines.length < MAX_PIPELINES && (
        <GhostRow isDragOver={isDragging} />
      )}
    </div>
  );
}
