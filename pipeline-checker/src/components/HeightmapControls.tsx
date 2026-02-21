import { Section } from './ui/Section';
import { Slider } from './ui/Slider';
import { Select } from './ui/Select';
import { Toggle } from './ui/Toggle';
import {
  type HeightmapSettings,
  HeightMode,
  HEIGHT_MODE_LABELS,
} from '../types/pipeline';

const HEIGHT_MODE_OPTIONS = Object.entries(HEIGHT_MODE_LABELS).map(
  ([value, label]) => ({ value: Number(value), label }),
);

const DOWNSAMPLE_OPTIONS = [
  { value: 1, label: '1x (full)' },
  { value: 2, label: '2x' },
  { value: 4, label: '4x' },
  { value: 8, label: '8x' },
  { value: 16, label: '16x' },
] as const;

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
        <Select
          label="Mode"
          value={settings.heightMode}
          options={HEIGHT_MODE_OPTIONS}
          onChange={(v) => patch({ heightMode: v as HeightMode })}
        />
        <Slider
          label="Scale"
          value={settings.heightScale}
          min={0.01}
          max={2.0}
          step={0.01}
          defaultValue={0.1}
          onChange={(v) => patch({ heightScale: v })}
        />
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
        <Toggle
          label="Stops (-log2)"
          value={settings.stopsMode}
          onChange={(v) => patch({ stopsMode: v })}
        />
        <Toggle
          label="Perceptual"
          value={settings.perceptualMode}
          onChange={(v) => patch({ perceptualMode: v })}
        />
      </Section>

      <Section title="Range" defaultOpen>
        <Slider
          label="Min"
          value={settings.rangeMin}
          min={0}
          max={1}
          step={0.01}
          defaultValue={0.0}
          onChange={(v) => patch({ rangeMin: v })}
        />
        <Slider
          label="Max"
          value={settings.rangeMax}
          min={0}
          max={1}
          step={0.01}
          defaultValue={1.0}
          onChange={(v) => patch({ rangeMax: v })}
        />
      </Section>

      <Section title="Display" defaultOpen>
        <Select
          label="Downsample"
          value={settings.downsample}
          options={[...DOWNSAMPLE_OPTIONS]}
          onChange={(v) => patch({ downsample: v as 1 | 2 | 4 | 8 | 16 })}
        />
        <Toggle
          label="Column Mode"
          value={settings.columnMode}
          onChange={(v) => patch({ columnMode: v })}
        />
      </Section>
    </div>
  );
}
