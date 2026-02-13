import { cn } from '../lib/utils'
import type { InstanceInfo } from '../types/settings'

interface InstanceSelectorProps {
  instances: InstanceInfo[]
  selectedInstanceId: string | null
  onSelectInstance: (instanceId: string) => void
  compact?: boolean
}

export function InstanceSelector({
  instances,
  selectedInstanceId,
  onSelectInstance,
  compact = false,
}: InstanceSelectorProps) {
  // Don't render if no instances or only one instance
  if (instances.length <= 1) {
    return null
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-surface-400">Instance:</span>
        <select
          value={selectedInstanceId || ''}
          onChange={(e) => onSelectInstance(e.target.value)}
          className={cn(
            'px-2 py-1 text-xs',
            'bg-surface-800 border border-surface-700 rounded',
            'text-surface-200',
            'focus:outline-none focus:border-surface-500',
            'cursor-pointer'
          )}
        >
          {instances.map((instance) => (
            <option key={instance.id} value={instance.id}>
              {instance.displayName}
              {instance.isActive ? '' : ' (inactive)'}
            </option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <div className="text-sm text-surface-300">Instance</div>
      <div className="flex-1 flex items-center gap-2">
        <select
          value={selectedInstanceId || ''}
          onChange={(e) => onSelectInstance(e.target.value)}
          className={cn(
            'flex-1 px-3 py-1.5 text-sm',
            'bg-surface-800 border border-surface-700 rounded',
            'text-surface-200',
            'focus:outline-none focus:border-surface-500',
            'cursor-pointer'
          )}
        >
          {instances.map((instance) => (
            <option key={instance.id} value={instance.id}>
              {instance.displayName}
            </option>
          ))}
        </select>
        {/* Status indicator for selected instance */}
        {instances.find((i) => i.id === selectedInstanceId) && (
          <div
            className={cn(
              'w-2 h-2 rounded-full flex-shrink-0',
              instances.find((i) => i.id === selectedInstanceId)?.isActive
                ? 'bg-green-500'
                : 'bg-surface-500'
            )}
            title={
              instances.find((i) => i.id === selectedInstanceId)?.isActive
                ? 'Active'
                : 'Inactive'
            }
          />
        )}
      </div>
    </div>
  )
}
