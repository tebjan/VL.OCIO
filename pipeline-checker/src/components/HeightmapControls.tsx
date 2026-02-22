import {
  type HeightmapSettings,
  HeightMode,
  HEIGHT_MODE_LABELS,
} from '../types/pipeline';

const HEIGHT_MODE_OPTIONS = Object.entries(HEIGHT_MODE_LABELS).map(
  ([value, label]) => ({ value: String(value), label }),
);

const DOWNSAMPLE_OPTIONS = [
  { value: '1', label: '1x (full)' },
  { value: '2', label: '2x' },
  { value: '4', label: '4x' },
  { value: '8', label: '8x' },
  { value: '16', label: '16x' },
];

const MSAA_OPTIONS = [
  { value: '0', label: 'Off' },
  { value: '2', label: '2x' },
  { value: '4', label: '4x' },
];

export interface HeightmapControlsProps {
  settings: HeightmapSettings;
  onChange: (settings: HeightmapSettings) => void;
}

/** Compact labeled group: label stacked above control for clear association. */
function Field({ label, title, children, minWidth }: {
  label: string;
  title?: string;
  children: React.ReactNode;
  minWidth?: string;
}) {
  return (
    <div style={{ minWidth, display: 'flex', flexDirection: 'column', gap: '2px' }} title={title}>
      <div style={{ fontSize: '10px', color: 'var(--surface-500)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      {children}
    </div>
  );
}

/** Compact toggle rendered as a small pill button. */
function CompactToggle({ label, value, onChange, title }: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  title?: string;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      title={title}
      style={{
        padding: '4px 10px',
        fontSize: '11px',
        border: '1px solid var(--surface-600)',
        borderRadius: '4px',
        cursor: 'pointer',
        background: value ? 'var(--surface-700)' : 'var(--surface-900)',
        color: value ? 'var(--surface-200)' : 'var(--surface-500)',
        fontWeight: value ? 600 : 400,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

/** Compact inline slider: just the range input + value, no label (label is above via Field). */
function CompactSlider({ value, min, max, step, defaultValue, decimals = 2, onChange }: {
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  decimals?: number;
  onChange: (v: number) => void;
}) {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onDoubleClick={() => onChange(defaultValue)}
        className="w-full h-4"
        style={{ '--slider-gradient': `linear-gradient(to right, #71717a ${pct}%, #3f3f46 ${pct}%)` } as React.CSSProperties}
      />
      <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--surface-300)', minWidth: '36px', textAlign: 'right' }}>
        {value.toFixed(decimals)}
      </span>
    </div>
  );
}

/** Compact inline select: just the dropdown, no label (label is above via Field). */
function CompactSelect<T extends string>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      style={{
        width: '100%',
        padding: '3px 6px',
        fontSize: '12px',
        background: 'var(--surface-800)',
        border: '1px solid var(--surface-700)',
        borderRadius: '4px',
        color: 'var(--surface-200)',
        cursor: 'pointer',
      }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

export function HeightmapControls({ settings, onChange }: HeightmapControlsProps) {
  const patch = (partial: Partial<HeightmapSettings>) =>
    onChange({ ...settings, ...partial });

  return (
    <div
      style={{
        padding: '6px 12px',
        borderTop: '1px solid var(--surface-800)',
        background: 'var(--surface-950)',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      {/* Row 1: Height */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '16px' }}>
        <Field label="Mode" title="How pixel values are mapped to height" minWidth="120px">
          <CompactSelect
            value={String(settings.heightMode)}
            options={HEIGHT_MODE_OPTIONS}
            onChange={(v) => patch({ heightMode: Number(v) as HeightMode })}
          />
        </Field>
        <div style={{ flex: 1 }}>
          <Field label="Scale" title="Multiplier for the height displacement">
            <CompactSlider value={settings.heightScale} min={0.01} max={2.0} step={0.01} defaultValue={0.25} onChange={(v) => patch({ heightScale: v })} />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Exponent" title="Power curve applied to height values (1.0 = linear)">
            <CompactSlider value={settings.exponent} min={0.1} max={5.0} step={0.1} defaultValue={1.0} decimals={1} onChange={(v) => patch({ exponent: v })} />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: '4px', paddingBottom: '1px' }}>
          <CompactToggle label="Stops" value={settings.stopsMode} onChange={(v) => patch({ stopsMode: v })} title="Interpret values as photographic stops" />
          <CompactToggle label="Perceptual" value={settings.perceptualMode} onChange={(v) => patch({ perceptualMode: v })} title="Apply perceptual weighting" />
        </div>
      </div>

      {/* Row 2: Range + Display */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '16px' }}>
        <div style={{ flex: 1 }}>
          <Field label="Range Min" title="Minimum value mapped to zero height">
            <CompactSlider value={settings.rangeMin} min={-1} max={10} step={0.01} defaultValue={0.0} onChange={(v) => patch({ rangeMin: v })} />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Range Max" title="Maximum value mapped to full height">
            <CompactSlider value={settings.rangeMax} min={0.01} max={100} step={0.01} defaultValue={1.0} onChange={(v) => patch({ rangeMax: v })} />
          </Field>
        </div>
        <Field label="Downsample" title="Reduce mesh resolution for performance" minWidth="120px">
          <CompactSelect
            value={String(settings.downsample)}
            options={DOWNSAMPLE_OPTIONS}
            onChange={(v) => patch({ downsample: Number(v) as 1 | 2 | 4 | 8 | 16 })}
          />
        </Field>
        <Field label="MSAA" title="Multisample anti-aliasing" minWidth="90px">
          <CompactSelect
            value={String(settings.msaa)}
            options={MSAA_OPTIONS}
            onChange={(v) => patch({ msaa: Number(v) as 0 | 2 | 4 })}
          />
        </Field>
      </div>
    </div>
  );
}
