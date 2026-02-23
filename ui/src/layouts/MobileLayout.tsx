import { useState } from 'react'
import { LiftGammaGain } from '../components/LiftGammaGain'
import { ShadowMidHighlight } from '../components/ShadowMidHighlight'
import { Slider } from '../components/Slider'
import { Select } from '../components/Select'
import { PresetManager } from '../components/PresetManager'
import { InstanceSelector } from '../components/InstanceSelector'
import { cn } from '../lib/utils'
import type {
  ColorSpace,
  GradingSpace,
  TonemapOperator,
  ColorCorrectionSettings,
  TonemapSettings,
  Vector3,
  InstanceInfo,
  ServerInfo,
  DiscoveredServer,
} from '../types/settings'
import { URL_PATH } from '../hooks/useWebSocket'

type MobileTab = 'grade' | 'wheels' | 'output' | 'presets'

interface MobileLayoutProps {
  isConnected: boolean
  cc: ColorCorrectionSettings
  tm: TonemapSettings
  presetName: string
  isPresetDirty: boolean
  presets: string[]
  instances: InstanceInfo[]
  selectedInstanceId: string | null
  serverInfo: ServerInfo | null
  knownServers: DiscoveredServer[]
  colorSpaceOptions: { value: ColorSpace; label: string }[]
  gradingSpaceOptions: { value: GradingSpace; label: string }[]
  tonemapOptions: { value: TonemapOperator; label: string }[]
  updateColorCorrection: (patch: Partial<ColorCorrectionSettings>) => void
  updateTonemap: (patch: Partial<TonemapSettings>) => void
  handleLiftChange: (value: Vector3) => void
  handleGammaChange: (value: Vector3) => void
  handleGainChange: (value: Vector3) => void
  liftMaster: number
  gammaMaster: number
  gainMaster: number
  handleLiftMasterChange: (value: number) => void
  handleGammaMasterChange: (value: number) => void
  handleGainMasterChange: (value: number) => void
  loadPreset: (name: string) => void
  savePreset: (name: string) => void
  deletePreset: (name: string) => void
  reset: () => void
  selectInstance: (id: string) => void
}

const TABS: { id: MobileTab; label: string }[] = [
  { id: 'grade', label: 'Grade' },
  { id: 'wheels', label: 'Wheels' },
  { id: 'output', label: 'Output' },
  { id: 'presets', label: 'Presets' },
]

