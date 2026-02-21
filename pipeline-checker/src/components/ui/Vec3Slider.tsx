import type { Vec3 } from '../../types/settings';

export interface Vec3SliderProps {
  label: string;
  value: Vec3;
  min: number;
  max: number;
  step?: number;
  defaultValue?: Vec3;
  decimals?: number;
  onChange: (value: Vec3) => void;
}

const CHANNELS: Array<{ key: keyof Vec3; label: string; color: string }> = [
  { key: 'x', label: 'R', color: '#cc6666' },
  { key: 'y', label: 'G', color: '#66cc66' },
  { key: 'z', label: 'B', color: '#6666cc' },
];

export function Vec3Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  defaultValue,
  decimals = 2,
  onChange,
}: Vec3SliderProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <span style={{ color: 'var(--surface-500)', fontSize: '11px', fontWeight: 600 }}>
        {label}
      </span>
      {CHANNELS.map((ch) => (
        <div
          key={ch.key}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '8px' }}
        >
          <span
            style={{
              color: ch.color,
              fontSize: '11px',
              width: '12px',
              fontFamily: 'monospace',
              opacity: 0.6,
            }}
          >
            {ch.label}
          </span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value[ch.key]}
            onChange={(e) => onChange({ ...value, [ch.key]: parseFloat(e.target.value) })}
            onDoubleClick={() => {
              if (defaultValue) onChange({ ...value, [ch.key]: defaultValue[ch.key] });
            }}
            style={{ flex: 1, accentColor: 'var(--surface-400)' }}
          />
          <span
            style={{
              color: 'var(--surface-300)',
              fontSize: '10px',
              fontFamily: 'monospace',
              width: '44px',
              textAlign: 'right',
            }}
          >
            {value[ch.key].toFixed(decimals)}
          </span>
        </div>
      ))}
    </div>
  );
}
