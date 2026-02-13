import { useCallback, useState } from 'react'
import { cn, formatNumber } from '../lib/utils'

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  defaultValue?: number
  decimals?: number
  unit?: string
  onChange: (value: number) => void
  gradient?: string
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  defaultValue,
  decimals = 2,
  unit = '',
  onChange,
  gradient,
}: SliderProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [inputValue, setInputValue] = useState('')

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(parseFloat(e.target.value))
    },
    [onChange]
  )

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
  }, [])

  const handleInputBlur = useCallback(() => {
    setIsEditing(false)
    const parsed = parseFloat(inputValue)
    if (!isNaN(parsed)) {
      onChange(Math.min(Math.max(parsed, min), max))
    }
  }, [inputValue, onChange, min, max])

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleInputBlur()
      } else if (e.key === 'Escape') {
        setIsEditing(false)
      }
    },
    [handleInputBlur]
  )

  const handleValueClick = useCallback(() => {
    setInputValue(formatNumber(value, decimals))
    setIsEditing(true)
  }, [value, decimals])

  const handleDoubleClick = useCallback(() => {
    if (defaultValue !== undefined) {
      onChange(defaultValue)
    }
  }, [defaultValue, onChange])

  const percentage = ((value - min) / (max - min)) * 100

  return (
    <div className="flex items-center gap-3 group">
      <div className="w-24 text-sm text-surface-300 truncate">{label}</div>
      <div className="flex-1 flex items-center">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleSliderChange}
          onDoubleClick={handleDoubleClick}
          className={cn('w-full h-4', gradient && 'gradient-track')}
          style={
            gradient
              ? { '--slider-gradient': gradient } as React.CSSProperties
              : { '--slider-gradient': `linear-gradient(to right, #71717a ${percentage}%, #3f3f46 ${percentage}%)` } as React.CSSProperties
          }
        />
      </div>
      {isEditing ? (
        <input
          type="number"
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onKeyDown={handleInputKeyDown}
          autoFocus
          className={cn(
            'w-20 px-2 py-0.5 text-sm font-mono text-right',
            'bg-surface-800 border border-surface-600 rounded',
            'focus:outline-none focus:border-surface-400'
          )}
        />
      ) : (
        <div
          onClick={handleValueClick}
          className={cn(
            'w-20 px-2 py-0.5 text-sm font-mono text-right text-surface-300',
            'rounded cursor-text hover:bg-surface-800 transition-colors'
          )}
        >
          {formatNumber(value, decimals)}{unit}
        </div>
      )}
    </div>
  )
}
