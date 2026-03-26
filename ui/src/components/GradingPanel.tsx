import { useCallback, useEffect, useRef, useState } from 'react'
import { LiftGammaGain } from './LiftGammaGain'
import { ShadowMidHighlight } from './ShadowMidHighlight'
import { Slider } from './Slider'
import { Select } from './Select'
import { Section } from './Section'
import type {
  ColorCorrectionSettings,
  TonemapSettings,
  ColorSpace,
  GradingSpace,
  TonemapOperator,
  Vector3,
} from '../types/settings'
import {
  COLOR_SPACE_LABELS,
  GRADING_SPACE_LABELS,
  TONEMAP_LABELS,
} from '../types/settings'

const COLOR_SPACE_OPTIONS = Object.entries(COLOR_SPACE_LABELS).map(([value, label]) => ({
  value: value as ColorSpace,
  label,
}))

const GRADING_SPACE_OPTIONS = Object.entries(GRADING_SPACE_LABELS).map(([value, label]) => ({
  value: value as GradingSpace,
  label,
}))

const TONEMAP_OPTIONS = Object.entries(TONEMAP_LABELS).map(([value, label]) => ({
  value: value as TonemapOperator,
  label,
}))

interface GradingPanelProps {
  cc: ColorCorrectionSettings
  tm: TonemapSettings
  onUpdateCC: (params: Partial<ColorCorrectionSettings>) => void
  onUpdateTM: (params: Partial<TonemapSettings>) => void
  visible: boolean
}

