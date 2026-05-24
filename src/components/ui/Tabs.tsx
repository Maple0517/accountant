import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Tabs({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`segmented-control ${className}`.trim()}>{children}</div>
}

export function TabButton({
  active,
  children,
  className = '',
  ...props
}: { active?: boolean; children: ReactNode; className?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`${active ? 'active' : ''} ${className}`.trim()} type="button" {...props}>
      {children}
    </button>
  )
}
