import { cn } from '../lib/utils'
import type { InstanceInfo } from '../types/settings'

interface InstanceSelectorProps {
  instances: InstanceInfo[]
  selectedInstanceId: string | null
  onSelectInstance: (instanceId: string) => void
}

export function InstanceSelector({
  instances,
  selectedInstanceId,
  onSelectInstance,
}: InstanceSelectorProps) {
  // Don't render if no instances
  if (instances.length === 0) {
    return null
  }

  // Single instance: non-interactive badge with status
  if (instances.length === 1) {
    const inst = instances[0]
    return (
      <div className="flex items-center gap-2 px-3 py-1 rounded bg-surface-800/50 border border-surface-700/50">
        <div
          className={cn(
            'w-1.5 h-1.5 rounded-full flex-shrink-0',
            inst.isActive ? 'bg-green-500' : 'bg-surface-500'
          )}
        />
        <span className="text-xs text-surface-300 truncate max-w-[140px]">
          {inst.displayName}
        </span>
      </div>
    )
  }

  // Multiple instances: clickable tab bar
  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {instances.map((inst) => {
        const isSelected = inst.id === selectedInstanceId
        return (
          <button
            key={inst.id}
            onClick={() => onSelectInstance(inst.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded text-xs transition-colors',
              'whitespace-nowrap flex-shrink-0',
              isSelected
                ? 'bg-surface-700 border border-surface-600 text-surface-100'
                : 'bg-surface-800/50 border border-transparent text-surface-400 hover:text-surface-200 hover:bg-surface-800'
            )}
            title={inst.displayName}
          >
            <div
              className={cn(
                'w-1.5 h-1.5 rounded-full flex-shrink-0',
                inst.isActive ? 'bg-green-500' : 'bg-surface-500'
              )}
            />
            <span className="truncate max-w-[120px]">
              {inst.displayName}
            </span>
          </button>
        )
      })}
    </div>
  )
}
