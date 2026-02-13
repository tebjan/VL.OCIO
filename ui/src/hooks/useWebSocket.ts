import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectSettings, ColorCorrectionSettings, TonemapSettings, InstanceInfo, InstanceState } from '../types/settings'
import { createDefaultProject } from '../types/settings'

interface WebSocketState {
  isConnected: boolean
  settings: ProjectSettings
  presets: string[]
  // Multi-instance state
  instances: InstanceInfo[]
  selectedInstanceId: string | null
  instanceStates: Record<string, InstanceState>
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

// Default fallback - will be overridden by discovery file
const DEFAULT_PORT = 9999
const RECONNECT_DELAY_MIN = 500      // Start fast
const RECONNECT_DELAY_MAX = 5000     // Cap at 5 seconds
const PING_INTERVAL = 3000           // Ping every 3 seconds
const PONG_TIMEOUT = 5000            // Wait 5 seconds for pong
const DISCOVERY_CHECK_INTERVAL = 2000 // Check discovery file every 2 seconds

// Fetch the discovery file to get the actual server port
async function discoverServerPort(): Promise<number> {
  try {
    // Try to fetch discovery.json from the same origin (works when served by C# server)
    const response = await fetch('/discovery.json', { cache: 'no-store' })
    if (response.ok) {
      const data = await response.json()
      if (data.port && typeof data.port === 'number') {
        console.log(`[WebSocket] Discovered server on port ${data.port}`)
        return data.port
      }
    }
  } catch {
    // Discovery file not found or not served - use default
  }

  // Fallback: try default port
  console.log(`[WebSocket] Discovery failed, using default port ${DEFAULT_PORT}`)
  return DEFAULT_PORT
}

export function useWebSocket(): WebSocketState & WebSocketActions {
  const [isConnected, setIsConnected] = useState(false)
  const [settings, setSettings] = useState<ProjectSettings>(createDefaultProject())
  const [presets, setPresets] = useState<string[]>([])
  // Multi-instance state
  const [instances, setInstances] = useState<InstanceInfo[]>([])
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const [instanceStates, setInstanceStates] = useState<Record<string, InstanceState>>({})

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const pingIntervalRef = useRef<number | null>(null)
  const pongTimeoutRef = useRef<number | null>(null)
  const discoveryIntervalRef = useRef<number | null>(null)
  const reconnectDelayRef = useRef(RECONNECT_DELAY_MIN)
  const isConnectingRef = useRef(false)
  const mountedRef = useRef(true)
  const currentPortRef = useRef<number>(DEFAULT_PORT)
  // Track if we've received initial state from server - don't send updates until then
  const hasReceivedInitialStateRef = useRef(false)
  // Track selected instance for including in messages
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
    if (discoveryIntervalRef.current) {
      clearInterval(discoveryIntervalRef.current)
      discoveryIntervalRef.current = null
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

  const connect = useCallback(async () => {
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

      // Discover the server port
      const port = await discoverServerPort()
      currentPortRef.current = port
      const wsUrl = `ws://127.0.0.1:${port}`

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
            // Handle multi-instance state
            if (msg.instances) {
              setInstanceStates(msg.instances)
              if (msg.selectedInstanceId) {
                setSelectedInstanceId(msg.selectedInstanceId)
                selectedInstanceIdRef.current = msg.selectedInstanceId
              }
              // Update settings from selected instance for backward compatibility
              const selectedState = msg.instances[msg.selectedInstanceId || Object.keys(msg.instances)[0]]
              if (selectedState) {
                setSettings({
                  colorCorrection: selectedState.colorCorrection,
                  tonemap: selectedState.tonemap,
                  inputFilePath: selectedState.inputFilePath,
                  presetName: selectedState.presetName || ''
                })
              }
            } else if (msg.data) {
              // Legacy single-instance mode
              setSettings(msg.data)
            }
            hasReceivedInitialStateRef.current = true // Now safe to send updates
          } else if (msg.type === 'instancesChanged') {
            // Handle instance list changes
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

    // Periodically check discovery file in case server restarts on different port
    discoveryIntervalRef.current = window.setInterval(async () => {
      if (!mountedRef.current) return

      // Only check if disconnected
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        const newPort = await discoverServerPort()
        if (newPort !== currentPortRef.current) {
          console.log(`[WebSocket] Server port changed from ${currentPortRef.current} to ${newPort}`)
          currentPortRef.current = newPort
          // Trigger reconnect with new port
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current)
          }
          reconnectDelayRef.current = RECONNECT_DELAY_MIN
          connect()
        }
      }
    }, DISCOVERY_CHECK_INTERVAL)

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
    // Update settings from the selected instance
    const instanceState = instanceStates[instanceId]
    if (instanceState) {
      setSettings({
        colorCorrection: instanceState.colorCorrection,
        tonemap: instanceState.tonemap,
        inputFilePath: instanceState.inputFilePath,
        presetName: instanceState.presetName || ''
      })
    }
    // Notify server of selection change
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'selectInstance', instanceId }))
    }
  }, [instanceStates])

  return {
    isConnected,
    settings,
    presets,
    instances,
    selectedInstanceId,
    instanceStates,
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
