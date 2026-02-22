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
}

/**
 * A single pipeline stage card for the filmstrip.
 * Fixed size: 160x120px (160x90 thumbnail + 160x30 label row).
 * Renders a live GPU thumbnail of the stage's output texture.
 */
export function StageCard({ stage, isSelected, onSelect, onToggle, device, format, stageTexture, renderVersion }: StageCardProps) {
  const isAvailable = stage.available !== false;
  const isEnabled = stage.enabled && isAvailable;
  const hasThumbnail = device && stageTexture && isAvailable;

  const opacity = !isAvailable ? 0.4
    : !isEnabled && isSelected ? 0.6
    : !isEnabled ? 0.4
    : 1;

  const bg = isSelected ? 'var(--surface-700)' : 'var(--surface-800)';
  const border = isSelected
    ? '2px solid var(--surface-400)'
    : '1px solid var(--surface-600)';

  return (
    <button
      onClick={onSelect}
      style={{
        background: bg,
        border,
        borderRadius: '6px',
        padding: '4px',
        cursor: 'pointer',
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
      {/* Thumbnail area: 152x90 (with 4px padding on each side = 160px card width) */}
      <div
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
          />
        ) : !isAvailable ? (
          <span style={{ color: 'var(--surface-500)', fontSize: '11px' }}>
            Not Available
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
      </div>

      {/* Label row: shortName + enable checkbox (30px height) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          height: '22px',
          padding: '2px 2px 0',
        }}
      >
        <span
          style={{
            color: 'var(--surface-300)',
            fontSize: '11px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {stage.name}
        </span>

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
            title={stage.enabled ? 'Disable stage' : 'Enable stage'}
          />
        )}
      </div>
    </button>
  );
}
