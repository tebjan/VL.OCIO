import { useState } from 'react'
import { cn } from '../lib/utils'

interface SectionProps {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  className?: string
}

export function Section({ title, children, defaultOpen = true, className }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className={cn('', className)}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-1.5 w-full py-1.5 border-none bg-transparent cursor-pointer',
          'text-xs font-semibold text-surface-500 uppercase tracking-wider'
        )}
      >
        <span
          className="text-[8px] transition-transform duration-150"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          {'\u25B6'}
        </span>
        {title}
      </button>
      {open && (
        <div className="space-y-2">
          {children}
        </div>
      )}
    </div>
  )
}
