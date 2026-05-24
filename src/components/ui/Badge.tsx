import type { HTMLAttributes, ReactNode } from 'react'

type BadgeTone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning' | 'info' | 'muted'

export function Badge({
  children,
  tone = 'neutral',
  className = '',
  ...props
}: {
  children: ReactNode
  tone?: BadgeTone
  className?: string
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`badge badge-${tone} ${className}`.trim()} {...props}>
      {children}
    </span>
  )
}
