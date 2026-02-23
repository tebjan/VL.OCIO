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
  /** Called when a file is dropped on a row (replace) or ghost row (add new). null id = new pipeline. */
  onFileDrop?: (file: File, fileHandle: FileSystemFileHandle | undefined, targetPipelineId: PipelineId | null) => void;
  /** Called when a pipeline's compact mode is toggled. */
  onCompactModeChange: (pipelineId: PipelineId, compact: boolean) => void;
  /** Whether settings are linked across all pipelines. */
  linkedSettings: boolean;
}

/** Derive a short format label for stage 0 from the pipeline's file type. */
function getSourceLabel(inst: PipelineInstance): string {
  if (inst.fileType === 'exr') return 'EXR';
  if (inst.fileType === 'dds') return inst.ddsFormatLabel ?? 'DDS';
  if (inst.fileType === 'sample') return 'Sample';
  if (inst.fileName) {
    const ext = inst.fileName.split('.').pop()?.toUpperCase();
    if (ext) return ext;
  }
  return 'Source';
}

/** Derive StageInfo[] from a PipelineInstance's state */
function deriveStages(inst: PipelineInstance) {
  const sourceLabel = getSourceLabel(inst);
  return inst.stageStates.map((state, i) => ({
    index: i,
    name: i === 0 ? sourceLabel : STAGE_NAMES[i].name,
    shortName: i === 0 ? sourceLabel : STAGE_NAMES[i].shortName,
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
  onFileDrop,
  onCompactModeChange,
  linkedSettings,
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
          onFileDrop={onFileDrop ? (file, handle) => onFileDrop(file, handle, pipeline.id) : undefined}
          isDraggingFile={isDragging}
          compactMode={pipeline.compactMode}
          linkedSettings={linkedSettings}
          onCompactModeChange={(compact) => onCompactModeChange(pipeline.id, compact)}
        />
      ))}
      {pipelines.length < MAX_PIPELINES && (
        <GhostRow
          isDragOver={isDragging}
          onFileDrop={onFileDrop ? (file, handle) => onFileDrop(file, handle, null) : undefined}
        />
      )}
    </div>
  );
}
