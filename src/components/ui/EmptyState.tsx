import type { ReactNode } from 'react'

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode
  title: string
  children?: ReactNode
}) {
  return (
    <div className="empty-state card">
      {icon && <div className="empty-icon" aria-hidden="true">{icon}</div>}
      <h3>{title}</h3>
      {children && <div className="text-secondary empty-copy">{children}</div>}
    </div>
  )
}
