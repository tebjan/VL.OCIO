import type { PipelineSettings } from '../types/settings';
import { Section } from './ui/Section';
import { Slider } from './ui/Slider';
import { Vec3Slider } from './ui/Vec3Slider';
import { Select } from './ui/Select';
import { Toggle } from './ui/Toggle';

export interface ControlsPanelProps {
  settings: PipelineSettings;
  onSettingsChange: (patch: Partial<PipelineSettings>) => void;
}

// --- Enum options (will move to settings.ts in task 7.5) ---
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
      <Section title="Input">
        <Select label="Color Space" value={settings.inputColorSpace} options={HDR_COLOR_SPACES} onChange={(v) => set({ inputColorSpace: v })} />
        <Select label="BC Format" value={settings.bcFormat} options={BC_FORMATS} onChange={(v) => set({ bcFormat: v })} />
      </Section>

      {/* --- Color Grading Section (Stage 5) --- */}
      <Section title="Color Grading">
        <Select label="Grading Space" value={settings.gradingSpace} options={GRADING_SPACES} onChange={(v) => set({ gradingSpace: v })} />
        <Slider label="Exposure" value={settings.gradeExposure} min={-10} max={10} defaultValue={0} onChange={(v) => set({ gradeExposure: v })} />
        <Slider label="Contrast" value={settings.gradeContrast} min={0} max={3} defaultValue={1} onChange={(v) => set({ gradeContrast: v })} />
        <Slider label="Saturation" value={settings.gradeSaturation} min={0} max={3} defaultValue={1} onChange={(v) => set({ gradeSaturation: v })} />
        <Slider label="Temperature" value={settings.gradeTemperature} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeTemperature: v })} />
        <Slider label="Tint" value={settings.gradeTint} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeTint: v })} />
        <Slider label="Highlights" value={settings.gradeHighlights} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeHighlights: v })} />
        <Slider label="Shadows" value={settings.gradeShadows} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeShadows: v })} />
        <Slider label="Vibrance" value={settings.gradeVibrance} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeVibrance: v })} />

        <Vec3Slider label="Lift" value={settings.gradeLift} min={-1} max={1} defaultValue={{ x: 0, y: 0, z: 0 }} onChange={(v) => set({ gradeLift: v })} />
        <Vec3Slider label="Gamma" value={settings.gradeGamma} min={0.01} max={4} defaultValue={{ x: 1, y: 1, z: 1 }} onChange={(v) => set({ gradeGamma: v })} />
        <Vec3Slider label="Gain" value={settings.gradeGain} min={0} max={4} defaultValue={{ x: 1, y: 1, z: 1 }} onChange={(v) => set({ gradeGain: v })} />
        <Vec3Slider label="Offset" value={settings.gradeOffset} min={-1} max={1} defaultValue={{ x: 0, y: 0, z: 0 }} onChange={(v) => set({ gradeOffset: v })} />

        <Vec3Slider label="Shadow Color" value={settings.gradeShadowColor} min={-1} max={1} defaultValue={{ x: 0, y: 0, z: 0 }} onChange={(v) => set({ gradeShadowColor: v })} />
        <Vec3Slider label="Midtone Color" value={settings.gradeMidtoneColor} min={-1} max={1} defaultValue={{ x: 0, y: 0, z: 0 }} onChange={(v) => set({ gradeMidtoneColor: v })} />
        <Vec3Slider label="Highlight Color" value={settings.gradeHighlightColor} min={-1} max={1} defaultValue={{ x: 0, y: 0, z: 0 }} onChange={(v) => set({ gradeHighlightColor: v })} />

        <Slider label="HL Soft Clip" value={settings.gradeHighlightSoftClip} min={0} max={1} defaultValue={0} onChange={(v) => set({ gradeHighlightSoftClip: v })} />
        <Slider label="SH Soft Clip" value={settings.gradeShadowSoftClip} min={0} max={1} defaultValue={0} onChange={(v) => set({ gradeShadowSoftClip: v })} />
        <Slider label="HL Knee" value={settings.gradeHighlightKnee} min={0} max={4} defaultValue={1} onChange={(v) => set({ gradeHighlightKnee: v })} />
        <Slider label="SH Knee" value={settings.gradeShadowKnee} min={0} max={1} defaultValue={0.1} onChange={(v) => set({ gradeShadowKnee: v })} />
      </Section>

      {/* --- Tonemap Section (Stages 6-7) --- */}
      <Section title="Tonemap">
        <Select label="Operator" value={settings.tonemapOperator} options={TONEMAP_OPERATORS} onChange={(v) => set({ tonemapOperator: v })} />
        <Toggle label="RRT Enabled" value={settings.rrtEnabled} onChange={(v) => set({ rrtEnabled: v })} />
        <Toggle label="ODT Enabled" value={settings.odtEnabled} onChange={(v) => set({ odtEnabled: v })} />
        <Select label="ODT Target" value={settings.odtTarget} options={ODT_TARGETS} onChange={(v) => set({ odtTarget: v })} />
        <Slider label="Exposure" value={settings.tonemapExposure} min={-10} max={10} defaultValue={0} onChange={(v) => set({ tonemapExposure: v })} />
        <Slider label="White Point" value={settings.tonemapWhitePoint} min={0.1} max={20} defaultValue={4} onChange={(v) => set({ tonemapWhitePoint: v })} />
        <Slider label="Peak Bright." value={settings.tonemapPeakBrightness} min={100} max={10000} step={10} decimals={0} defaultValue={1000} onChange={(v) => set({ tonemapPeakBrightness: v })} />
      </Section>

      {/* --- Output Section (Stages 8-9) --- */}
      <Section title="Output">
        <Select label="Output Space" value={settings.outputSpace} options={HDR_COLOR_SPACES} onChange={(v) => set({ outputSpace: v })} />
        <Slider label="Paper White" value={settings.outputPaperWhite} min={80} max={500} step={1} decimals={0} unit=" nits" defaultValue={200} onChange={(v) => set({ outputPaperWhite: v })} />
        <Slider label="Peak Bright." value={settings.outputPeakBrightness} min={100} max={10000} step={10} decimals={0} unit=" nits" defaultValue={1000} onChange={(v) => set({ outputPeakBrightness: v })} />
        <Slider label="Black Level" value={settings.outputBlackLevel} min={0} max={0.1} step={0.001} decimals={3} defaultValue={0} onChange={(v) => set({ outputBlackLevel: v })} />
        <Slider label="White Level" value={settings.outputWhiteLevel} min={0.5} max={2} defaultValue={1} onChange={(v) => set({ outputWhiteLevel: v })} />
      </Section>
    </div>
  );
}
