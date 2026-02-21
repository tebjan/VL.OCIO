import { useCallback } from 'react';

export interface ViewExposureHeaderProps {
  exposure: number;
  onChange: (value: number) => void;
}

/**
 * "View (non-destructive)" section placed ABOVE the preview canvas.
 * Visually separated from pipeline controls to prevent confusion
 * with grade exposure (Stage 5) or tonemap exposure (Stage 6).
 */
export function ViewExposureHeader({ exposure, onChange }: ViewExposureHeaderProps) {
  const handleInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseFloat(e.target.value));
  }, [onChange]);

  const handleDoubleClick = useCallback(() => {
    onChange(0);
  }, [onChange]);

  const displayValue = exposure >= 0 ? `+${exposure.toFixed(1)}` : exposure.toFixed(1);

  return (
    <div
      style={{
        padding: '8px 12px',
        background: 'var(--surface-950)',
        borderBottom: '1px solid var(--surface-700)',
      }}
    >
      {/* Header */}
      <div
        style={{
          fontSize: '11px',
          fontStyle: 'italic',
          color: 'var(--surface-400)',
          marginBottom: '4px',
        }}
      >
        View (non-destructive)
      </div>

      {/* Dashed separator */}
      <div
        style={{
          borderTop: '1px dashed var(--surface-600)',
          marginBottom: '8px',
        }}
      />

      {/* Exposure slider row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <label
          style={{
            fontSize: '12px',
            color: 'var(--surface-300)',
            width: '64px',
            flexShrink: 0,
          }}
        >
          Exposure
        </label>

        <input
          type="range"
          min={-10}
          max={10}
          step={0.1}
          value={exposure}
          onChange={handleInput}
          onDoubleClick={handleDoubleClick}
          style={{
            flex: 1,
            height: '4px',
            cursor: 'pointer',
            accentColor: 'var(--surface-400)',
          }}
        />

        <span
          style={{
            fontSize: '12px',
            fontFamily: 'monospace',
            color: 'var(--surface-200)',
            width: '64px',
            textAlign: 'right',
            flexShrink: 0,
          }}
        >
          {displayValue} EV
        </span>
      </div>
    </div>
  );
}
