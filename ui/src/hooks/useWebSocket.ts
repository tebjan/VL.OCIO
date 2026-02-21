import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectSettings, ColorCorrectionSettings, TonemapSettings, InstanceInfo, InstanceState, ServerInfo, DiscoveredServer } from '../types/settings'
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
  knownServers: DiscoveredServer[]
  stateVersion: number
}

interface WebSocketActions {
  updateColorCorrection: (params: Partial<ColorCorrectionSettings>) => void
  updateTonemap: (params: Partial<TonemapSettings>) => void
  loadPreset: (name: string) => void
  savePreset: (name: string) => void
  deletePreset: (name: string) => void
  listPresets: () => void
  reset: () => void
  // Multi-instance actions
  selectInstance: (instanceId: string) => void
}

// Base URL path — used for fallback and directory links
export const URL_PATH = 'grade'
const RECONNECT_DELAY_MIN = 500
const RECONNECT_DELAY_MAX = 5000
const PING_INTERVAL = 3000
const PONG_TIMEOUT = 5000

/**
 * Get the WebSocket URL based on how the UI is being served.
 * - Production: derive from window.location.pathname (matches the HTTP prefix)
 * - Dev mode (Vite on port 5173/3000): connect to C# server, use ?path= query param
 */
function getWebSocketUrl(): string {
  const loc = window.location
  const host = loc.hostname || '127.0.0.1'
  const port = loc.port || '80'

  // Vite dev mode: dev server runs on 5173 (default) or 3000
  if (port === '5173' || port === '3000') {
    const devPath = new URLSearchParams(loc.search).get('path') || URL_PATH
    return `ws://${host}:80/${devPath}/`
  }

  // Production: derive WebSocket path from current page URL
  // Page at /grade/machine/app/ → ws://host/grade/machine/app/
  // loc.host already includes port when non-standard (e.g. "127.0.0.1:9000")
  const basePath = loc.pathname.replace(/^\/+|\/+$/g, '') || URL_PATH
  const wsProtocol = loc.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${wsProtocol}//${loc.host}/${basePath}/`
}

