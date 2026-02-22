import {
  type PipelineSettings,
  BC_FORMATS,
  ODT_TARGETS,
} from '../types/settings';
import {
  type ColorSpaceString,
  type TonemapString,
  type GradingSpaceString,
  COLOR_SPACE_LABELS,
  TONEMAP_LABELS,
  GRADING_SPACE_LABELS,
  colorSpaceToIndex,
  indexToColorSpace,
  tonemapToIndex,
  indexToTonemap,
  gradingSpaceToIndex,
  indexToGradingSpace,
} from '../lib/enumMaps';
import { Section } from './grading/Section';
import { Slider } from './grading/Slider';
import { Select } from './grading/Select';
import { Toggle } from './grading/Toggle';
import { LiftGammaGain } from './grading/LiftGammaGain';

export interface ControlsPanelProps {
  settings: PipelineSettings;
  onSettingsChange: (patch: Partial<PipelineSettings>) => void;
  onReset?: () => void;
}

const colorSpaceOptions = Object.entries(COLOR_SPACE_LABELS).map(
  ([value, label]) => ({ value: value as ColorSpaceString, label }),
);

const tonemapOptions = Object.entries(TONEMAP_LABELS).map(
  ([value, label]) => ({ value: value as TonemapString, label }),
);

const gradingSpaceOptions = Object.entries(GRADING_SPACE_LABELS).map(
  ([value, label]) => ({ value: value as GradingSpaceString, label }),
);

