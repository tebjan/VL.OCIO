import type { StageInfo } from '../pipeline/types/StageInfo';

export interface FilmstripProps {
  stages: StageInfo[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onToggle: (index: number, enabled: boolean) => void;
}

export function Filmstrip({ stages, selectedIndex, onSelect, onToggle }: FilmstripProps) {
  return (
    <div
      style={{
        background: 'var(--surface-900)',
        borderBottom: '1px solid var(--surface-700)',
        padding: '8px 12px',
        overflowX: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        flexShrink: 0,
      }}
    >
      {stages.map((stage, i) => {
        const isSelected = i === selectedIndex;
        const isAvailable = stage.available !== false;
        const isEnabled = stage.enabled && isAvailable;

        const opacity = !isAvailable ? 0.4
          : !isEnabled && isSelected ? 0.6
          : !isEnabled ? 0.4
          : 1;

        const bg = isSelected ? 'var(--surface-700)' : 'var(--surface-800)';
        const border = isSelected
          ? '2px solid var(--surface-400)'
          : '1px solid var(--surface-600)';

        return (
          <div key={stage.index} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {/* Arrow connector before each card (except first) */}
            {i > 0 && (
              <span
                style={{
                  color: 'var(--surface-600)',
                  fontSize: '18px',
                  lineHeight: 1,
                  userSelect: 'none',
                  flexShrink: 0,
                }}
              >
                ›
              </span>
            )}

            {/* Stage card */}
            <button
              onClick={() => onSelect(i)}
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
                gap: '4px',
                flexShrink: 0,
                width: '160px',
                position: 'relative',
              }}
            >
              {/* Thumbnail placeholder */}
              <div
                style={{
                  width: '152px',
                  height: '90px',
                  background: 'var(--surface-950)',
                  borderRadius: '3px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {!isAvailable ? (
                  <span style={{ color: 'var(--surface-500)', fontSize: '11px' }}>
                    Not Available
                  </span>
                ) : !isEnabled ? (
                  /* Bypass arrow overlay */
                  <span
                    style={{
                      color: 'var(--surface-500)',
                      fontSize: '32px',
                      opacity: 0.6,
                      userSelect: 'none',
                    }}
                  >
                    ↷
                  </span>
                ) : (
                  <span style={{ color: 'var(--surface-600)', fontSize: '11px' }}>
                    {stage.shortName}
                  </span>
                )}
              </div>

              {/* Footer: name + enable checkbox */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '0 2px',
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
                      onToggle(i, e.target.checked);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ accentColor: 'var(--surface-400)', flexShrink: 0 }}
                    title={stage.enabled ? 'Disable stage' : 'Enable stage'}
                  />
                )}
              </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}
