import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectSettings, ColorCorrectionSettings, TonemapSettings, InstanceInfo, InstanceState, ServerInfo } from '../types/settings'
import { createDefaultProject } from '../types/settings'

interface WebSocketState {
  isConnected: boolean
  settings: ProjectSettings
  presets: string[]
  // Multi-instance state
  instances: InstanceInfo[]
  selectedInstanceId: string | null
  instanceStates: Record<string, InstanceState>
  serverInfo: ServerInfo | null
}

interface WebSocketActions {
  updateColorCorrection: (params: Partial<ColorCorrectionSettings>) => void
  updateTonemap: (params: Partial<TonemapSettings>) => void
  setInputFile: (path: string) => void
  browseFile: () => void
  loadPreset: (name: string) => void
  savePreset: (name: string) => void
  listPresets: () => void
  reset: () => void
  // Multi-instance actions
  selectInstance: (instanceId: string) => void
}

// Default fallback port for Vite dev mode
const DEFAULT_PORT = 9999
const RECONNECT_DELAY_MIN = 500
const RECONNECT_DELAY_MAX = 5000
const PING_INTERVAL = 3000
const PONG_TIMEOUT = 5000

/**
 * Get the WebSocket URL based on how the UI is being served.
 * - Production (embedded in C# server): use same origin as the page (works on any machine/IP)
 * - Dev mode (Vite on port 5173/3000): connect directly to C# server on DEFAULT_PORT
 */
function getWebSocketUrl(): string {
  const loc = window.location
  const host = loc.hostname || '127.0.0.1'
  const port = loc.port || '80'

  // Vite dev mode: dev server runs on 5173 (default) or 3000
  if (port === '5173' || port === '3000') {
    return `ws://${host}:${DEFAULT_PORT}`
  }

  // Production: UI is served by the C# server, so same origin works.
  // This handles localhost, LAN IPs, hostnames — whatever the browser used to reach us.
  return `ws://${host}:${port}`
}