export function ControlsPanel({ settings, onSettingsChange, onReset }: ControlsPanelProps) {
  const set = (patch: Partial<PipelineSettings>) => onSettingsChange(patch);

  return (
    <div className="w-80 min-w-64 h-full overflow-y-auto p-3 flex flex-col gap-4 bg-surface-950 border-l border-surface-700 shrink-0">
      {/* --- Reset Button --- */}
      {onReset && (
        <button
          onClick={onReset}
          className="px-3 py-1.5 bg-surface-800 border border-surface-600 rounded text-surface-200 text-xs cursor-pointer hover:bg-surface-700 self-end"
        >
          Reset All
        </button>
      )}

      {/* --- Input Section (Stages 1-4) --- */}
      <Section title="Input">
        <Select<ColorSpaceString>
          label="Color Space"
          value={indexToColorSpace(settings.inputColorSpace)}
          options={colorSpaceOptions}
          onChange={(v) => set({ inputColorSpace: colorSpaceToIndex(v) })}
        />
        {/* BC Format is pipeline-specific (numeric), use inline select */}
        <div className="flex items-center gap-3">
          <div className="w-24 text-sm text-surface-300 truncate">BC Format</div>
          <select
            value={settings.bcFormat}
            onChange={(e) => set({ bcFormat: parseInt(e.target.value) })}
            className="flex-1 px-3 py-1.5 text-sm bg-surface-800 border border-surface-700 rounded text-surface-200 focus:outline-none focus:border-surface-500 cursor-pointer"
          >
            {BC_FORMATS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </Section>

      {/* --- Color Grading Section (Stage 5) --- */}
      <Section title="Color Grading">
        <Select<GradingSpaceString>
          label="Grading Space"
          value={indexToGradingSpace(settings.gradingSpace)}
          options={gradingSpaceOptions}
          onChange={(v) => set({ gradingSpace: gradingSpaceToIndex(v) })}
        />
        <Slider label="Exposure" value={settings.gradeExposure} min={-10} max={10} defaultValue={0} onChange={(v) => set({ gradeExposure: v })} />
        <Slider label="Contrast" value={settings.gradeContrast} min={0} max={3} defaultValue={1} onChange={(v) => set({ gradeContrast: v })} />
        <Slider label="Saturation" value={settings.gradeSaturation} min={0} max={3} defaultValue={1} onChange={(v) => set({ gradeSaturation: v })} />
        <Slider label="Temperature" value={settings.gradeTemperature} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeTemperature: v })} />
        <Slider label="Tint" value={settings.gradeTint} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeTint: v })} />
        <Slider label="Highlights" value={settings.gradeHighlights} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeHighlights: v })} />
        <Slider label="Shadows" value={settings.gradeShadows} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeShadows: v })} />
        <Slider label="Vibrance" value={settings.gradeVibrance} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeVibrance: v })} />

        <LiftGammaGain
          lift={settings.gradeLift}
          gamma={settings.gradeGamma}
          gain={settings.gradeGain}
          onLiftChange={(v) => set({ gradeLift: v })}
          onGammaChange={(v) => set({ gradeGamma: v })}
          onGainChange={(v) => set({ gradeGain: v })}
        />

        {/* Offset - individual R/G/B sliders */}
        <div className="space-y-1">
          <div className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Offset</div>
          <Slider label="R" value={settings.gradeOffset.x} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeOffset: { ...settings.gradeOffset, x: v } })} />
          <Slider label="G" value={settings.gradeOffset.y} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeOffset: { ...settings.gradeOffset, y: v } })} />
          <Slider label="B" value={settings.gradeOffset.z} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeOffset: { ...settings.gradeOffset, z: v } })} />
        </div>

        {/* Shadow Color - individual R/G/B sliders */}
        <div className="space-y-1">
          <div className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Shadow Color</div>
          <Slider label="R" value={settings.gradeShadowColor.x} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeShadowColor: { ...settings.gradeShadowColor, x: v } })} />
          <Slider label="G" value={settings.gradeShadowColor.y} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeShadowColor: { ...settings.gradeShadowColor, y: v } })} />
          <Slider label="B" value={settings.gradeShadowColor.z} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeShadowColor: { ...settings.gradeShadowColor, z: v } })} />
        </div>

        {/* Midtone Color - individual R/G/B sliders */}
        <div className="space-y-1">
          <div className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Midtone Color</div>
          <Slider label="R" value={settings.gradeMidtoneColor.x} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeMidtoneColor: { ...settings.gradeMidtoneColor, x: v } })} />
          <Slider label="G" value={settings.gradeMidtoneColor.y} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeMidtoneColor: { ...settings.gradeMidtoneColor, y: v } })} />
          <Slider label="B" value={settings.gradeMidtoneColor.z} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeMidtoneColor: { ...settings.gradeMidtoneColor, z: v } })} />
        </div>

        {/* Highlight Color - individual R/G/B sliders */}
        <div className="space-y-1">
          <div className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Highlight Color</div>
          <Slider label="R" value={settings.gradeHighlightColor.x} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeHighlightColor: { ...settings.gradeHighlightColor, x: v } })} />
          <Slider label="G" value={settings.gradeHighlightColor.y} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeHighlightColor: { ...settings.gradeHighlightColor, y: v } })} />
          <Slider label="B" value={settings.gradeHighlightColor.z} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeHighlightColor: { ...settings.gradeHighlightColor, z: v } })} />
        </div>

        <Slider label="HL Soft Clip" value={settings.gradeHighlightSoftClip} min={0} max={1} defaultValue={0} onChange={(v) => set({ gradeHighlightSoftClip: v })} />
        <Slider label="SH Soft Clip" value={settings.gradeShadowSoftClip} min={0} max={1} defaultValue={0} onChange={(v) => set({ gradeShadowSoftClip: v })} />
        <Slider label="HL Knee" value={settings.gradeHighlightKnee} min={0} max={4} defaultValue={1} onChange={(v) => set({ gradeHighlightKnee: v })} />
        <Slider label="SH Knee" value={settings.gradeShadowKnee} min={0} max={1} defaultValue={0.1} onChange={(v) => set({ gradeShadowKnee: v })} />
      </Section>

      {/* --- Tonemap Section (Stages 6-7) --- */}
      <Section title="Tonemap">
        <Select<TonemapString>
          label="Operator"
          value={indexToTonemap(settings.tonemapOperator)}
          options={tonemapOptions}
          onChange={(v) => set({ tonemapOperator: tonemapToIndex(v) })}
        />
        <Toggle label="RRT Enabled" value={settings.rrtEnabled} onChange={(v) => set({ rrtEnabled: v })} />
        <Toggle label="ODT Enabled" value={settings.odtEnabled} onChange={(v) => set({ odtEnabled: v })} />
        {/* ODT Target is pipeline-specific (numeric, 2 options), use inline select */}
        <div className="flex items-center gap-3">
          <div className="w-24 text-sm text-surface-300 truncate">ODT Target</div>
          <select
            value={settings.odtTarget}
            onChange={(e) => set({ odtTarget: parseInt(e.target.value) })}
            className="flex-1 px-3 py-1.5 text-sm bg-surface-800 border border-surface-700 rounded text-surface-200 focus:outline-none focus:border-surface-500 cursor-pointer"
          >
            {ODT_TARGETS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <Slider label="Exposure" value={settings.tonemapExposure} min={-10} max={10} defaultValue={0} onChange={(v) => set({ tonemapExposure: v })} />
        <Slider label="White Point" value={settings.tonemapWhitePoint} min={0.1} max={20} defaultValue={4} onChange={(v) => set({ tonemapWhitePoint: v })} />
        <Slider label="Peak Bright." value={settings.tonemapPeakBrightness} min={100} max={10000} step={10} decimals={0} defaultValue={1000} onChange={(v) => set({ tonemapPeakBrightness: v })} />
      </Section>

      {/* --- Output Section (Stages 8-9) --- */}
      <Section title="Output">
        <Select<ColorSpaceString>
          label="Output Space"
          value={indexToColorSpace(settings.outputSpace)}
          options={colorSpaceOptions}
          onChange={(v) => set({ outputSpace: colorSpaceToIndex(v) })}
        />
        <Slider label="Paper White" value={settings.outputPaperWhite} min={80} max={500} step={1} decimals={0} unit=" nits" defaultValue={200} onChange={(v) => set({ outputPaperWhite: v })} />
        <Slider label="Peak Bright." value={settings.outputPeakBrightness} min={100} max={10000} step={10} decimals={0} unit=" nits" defaultValue={1000} onChange={(v) => set({ outputPeakBrightness: v })} />
        <Slider label="Black Level" value={settings.outputBlackLevel} min={0} max={0.1} step={0.001} decimals={3} defaultValue={0} onChange={(v) => set({ outputBlackLevel: v })} />
        <Slider label="White Level" value={settings.outputWhiteLevel} min={0.5} max={2} defaultValue={1} onChange={(v) => set({ outputWhiteLevel: v })} />
      </Section>
    </div>
  );
}
