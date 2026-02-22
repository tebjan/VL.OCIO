import { Section, Slider, Select } from './ui';
import { Toggle } from './Toggle';
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

export interface HeightmapControlsProps {
  settings: HeightmapSettings;
  onChange: (settings: HeightmapSettings) => void;
}

export function HeightmapControls({ settings, onChange }: HeightmapControlsProps) {
  const patch = (partial: Partial<HeightmapSettings>) =>
    onChange({ ...settings, ...partial });

  return (
    <div
      style={{
        padding: '8px 12px',
        borderTop: '1px solid var(--surface-800)',
        background: 'var(--surface-950)',
        overflowY: 'auto',
      }}
    >
      <Section title="Height" defaultOpen>
        <div title="How pixel values are mapped to height (luminance, individual channel, etc.)">
          <Select<string>
            label="Mode"
            value={String(settings.heightMode)}
            options={HEIGHT_MODE_OPTIONS}
            onChange={(v) => patch({ heightMode: Number(v) as HeightMode })}
          />
        </div>
        <div title="Multiplier for the height displacement">
          <Slider
            label="Scale"
            value={settings.heightScale}
            min={0.01}
            max={2.0}
            step={0.01}
            defaultValue={0.25}
            onChange={(v) => patch({ heightScale: v })}
          />
        </div>
        <div title="Power curve applied to height values (1.0 = linear)">
          <Slider
            label="Exponent"
            value={settings.exponent}
            min={0.1}
            max={5.0}
            step={0.1}
            defaultValue={1.0}
            decimals={1}
            onChange={(v) => patch({ exponent: v })}
          />
        </div>
        <Toggle
          label="Stops (-log2)"
          value={settings.stopsMode}
          onChange={(v) => patch({ stopsMode: v })}
          title="Interpret values as photographic stops (logarithmic scale)"
        />
        <Toggle
          label="Perceptual"
          value={settings.perceptualMode}
          onChange={(v) => patch({ perceptualMode: v })}
          title="Apply perceptual weighting to height values"
        />
      </Section>

      <Section title="Range" defaultOpen>
        <div title="Minimum value mapped to zero height (negative for HDR data)">
          <Slider
            label="Min"
            value={settings.rangeMin}
            min={-1}
            max={10}
            step={0.01}
            defaultValue={0.0}
            onChange={(v) => patch({ rangeMin: v })}
          />
        </div>
        <div title="Maximum value mapped to full height (increase for HDR content)">
          <Slider
            label="Max"
            value={settings.rangeMax}
            min={0.01}
            max={100}
            step={0.01}
            defaultValue={1.0}
            onChange={(v) => patch({ rangeMax: v })}
          />
        </div>
      </Section>

      <Section title="Display" defaultOpen>
        <div title="Reduce mesh resolution for performance (1x = full detail)">
          <Select<string>
            label="Downsample"
            value={String(settings.downsample)}
            options={DOWNSAMPLE_OPTIONS}
            onChange={(v) => patch({ downsample: Number(v) as 1 | 2 | 4 | 8 | 16 })}
          />
        </div>
      </Section>
    </div>
  );
}
