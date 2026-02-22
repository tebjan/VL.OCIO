import { useCallback, useState } from 'react';
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
import { Section, Slider, Select, LiftGammaGain } from './ui';
import { Toggle } from './Toggle';

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

  // Master controls for Lift/Gamma/Gain (affects all RGB channels uniformly)
  const [liftMaster, setLiftMaster] = useState(0);
  const [gammaMaster, setGammaMaster] = useState(1);
  const [gainMaster, setGainMaster] = useState(1);

  const handleLiftMasterChange = useCallback((newMaster: number) => {
    const delta = newMaster - liftMaster;
    setLiftMaster(newMaster);
    set({
      gradeLift: {
        x: settings.gradeLift.x + delta,
        y: settings.gradeLift.y + delta,
        z: settings.gradeLift.z + delta,
      },
    });
  }, [settings.gradeLift, liftMaster]);

  const handleGammaMasterChange = useCallback((newMaster: number) => {
    const ratio = gammaMaster !== 0 ? newMaster / gammaMaster : newMaster;
    setGammaMaster(newMaster);
    set({
      gradeGamma: {
        x: settings.gradeGamma.x * ratio,
        y: settings.gradeGamma.y * ratio,
        z: settings.gradeGamma.z * ratio,
      },
    });
  }, [settings.gradeGamma, gammaMaster]);

  const handleGainMasterChange = useCallback((newMaster: number) => {
    const ratio = gainMaster !== 0 ? newMaster / gainMaster : newMaster;
    setGainMaster(newMaster);
    set({
      gradeGain: {
        x: settings.gradeGain.x * ratio,
        y: settings.gradeGain.y * ratio,
        z: settings.gradeGain.z * ratio,
      },
    });
  }, [settings.gradeGain, gainMaster]);

  return (
    <div className="w-80 min-w-64 h-full overflow-y-auto bg-surface-950 border-l border-surface-700 shrink-0">
      <div className="p-3 space-y-4">

        {/* ========== PIPELINE ========== */}
        <div className="bg-surface-900 rounded-lg p-3">
          <Section title="Pipeline" defaultOpen>
            <div className="space-y-3">
              <div title="Color space of the source image before any transforms">
                <Select<ColorSpaceString> mobile label="Input Space" value={indexToColorSpace(settings.inputColorSpace)} options={colorSpaceOptions} onChange={(v) => set({ inputColorSpace: colorSpaceToIndex(v) })} />
              </div>

              <div className="flex flex-col gap-1">
                <div className="text-sm text-surface-300">BC Format</div>
                <select
                  value={settings.bcFormat}
                  onChange={(e) => set({ bcFormat: parseInt(e.target.value) })}
                  title="Block compression format used for GPU texture encoding"
                  className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded text-surface-200 focus:outline-none focus:border-surface-500 cursor-pointer"
                >
                  {BC_FORMATS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <Toggle label="vvvv viewer" value={settings.applySRGB} onChange={(v) => set({ applySRGB: v })} title="Simulate vvvv's sRGB viewer transform (applies gamma for correct display)" />
              <Toggle label="RRT Enabled" value={settings.rrtEnabled} onChange={(v) => set({ rrtEnabled: v })} title="Enable/disable the Reference Rendering Transform stage" />
              <Toggle label="ODT Enabled" value={settings.odtEnabled} onChange={(v) => set({ odtEnabled: v })} title="Enable/disable the Output Device Transform stage" />

              <div className="flex flex-col gap-1">
                <div className="text-sm text-surface-300">ODT Target</div>
                <select
                  value={settings.odtTarget}
                  onChange={(e) => set({ odtTarget: parseInt(e.target.value) })}
                  title="Target display standard for the Output Device Transform"
                  className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded text-surface-200 focus:outline-none focus:border-surface-500 cursor-pointer"
                >
                  {ODT_TARGETS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {onReset && (
                <button
                  onClick={onReset}
                  title="Reset all settings to their default values"
                  className="w-full px-3 py-1.5 bg-surface-800 border border-surface-600 rounded text-surface-200 text-xs cursor-pointer hover:bg-surface-700"
                >
                  Reset All
                </button>
              )}
            </div>
          </Section>
        </div>

        {/* ========== COLOR GRADING ========== */}
        <div className="bg-surface-900 rounded-lg p-3" title="Creative color correction applied in the working color space">
          <Section title="Color Grading" defaultOpen={false}>
            <div className="mb-4 space-y-3">
              <div title="Log (ACEScct) for colorist workflow, Linear (ACEScg) for VFX compositing">
                <Select<GradingSpaceString> mobile label="Grading Space" value={indexToGradingSpace(settings.gradingSpace)} options={gradingSpaceOptions} onChange={(v) => set({ gradingSpace: gradingSpaceToIndex(v) })} />
              </div>
            </div>
            <div className="mb-4">
              <LiftGammaGain
                mobile
                lift={settings.gradeLift}
                gamma={settings.gradeGamma}
                gain={settings.gradeGain}
                onLiftChange={(v) => set({ gradeLift: v })}
                onGammaChange={(v) => set({ gradeGamma: v })}
                onGainChange={(v) => set({ gradeGain: v })}
              />
            </div>

            <div className="space-y-2 mb-4">
              <Slider mobile label="Lift" value={liftMaster} min={-0.5} max={0.5} step={0.01} defaultValue={0} decimals={2} onChange={handleLiftMasterChange} />
              <Slider mobile label="Gamma" value={gammaMaster} min={0.75} max={1.5} step={0.01} defaultValue={1} decimals={2} onChange={handleGammaMasterChange} />
              <Slider mobile label="Gain" value={gainMaster} min={0.75} max={1.5} step={0.01} defaultValue={1} decimals={2} onChange={handleGainMasterChange} />
            </div>

            <div className="space-y-2 mb-4">
              <Slider mobile label="Exposure" value={settings.gradeExposure} min={-4} max={4} step={0.01} defaultValue={0} decimals={2} onChange={(v) => set({ gradeExposure: v })} />
              <Slider mobile label="Contrast" value={settings.gradeContrast} min={0.75} max={1.5} step={0.01} defaultValue={1} decimals={2} onChange={(v) => set({ gradeContrast: v })} />
              <Slider mobile label="Saturation" value={settings.gradeSaturation} min={0.5} max={1.5} step={0.01} defaultValue={1} decimals={2} onChange={(v) => set({ gradeSaturation: v })} />
            </div>

            <div className="space-y-2 mb-4">
              <Slider mobile label="Temperature" value={settings.gradeTemperature} min={-0.5} max={0.5} step={0.01} defaultValue={0} decimals={2} gradient="linear-gradient(to right, #4488ff, #ff8844)" onChange={(v) => set({ gradeTemperature: v })} />
              <Slider mobile label="Tint" value={settings.gradeTint} min={-0.5} max={0.5} step={0.01} defaultValue={0} decimals={2} gradient="linear-gradient(to right, #ff44ff, #44ff44)" onChange={(v) => set({ gradeTint: v })} />
            </div>

            <div className="space-y-2 mb-4">
              <Slider mobile label="Highlights" value={settings.gradeHighlights} min={-1} max={1} step={0.01} defaultValue={0} decimals={2} onChange={(v) => set({ gradeHighlights: v })} />
              <Slider mobile label="Shadows" value={settings.gradeShadows} min={-1} max={1} step={0.01} defaultValue={0} decimals={2} onChange={(v) => set({ gradeShadows: v })} />
              <Slider mobile label="Vibrance" value={settings.gradeVibrance} min={-1} max={2} step={0.01} defaultValue={0} decimals={2} onChange={(v) => set({ gradeVibrance: v })} />
            </div>

            <div className="space-y-2 mb-4">
              <Slider mobile label="Offset R" value={settings.gradeOffset.x} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeOffset: { ...settings.gradeOffset, x: v } })} />
              <Slider mobile label="Offset G" value={settings.gradeOffset.y} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeOffset: { ...settings.gradeOffset, y: v } })} />
              <Slider mobile label="Offset B" value={settings.gradeOffset.z} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeOffset: { ...settings.gradeOffset, z: v } })} />
            </div>

            <div className="space-y-2 mb-4">
              <Slider mobile label="SH Color R" value={settings.gradeShadowColor.x} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeShadowColor: { ...settings.gradeShadowColor, x: v } })} />
              <Slider mobile label="SH Color G" value={settings.gradeShadowColor.y} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeShadowColor: { ...settings.gradeShadowColor, y: v } })} />
              <Slider mobile label="SH Color B" value={settings.gradeShadowColor.z} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeShadowColor: { ...settings.gradeShadowColor, z: v } })} />
            </div>

            <div className="space-y-2 mb-4">
              <Slider mobile label="Mid Color R" value={settings.gradeMidtoneColor.x} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeMidtoneColor: { ...settings.gradeMidtoneColor, x: v } })} />
              <Slider mobile label="Mid Color G" value={settings.gradeMidtoneColor.y} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeMidtoneColor: { ...settings.gradeMidtoneColor, y: v } })} />
              <Slider mobile label="Mid Color B" value={settings.gradeMidtoneColor.z} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeMidtoneColor: { ...settings.gradeMidtoneColor, z: v } })} />
            </div>

            <div className="space-y-2 mb-4">
              <Slider mobile label="HL Color R" value={settings.gradeHighlightColor.x} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeHighlightColor: { ...settings.gradeHighlightColor, x: v } })} />
              <Slider mobile label="HL Color G" value={settings.gradeHighlightColor.y} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeHighlightColor: { ...settings.gradeHighlightColor, y: v } })} />
              <Slider mobile label="HL Color B" value={settings.gradeHighlightColor.z} min={-1} max={1} defaultValue={0} onChange={(v) => set({ gradeHighlightColor: { ...settings.gradeHighlightColor, z: v } })} />
            </div>

            <div className="space-y-2">
              <div title="Softly compresses highlight values to prevent harsh clipping">
                <Slider mobile label="HL Soft Clip" value={settings.gradeHighlightSoftClip} min={0} max={1} step={0.01} defaultValue={0} decimals={2} onChange={(v) => set({ gradeHighlightSoftClip: v })} />
              </div>
              <div title="Softly compresses shadow values to prevent crushing blacks">
                <Slider mobile label="SH Soft Clip" value={settings.gradeShadowSoftClip} min={0} max={1} step={0.01} defaultValue={0} decimals={2} onChange={(v) => set({ gradeShadowSoftClip: v })} />
              </div>
              <div title="Controls the transition curve for highlight soft clipping">
                <Slider mobile label="HL Knee" value={settings.gradeHighlightKnee} min={0} max={4} step={0.01} defaultValue={1} decimals={2} onChange={(v) => set({ gradeHighlightKnee: v })} />
              </div>
              <div title="Controls the transition curve for shadow soft clipping">
                <Slider mobile label="SH Knee" value={settings.gradeShadowKnee} min={0} max={1} step={0.01} defaultValue={0.1} decimals={2} onChange={(v) => set({ gradeShadowKnee: v })} />
              </div>
            </div>
          </Section>
        </div>

        {/* ========== DISPLAY OUTPUT ========== */}
        <div className="bg-surface-900 rounded-lg p-3">
          <Section title="Display Output">
            <div className="space-y-3">
              <div title="Tone mapping operator that compresses HDR to displayable range">
                <Select<TonemapString> mobile label="Tonemap" value={indexToTonemap(settings.tonemapOperator)} options={tonemapOptions} onChange={(v) => set({ tonemapOperator: tonemapToIndex(v) })} />
              </div>
              <div title="Pre-tonemap exposure adjustment in stops">
                <Slider mobile label="Exposure" value={settings.tonemapExposure} min={-2} max={2} step={0.01} defaultValue={0} decimals={2} onChange={(v) => set({ tonemapExposure: v })} />
              </div>
              <div title="Maximum scene brightness mapped to display white (Reinhard parameter)">
                <Slider mobile label="White Point" value={settings.tonemapWhitePoint} min={1} max={8} step={0.1} defaultValue={4} decimals={1} onChange={(v) => set({ tonemapWhitePoint: v })} />
              </div>

              <div className="border-t border-surface-700 my-1" />

              <div title="Color space and transfer function for final output encoding">
                <Select<ColorSpaceString> mobile label="Output Space" value={indexToColorSpace(settings.outputSpace)} options={colorSpaceOptions} onChange={(v) => set({ outputSpace: colorSpaceToIndex(v) })} />
              </div>

              <div title="Reference white brightness for HDR output (nits)">
                <Slider mobile label="Paper White" value={settings.outputPaperWhite} min={80} max={400} step={1} defaultValue={200} decimals={0} unit=" nits" onChange={(v) => set({ outputPaperWhite: v })} />
              </div>
              <div title="Maximum display brightness for HDR tone mapping (nits)">
                <Slider mobile label="Peak Brightness" value={settings.tonemapPeakBrightness} min={400} max={10000} step={100} defaultValue={1000} decimals={0} unit=" nits" onChange={(v) => set({ tonemapPeakBrightness: v })} />
              </div>

              <div className="border-t border-surface-700 my-1" />

              <div title="Adjusts output black point (lift shadows or crush blacks)">
                <Slider mobile label="Black Level" value={settings.outputBlackLevel} min={-0.25} max={0.25} step={0.001} defaultValue={0} decimals={3} onChange={(v) => set({ outputBlackLevel: v })} />
              </div>
              <div title="Adjusts output white point (scale peak output)">
                <Slider mobile label="White Level" value={settings.outputWhiteLevel} min={0.5} max={2} step={0.01} defaultValue={1} decimals={2} onChange={(v) => set({ outputWhiteLevel: v })} />
              </div>
            </div>
          </Section>
        </div>

      </div>
    </div>
  );
}
