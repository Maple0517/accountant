import type { HTMLAttributes, ReactNode } from 'react'

type CardVariant = 'default' | 'raised' | 'muted'
type CardPadding = 'none' | 'sm' | 'md' | 'lg'

export function Card({
  children,
  variant = 'default',
  padding = 'md',
  className = '',
  ...props
}: {
  children: ReactNode
  variant?: CardVariant
  padding?: CardPadding
  className?: string
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`card card-${variant} card-pad-${padding} ${className}`.trim()} {...props}>
      {children}
    </div>
  )
}
