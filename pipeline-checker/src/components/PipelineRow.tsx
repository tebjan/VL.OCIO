import { useState, useRef } from 'react';
import { Filmstrip } from './Filmstrip';
import { extractDroppedFile } from './DropZone';
import type { StageInfo } from '../pipeline/types/StageInfo';
import { type PipelineInstance, PIPELINE_COLORS } from '../types/PipelineInstance';
import { getStageVisibility } from '../types/settings';

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
  /** Called when a file is dropped on this row (replace this pipeline's file). */
  onFileDrop?: (file: File, fileHandle?: FileSystemFileHandle) => void;
  /** True when a file is being dragged over the window. */
  isDraggingFile?: boolean;
  /** Whether this pipeline is in compact mode (hides BC Compress + Output Encode). */
  compactMode: boolean;
  /** Whether settings are linked — when true, hides per-row compact toggle. */
  linkedSettings: boolean;
  /** Called when the user clicks the compact toggle for this row. */
  onCompactModeChange: (compact: boolean) => void;
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
  onFileDrop,
  isDraggingFile,
  compactMode,
  linkedSettings,
  onCompactModeChange,
}: PipelineRowProps) {
  const color = PIPELINE_COLORS[pipeline.colorIndex];
  const applySRGB = pipeline.settings.applySRGB;
  const stageVisibility = getStageVisibility(compactMode);

  // Per-row drag-over tracking
  const [isHovering, setIsHovering] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setIsHovering(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsHovering(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsHovering(false);

    const result = extractDroppedFile(e);
    if (!result || !onFileDrop) return;

    const fileHandle = result.handlePromise ? await result.handlePromise : undefined;
    onFileDrop(result.file, fileHandle);
  };

  const bgTint = isHovering
    ? `rgba(${Math.round(color.rgb[0] * 255)}, ${Math.round(color.rgb[1] * 255)}, ${Math.round(color.rgb[2] * 255)}, 0.15)`
    : isSelected
      ? `rgba(${Math.round(color.rgb[0] * 255)}, ${Math.round(color.rgb[1] * 255)}, ${Math.round(color.rgb[2] * 255)}, 0.08)`
      : 'transparent';

  // Visual cues during drag
  const outlineStyle = isHovering
    ? `2px solid ${color.hex}`
    : isDraggingFile
      ? `1px dashed ${color.hex}88`
      : 'none';

  return (
    <div
      onClick={onSelect}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        background: bgTint,
        borderBottom: '1px solid var(--surface-800)',
        cursor: 'pointer',
        position: 'relative',
        outline: outlineStyle,
        outlineOffset: '-2px',
        transition: 'outline 0.1s, background 0.1s',
      }}
    >
      {/* Color indicator strip */}
      <div
        style={{
          width: '4px',
          flexShrink: 0,
          background: color.hex,
          opacity: isSelected || isHovering ? 1 : 0.4,
          transition: 'opacity 0.15s',
        }}
      />

      {/* Filmstrip */}
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
          stageVisibility={stageVisibility}
        />
      </div>

      {/* Filename + compact toggle + remove button + drop hint */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: '0 8px',
          gap: '4px',
          flexShrink: 0,
          width: '120px',
        }}
      >
        {isHovering ? (
          <span style={{ color: color.hex, fontSize: '11px', whiteSpace: 'nowrap' }}>
            Drop to replace
          </span>
        ) : (
          <>
            <span
              style={{
                color: isSelected ? 'var(--color-text)' : 'var(--color-text-muted)',
                fontSize: '10px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1,
                textAlign: 'right',
              }}
              title={pipeline.fileName ?? 'Sample'}
            >
              {pipeline.fileName ?? 'Sample'}
            </span>
            {/* Compact toggle — hidden when linked (global toggle in header controls all) */}
            {!linkedSettings && (
              <button
                onClick={(e) => { e.stopPropagation(); onCompactModeChange(!compactMode); }}
                title={compactMode ? 'Show all stages' : 'Hide BC Compress and Output Encode stages'}
                style={{
                  background: 'none',
                  border: 'none',
                  color: compactMode ? 'var(--surface-600)' : 'var(--color-text-muted)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  lineHeight: 1,
                  padding: '0 1px',
                  flexShrink: 0,
                  opacity: 0.7,
                }}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1'; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0.7'; }}
              >
                {compactMode ? '⊟' : '⊞'}
              </button>
            )}
            {onRemove && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                title="Remove this pipeline"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--surface-600)',
                  cursor: 'pointer',
                  fontSize: '14px',
                  lineHeight: 1,
                  padding: '0 2px',
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'var(--color-error, #e06060)'; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.color = 'var(--surface-600)'; }}
              >
                ×
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
