import { useCallback, useEffect, useRef, useState } from 'react'
import type { Vector3 } from '../types/settings'
import { cn, formatNumber } from '../lib/utils'

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

  // Store the wheel position (normalized -1 to 1, clamped to unit circle)
  // This is the SOURCE OF TRUTH for dot position - sensitivity only scales RGB output
  const [wheelPos, setWheelPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const prevSensitivityRef = useRef(sensitivity)

  // Sensitivity scales the RGB output at wheel edge
  const wheelSensitivity = Math.max(sensitivity, 0.01)

  // Convert wheel position to RGB offset
  const positionToRgb = useCallback((px: number, py: number, sens: number): Vector3 => {
    // Clamp to unit circle
    let dist = Math.sqrt(px * px + py * py)
    if (dist > 1) {
      px /= dist
      py /= dist
      dist = 1
    }

    // Convert from canvas coordinates back to standard math angle
    const angle = Math.atan2(-py, px)
    // Scale by sensitivity (wheel edge = sens RGB offset)
    const mag = dist * sens

    // Project onto RGB axes: R at 0°, G at 120°, B at 240°
    const r = mag * Math.cos(angle)
    const g = mag * Math.cos(angle - 2.094)  // angle - 120°
    const b = mag * Math.cos(angle - 4.189)  // angle - 240°

    return {
      x: defaultValue.x + r,
      y: defaultValue.y + g,
      z: defaultValue.z + b,
    }
  }, [defaultValue])

  // When sensitivity changes, update RGB values but keep dot position
  useEffect(() => {
    if (prevSensitivityRef.current !== sensitivity) {
      prevSensitivityRef.current = sensitivity
      // Recalculate RGB from current wheel position with new sensitivity
      const newRgb = positionToRgb(wheelPos.x, wheelPos.y, wheelSensitivity)
      onChange(newRgb)
    }
  }, [sensitivity, wheelPos, wheelSensitivity, positionToRgb, onChange])

  // Initialize wheel position from initial RGB value (only once on mount)
  useEffect(() => {
    const r = value.x - defaultValue.x
    const g = value.y - defaultValue.y
    const b = value.z - defaultValue.z

    const angle = Math.atan2(
      0.866 * (g - b),
      r - 0.5 * g - 0.5 * b
    )
    const rgbMag = Math.sqrt(r * r + g * g + b * b)
    const normalizedMag = Math.min(rgbMag / wheelSensitivity, 1)

    const x = normalizedMag * Math.cos(angle)
    const y = -normalizedMag * Math.sin(angle)

    setWheelPos({ x, y })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount

  const drawWheel = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const centerX = size / 2
    const centerY = size / 2
    const radius = size / 2 - 8

    // Clear
    ctx.clearRect(0, 0, size, size)

    // Draw color wheel background
    // Conic gradient starts at 3 o'clock (0°) and goes clockwise
    // But canvas Y is inverted, so visually it goes counter-clockwise
    // Our RGB positions: R at 0° (right), G at 120° (top-left), B at 240° (bottom-left)
    // In conic gradient with inverted Y: 0=right, 0.33=bottom-left, 0.67=top-left
    const gradient = ctx.createConicGradient(0, centerX, centerY)
    gradient.addColorStop(0, '#ff4444')      // Red at 0° (right)
    gradient.addColorStop(0.167, '#ff44ff')  // Magenta
    gradient.addColorStop(0.333, '#4444ff')  // Blue at 120° CW = 240° CCW (bottom-left visually)
    gradient.addColorStop(0.5, '#44ffff')    // Cyan
    gradient.addColorStop(0.667, '#44ff44')  // Green at 240° CW = 120° CCW (top-left visually)
    gradient.addColorStop(0.833, '#ffff44')  // Yellow
    gradient.addColorStop(1, '#ff4444')      // Red

    ctx.beginPath()
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
    ctx.fillStyle = gradient
    ctx.globalAlpha = 0.55
    ctx.fill()
    ctx.globalAlpha = 1

    // Draw ring
    ctx.beginPath()
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
    ctx.strokeStyle = '#71717a'
    ctx.lineWidth = 2
    ctx.stroke()

    // Draw center crosshair
    ctx.beginPath()
    ctx.moveTo(centerX - 6, centerY)
    ctx.lineTo(centerX + 6, centerY)
    ctx.moveTo(centerX, centerY - 6)
    ctx.lineTo(centerX, centerY + 6)
    ctx.strokeStyle = '#71717a'
    ctx.lineWidth = 1
    ctx.stroke()

    // Draw current position (use stored wheel position, not derived from RGB)
    const dotX = centerX + wheelPos.x * radius
    const dotY = centerY + wheelPos.y * radius

    // Outer glow
    ctx.beginPath()
    ctx.arc(dotX, dotY, 8, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
    ctx.fill()

    // Inner dot
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

  const updateFromMouseEvent = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const centerX = size / 2
      const centerY = size / 2
      const radius = size / 2 - 8

      let x = (clientX - rect.left - centerX) / radius
      let y = (clientY - rect.top - centerY) / radius

      // Clamp to unit circle
      const dist = Math.sqrt(x * x + y * y)
      if (dist > 1) {
        x /= dist
        y /= dist
      }

      // Update wheel position (dot stays where you put it)
      setWheelPos({ x, y })

      // Calculate RGB from new position
      const newValue = positionToRgb(x, y, wheelSensitivity)
      onChange(newValue)
    },
    [size, positionToRgb, wheelSensitivity, onChange]
  )

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    setIsDragging(true)
    updateFromMouseEvent(e.clientX, e.clientY)
  }, [updateFromMouseEvent])

  // Global mouse move/up handlers for drag outside canvas
  useEffect(() => {
    if (!isDragging) return

    const handleGlobalMouseMove = (e: MouseEvent) => {
      updateFromMouseEvent(e.clientX, e.clientY)
    }

    const handleGlobalMouseUp = () => {
      setIsDragging(false)
    }

    window.addEventListener('mousemove', handleGlobalMouseMove)
    window.addEventListener('mouseup', handleGlobalMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove)
      window.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [isDragging, updateFromMouseEvent])

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
        onMouseDown={handleMouseDown}
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
