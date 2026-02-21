import { useCallback, useState } from 'react'
import { cn } from '../lib/utils'

interface PresetManagerProps {
  activePresetName: string
  isPresetDirty: boolean
  presets: string[]
  onLoad: (name: string) => void
  onSave: (name: string) => void
  onDelete: (name: string) => void
  onReset: () => void
}

export function PresetManager({
  activePresetName,
  isPresetDirty,
  presets,
  onLoad,
  onSave,
  onDelete,
  onReset,
}: PresetManagerProps) {
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [newPresetName, setNewPresetName] = useState('')
  const [confirmLoad, setConfirmLoad] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const handleSave = useCallback(() => {
    const name = newPresetName.trim()
    if (name) {
      onSave(name)
      setNewPresetName('')
      setShowSaveInput(false)
    }
  }, [newPresetName, onSave])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleSave()
      } else if (e.key === 'Escape') {
        setShowSaveInput(false)
      }
    },
    [handleSave]
  )

  const handleLoadClick = useCallback(
    (name: string) => {
      // Skip confirmation only when re-loading the already-active, unmodified preset
      const isActiveClean = name === activePresetName && !isPresetDirty
      if (isActiveClean) {
        onLoad(name)
      } else {
        setConfirmDelete(null)
        setConfirmLoad(name)
      }
    },
    [isPresetDirty, activePresetName, onLoad]
  )

  const handleConfirmLoad = useCallback(() => {
    if (confirmLoad) {
      onLoad(confirmLoad)
      setConfirmLoad(null)
    }
  }, [confirmLoad, onLoad])

  const handleDeleteClick = useCallback((e: React.MouseEvent, name: string) => {
    e.stopPropagation()
    setConfirmLoad(null)
    setConfirmDelete(name)
  }, [])

  const handleConfirmDelete = useCallback(() => {
    if (confirmDelete) {
      onDelete(confirmDelete)
      setConfirmDelete(null)
    }
  }, [confirmDelete, onDelete])

  const handleResetClick = useCallback(() => {
    setConfirmReset(true)
  }, [])

  const handleConfirmReset = useCallback(() => {
    onReset()
    setConfirmReset(false)
  }, [onReset])

  // Only show dirty when preset is associated AND exists in the list
  const showDirty = isPresetDirty && !!activePresetName && presets.includes(activePresetName)

  return (
    <div className="flex flex-col h-full">
      {/* Header with active preset indicator */}
      <div className="px-4 pt-4 pb-1">
        <h2 className="text-[10px] font-semibold tracking-wider uppercase text-surface-500">
          Snapshots
        </h2>
      </div>
      {activePresetName && presets.includes(activePresetName) && (
        <div className="px-4 pb-2">
          <span className="text-xs text-surface-300">
            {activePresetName}
            {showDirty && <span className="text-amber-400 ml-0.5">*</span>}
          </span>
        </div>
      )}

      {/* Action buttons */}
      <div className="px-3 pb-2 space-y-1.5">
        {showSaveInput ? (
          <div className="flex gap-1">
            <input
              type="text"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Name"
              autoFocus
              className={cn(
                'flex-1 min-w-0 px-2 py-1.5 text-xs',
                'bg-surface-800 border border-surface-600 rounded-md',
                'text-surface-200 placeholder-surface-500',
                'focus:outline-none focus:border-surface-400'
              )}
            />
            <button
              onClick={handleSave}
              className="px-2 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 rounded-md text-surface-200 transition-colors"
            >
              OK
            </button>
            <button
              onClick={() => setShowSaveInput(false)}
              className="px-2 py-1.5 text-xs bg-surface-800 hover:bg-surface-700 rounded-md text-surface-400 transition-colors"
            >
              X
            </button>
          </div>
        ) : confirmReset ? (
          /* Reset confirmation — replaces button row in-place */
          <div className="flex gap-1.5">
            <button
              onClick={handleConfirmReset}
              className="flex-1 px-3 py-2 text-xs bg-red-600/20 border border-red-500/40 hover:bg-red-600/30 rounded-lg text-red-300 transition-colors"
            >
              Confirm Reset
            </button>
            <button
              onClick={() => setConfirmReset(false)}
              className="px-3 py-2 text-xs bg-surface-800 border border-surface-700 hover:bg-surface-750 rounded-lg text-surface-400 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                setNewPresetName(activePresetName || '')
                setShowSaveInput(true)
              }}
              className={cn(
                'flex-1 px-3 py-2 text-xs rounded-lg transition-colors',
                'bg-surface-800 border border-surface-700',
                'text-surface-300 hover:bg-surface-750 hover:text-surface-200 hover:border-surface-600'
              )}
            >
              Save Snapshot
            </button>
            <button
              onClick={handleResetClick}
              className={cn(
                'px-3 py-2 text-xs rounded-lg transition-colors',
                'bg-surface-800 border border-surface-700',
                'text-surface-500 hover:bg-surface-750 hover:text-surface-300 hover:border-surface-600'
              )}
              title="Reset all values to defaults"
            >
              Reset
            </button>
          </div>
        )}
      </div>

      {/* Preset list */}
      <div className="flex-1 overflow-y-auto px-3 py-1 space-y-1">
        {presets.length === 0 ? (
          <p className="text-xs text-surface-600 px-2 py-4 text-center">
            No snapshots saved yet
          </p>
        ) : (
          presets.map((name) => {
            const isActive = name === activePresetName

            /* Load confirmation — replaces this row in-place */
            if (confirmLoad === name) {
              return (
                <div
                  key={name}
                  className="p-2 bg-surface-800 border border-amber-500/30 rounded-lg"
                >
                  <p className="text-xs text-surface-300 mb-1.5 break-words">
                    Load "{name}"?
                  </p>
                  <div className="flex gap-1.5">
                    <button
                      onClick={handleConfirmLoad}
                      className="flex-1 px-2 py-1.5 text-xs bg-amber-600/20 border border-amber-500/40 hover:bg-amber-600/30 rounded-md text-amber-300 transition-colors"
                    >
                      Load
                    </button>
                    <button
                      onClick={() => setConfirmLoad(null)}
                      className="flex-1 px-2 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 rounded-md text-surface-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )
            }

            /* Delete confirmation — replaces this row in-place */
            if (confirmDelete === name) {
              return (
                <div
                  key={name}
                  className="p-2 bg-surface-800 border border-red-500/30 rounded-lg"
                >
                  <p className="text-xs text-surface-300 mb-1.5 break-words">
                    Delete "{name}"?
                  </p>
                  <div className="flex gap-1.5">
                    <button
                      onClick={handleConfirmDelete}
                      className="flex-1 px-2 py-1.5 text-xs bg-red-600/20 border border-red-500/40 hover:bg-red-600/30 rounded-md text-red-300 transition-colors"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="flex-1 px-2 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 rounded-md text-surface-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )
            }

            /* Normal preset row */
            return (
              <div
                key={name}
                className={cn(
                  'group flex items-center rounded-lg transition-all duration-150',
                  'border',
                  isActive
                    ? 'bg-surface-800 border-surface-600 text-surface-50'
                    : 'bg-surface-900/50 border-surface-800/50 text-surface-400 hover:bg-surface-850 hover:text-surface-200 hover:border-surface-700'
                )}
              >
                <button
                  onClick={() => handleLoadClick(name)}
                  title={`Load "${name}"`}
                  className="flex-1 min-w-0 text-left px-3 py-2"
                >
                  <span className="text-xs font-medium leading-snug break-words">
                    {name}
                    {isActive && showDirty && (
                      <span className="text-amber-400 ml-0.5">*</span>
                    )}
                  </span>
                </button>
                <button
                  onClick={(e) => handleDeleteClick(e, name)}
                  title={`Delete "${name}"`}
                  className="flex-shrink-0 px-2 py-2 text-xs text-surface-600 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all"
                >
                  &times;
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
