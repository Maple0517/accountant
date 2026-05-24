'use client'

import { useEffect, type ReactNode } from 'react'

export function Drawer({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  if (!open) return null

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        aria-modal="true"
        className="drawer-panel"
        role="dialog"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="drawer-header">
          <h2>{title}</h2>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close drawer">
            ×
          </button>
        </div>
        <div className="drawer-content">{children}</div>
      </aside>
    </div>
  )
}
