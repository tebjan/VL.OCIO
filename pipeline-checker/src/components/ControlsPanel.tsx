import { useState } from 'react';
import type { PipelineSettings, Vec3 } from '../types/settings';

export interface ControlsPanelProps {
  settings: PipelineSettings;
  onSettingsChange: (patch: Partial<PipelineSettings>) => void;
}

/** Inline collapsible section — will be extracted to reusable Section.tsx in task 7.4 */
function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          width: '100%',
          padding: '6px 0',
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          color: 'var(--surface-500)',
          fontSize: '11px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        <span style={{ fontSize: '10px', transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          ▶
        </span>
        {title}
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '4px 0 8px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Placeholder slider row — will be replaced by Slider component in 7.4 */
function PlaceholderSlider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ color: 'var(--surface-300)', fontSize: '12px', width: '110px', flexShrink: 0 }}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: 'var(--surface-400)' }}
      />
      <span style={{ color: 'var(--surface-300)', fontSize: '11px', fontFamily: 'monospace', width: '52px', textAlign: 'right', flexShrink: 0 }}>
        {value.toFixed(2)}
      </span>
    </div>
  );
}

/** Placeholder select — will be replaced by Select component in 7.4 */
function PlaceholderSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: ReadonlyArray<{ value: number; label: string }>;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ color: 'var(--surface-300)', fontSize: '12px', width: '110px', flexShrink: 0 }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        style={{
          flex: 1,
          background: 'var(--surface-800)',
          color: 'var(--surface-300)',
          border: '1px solid var(--surface-600)',
          borderRadius: '4px',
          padding: '4px 8px',
          fontSize: '12px',
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Placeholder toggle — will be replaced by Toggle component in 7.4 */
function PlaceholderToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ color: 'var(--surface-300)', fontSize: '12px', width: '110px', flexShrink: 0 }}>
        {label}
      </span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: 'var(--surface-400)' }}
      />
    </div>
  );
}

