export interface ToggleProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  labelOn?: string;
  labelOff?: string;
  title?: string;
}

export function Toggle({ label, value, onChange, labelOn, labelOff, title }: ToggleProps) {
  const isLabeled = labelOn !== undefined && labelOff !== undefined;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }} title={title}>
      <span
        style={{
          color: 'var(--surface-300)',
          fontSize: '12px',
          width: '96px',
          flexShrink: 0,
        }}
      >
        {label}
      </span>

      {isLabeled ? (
        /* Segmented button toggle for named options */
        <div
          style={{
            display: 'flex',
            flex: 1,
            borderRadius: '4px',
            overflow: 'hidden',
            border: '1px solid var(--surface-600)',
          }}
        >
          <button
            onClick={() => onChange(false)}
            style={{
              flex: 1,
              padding: '4px 8px',
              fontSize: '11px',
              border: 'none',
              cursor: 'pointer',
              background: !value ? 'var(--surface-700)' : 'var(--surface-800)',
              color: !value ? 'var(--surface-200)' : 'var(--surface-500)',
              fontWeight: !value ? 600 : 400,
            }}
          >
            {labelOff}
          </button>
          <button
            onClick={() => onChange(true)}
            style={{
              flex: 1,
              padding: '4px 8px',
              fontSize: '11px',
              border: 'none',
              borderLeft: '1px solid var(--surface-600)',
              cursor: 'pointer',
              background: value ? 'var(--surface-700)' : 'var(--surface-800)',
              color: value ? 'var(--surface-200)' : 'var(--surface-500)',
              fontWeight: value ? 600 : 400,
            }}
          >
            {labelOn}
          </button>
        </div>
      ) : (
        /* Simple switch toggle */
        <button
          onClick={() => onChange(!value)}
          style={{
            width: '36px',
            height: '20px',
            borderRadius: '10px',
            border: 'none',
            cursor: 'pointer',
            background: 'var(--surface-700)',
            position: 'relative',
            padding: 0,
          }}
        >
          <span
            style={{
              display: 'block',
              width: '14px',
              height: '14px',
              borderRadius: '50%',
              background: value ? 'var(--surface-300)' : 'var(--surface-500)',
              position: 'absolute',
              top: '3px',
              left: value ? '19px' : '3px',
              transition: 'left 0.15s, background 0.15s',
            }}
          />
        </button>
      )}
    </div>
  );
}
