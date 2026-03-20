import { useState, useCallback } from 'react'
import { cn } from '../lib/utils'
import type { BankState } from '../types/settings'
import { displayName } from '../types/settings'

interface BankPanelProps {
  bankState: BankState
  onCopyFrom: (sourceKey: string) => void
  onSaveSnapshot: (name: string) => void
  onLoadSnapshot: (name: string) => void
  onDeleteSnapshot: (name: string) => void
  onReset: () => void
  onSave: () => void
  onSetFriendlyName: (key: string, name: string) => void
}

export function BankPanel({
  bankState,
  onCopyFrom,
  onSaveSnapshot,
  onLoadSnapshot,
  onDeleteSnapshot,
  onReset,
  onSave,
  onSetFriendlyName,
}: BankPanelProps) {
  const [editingLabel, setEditingLabel] = useState<string | null>(null)
  const [labelValue, setLabelValue] = useState('')
  const [snapshotName, setSnapshotName] = useState('')
  const [copyConfirming, setCopyConfirming] = useState<string | null>(null)
  const [deleteConfirming, setDeleteConfirming] = useState<string | null>(null)

  const { currentKey, allKeys, friendlyNames, thumbnails, currentSnapshots } = bankState
  const currentLabel = displayName(currentKey, friendlyNames)

  // --- Label editing ---
  const handleStartEditLabel = useCallback(() => {
    setEditingLabel(currentKey)
    setLabelValue(friendlyNames[currentKey] || '')
  }, [currentKey, friendlyNames])

  const handleSaveLabel = useCallback(() => {
    if (editingLabel) {
      onSetFriendlyName(editingLabel, labelValue.trim())
      setEditingLabel(null)
    }
  }, [editingLabel, labelValue, onSetFriendlyName])

  const handleLabelKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSaveLabel()
    if (e.key === 'Escape') setEditingLabel(null)
  }, [handleSaveLabel])

  // --- Snapshot ---
  const handleSaveSnapshot = useCallback(() => {
    const name = snapshotName.trim()
    if (!name) return
    onSaveSnapshot(name)
    setSnapshotName('')
  }, [snapshotName, onSaveSnapshot])

  if (!currentKey) {
    return (
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-[10px] font-semibold tracking-wider uppercase text-surface-500 mb-1">
          Settings Bank
        </h2>
        <div className="text-[10px] text-surface-600 italic">
          No active key
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-1">
        <h2 className="text-[10px] font-semibold tracking-wider uppercase text-surface-500">
          Settings Bank
        </h2>
      </div>

      {/* Current key label — editable */}
      <div className="px-4 pb-2">
        {editingLabel === currentKey ? (
          <input
            className={cn(
              'w-full px-2 py-1 text-xs',
              'bg-surface-800 border border-surface-600 rounded-md',
              'text-surface-200 placeholder-surface-500',
              'focus:outline-none focus:border-surface-400'
            )}
            value={labelValue}
            onChange={e => setLabelValue(e.target.value)}
            onKeyDown={handleLabelKeyDown}
            onBlur={handleSaveLabel}
            placeholder="Display name..."
            autoFocus
          />
        ) : (
          <button
            className="w-full text-left cursor-pointer bg-transparent border-none p-0 group"
            onClick={handleStartEditLabel}
            title="Click to rename"
          >
            <span className="text-xs text-surface-200 group-hover:text-white">
              {currentLabel}
            </span>
            {currentLabel !== currentKey && (
              <div className="text-[10px] text-surface-500 font-mono truncate">
                {currentKey}
              </div>
            )}
          </button>
        )}
      </div>

      {/* Key list — vertical, compact */}
      <div className="px-3 pb-2 space-y-1">
        {allKeys.map(key => {
          const label = displayName(key, friendlyNames)
          const thumb = thumbnails?.[key]
          const isActive = key === currentKey
          const isCopySource = copyConfirming === key
          return (
            <div
              key={key}
              className={cn(
                'rounded-md border overflow-hidden transition-colors',
                isActive
                  ? 'bg-surface-700/80 border-surface-500/60'
                  : isCopySource
                    ? 'bg-blue-900/30 border-blue-600/40'
                    : 'bg-surface-800/40 border-surface-700/40 hover:border-surface-600/60'
              )}
            >
              {thumb && (
                <img
                  src={thumb}
                  alt={label}
                  className="w-full h-auto object-cover"
                  draggable={false}
                />
              )}
              <div className="px-2 py-1 flex items-center gap-1">
                <div className="flex-1 min-w-0">
                  <div className={cn(
                    'text-[11px] truncate',
                    isActive ? 'text-surface-100 font-medium' : 'text-surface-400'
                  )}>
                    {label}
                  </div>
                </div>
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-surface-300 flex-shrink-0" />
                )}
                {!isActive && !isCopySource && (
                  <button
                    className="text-[9px] text-surface-600 hover:text-surface-300 cursor-pointer bg-transparent border-none p-0 flex-shrink-0 transition-colors"
                    onClick={() => setCopyConfirming(key)}
                    title={`Copy settings from "${label}"`}
                  >
                    copy
                  </button>
                )}
                {isCopySource && (
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      className="text-[9px] text-amber-300 hover:text-amber-200 cursor-pointer bg-transparent border-none p-0 transition-colors"
                      onClick={() => { onCopyFrom(key); setCopyConfirming(null) }}
                    >
                      confirm
                    </button>
                    <button
                      className="text-[9px] text-surface-500 hover:text-surface-300 cursor-pointer bg-transparent border-none p-0 transition-colors"
                      onClick={() => setCopyConfirming(null)}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Bank snapshots */}
      {currentSnapshots.length > 0 && (
        <div className="px-3 pb-2">
          <div className="text-[10px] text-surface-500 uppercase tracking-wider mb-1 px-1">
            Key Snapshots
          </div>
          <div className="space-y-0.5">
            {currentSnapshots.map(name => (
              <div
                key={name}
                className="flex items-center gap-1 px-1 py-0.5 rounded hover:bg-surface-800/60 group"
              >
                <span className={cn(
                  'flex-1 text-[11px] truncate cursor-pointer',
                  name === '_preresetbackup' ? 'text-surface-500 italic' : 'text-surface-300 hover:text-surface-100'
                )}
                  onClick={() => onLoadSnapshot(name)}
                  title="Click to load"
                >
                  {name}
                </span>
                {deleteConfirming === name ? (
                  <div className="flex gap-1">
                    <button
                      className="text-[9px] text-red-400 cursor-pointer bg-transparent border-none p-0"
                      onClick={() => { onDeleteSnapshot(name); setDeleteConfirming(null) }}
                    >
                      del
                    </button>
                    <button
                      className="text-[9px] text-surface-500 cursor-pointer bg-transparent border-none p-0"
                      onClick={() => setDeleteConfirming(null)}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    className="text-[9px] text-surface-600 hover:text-red-400 cursor-pointer bg-transparent border-none p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => setDeleteConfirming(name)}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Save snapshot input */}
      <div className="px-3 pb-2">
        <div className="flex gap-1">
          <input
            className={cn(
              'flex-1 min-w-0 px-2 py-1 text-[11px]',
              'bg-surface-800 border border-surface-700 rounded-md',
              'text-surface-200 placeholder-surface-500',
              'focus:outline-none focus:border-surface-500'
            )}
            value={snapshotName}
            onChange={e => setSnapshotName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveSnapshot()}
            placeholder="Save snapshot..."
          />
          <button
            className={cn(
              'px-2 py-1 text-[11px] bg-surface-700 hover:bg-surface-600 rounded-md text-surface-300 transition-colors',
              !snapshotName.trim() && 'opacity-40 cursor-not-allowed'
            )}
            onClick={handleSaveSnapshot}
            disabled={!snapshotName.trim()}
          >
            +
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="px-3 pb-3 space-y-1">
        <button
          className="w-full px-2 py-1.5 text-[10px] bg-surface-800 hover:bg-surface-700 rounded-md text-surface-400 hover:text-surface-200 transition-colors text-left"
          onClick={onSave}
        >
          Save to File
        </button>
        <button
          className="w-full px-2 py-1.5 text-[10px] bg-surface-800 hover:bg-red-900/30 rounded-md text-surface-500 hover:text-red-400 transition-colors text-left"
          onClick={onReset}
          title="Auto-saves backup first"
        >
          Reset Key
        </button>
      </div>
    </div>
  )
}
