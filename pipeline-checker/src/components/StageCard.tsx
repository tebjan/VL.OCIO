import type { StageInfo } from '../pipeline/types/StageInfo';
import { ThumbnailCanvas } from './ThumbnailCanvas';

export interface StageCardProps {
  stage: StageInfo;
  isSelected: boolean;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
  device: GPUDevice | null;
  format: GPUTextureFormat;
  stageTexture: GPUTexture | null;
  renderVersion?: number;
  applySRGB?: boolean;
  colorSpaceLabel?: string;
}

/**
 * A single pipeline stage card for the filmstrip.
 * Compact size: 120x88px (114x66 thumbnail + label row).
 * Renders a live GPU thumbnail of the stage's output texture.
 */
export function StageCard({ stage, isSelected, onSelect, onToggle, device, format, stageTexture, renderVersion, applySRGB, colorSpaceLabel }: StageCardProps) {
  const isAvailable = stage.available !== false;
  const isEnabled = stage.enabled && isAvailable;
  const hasThumbnail = device && stageTexture && isAvailable;

  const opacity = !isAvailable ? 0.4
    : !isEnabled && isSelected ? 0.6
    : !isEnabled ? 0.4
    : 1;

  const bg = isSelected ? 'var(--surface-700)' : 'transparent';
  const border = isSelected
    ? '1px solid var(--color-stage-active)'
    : '1px solid var(--surface-700)';

  return (
    <div
      style={{
        background: bg,
        border,
        borderRadius: '4px',
        padding: '3px',
        opacity,
        transition: 'opacity 0.15s, border-color 0.15s',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0px',
        flexShrink: 0,
        width: '160px',
        height: '120px',
        position: 'relative',
      }}
    >
      {/* Thumbnail area: 152x90 — clickable to select stage */}
      <button
        onClick={onSelect}
        title={stage.description}
        style={{
          width: '152px',
          height: '90px',
          background: 'var(--surface-950)',
          borderRadius: '3px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
          cursor: 'pointer',
          border: 'none',
          padding: 0,
        }}
      >
        {hasThumbnail ? (
          <ThumbnailCanvas
            device={device}
            format={format}
            texture={stageTexture}
            width={152}
            height={90}
            renderVersion={renderVersion}
            applySRGB={applySRGB}
          />
        ) : !isAvailable ? (
          <span style={{ color: 'var(--surface-500)', fontSize: '11px' }}>
            N/A
          </span>
        ) : (
          <span style={{ color: 'var(--surface-600)', fontSize: '11px' }}>
            {stage.shortName}
          </span>
        )}

        {/* Bypass overlay for disabled stages */}
        {isAvailable && !isEnabled && (
          <span
            style={{
              position: 'absolute',
              color: 'var(--surface-500)',
              fontSize: '32px',
              opacity: 0.6,
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          >
            &darr;
          </span>
        )}
      </button>

      {/* Label row: stage name, color space, checkbox */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          height: '22px',
          padding: '2px 2px 0',
          gap: '4px',
        }}
      >
        <span
          style={{
            color: 'var(--surface-300)',
            fontSize: '10px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
          }}
        >
          {stage.shortName}
        </span>

        {colorSpaceLabel && (
          <span
            style={{
              color: 'var(--surface-500)',
              fontSize: '9px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0,
            }}
          >
            {colorSpaceLabel}
          </span>
        )}

        <span style={{ flex: 1 }} />

        {isAvailable && (
          <input
            type="checkbox"
            checked={stage.enabled}
            onChange={(e) => {
              e.stopPropagation();
              onToggle(e.target.checked);
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ accentColor: 'var(--surface-400)', flexShrink: 0 }}
            title={stage.enabled ? 'Disable this stage (bypass)' : 'Enable this stage'}
          />
        )}
      </div>
    </div>
  );
}
