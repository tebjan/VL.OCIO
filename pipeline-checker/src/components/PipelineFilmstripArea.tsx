import { PipelineRow } from './PipelineRow';
import { GhostRow } from './GhostRow';
import { STAGE_NAMES } from '../pipeline/types/StageInfo';
import type { PipelineInstance, PipelineId } from '../types/PipelineInstance';
import { MAX_PIPELINES } from '../types/PipelineInstance';
import { getStageVisibility } from '../types/settings';

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
  /** Compact mode: hide stages that don't change the image with current settings. */
  compactMode: boolean;
  onCompactModeChange: (compact: boolean) => void;
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
  onFileDrop,
  compactMode,
  onCompactModeChange,
}: PipelineFilmstripAreaProps) {
  const canRemove = pipelines.length > 1;
  const stageVisibility = getStageVisibility(compactMode);

  return (
    <div style={{ flexShrink: 0 }}>
      {/* Compact mode toggle */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        padding: '2px 8px',
        background: 'var(--surface-900)',
        borderBottom: '1px solid var(--surface-800)',
      }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            cursor: 'pointer',
            fontSize: '11px',
            color: 'var(--color-text-muted)',
            userSelect: 'none',
          }}
          title="Hide stages that produce identical output to their neighbor with current settings"
        >
          <input
            type="checkbox"
            checked={compactMode}
            onChange={(e) => onCompactModeChange(e.target.checked)}
            style={{ margin: 0, cursor: 'pointer' }}
          />
          Compact
        </label>
      </div>
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
          stageVisibility={stageVisibility}
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