export function useWebSocket(): WebSocketState & WebSocketActions {
  const [isConnected, setIsConnected] = useState(false)
  const [settings, setSettings] = useState<ProjectSettings>(createDefaultProject())
  const [presets, setPresets] = useState<string[]>([])
  // Multi-instance state
  const [instances, setInstances] = useState<InstanceInfo[]>([])
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const [instanceStates, setInstanceStates] = useState<Record<string, InstanceState>>({})
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const pingIntervalRef = useRef<number | null>(null)
  const pongTimeoutRef = useRef<number | null>(null)
  const reconnectDelayRef = useRef(RECONNECT_DELAY_MIN)
  const isConnectingRef = useRef(false)
  const mountedRef = useRef(true)
  // Track if we've received initial state from server - don't send updates until then
  const hasReceivedInitialStateRef = useRef(false)
  // Track selected instance for including in messages
  const selectedInstanceIdRef = useRef<string | null>(null)
  // Ref mirror of instanceStates to avoid stale closures in message handlers
  const instanceStatesRef = useRef<Record<string, InstanceState>>({})

  // Keep ref in sync with state
  useEffect(() => {
    instanceStatesRef.current = instanceStates
  }, [instanceStates])

  // Clear all timers
  const clearTimers = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current)
      pingIntervalRef.current = null
    }
    if (pongTimeoutRef.current) {
      clearTimeout(pongTimeoutRef.current)
      pongTimeoutRef.current = null
    }
  }, [])

  // Schedule reconnection with exponential backoff
  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return

    clearTimers()
    reconnectTimeoutRef.current = window.setTimeout(() => {
      if (mountedRef.current) {
        connect()
      }
    }, reconnectDelayRef.current)

    // Exponential backoff with cap
    reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 1.5, RECONNECT_DELAY_MAX)
  }, [])

  // Start ping/pong heartbeat
  const startHeartbeat = useCallback((ws: WebSocket) => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current)
    }

    pingIntervalRef.current = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        // Send ping
        try {
          ws.send(JSON.stringify({ type: 'ping' }))
        } catch {
          // Send failed, connection is dead
          ws.close()
          return
        }

        // Set timeout for pong response
        if (pongTimeoutRef.current) {
          clearTimeout(pongTimeoutRef.current)
        }
        pongTimeoutRef.current = window.setTimeout(() => {
          // No pong received, connection is dead
          console.warn('WebSocket: No pong received, closing connection')
          ws.close()
        }, PONG_TIMEOUT)
      }
    }, PING_INTERVAL)
  }, [])

  /**
   * Apply settings from an instance state to the UI.
   * Used when switching instances or when server pushes a new selection.
   */
  const applyInstanceSettings = useCallback((state: InstanceState) => {
    setSettings({
      colorCorrection: state.colorCorrection,
      tonemap: state.tonemap,
      inputFilePath: state.inputFilePath,
      presetName: state.presetName || ''
    })
  }, [])

  const connect = useCallback(() => {
    // Prevent multiple simultaneous connection attempts
    if (isConnectingRef.current) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return

    isConnectingRef.current = true

    try {
      // Clean up any existing socket
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.onerror = null
        wsRef.current.onmessage = null
        wsRef.current.onopen = null
        try { wsRef.current.close() } catch { /* ignore */ }
        wsRef.current = null
      }

      const wsUrl = getWebSocketUrl()
      console.log(`[WebSocket] Connecting to ${wsUrl}`)
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        if (!mountedRef.current) {
          ws.close()
          return
        }

        isConnectingRef.current = false
        setIsConnected(true)
        reconnectDelayRef.current = RECONNECT_DELAY_MIN // Reset backoff on success
        hasReceivedInitialStateRef.current = false // Wait for server to send state

        // Start heartbeat
        startHeartbeat(ws)

        // Server sends state automatically on connect, no need to request
        // Just request preset list as a backup
        ws.send(JSON.stringify({ type: 'listPresets' }))
      }

      ws.onclose = () => {
        isConnectingRef.current = false
        setIsConnected(false)
        wsRef.current = null
        hasReceivedInitialStateRef.current = false // Reset on disconnect
        clearTimers()

        // Schedule reconnection
        if (mountedRef.current) {
          scheduleReconnect()
        }
      }

      ws.onerror = () => {
        // Error will trigger onclose, no need to do anything here
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)

          // Handle pong - clear the timeout
          if (msg.type === 'pong') {
            if (pongTimeoutRef.current) {
              clearTimeout(pongTimeoutRef.current)
              pongTimeoutRef.current = null
            }
            return
          }

          if (msg.type === 'state') {
            // Extract server info if present
            if (msg.serverInfo) {
              setServerInfo(msg.serverInfo)
            }

            // Handle multi-instance state
            if (msg.instances) {
              setInstanceStates(msg.instances)
              instanceStatesRef.current = msg.instances
              if (msg.selectedInstanceId) {
                setSelectedInstanceId(msg.selectedInstanceId)
                selectedInstanceIdRef.current = msg.selectedInstanceId
              }
              // Update settings from selected instance
              const selectedId = msg.selectedInstanceId || Object.keys(msg.instances)[0]
              const selectedState = msg.instances[selectedId]
              if (selectedState) {
                applyInstanceSettings(selectedState)
              }
            } else if (msg.data) {
              // Legacy single-instance mode
              setSettings(msg.data)
            }
            hasReceivedInitialStateRef.current = true // Now safe to send updates
          } else if (msg.type === 'instancesChanged') {
            // Handle instance list changes (e.g. instance added/removed)
            if (msg.instances) {
              setInstances(msg.instances)
            }
            if (msg.selectedInstanceId) {
              const newId = msg.selectedInstanceId
              const oldId = selectedInstanceIdRef.current

              setSelectedInstanceId(newId)
              selectedInstanceIdRef.current = newId

              // If selection changed, load the new instance's settings from cache
              if (newId !== oldId) {
                const cachedState = instanceStatesRef.current[newId]
                if (cachedState) {
                  applyInstanceSettings(cachedState)
                }
                // Also request fresh state from server to ensure cache is up-to-date
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ type: 'getState' }))
                }
              }
            }
          } else if (msg.type === 'presets' && msg.list) {
            setPresets(msg.list)
          }
        } catch (e) {
          console.error('Failed to parse message:', e)
        }
      }

      wsRef.current = ws
    } catch (e) {
      console.error('WebSocket connection failed:', e)
      isConnectingRef.current = false
      scheduleReconnect()
    }
  }, [clearTimers, scheduleReconnect, startHeartbeat, applyInstanceSettings])

  useEffect(() => {
    mountedRef.current = true

    // Start connection
    connect()

    return () => {
      mountedRef.current = false
      clearTimers()
      if (wsRef.current) {
        wsRef.current.onclose = null // Prevent reconnect on unmount
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connect, clearTimers])

  const send = useCallback((data: object) => {
    // Only send updates after we've received initial state from server
    if (wsRef.current?.readyState === WebSocket.OPEN && hasReceivedInitialStateRef.current) {
      // Include instanceId in all messages if we have a selected instance
      const messageWithInstance = selectedInstanceIdRef.current
        ? { ...data, instanceId: selectedInstanceIdRef.current }
        : data
      wsRef.current.send(JSON.stringify(messageWithInstance))
    }
  }, [])

  const updateColorCorrection = useCallback(
    (params: Partial<ColorCorrectionSettings>) => {
      send({ type: 'update', section: 'colorCorrection', params })
      // Optimistic update
      setSettings((prev) => ({
        ...prev,
        colorCorrection: { ...prev.colorCorrection, ...params },
      }))
    },
    [send]
  )

  const updateTonemap = useCallback(
    (params: Partial<TonemapSettings>) => {
      send({ type: 'update', section: 'tonemap', params })
      // Optimistic update
      setSettings((prev) => ({
        ...prev,
        tonemap: { ...prev.tonemap, ...params },
      }))
    },
    [send]
  )

  const setInputFile = useCallback(
    (path: string) => {
      send({ type: 'setInputFile', path })
      setSettings((prev) => ({ ...prev, inputFilePath: path }))
    },
    [send]
  )

  const loadPreset = useCallback(
    (name: string) => {
      send({ type: 'loadPreset', name })
    },
    [send]
  )

  const savePreset = useCallback(
    (name: string) => {
      send({ type: 'savePreset', name })
      setSettings((prev) => ({ ...prev, presetName: name }))
    },
    [send]
  )

  const listPresets = useCallback(() => {
    send({ type: 'listPresets' })
  }, [send])

  const reset = useCallback(() => {
    send({ type: 'reset' })
  }, [send])

  const browseFile = useCallback(() => {
    send({ type: 'browseFile' })
  }, [send])

  const selectInstance = useCallback((instanceId: string) => {
    setSelectedInstanceId(instanceId)
    selectedInstanceIdRef.current = instanceId
    // Update settings from the cached instance state
    const cachedState = instanceStatesRef.current[instanceId]
    if (cachedState) {
      applyInstanceSettings(cachedState)
    }
    // Notify server of selection change
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'selectInstance', instanceId }))
    }
  }, [applyInstanceSettings])

  return {
    isConnected,
    settings,
    presets,
    instances,
    selectedInstanceId,
    instanceStates,
    serverInfo,
    updateColorCorrection,
    updateTonemap,
    setInputFile,
    browseFile,
    loadPreset,
    savePreset,
    listPresets,
    reset,
    selectInstance,
  }
}
