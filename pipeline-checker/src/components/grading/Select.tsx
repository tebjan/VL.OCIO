import { cn } from '../../lib/utils'

interface SelectProps<T extends string> {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  compact?: boolean
  mobile?: boolean
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  compact = false,
  mobile = false,
}: SelectProps<T>) {
  if (compact) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={cn(
          'px-2 py-1 text-xs',
          'bg-surface-800 border border-surface-700 rounded',
          'text-surface-200',
          'focus:outline-none focus:border-surface-500',
          'cursor-pointer'
        )}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    )
  }

  if (mobile) {
    return (
      <div className="flex flex-col gap-1">
        <div className="text-sm text-surface-300">{label}</div>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className={cn(
            'w-full px-3 py-2 text-sm',
            'bg-surface-800 border border-surface-700 rounded',
            'text-surface-200',
            'focus:outline-none focus:border-surface-500',
            'cursor-pointer'
          )}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <div className="w-24 text-sm text-surface-300 truncate">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={cn(
          'flex-1 px-3 py-1.5 text-sm',
          'bg-surface-800 border border-surface-700 rounded',
          'text-surface-200',
          'focus:outline-none focus:border-surface-500',
          'cursor-pointer'
        )}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