export function GradingPanel({ cc, tm, onUpdateCC, onUpdateTM, visible }: GradingPanelProps) {
  // LGG handlers
  const handleLiftChange = useCallback(
    (value: Vector3) => onUpdateCC({ lift: value }),
    [onUpdateCC]
  )
  const handleGammaChange = useCallback(
    (value: Vector3) => onUpdateCC({ gamma: value }),
    [onUpdateCC]
  )
  const handleGainChange = useCallback(
    (value: Vector3) => onUpdateCC({ gain: value }),
    [onUpdateCC]
  )

  // Master controls for Lift/Gamma/Gain (relative, per-panel state)
  const [liftMaster, setLiftMaster] = useState(0)
  const [gammaMaster, setGammaMaster] = useState(1)
  const [gainMaster, setGainMaster] = useState(1)

  const liftMasterRef = useRef(0)
  const gammaMasterRef = useRef(1)
  const gainMasterRef = useRef(1)
  const latestLiftRef = useRef(cc.lift)
  const latestGammaRef = useRef(cc.gamma)
  const latestGainRef = useRef(cc.gain)

  // Sync refs from React state on each render
  useEffect(() => {
    latestLiftRef.current = cc.lift
    latestGammaRef.current = cc.gamma
    latestGainRef.current = cc.gain
  }, [cc.lift, cc.gamma, cc.gain])

  const handleLiftMasterChange = useCallback((newMaster: number) => {
    const delta = newMaster - liftMasterRef.current
    liftMasterRef.current = newMaster
    setLiftMaster(newMaster)
    const l = latestLiftRef.current
    const newLift = { x: l.x + delta, y: l.y + delta, z: l.z + delta }
    latestLiftRef.current = newLift
    onUpdateCC({ lift: newLift })
  }, [onUpdateCC])

  const handleGammaMasterChange = useCallback((newMaster: number) => {
    const old = gammaMasterRef.current
    const ratio = old !== 0 ? newMaster / old : newMaster
    gammaMasterRef.current = newMaster
    setGammaMaster(newMaster)
    const g = latestGammaRef.current
    const newGamma = { x: g.x * ratio, y: g.y * ratio, z: g.z * ratio }
    latestGammaRef.current = newGamma
    onUpdateCC({ gamma: newGamma })
  }, [onUpdateCC])

  const handleGainMasterChange = useCallback((newMaster: number) => {
    const old = gainMasterRef.current
    const ratio = old !== 0 ? newMaster / old : newMaster
    gainMasterRef.current = newMaster
    setGainMaster(newMaster)
    const g = latestGainRef.current
    const newGain = { x: g.x * ratio, y: g.y * ratio, z: g.z * ratio }
    latestGainRef.current = newGain
    onUpdateCC({ gain: newGain })
  }, [onUpdateCC])

  return (
    <div style={{ display: visible ? 'block' : 'none' }}>
      <div className="space-y-4">
        {/* ========== COLOR GRADING ========== */}
        <div className="bg-surface-900 rounded-lg p-4">
          <Section title="Color Grading">
            <div className="mb-4 space-y-3">
              <Select
                label="Input Space"
                value={cc.inputSpace}
                options={COLOR_SPACE_OPTIONS}
                onChange={(v) => onUpdateCC({ inputSpace: v })}
              />
              <Select
                label="Grading Space"
                value={cc.gradingSpace}
                options={GRADING_SPACE_OPTIONS}
                onChange={(v) => onUpdateCC({ gradingSpace: v })}
              />
            </div>
            <div className="mb-4">
              <LiftGammaGain
                lift={cc.lift}
                gamma={cc.gamma}
                gain={cc.gain}
                onLiftChange={handleLiftChange}
                onGammaChange={handleGammaChange}
                onGainChange={handleGainChange}
              />
            </div>

            <div className="space-y-2 mb-4">
              <Slider label="Lift" value={liftMaster} min={-0.5} max={0.5} step={0.01} defaultValue={0} decimals={2} onChange={handleLiftMasterChange} />
              <Slider label="Gamma" value={gammaMaster} min={0.75} max={1.5} step={0.01} defaultValue={1} decimals={2} onChange={handleGammaMasterChange} />
              <Slider label="Gain" value={gainMaster} min={0.75} max={1.5} step={0.01} defaultValue={1} decimals={2} onChange={handleGainMasterChange} />
            </div>

            <div className="mb-4">
              <ShadowMidHighlight
                shadowColor={cc.shadowColor}
                midtoneColor={cc.midtoneColor}
                highlightColor={cc.highlightColor}
                onShadowColorChange={(v) => onUpdateCC({ shadowColor: v })}
                onMidtoneColorChange={(v) => onUpdateCC({ midtoneColor: v })}
                onHighlightColorChange={(v) => onUpdateCC({ highlightColor: v })}
              />
            </div>

            <div className="space-y-2 mb-4">
              <Slider label="Exposure" value={cc.exposure} min={-4} max={4} step={0.01} defaultValue={0} decimals={2} onChange={(v) => onUpdateCC({ exposure: v })} />
              <Slider label="Contrast" value={cc.contrast} min={0.75} max={1.5} step={0.01} defaultValue={1} decimals={2} onChange={(v) => onUpdateCC({ contrast: v })} />
              <Slider label="Saturation" value={cc.saturation} min={0.5} max={1.5} step={0.01} defaultValue={1} decimals={2} onChange={(v) => onUpdateCC({ saturation: v })} />
            </div>

            <div className="space-y-2 mb-4">
              <Slider label="Temperature" value={cc.temperature} min={-0.5} max={0.5} step={0.01} defaultValue={0} decimals={2} gradient="linear-gradient(to right, #4488ff, #ff8844)" onChange={(v) => onUpdateCC({ temperature: v })} />
              <Slider label="Tint" value={cc.tint} min={-0.5} max={0.5} step={0.01} defaultValue={0} decimals={2} gradient="linear-gradient(to right, #ff44ff, #44ff44)" onChange={(v) => onUpdateCC({ tint: v })} />
            </div>

            <div className="space-y-2 mb-4">
              <Slider label="Highlights" value={cc.highlights} min={-1} max={1} step={0.01} defaultValue={0} decimals={2} onChange={(v) => onUpdateCC({ highlights: v })} />
              <Slider label="Shadows" value={cc.shadows} min={-1} max={1} step={0.01} defaultValue={0} decimals={2} onChange={(v) => onUpdateCC({ shadows: v })} />
              <Slider label="Vibrance" value={cc.vibrance} min={-1} max={2} step={0.01} defaultValue={0} decimals={2} onChange={(v) => onUpdateCC({ vibrance: v })} />
            </div>

          </Section>
        </div>

        {/* ========== VIGNETTE ========== */}
        <div className="bg-surface-900 rounded-lg p-4">
          <Section title="Vignette">
            <div className="space-y-2">
              <Slider label="Strength" value={cc.vignetteStrength} min={0} max={0.5} step={0.01} defaultValue={0} decimals={2} onChange={(v) => onUpdateCC({ vignetteStrength: v })} />
              <Slider label="Radius" value={cc.vignetteRadius} min={0.4} max={0.85} step={0.01} defaultValue={0.7} decimals={2} onChange={(v) => onUpdateCC({ vignetteRadius: v })} />
              <Slider label="Softness" value={cc.vignetteSoftness} min={0} max={0.5} step={0.01} defaultValue={0.3} decimals={2} onChange={(v) => onUpdateCC({ vignetteSoftness: v })} />
            </div>
          </Section>
        </div>

        {/* ========== HDR OUTPUT ========== */}
        <div className="bg-surface-900 rounded-lg p-4">
          <Section title="Display Output">
            <div className="space-y-3">
              <Select label="Tonemap" value={tm.tonemap} options={TONEMAP_OPTIONS} onChange={(v) => onUpdateTM({ tonemap: v })} />
              <Slider label="Exposure" value={tm.exposure} min={-2} max={2} step={0.01} defaultValue={0} decimals={2} onChange={(v) => onUpdateTM({ exposure: v })} />
              {tm.tonemap === 'ReinhardExtended' && (
                <Slider label="White Point" value={tm.whitePoint} min={1} max={8} step={0.1} defaultValue={4} decimals={1} onChange={(v) => onUpdateTM({ whitePoint: v })} />
              )}

              <div className="border-t border-surface-700 my-3" />

              <Select label="Output Space" value={tm.outputSpace} options={COLOR_SPACE_OPTIONS} onChange={(v) => onUpdateTM({ outputSpace: v })} />

              {(tm.outputSpace === 'PQ_Rec2020' || tm.outputSpace === 'HLG_Rec2020' || tm.outputSpace === 'scRGB') && (<>
                <Slider label="Paper White" value={tm.paperWhite} min={80} max={400} step={1} defaultValue={200} decimals={0} unit=" nits" onChange={(v) => onUpdateTM({ paperWhite: v })} />
                <Slider label="Peak Brightness" value={tm.peakBrightness} min={400} max={10000} step={100} defaultValue={1000} decimals={0} unit=" nits" onChange={(v) => onUpdateTM({ peakBrightness: v })} />
              </>)}

              <div className="border-t border-surface-700 my-3" />

              <Slider label="Black Level" value={tm.blackLevel} min={-0.25} max={0.25} step={0.001} defaultValue={0} decimals={3} onChange={(v) => onUpdateTM({ blackLevel: v })} />
              <Slider label="White Level" value={tm.whiteLevel} min={0.5} max={2} step={0.01} defaultValue={1} decimals={2} onChange={(v) => onUpdateTM({ whiteLevel: v })} />
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}
