import { useCallback, useEffect, useRef, useState } from 'react'
import type { Vector3 } from '../../types/settings'
import { cn, formatNumber } from '../../lib/utils'
import { wheelPosToChroma, chromaToWheelPos, decomposeRgb } from '../../lib/colorWheelMath'

interface ColorWheelProps {
  label: string
  value: Vector3
  defaultValue?: Vector3
  onChange: (value: Vector3) => void
  size?: number
  sensitivity: number
  defaultSensitivity: number
  onSensitivityChange: (value: number) => void
}

export function ColorWheel({
  label,
  value,
  defaultValue = { x: 0, y: 0, z: 0 },
  onChange,
  size = 160,
  sensitivity,
  defaultSensitivity,
  onSensitivityChange,
}: ColorWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Wheel position (normalized -1 to 1, clamped to unit circle)
  // SOURCE OF TRUTH for dot position during drag
  const [wheelPos, setWheelPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const prevSensitivityRef = useRef(sensitivity)

  const wheelSensitivity = Math.max(sensitivity, 0.01)

  // Compose final RGB: defaultValue + chromatic (from wheel) + achromatic (from master slider)
  const composeValue = useCallback(
    (pos: { x: number; y: number }, sens: number, achromatic: number): Vector3 => {
      const chroma = wheelPosToChroma(pos, sens)
      return {
        x: defaultValue.x + chroma.r + achromatic,
        y: defaultValue.y + chroma.g + achromatic,
        z: defaultValue.z + chroma.b + achromatic,
      }
    },
    [defaultValue]
  )

  // When sensitivity changes, recalculate RGB but preserve achromatic component
  useEffect(() => {
    if (prevSensitivityRef.current !== sensitivity) {
      prevSensitivityRef.current = sensitivity
      const { achromatic } = decomposeRgb(value, defaultValue)
      const newValue = composeValue(wheelPos, wheelSensitivity, achromatic)
      onChange(newValue)
    }
  }, [sensitivity, wheelPos, wheelSensitivity, value, defaultValue, composeValue, onChange])

  // Sync wheel position from external RGB changes (instance switch, preset load, master slider).
  // Skip during drag -- the drag handler sets wheelPos directly.
  useEffect(() => {
    if (isDragging) return

    const { chroma } = decomposeRgb(value, defaultValue)
    const pos = chromaToWheelPos(chroma.r, chroma.g, chroma.b, wheelSensitivity)
    setWheelPos(pos)
  }, [value.x, value.y, value.z, defaultValue.x, defaultValue.y, defaultValue.z, wheelSensitivity, isDragging])

  const drawWheel = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const centerX = size / 2
    const centerY = size / 2
    const radius = size / 2 - 8

    ctx.clearRect(0, 0, size, size)

    // Color wheel background: R at 0 (right), B at 120 CW, G at 240 CW
    const gradient = ctx.createConicGradient(0, centerX, centerY)
    gradient.addColorStop(0, '#ff4444')
    gradient.addColorStop(0.167, '#ff44ff')
    gradient.addColorStop(0.333, '#4444ff')
    gradient.addColorStop(0.5, '#44ffff')
    gradient.addColorStop(0.667, '#44ff44')
    gradient.addColorStop(0.833, '#ffff44')
    gradient.addColorStop(1, '#ff4444')

    ctx.beginPath()
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
    ctx.fillStyle = gradient
    ctx.globalAlpha = 0.55
    ctx.fill()
    ctx.globalAlpha = 1

    // Ring
    ctx.beginPath()
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
    ctx.strokeStyle = '#71717a'
    ctx.lineWidth = 2
    ctx.stroke()

    // Center crosshair
    ctx.beginPath()
    ctx.moveTo(centerX - 6, centerY)
    ctx.lineTo(centerX + 6, centerY)
    ctx.moveTo(centerX, centerY - 6)
    ctx.lineTo(centerX, centerY + 6)
    ctx.strokeStyle = '#71717a'
    ctx.lineWidth = 1
    ctx.stroke()

    // Dot at wheel position
    const dotX = centerX + wheelPos.x * radius
    const dotY = centerY + wheelPos.y * radius

    ctx.beginPath()
    ctx.arc(dotX, dotY, 8, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
    ctx.fill()

    ctx.beginPath()
    ctx.arc(dotX, dotY, 5, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.strokeStyle = '#27272a'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }, [size, wheelPos])

  useEffect(() => {
    drawWheel()
  }, [drawWheel])

  const updateFromPointerEvent = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const centerX = size / 2
      const centerY = size / 2
      const radius = size / 2 - 8

      let x = (clientX - rect.left - centerX) / radius
      let y = (clientY - rect.top - centerY) / radius

      const dist = Math.sqrt(x * x + y * y)
      if (dist > 1) {
        x /= dist
        y /= dist
      }

      setWheelPos({ x, y })

      // Preserve any achromatic offset from master slider
      const { achromatic } = decomposeRgb(value, defaultValue)
      const newValue = composeValue({ x, y }, wheelSensitivity, achromatic)
      onChange(newValue)
    },
    [size, wheelSensitivity, value, defaultValue, composeValue, onChange]
  )

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
    updateFromPointerEvent(e.clientX, e.clientY)
  }, [updateFromPointerEvent])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging) return
    updateFromPointerEvent(e.clientX, e.clientY)
  }, [isDragging, updateFromPointerEvent])

  const handlePointerUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleReset = useCallback(() => {
    setWheelPos({ x: 0, y: 0 })
    onChange(defaultValue)
  }, [onChange, defaultValue])

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-xs font-medium text-surface-400 uppercase tracking-wider">
        {label}
      </div>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className={cn(
          'cursor-crosshair rounded-full',
          isDragging && 'cursor-grabbing'
        )}
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleReset}
      />
      <div className="flex text-[10px] font-mono">
        <span className="text-red-400 w-10 text-right">{formatNumber(value.x, 3)}</span>
        <span className="text-green-400 w-10 text-right">{formatNumber(value.y, 3)}</span>
        <span className="text-blue-400 w-10 text-right">{formatNumber(value.z, 3)}</span>
      </div>
      <div className="flex items-center gap-1 mt-1">
        <span className="text-[10px] text-surface-500">Sens</span>
        <input
          type="range"
          min={0.01}
          max={0.5}
          step={0.01}
          value={sensitivity}
          onChange={(e) => onSensitivityChange(parseFloat(e.target.value))}
          onDoubleClick={() => onSensitivityChange(defaultSensitivity)}
          className="w-16 h-3"
        />
        <span className="text-[10px] text-surface-500 w-6">{formatNumber(sensitivity, 2)}</span>
      </div>
    </div>
  )
}
