import { useEffect } from 'react'
import { useWebSocket, URL_PATH } from './hooks/useWebSocket'
import { useIsMobile } from './hooks/useIsMobile'
import { GradingPanel } from './components/GradingPanel'
import { PresetManager } from './components/PresetManager'
import { InstanceSelector } from './components/InstanceSelector'
import { BankPanel } from './components/BankPanel'
import { cn } from './lib/utils'
import { createDefaultProject } from './types/settings'

function App() {
  const isMobile = useIsMobile()
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
    deletePreset,
    reset,
    selectInstance,
    bankState,
    bankCopyFrom,
    bankSaveSnapshot,
    bankLoadSnapshot,
    bankDeleteSnapshot,
    bankReset,
    bankSetFriendlyName,
    bankSave,
    bankSelectEditingKey,
    bankUndo,
    bankRedo,
  } = useWebSocket()

  // Global keyboard shortcuts — Ctrl+Z / Ctrl+Shift+Z for bank undo/redo
  useEffect(() => {
    if (!bankState?.hasBank) return
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) bankRedo()
        else bankUndo()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault()
        bankRedo()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [bankState?.hasBank, bankUndo, bankRedo])

  // Default settings for fallback
  const defaultProject = createDefaultProject()

  // Disconnection overlay (shared between mobile and desktop)
  const disconnectOverlay = !isConnected && (
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
  )

  if (isMobile) {
    // Mobile: simple single-panel view from instance state (no bank key switching)
    return (
      <>
        {disconnectOverlay}
        <div className="p-2">
          <GradingPanel
            cc={settings.colorCorrection}
            tm={settings.tonemap}
            onUpdateCC={updateColorCorrection}
            onUpdateTM={updateTonemap}
            visible={true}
          />
        </div>
      </>
    )
  }

  // Build display URL: prefer mDNS, fall back to ip:port (for network access)
  const displayUrl = (() => {
    if (!serverInfo) return null
    if (serverInfo.mdnsUrl) return serverInfo.mdnsUrl
    const host = serverInfo.ip && serverInfo.ip !== '127.0.0.1'
      ? serverInfo.ip
      : serverInfo.hostname
    const portSuffix = serverInfo.port === 80 ? '' : `:${serverInfo.port}`
    const path = serverInfo.path || URL_PATH
    return `http://${host}${portSuffix}/${path}/`
  })()

  const hasSidebar = instances.length > 1
  const hasNetworkPeers = knownServers.length > 1

  return (
    <div className="min-h-screen bg-surface-950">
      {disconnectOverlay}

      <div className="max-w-2xl mx-auto p-4 relative">
        {/* Left sidebar — instances + network peers */}
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
        {/* Right sidebar 1 — snapshots/presets */}
        <div className="absolute left-full top-0 w-48 h-screen overflow-y-auto ml-2">
          <PresetManager
            activePresetName={settings.presetName}
            isPresetDirty={settings.isPresetDirty}
            presets={presets}
            onLoad={loadPreset}
            onSave={savePreset}
            onDelete={deletePreset}
            onReset={reset}
          />
        </div>
        {/* Right sidebar 2 — bank sequences (next to snapshots) */}
        {bankState?.hasBank && (
          <div className="absolute top-0 h-screen overflow-y-auto" style={{ left: 'calc(100% + 200px + 0.5rem)' }}>
            <div className="w-48">
              <BankPanel
                bankState={bankState}
                onCopyFrom={bankCopyFrom}
                onSaveSnapshot={bankSaveSnapshot}
                onLoadSnapshot={bankLoadSnapshot}
                onDeleteSnapshot={bankDeleteSnapshot}
                onReset={bankReset}
                onSave={bankSave}
                onSetFriendlyName={bankSetFriendlyName}
                onSelectEditingKey={bankSelectEditingKey}
                onUndo={bankUndo}
                onRedo={bankRedo}
              />
            </div>
          </div>
        )}
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
          {isConnected && displayUrl && serverInfo?.networkEnabled && (
            <span className="text-xs text-surface-500" title="Access from any device on the network">
              {displayUrl}
            </span>
          )}
        </div>

        {/* Main Content — one GradingPanel per bank key (or per instance when no bank) */}
        {bankState?.hasBank ? (
          // Bank active: render one panel per key, show/hide by editing key
          bankState.allKeys.map(key => {
            const ks = bankState.keySettings?.[key]
            return (
              <GradingPanel
                key={key}
                cc={ks?.colorCorrection ?? defaultProject.colorCorrection}
                tm={ks?.tonemap ?? defaultProject.tonemap}
                onUpdateCC={updateColorCorrection}
                onUpdateTM={updateTonemap}
                visible={key === bankState.editingKey}
              />
            )
          })
        ) : (
          // No bank: single panel from instance state
          <GradingPanel
            cc={settings.colorCorrection}
            tm={settings.tonemap}
            onUpdateCC={updateColorCorrection}
            onUpdateTM={updateTonemap}
            visible={true}
          />
        )}
      </div>
    </div>
  )
}

export default App