export function useWebSocket(): WebSocketState & WebSocketActions {
  const [isConnected, setIsConnected] = useState(false)
  const [presets, setPresets] = useState<string[]>([])
  // Multi-instance state — single source of truth, one complete state per instance
  const [instances, setInstances] = useState<InstanceInfo[]>([])
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const [instanceStates, setInstanceStates] = useState<Record<string, InstanceState>>({})
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null)
  const [knownServers, setKnownServers] = useState<DiscoveredServer[]>([])
  const [stateVersion, setStateVersion] = useState(0)

  // Derive settings for the selected instance — no separate settings state
  const settings: ProjectSettings = useMemo(() => {
    if (selectedInstanceId && instanceStates[selectedInstanceId]) {
      const state = instanceStates[selectedInstanceId]
      return {
        colorCorrection: state.colorCorrection,
        tonemap: state.tonemap,
        inputFilePath: state.inputFilePath,
        presetName: state.presetName || '',
        isPresetDirty: state.isPresetDirty ?? false,
      }
    }
    return createDefaultProject()
  }, [selectedInstanceId, instanceStates])

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const pingIntervalRef = useRef<number | null>(null)
  const pongTimeoutRef = useRef<number | null>(null)
  const reconnectDelayRef = useRef(RECONNECT_DELAY_MIN)
  const isConnectingRef = useRef(false)
  const mountedRef = useRef(true)
  // Track if we've received initial state from server - don't send updates until then
  const hasReceivedInitialStateRef = useRef(false)
  // Track selected instance for including in messages (ref to avoid stale closures)
  const selectedInstanceIdRef = useRef<string | null>(null)

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

          // Handle redirect — server is switching network mode, navigate to new URL
          if (msg.type === 'redirect' && msg.url) {
            console.log('Server redirect:', msg.url)
            // Prevent reconnect attempts on the old URL
            mountedRef.current = false
            clearTimers()
            if (wsRef.current) {
              wsRef.current.onclose = null
              try { wsRef.current.close() } catch { /* ignore */ }
            }
            window.location.href = msg.url
            return
          }

          if (msg.type === 'state') {
            // Extract server info if present
            if (msg.serverInfo) {
              setServerInfo(msg.serverInfo)
            }

            // Update all instance states from server (authoritative)
            if (msg.instances) {
              setInstanceStates(msg.instances)
            }

            // Update selected instance ID
            if (msg.selectedInstanceId) {
              setSelectedInstanceId(msg.selectedInstanceId)
              selectedInstanceIdRef.current = msg.selectedInstanceId
            }

            // Update known servers (mDNS discovery)
            if (msg.knownServers) {
              setKnownServers(msg.knownServers)
            }

            hasReceivedInitialStateRef.current = true
            setStateVersion(v => v + 1)
          } else if (msg.type === 'instancesChanged') {
            // Handle instance list changes (e.g. instance added/removed)
            if (msg.instances) {
              setInstances(msg.instances)
            }
            if (msg.selectedInstanceId) {
              setSelectedInstanceId(msg.selectedInstanceId)
              selectedInstanceIdRef.current = msg.selectedInstanceId
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
  }, [clearTimers, scheduleReconnect, startHeartbeat])

  useEffect(() => {
    mountedRef.current = true

    // Start connection
    connect()

    // Reconnect immediately when tab becomes visible or regains focus.
    // Background tabs get their timers throttled by the browser (Chrome: once/min),
    // so the normal reconnect loop may be too slow when the server restarts.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && mountedRef.current) {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          reconnectDelayRef.current = RECONNECT_DELAY_MIN
          connect()
        }
      }
    }
    const handleFocus = () => {
      if (mountedRef.current && (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)) {
        reconnectDelayRef.current = RECONNECT_DELAY_MIN
        connect()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleFocus)

    return () => {
      mountedRef.current = false
      clearTimers()
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleFocus)
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

  // Update color correction — modifies the selected instance's state directly
  const updateColorCorrection = useCallback(
    (params: Partial<ColorCorrectionSettings>) => {
      send({ type: 'update', section: 'colorCorrection', params })
      setInstanceStates((prev) => {
        const id = selectedInstanceIdRef.current
        if (!id || !prev[id]) return prev
        return {
          ...prev,
          [id]: {
            ...prev[id],
            colorCorrection: { ...prev[id].colorCorrection, ...params },
            isPresetDirty: prev[id].presetName ? true : prev[id].isPresetDirty,
          },
        }
      })
    },
    [send]
  )

  // Update tonemap — modifies the selected instance's state directly
  const updateTonemap = useCallback(
    (params: Partial<TonemapSettings>) => {
      send({ type: 'update', section: 'tonemap', params })
      setInstanceStates((prev) => {
        const id = selectedInstanceIdRef.current
        if (!id || !prev[id]) return prev
        return {
          ...prev,
          [id]: {
            ...prev[id],
            tonemap: { ...prev[id].tonemap, ...params },
            isPresetDirty: prev[id].presetName ? true : prev[id].isPresetDirty,
          },
        }
      })
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
    },
    [send]
  )

  const deletePreset = useCallback(
    (name: string) => {
      send({ type: 'deletePreset', name })
    },
    [send]
  )

  const listPresets = useCallback(() => {
    send({ type: 'listPresets' })
  }, [send])

  const reset = useCallback(() => {
    send({ type: 'reset' })
  }, [send])

  // Select instance — just change the ID, state is already in instanceStates
  const selectInstance = useCallback((instanceId: string) => {
    setSelectedInstanceId(instanceId)
    selectedInstanceIdRef.current = instanceId
    // Notify server of selection change
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'selectInstance', instanceId }))
    }
  }, [])

  return {
    isConnected,
    settings,
    presets,
    instances,
    selectedInstanceId,
    instanceStates,
    serverInfo,
    knownServers,
    stateVersion,
    updateColorCorrection,
    updateTonemap,
    loadPreset,
    savePreset,
    deletePreset,
    listPresets,
    reset,
    selectInstance,
  }
}