/** Placeholder vec3 slider — 3 channel sliders in a compact row */
function PlaceholderVec3Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
}: {
  label: string;
  value: Vec3;
  min: number;
  max: number;
  step?: number;
  onChange: (v: Vec3) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <span style={{ color: 'var(--surface-500)', fontSize: '11px', fontWeight: 600 }}>{label}</span>
      {(['x', 'y', 'z'] as const).map((ch, i) => (
        <div key={ch} style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '8px' }}>
          <span style={{ color: ['#cc6666', '#66cc66', '#6666cc'][i], fontSize: '11px', width: '12px', fontFamily: 'monospace' }}>
            {['R', 'G', 'B'][i]}
          </span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value[ch]}
            onChange={(e) => onChange({ ...value, [ch]: parseFloat(e.target.value) })}
            style={{ flex: 1, accentColor: 'var(--surface-400)' }}
          />
          <span style={{ color: 'var(--surface-300)', fontSize: '10px', fontFamily: 'monospace', width: '44px', textAlign: 'right' }}>
            {value[ch].toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
}

// --- Inline enum options (will move to settings.ts in task 7.5) ---
const HDR_COLOR_SPACES = [
  { value: 0, label: 'Linear Rec.709' },
  { value: 1, label: 'Linear Rec.2020' },
  { value: 2, label: 'ACEScg' },
  { value: 3, label: 'ACEScc' },
  { value: 4, label: 'ACEScct' },
  { value: 5, label: 'sRGB' },
  { value: 6, label: 'PQ Rec.2020 (HDR10)' },
  { value: 7, label: 'HLG Rec.2020' },
  { value: 8, label: 'scRGB' },
];

const BC_FORMATS = [
  { value: 0, label: 'BC1 (DXT1)' },
  { value: 1, label: 'BC2 (DXT3)' },
  { value: 2, label: 'BC3 (DXT5)' },
  { value: 3, label: 'BC4 (ATI1)' },
  { value: 4, label: 'BC5 (ATI2)' },
  { value: 5, label: 'BC6H (HDR)' },
  { value: 6, label: 'BC7' },
];

const GRADING_SPACES = [
  { value: 0, label: 'Log (ACEScct)' },
  { value: 1, label: 'Linear (ACEScg)' },
];

const TONEMAP_OPERATORS = [
  { value: 0, label: 'None' },
  { value: 1, label: 'ACES (Fit)' },
  { value: 2, label: 'ACES 1.3' },
  { value: 3, label: 'ACES 2.0' },
  { value: 4, label: 'AgX' },
  { value: 5, label: 'Gran Turismo' },
  { value: 6, label: 'Uncharted 2' },
  { value: 7, label: 'Khronos PBR Neutral' },
  { value: 8, label: 'Lottes' },
  { value: 9, label: 'Reinhard' },
  { value: 10, label: 'Reinhard Extended' },
  { value: 11, label: 'Hejl-Burgess' },
];

const ODT_TARGETS = [
  { value: 0, label: 'Rec.709 100 nits' },
  { value: 1, label: 'Rec.2020 1000 nits' },
];

export function ControlsPanel({ settings, onSettingsChange }: ControlsPanelProps) {
  const set = (patch: Partial<PipelineSettings>) => onSettingsChange(patch);

  return (
    <div
      style={{
        width: '320px',
        minWidth: '256px',
        height: '100%',
        overflowY: 'auto',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        background: 'var(--surface-950)',
        borderLeft: '1px solid var(--surface-700)',
        flexShrink: 0,
      }}
    >
      {/* --- Input Section (Stages 1-4) --- */}
      <CollapsibleSection title="Input">
        <PlaceholderSelect label="Color Space" value={settings.inputColorSpace} options={HDR_COLOR_SPACES} onChange={(v) => set({ inputColorSpace: v })} />
        <PlaceholderSelect label="BC Format" value={settings.bcFormat} options={BC_FORMATS} onChange={(v) => set({ bcFormat: v })} />
      </CollapsibleSection>

      {/* --- Color Grading Section (Stage 5) --- */}
      <CollapsibleSection title="Color Grading">
        <PlaceholderSelect label="Grading Space" value={settings.gradingSpace} options={GRADING_SPACES} onChange={(v) => set({ gradingSpace: v })} />
        <PlaceholderSlider label="Exposure" value={settings.gradeExposure} min={-10} max={10} onChange={(v) => set({ gradeExposure: v })} />
        <PlaceholderSlider label="Contrast" value={settings.gradeContrast} min={0} max={3} onChange={(v) => set({ gradeContrast: v })} />
        <PlaceholderSlider label="Saturation" value={settings.gradeSaturation} min={0} max={3} onChange={(v) => set({ gradeSaturation: v })} />
        <PlaceholderSlider label="Temperature" value={settings.gradeTemperature} min={-1} max={1} onChange={(v) => set({ gradeTemperature: v })} />
        <PlaceholderSlider label="Tint" value={settings.gradeTint} min={-1} max={1} onChange={(v) => set({ gradeTint: v })} />
        <PlaceholderSlider label="Highlights" value={settings.gradeHighlights} min={-1} max={1} onChange={(v) => set({ gradeHighlights: v })} />
        <PlaceholderSlider label="Shadows" value={settings.gradeShadows} min={-1} max={1} onChange={(v) => set({ gradeShadows: v })} />
        <PlaceholderSlider label="Vibrance" value={settings.gradeVibrance} min={-1} max={1} onChange={(v) => set({ gradeVibrance: v })} />

        <PlaceholderVec3Slider label="Lift" value={settings.gradeLift} min={-1} max={1} onChange={(v) => set({ gradeLift: v })} />
        <PlaceholderVec3Slider label="Gamma" value={settings.gradeGamma} min={0.01} max={4} onChange={(v) => set({ gradeGamma: v })} />
        <PlaceholderVec3Slider label="Gain" value={settings.gradeGain} min={0} max={4} onChange={(v) => set({ gradeGain: v })} />
        <PlaceholderVec3Slider label="Offset" value={settings.gradeOffset} min={-1} max={1} onChange={(v) => set({ gradeOffset: v })} />

        <PlaceholderVec3Slider label="Shadow Color" value={settings.gradeShadowColor} min={-1} max={1} onChange={(v) => set({ gradeShadowColor: v })} />
        <PlaceholderVec3Slider label="Midtone Color" value={settings.gradeMidtoneColor} min={-1} max={1} onChange={(v) => set({ gradeMidtoneColor: v })} />
        <PlaceholderVec3Slider label="Highlight Color" value={settings.gradeHighlightColor} min={-1} max={1} onChange={(v) => set({ gradeHighlightColor: v })} />

        <PlaceholderSlider label="HL Soft Clip" value={settings.gradeHighlightSoftClip} min={0} max={1} onChange={(v) => set({ gradeHighlightSoftClip: v })} />
        <PlaceholderSlider label="SH Soft Clip" value={settings.gradeShadowSoftClip} min={0} max={1} onChange={(v) => set({ gradeShadowSoftClip: v })} />
        <PlaceholderSlider label="HL Knee" value={settings.gradeHighlightKnee} min={0} max={4} onChange={(v) => set({ gradeHighlightKnee: v })} />
        <PlaceholderSlider label="SH Knee" value={settings.gradeShadowKnee} min={0} max={1} onChange={(v) => set({ gradeShadowKnee: v })} />
      </CollapsibleSection>

      {/* --- Tonemap Section (Stages 6-7) --- */}
      <CollapsibleSection title="Tonemap">
        <PlaceholderSelect label="Operator" value={settings.tonemapOperator} options={TONEMAP_OPERATORS} onChange={(v) => set({ tonemapOperator: v })} />
        <PlaceholderToggle label="RRT Enabled" value={settings.rrtEnabled} onChange={(v) => set({ rrtEnabled: v })} />
        <PlaceholderToggle label="ODT Enabled" value={settings.odtEnabled} onChange={(v) => set({ odtEnabled: v })} />
        <PlaceholderSelect label="ODT Target" value={settings.odtTarget} options={ODT_TARGETS} onChange={(v) => set({ odtTarget: v })} />
        <PlaceholderSlider label="Exposure" value={settings.tonemapExposure} min={-10} max={10} onChange={(v) => set({ tonemapExposure: v })} />
        <PlaceholderSlider label="White Point" value={settings.tonemapWhitePoint} min={0.1} max={20} onChange={(v) => set({ tonemapWhitePoint: v })} />
        <PlaceholderSlider label="Peak Bright." value={settings.tonemapPeakBrightness} min={100} max={10000} step={10} onChange={(v) => set({ tonemapPeakBrightness: v })} />
      </CollapsibleSection>

      {/* --- Output Section (Stages 8-9) --- */}
      <CollapsibleSection title="Output">
        <PlaceholderSelect label="Output Space" value={settings.outputSpace} options={HDR_COLOR_SPACES} onChange={(v) => set({ outputSpace: v })} />
        <PlaceholderSlider label="Paper White" value={settings.outputPaperWhite} min={80} max={500} step={1} onChange={(v) => set({ outputPaperWhite: v })} />
        <PlaceholderSlider label="Peak Bright." value={settings.outputPeakBrightness} min={100} max={10000} step={10} onChange={(v) => set({ outputPeakBrightness: v })} />
        <PlaceholderSlider label="Black Level" value={settings.outputBlackLevel} min={0} max={0.1} step={0.001} onChange={(v) => set({ outputBlackLevel: v })} />
        <PlaceholderSlider label="White Level" value={settings.outputWhiteLevel} min={0.5} max={2} onChange={(v) => set({ outputWhiteLevel: v })} />
      </CollapsibleSection>
    </div>
  );
}
