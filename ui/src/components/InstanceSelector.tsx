import { cn } from '../lib/utils'
import type { InstanceInfo, ServerInfo } from '../types/settings'

interface InstanceSelectorProps {
  instances: InstanceInfo[]
  selectedInstanceId: string | null
  onSelectInstance: (instanceId: string) => void
  serverInfo?: ServerInfo | null
}

export function InstanceSelector({
  instances,
  selectedInstanceId,
  onSelectInstance,
  serverInfo,
}: InstanceSelectorProps) {
  if (instances.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <h2 className="text-[10px] font-semibold tracking-wider uppercase text-surface-500">
          Instances
        </h2>
      </div>

      {/* Instance list */}
      <div className="flex-1 overflow-y-auto px-3 py-1 space-y-1.5">
        {instances.map((inst) => {
          const isSelected = inst.id === selectedInstanceId
          const tooltipLines = [inst.displayName]
          if (serverInfo) {
            tooltipLines.push(`${serverInfo.hostname} (${serverInfo.ip}:${serverInfo.port})`)
          }
          return (
            <button
              key={inst.id}
              onClick={() => onSelectInstance(inst.id)}
              title={tooltipLines.join('\n')}
              className={cn(
                'w-full text-left px-3 py-2.5 rounded-lg transition-all duration-150',
                'border',
                isSelected
                  ? 'bg-surface-800 border-surface-600 text-surface-50'
                  : 'bg-surface-900/50 border-surface-800/50 text-surface-400 hover:bg-surface-850 hover:text-surface-200 hover:border-surface-700'
              )}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <div
                  className={cn(
                    'w-2 h-2 rounded-full flex-shrink-0',
                    inst.isActive ? 'bg-emerald-400' : 'bg-surface-600'
                  )}
                />
                <span className="text-sm font-medium leading-snug break-words">
                  {inst.displayName}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