export function MobileLayout(props: MobileLayoutProps) {
  const [activeTab, setActiveTab] = useState<MobileTab>('grade')

  return (
    <div className="min-h-screen bg-surface-950 flex flex-col">
      {/* Compact header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-800">
        <h1 className="text-base font-semibold text-surface-100">HDR Grade</h1>
        <div
          className={cn(
            'w-2 h-2 rounded-full',
            props.isConnected ? 'bg-green-500' : 'bg-red-500'
          )}
        />
      </div>

      {/* Scrollable tab content */}
      <div className="flex-1 overflow-y-auto pb-16">
        <div className="px-4 py-3 space-y-4">
          {activeTab === 'grade' && <GradeTab {...props} />}
          {activeTab === 'wheels' && <WheelsTab {...props} />}
          {activeTab === 'output' && <OutputTab {...props} />}
          {activeTab === 'presets' && <PresetsTab {...props} />}
        </div>
      </div>

      {/* Fixed bottom tab bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-surface-900 border-t border-surface-700 safe-area-bottom">
        <div className="flex">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex-1 py-3 text-xs font-medium transition-colors',
                activeTab === tab.id
                  ? 'text-surface-100 bg-surface-800'
                  : 'text-surface-500'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function GradeTab(props: MobileLayoutProps) {
  const { cc, updateColorCorrection, colorSpaceOptions, gradingSpaceOptions } = props

  return (
    <>
      <Select mobile label="Input Space" value={cc.inputSpace} options={colorSpaceOptions} onChange={(v) => updateColorCorrection({ inputSpace: v })} />
      <Select mobile label="Grading Space" value={cc.gradingSpace} options={gradingSpaceOptions} onChange={(v) => updateColorCorrection({ gradingSpace: v })} />

      <Slider mobile label="Exposure" value={cc.exposure} min={-4} max={4} step={0.01} defaultValue={0} decimals={2} onChange={(v) => updateColorCorrection({ exposure: v })} />
      <Slider mobile label="Contrast" value={cc.contrast} min={0.75} max={1.5} step={0.01} defaultValue={1} decimals={2} onChange={(v) => updateColorCorrection({ contrast: v })} />
      <Slider mobile label="Saturation" value={cc.saturation} min={0.5} max={1.5} step={0.01} defaultValue={1} decimals={2} onChange={(v) => updateColorCorrection({ saturation: v })} />
      <Slider mobile label="Temperature" value={cc.temperature} min={-0.5} max={0.5} step={0.01} defaultValue={0} decimals={2} gradient="linear-gradient(to right, #4488ff, #ff8844)" onChange={(v) => updateColorCorrection({ temperature: v })} />
      <Slider mobile label="Tint" value={cc.tint} min={-0.5} max={0.5} step={0.01} defaultValue={0} decimals={2} gradient="linear-gradient(to right, #ff44ff, #44ff44)" onChange={(v) => updateColorCorrection({ tint: v })} />

      <div className="border-t border-surface-700 my-2" />

      <Slider mobile label="Highlights" value={cc.highlights} min={-1} max={1} step={0.01} defaultValue={0} decimals={2} onChange={(v) => updateColorCorrection({ highlights: v })} />
      <Slider mobile label="Shadows" value={cc.shadows} min={-1} max={1} step={0.01} defaultValue={0} decimals={2} onChange={(v) => updateColorCorrection({ shadows: v })} />
      <Slider mobile label="Vibrance" value={cc.vibrance} min={-1} max={2} step={0.01} defaultValue={0} decimals={2} onChange={(v) => updateColorCorrection({ vibrance: v })} />

      <div className="border-t border-surface-700 my-2" />

      <Slider mobile label="Vignette" value={cc.vignetteStrength} min={0} max={0.5} step={0.01} defaultValue={0} decimals={2} onChange={(v) => updateColorCorrection({ vignetteStrength: v })} />
      {cc.vignetteStrength > 0 && (
        <>
          <Slider mobile label="Radius" value={cc.vignetteRadius} min={0.4} max={0.85} step={0.01} defaultValue={0.7} decimals={2} onChange={(v) => updateColorCorrection({ vignetteRadius: v })} />
          <Slider mobile label="Softness" value={cc.vignetteSoftness} min={0} max={0.5} step={0.01} defaultValue={0.3} decimals={2} onChange={(v) => updateColorCorrection({ vignetteSoftness: v })} />
        </>
      )}
    </>
  )
}

function WheelsTab(props: MobileLayoutProps) {
  const { cc, updateColorCorrection, handleLiftChange, handleGammaChange, handleGainChange, liftMaster, gammaMaster, gainMaster, handleLiftMasterChange, handleGammaMasterChange, handleGainMasterChange } = props

  return (
    <>
      <LiftGammaGain
        mobile
        lift={cc.lift}
        gamma={cc.gamma}
        gain={cc.gain}
        onLiftChange={handleLiftChange}
        onGammaChange={handleGammaChange}
        onGainChange={handleGainChange}
      />
      <div className="space-y-3 mt-4">
        <Slider mobile label="Lift" value={liftMaster} min={-0.5} max={0.5} step={0.01} defaultValue={0} decimals={2} onChange={handleLiftMasterChange} />
        <Slider mobile label="Gamma" value={gammaMaster} min={0.75} max={1.5} step={0.01} defaultValue={1} decimals={2} onChange={handleGammaMasterChange} />
        <Slider mobile label="Gain" value={gainMaster} min={0.75} max={1.5} step={0.01} defaultValue={1} decimals={2} onChange={handleGainMasterChange} />
      </div>

      <div className="border-t border-surface-700 my-4" />

      <ShadowMidHighlight
        mobile
        shadowColor={cc.shadowColor}
        midtoneColor={cc.midtoneColor}
        highlightColor={cc.highlightColor}
        onShadowColorChange={(v) => updateColorCorrection({ shadowColor: v })}
        onMidtoneColorChange={(v) => updateColorCorrection({ midtoneColor: v })}
        onHighlightColorChange={(v) => updateColorCorrection({ highlightColor: v })}
      />
    </>
  )
}

function OutputTab(props: MobileLayoutProps) {
  const { tm, updateTonemap, tonemapOptions, colorSpaceOptions } = props

  return (
    <>
      <Select mobile label="Tonemap" value={tm.tonemap} options={tonemapOptions} onChange={(v) => updateTonemap({ tonemap: v })} />
      <Slider mobile label="Exposure" value={tm.exposure} min={-2} max={2} step={0.01} defaultValue={0} decimals={2} onChange={(v) => updateTonemap({ exposure: v })} />
      {tm.tonemap === 'ReinhardExtended' && (
        <Slider mobile label="White Point" value={tm.whitePoint} min={1} max={8} step={0.1} defaultValue={4} decimals={1} onChange={(v) => updateTonemap({ whitePoint: v })} />
      )}

      <div className="border-t border-surface-700 my-2" />

      <Select mobile label="Output Space" value={tm.outputSpace} options={colorSpaceOptions} onChange={(v) => updateTonemap({ outputSpace: v })} />

      {(tm.outputSpace === 'PQ_Rec2020' || tm.outputSpace === 'HLG_Rec2020' || tm.outputSpace === 'scRGB') && (<>
        <Slider mobile label="Paper White" value={tm.paperWhite} min={80} max={400} step={1} defaultValue={200} decimals={0} unit=" nits" onChange={(v) => updateTonemap({ paperWhite: v })} />
        <Slider mobile label="Peak Brightness" value={tm.peakBrightness} min={400} max={10000} step={100} defaultValue={1000} decimals={0} unit=" nits" onChange={(v) => updateTonemap({ peakBrightness: v })} />
      </>)}

      <div className="border-t border-surface-700 my-2" />

      <Slider mobile label="Black Level" value={tm.blackLevel} min={-0.25} max={0.25} step={0.001} defaultValue={0} decimals={3} onChange={(v) => updateTonemap({ blackLevel: v })} />
      <Slider mobile label="White Level" value={tm.whiteLevel} min={0.5} max={2} step={0.01} defaultValue={1} decimals={2} onChange={(v) => updateTonemap({ whiteLevel: v })} />
    </>
  )
}

function PresetsTab(props: MobileLayoutProps) {
  const { instances, selectedInstanceId, selectInstance, serverInfo, knownServers, presetName, isPresetDirty, presets, loadPreset, savePreset, deletePreset, reset } = props
  const hasSidebar = instances.length > 1
  const hasNetworkPeers = knownServers.length > 1

  return (
    <>
      {hasSidebar && (
        <InstanceSelector
          instances={instances}
          selectedInstanceId={selectedInstanceId}
          onSelectInstance={selectInstance}
          serverInfo={serverInfo}
        />
      )}

      <PresetManager
        activePresetName={presetName}
        isPresetDirty={isPresetDirty}
        presets={presets}
        onLoad={loadPreset}
        onSave={savePreset}
        onDelete={deletePreset}
        onReset={reset}
      />

      {hasNetworkPeers && (
        <div className="pt-4">
          <h2 className="text-[10px] font-semibold tracking-wider uppercase text-surface-500 mb-2">
            Network
          </h2>
          <div className="space-y-1">
            {knownServers.map((server) => {
              const isSelf = server.ip === serverInfo?.ip && server.path === serverInfo?.path
              const portSuffix = server.port === 80 ? '' : `:${server.port}`
              const serverPath = server.path || URL_PATH
              const serverUrl = `http://${server.ip}${portSuffix}/${serverPath}/`
              return (
                <div
                  key={`${server.ip}:${server.port}`}
                  className={cn(
                    'px-3 py-2 rounded-lg border text-xs',
                    isSelf
                      ? 'bg-surface-800 border-surface-600 text-surface-200'
                      : 'bg-surface-900/50 border-surface-800/50 text-surface-400'
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={cn(
                      'w-1.5 h-1.5 rounded-full flex-shrink-0',
                      server.isLeader ? 'bg-green-500' : 'bg-surface-500'
                    )} />
                    <span className="font-medium truncate">
                      {server.appName || server.hostname}
                    </span>
                    {isSelf && (
                      <span className="text-[9px] text-surface-500">(you)</span>
                    )}
                  </div>
                  {server.instanceCount > 0 && (
                    <div className="text-[10px] text-surface-500 ml-3 mt-0.5">
                      {server.instanceCount} instance{server.instanceCount !== 1 ? 's' : ''}
                    </div>
                  )}
                  {!isSelf && (
                    <a
                      href={serverUrl}
                      className="text-[10px] text-surface-500 hover:text-surface-300 ml-3 mt-0.5 block transition-colors"
                    >
                      Open
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
