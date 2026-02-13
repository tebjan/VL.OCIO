import { useCallback, useState } from 'react'
import { cn } from '../lib/utils'

interface PresetManagerProps {
  currentPreset: string
  presets: string[]
  onLoad: (name: string) => void
  onSave: (name: string) => void
  onReset: () => void
  compact?: boolean
}

export function PresetManager({
  currentPreset,
  presets,
  onLoad,
  onSave,
  onReset,
  compact = false,
}: PresetManagerProps) {
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [newPresetName, setNewPresetName] = useState('')

  const handleSave = useCallback(() => {
    if (newPresetName.trim()) {
      onSave(newPresetName.trim())
      setNewPresetName('')
      setShowSaveDialog(false)
    }
  }, [newPresetName, onSave])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleSave()
      } else if (e.key === 'Escape') {
        setShowSaveDialog(false)
      }
    },
    [handleSave]
  )

  const textSize = compact ? 'text-xs' : 'text-sm'
  const padding = compact ? 'px-2 py-1' : 'px-3 py-1.5'

  return (
    <div className="flex items-center gap-1">
      <select
        value={currentPreset}
        onChange={(e) => onLoad(e.target.value)}
        className={cn(
          padding, textSize,
          'bg-surface-800 border border-surface-700 rounded',
          'text-surface-200',
          'focus:outline-none focus:border-surface-500',
          'cursor-pointer'
        )}
      >
        {presets.length === 0 ? (
          <option value="">No presets</option>
        ) : (
          presets.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))
        )}
      </select>

      {showSaveDialog ? (
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Name"
            autoFocus
            className={cn(
              'w-24 px-2 py-1', textSize,
              'bg-surface-800 border border-surface-600 rounded',
              'text-surface-200 placeholder-surface-500',
              'focus:outline-none focus:border-surface-400'
            )}
          />
          <button
            onClick={handleSave}
            className={cn(
              padding, textSize,
              'bg-surface-700 hover:bg-surface-600 rounded',
              'text-surface-200 transition-colors'
            )}
          >
            ✓
          </button>
          <button
            onClick={() => setShowSaveDialog(false)}
            className={cn(
              padding, textSize,
              'bg-surface-800 hover:bg-surface-700 rounded',
              'text-surface-400 transition-colors'
            )}
          >
            ✕
          </button>
        </div>
      ) : (
        <>
          <button
            onClick={() => {
              setNewPresetName(currentPreset)
              setShowSaveDialog(true)
            }}
            className={cn(
              padding, textSize,
              'bg-surface-700 hover:bg-surface-600 rounded',
              'text-surface-200 transition-colors'
            )}
            title="Save preset"
          >
            {compact ? '💾' : 'Save'}
          </button>
          <button
            onClick={onReset}
            className={cn(
              padding, textSize,
              'bg-surface-800 hover:bg-surface-700 rounded',
              'text-surface-400 transition-colors'
            )}
            title="Reset all values"
          >
            {compact ? '↺' : 'Reset'}
          </button>
        </>
      )}
    </div>
  )
}
