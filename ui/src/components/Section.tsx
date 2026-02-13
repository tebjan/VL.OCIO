import { cn } from '../lib/utils'

interface SectionProps {
  title: string
  children: React.ReactNode
  className?: string
}

export function Section({ title, children, className }: SectionProps) {
  return (
    <div className={cn('', className)}>
      <div className="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-3 px-1">
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}
