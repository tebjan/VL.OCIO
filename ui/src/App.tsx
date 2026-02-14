import { useCallback, useEffect, useState } from 'react'
import { useWebSocket, URL_PATH } from './hooks/useWebSocket'
import { LiftGammaGain } from './components/LiftGammaGain'
import { Slider } from './components/Slider'
import { Select } from './components/Select'
import { Section } from './components/Section'
import { PresetManager } from './components/PresetManager'
import { InstanceSelector } from './components/InstanceSelector'
import { cn } from './lib/utils'
import {
  COLOR_SPACE_LABELS,
  DISPLAY_FORMAT_LABELS,
  GRADING_SPACE_LABELS,
  TONEMAP_LABELS,
  type ColorSpace,
  type DisplayFormat,
  type GradingSpace,
  type TonemapOperator,
  type Vector3,
} from './types/settings'

const COLOR_SPACE_OPTIONS = Object.entries(COLOR_SPACE_LABELS).map(([value, label]) => ({
  value: value as ColorSpace,
  label,
}))

const DISPLAY_FORMAT_OPTIONS = Object.entries(DISPLAY_FORMAT_LABELS).map(([value, label]) => ({
  value: value as DisplayFormat,
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

function App() {
  const {
    isConnected,
    settings,
    presets,
    instances,
    selectedInstanceId,
    serverInfo,
    knownServers,
    updateColorCorrection,
    updateTonemap,
    loadPreset,
    savePreset,
    reset,
    selectInstance,
  } = useWebSocket()

  const cc = settings.colorCorrection
  const tm = settings.tonemap

  // Color correction handlers
  const handleLiftChange = useCallback(
    (value: Vector3) => updateColorCorrection({ lift: value }),
    [updateColorCorrection]
  )

  const handleGammaChange = useCallback(
    (value: Vector3) => updateColorCorrection({ gamma: value }),
    [updateColorCorrection]
  )

  const handleGainChange = useCallback(
    (value: Vector3) => updateColorCorrection({ gain: value }),
    [updateColorCorrection]
  )

  // Master controls for Lift/Gamma/Gain (affects all RGB channels uniformly)
  const [liftMaster, setLiftMaster] = useState(0)
  const [gammaMaster, setGammaMaster] = useState(1)
  const [gainMaster, setGainMaster] = useState(1)

  // Reset master sliders when switching instances (they're relative controls)
  useEffect(() => {
    setLiftMaster(0)
    setGammaMaster(1)
    setGainMaster(1)
  }, [selectedInstanceId])

  const handleLiftMasterChange = useCallback((newMaster: number) => {
    const delta = newMaster - liftMaster
    setLiftMaster(newMaster)
    updateColorCorrection({
      lift: {
        x: cc.lift.x + delta,
        y: cc.lift.y + delta,
        z: cc.lift.z + delta,
      }
    })
  }, [cc.lift, liftMaster, updateColorCorrection])

  const handleGammaMasterChange = useCallback((newMaster: number) => {
    const ratio = gammaMaster !== 0 ? newMaster / gammaMaster : newMaster
    setGammaMaster(newMaster)
    updateColorCorrection({
      gamma: {
        x: cc.gamma.x * ratio,
        y: cc.gamma.y * ratio,
        z: cc.gamma.z * ratio,
      }
    })
  }, [cc.gamma, gammaMaster, updateColorCorrection])

  const handleGainMasterChange = useCallback((newMaster: number) => {
    const ratio = gainMaster !== 0 ? newMaster / gainMaster : newMaster
    setGainMaster(newMaster)
    updateColorCorrection({
      gain: {
        x: cc.gain.x * ratio,
        y: cc.gain.y * ratio,
        z: cc.gain.z * ratio,
      }
    })
  }, [cc.gain, gainMaster, updateColorCorrection])

  // When grading output space changes, also update tonemap input space
  const handleGradingOutputChange = useCallback(
    (value: ColorSpace) => {
      updateColorCorrection({ outputSpace: value })
      updateTonemap({ inputSpace: value })
    },
    [updateColorCorrection, updateTonemap]
  )

  // Build display URL: prefer mDNS, fall back to ip:port (for network access)
  const displayUrl = (() => {
    if (!serverInfo) return null
    if (serverInfo.mdnsUrl) return serverInfo.mdnsUrl
    // Use IP for network URL (hostname may not resolve on other machines)
    const host = serverInfo.ip && serverInfo.ip !== '127.0.0.1'
      ? serverInfo.ip
      : serverInfo.hostname
    // Suppress :80 since it's the HTTP default
    const portSuffix = serverInfo.port === 80 ? '' : `:${serverInfo.port}`
    const path = serverInfo.path || URL_PATH
    return `http://${host}${portSuffix}/${path}/`
  })()

  const hasSidebar = instances.length > 1
  const hasNetworkPeers = knownServers.length > 1

  return (
    <div className="min-h-screen bg-surface-950">
      {/* Disconnection overlay */}
      {!isConnected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 backdrop-blur-sm">
          <div className="bg-surface-900 rounded-xl p-8 max-w-sm mx-4 text-center border border-surface-700">
            <div className="w-10 h-10 mx-auto mb-4 rounded-full border-2 border-surface-500 border-t-surface-200 animate-spin" style={{ animationDuration: '2.5s' }} />
            <h2 className="text-lg font-semibold text-surface-100 mb-2">
              Connecting to server...
            </h2>
            <p className="text-sm text-surface-400">
              Waiting for the vvvv ColorGradingServer to start.
            </p>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto p-4 relative">
        {/* Left sidebar — instances + network peers, anchored to left edge of center block */}
        {(hasSidebar || hasNetworkPeers) && (
          <div className="absolute right-full top-0 w-52 h-screen overflow-y-auto mr-2">
            {hasSidebar && (
              <InstanceSelector
                instances={instances}
                selectedInstanceId={selectedInstanceId}
                onSelectInstance={selectInstance}
                serverInfo={serverInfo}
              />
            )}
            {/* Network peers discovered via mDNS */}
            {hasNetworkPeers && (
              <div className="px-4 pt-4">
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
                            Open →
                          </a>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        {/* Right sidebar — snapshots/presets */}
        <div className="absolute left-full top-0 w-48 h-screen overflow-y-auto ml-2">
          <PresetManager
            activePresetName={settings.presetName}
            isPresetDirty={settings.isPresetDirty}
            presets={presets}
            onLoad={loadPreset}
            onSave={savePreset}
            onReset={reset}
          />
        </div>
        {/* Header Row - Title, Status */}
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-lg font-semibold text-surface-100">
            HDR Color Grading
          </h1>
          <div
            className={cn(
              'w-2 h-2 rounded-full',
              isConnected ? 'bg-green-500' : 'bg-red-500'
            )}
            title={isConnected ? 'Connected' : 'Disconnected'}
          />
          {/* Show network URL so users on other machines know where to connect */}
          {isConnected && displayUrl && serverInfo?.networkEnabled && (
            <span className="text-xs text-surface-500" title="Access from any device on the network">
              {displayUrl}
            </span>
          )}
        </div>

        {/* Main Content */}
        <div className="space-y-4">
          {/* ========== COLOR GRADING ========== */}
          <div className="bg-surface-900 rounded-lg p-4">
            <Section title="Color Grading">
              {/* Input Color Space & Grading Space */}
              <div className="mb-4 space-y-3">
                <Select
                  label="Input Space"
                  value={cc.inputSpace}
                  options={COLOR_SPACE_OPTIONS}
                  onChange={(v) => updateColorCorrection({ inputSpace: v })}
                />
                <Select
                  label="Grading Space"
                  value={cc.gradingSpace}
                  options={GRADING_SPACE_OPTIONS}
                  onChange={(v) => updateColorCorrection({ gradingSpace: v })}
                />
              </div>
              {/* Color Wheels */}
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

              {/* Lift/Gamma/Gain Master Sliders */}
              <div className="space-y-2 mb-4">
                <Slider
                  label="Lift"
                  value={liftMaster}
                  min={-1}
                  max={1}
                  step={0.01}
                  defaultValue={0}
                  decimals={2}
                  onChange={handleLiftMasterChange}
                />
                <Slider
                  label="Gamma"
                  value={gammaMaster}
                  min={0.5}
                  max={2}
                  step={0.01}
                  defaultValue={1}
                  decimals={2}
                  onChange={handleGammaMasterChange}
                />
                <Slider
                  label="Gain"
                  value={gainMaster}
                  min={0.5}
                  max={2}
                  step={0.01}
                  defaultValue={1}
                  decimals={2}
                  onChange={handleGainMasterChange}
                />
              </div>

              {/* Basic Adjustments */}
              <div className="space-y-2 mb-4">
                <Slider
                  label="Exposure"
                  value={cc.exposure}
                  min={-8}
                  max={8}
                  step={0.01}
                  defaultValue={0}
                  decimals={2}
                  onChange={(v) => updateColorCorrection({ exposure: v })}
                />
                <Slider
                  label="Contrast"
                  value={cc.contrast}
                  min={0.5}
                  max={2}
                  step={0.01}
                  defaultValue={1}
                  decimals={2}
                  onChange={(v) => updateColorCorrection({ contrast: v })}
                />
                <Slider
                  label="Saturation"
                  value={cc.saturation}
                  min={0}
                  max={2}
                  step={0.01}
                  defaultValue={1}
                  decimals={2}
                  onChange={(v) => updateColorCorrection({ saturation: v })}
                />
              </div>

              {/* White Balance */}
              <div className="space-y-2 mb-4">
                <Slider
                  label="Temperature"
                  value={cc.temperature}
                  min={-1}
                  max={1}
                  step={0.01}
                  defaultValue={0}
                  decimals={2}
                  gradient="linear-gradient(to right, #4488ff, #ff8844)"
                  onChange={(v) => updateColorCorrection({ temperature: v })}
                />
                <Slider
                  label="Tint"
                  value={cc.tint}
                  min={-1}
                  max={1}
                  step={0.01}
                  defaultValue={0}
                  decimals={2}
                  gradient="linear-gradient(to right, #ff44ff, #44ff44)"
                  onChange={(v) => updateColorCorrection({ tint: v })}
                />
              </div>

              {/* Grading Output Space */}
              <Select
                label="Output Space"
                value={cc.outputSpace}
                options={COLOR_SPACE_OPTIONS}
                onChange={handleGradingOutputChange}
              />
            </Section>
          </div>

          {/* ========== HDR OUTPUT ========== */}
          <div className="bg-surface-900 rounded-lg p-4">
            <Section title="Display Output">
              <div className="space-y-3">
                <Select
                  label="Tonemap"
                  value={tm.tonemap}
                  options={TONEMAP_OPTIONS}
                  onChange={(v) => updateTonemap({ tonemap: v })}
                />
                <Slider
                  label="Exposure"
                  value={tm.exposure}
                  min={-4}
                  max={4}
                  step={0.01}
                  defaultValue={0}
                  decimals={2}
                  onChange={(v) => updateTonemap({ exposure: v })}
                />
                <Slider
                  label="White Point"
                  value={tm.whitePoint}
                  min={1}
                  max={16}
                  step={0.1}
                  defaultValue={4}
                  decimals={1}
                  onChange={(v) => updateTonemap({ whitePoint: v })}
                />

                <div className="border-t border-surface-700 my-3" />

                <Select
                  label="Display Format"
                  value={tm.outputSpace}
                  options={DISPLAY_FORMAT_OPTIONS}
                  onChange={(v) => updateTonemap({ outputSpace: v })}
                />

                {/* HDR-specific options - only show for HDR formats */}
                {(tm.outputSpace === 'linear_Rec709' || tm.outputSpace === 'pQ_Rec2020') && (
                  <div className="space-y-2 mt-3 p-3 bg-surface-800 rounded">
                    <div className="text-xs text-surface-400 mb-2">HDR Settings</div>
                    <Slider
                      label="Paper White"
                      value={tm.paperWhite}
                      min={80}
                      max={400}
                      step={1}
                      defaultValue={200}
                      decimals={0}
                      unit=" nits"
                      onChange={(v) => updateTonemap({ paperWhite: v })}
                    />
                    <Slider
                      label="Peak Brightness"
                      value={tm.peakBrightness}
                      min={400}
                      max={10000}
                      step={100}
                      defaultValue={1000}
                      decimals={0}
                      unit=" nits"
                      onChange={(v) => updateTonemap({ peakBrightness: v })}
                    />
                  </div>
                )}
              </div>
            </Section>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
