import { Filmstrip } from './Filmstrip';
import type { StageInfo } from '../pipeline/types/StageInfo';
import { type PipelineInstance, PIPELINE_COLORS } from '../types/PipelineInstance';

export interface PipelineRowProps {
  pipeline: PipelineInstance;
  stages: StageInfo[];
  isSelected: boolean;
  onSelect: () => void;
  onRemove?: () => void;
  device: GPUDevice;
  format: GPUTextureFormat;
  stageTextures: (GPUTexture | null)[];
  renderVersion: number;
  onStageSelect: (index: number) => void;
  onStageToggle: (index: number, enabled: boolean) => void;
}

export function PipelineRow({
  pipeline,
  stages,
  isSelected,
  onSelect,
  onRemove,
  device,
  format,
  stageTextures,
  renderVersion,
  onStageSelect,
  onStageToggle,
}: PipelineRowProps) {
  const color = PIPELINE_COLORS[pipeline.colorIndex];
  const applySRGB = pipeline.settings.applySRGB;

  const bgTint = isSelected
    ? `rgba(${Math.round(color.rgb[0] * 255)}, ${Math.round(color.rgb[1] * 255)}, ${Math.round(color.rgb[2] * 255)}, 0.08)`
    : 'transparent';

  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        background: bgTint,
        borderBottom: '1px solid var(--surface-700)',
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      {/* Color indicator strip */}
      <div
        style={{
          width: '4px',
          flexShrink: 0,
          background: color.hex,
          opacity: isSelected ? 1 : 0.4,
          transition: 'opacity 0.15s',
        }}
      />

      {/* Filmstrip (zero changes to component) */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Filmstrip
          stages={stages}
          selectedIndex={pipeline.selectedStageIndex}
          onSelect={onStageSelect}
          onToggle={onStageToggle}
          device={device}
          format={format}
          stageTextures={stageTextures}
          renderVersion={renderVersion}
          applySRGB={applySRGB}
          settings={pipeline.settings}
        />
      </div>

      {/* Filename + remove button */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          justifyContent: 'center',
          padding: '4px 8px',
          gap: '2px',
          flexShrink: 0,
          minWidth: '80px',
        }}
      >
        <span
          style={{
            color: isSelected ? 'var(--color-text)' : 'var(--color-text-muted)',
            fontSize: '11px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '120px',
          }}
        >
          {pipeline.fileName ?? 'Sample'}
        </span>

        {onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            title="Remove this pipeline"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--surface-500)',
              cursor: 'pointer',
              fontSize: '14px',
              lineHeight: 1,
              padding: '2px 4px',
              borderRadius: '3px',
            }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'var(--color-error)'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.color = 'var(--surface-500)'; }}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
