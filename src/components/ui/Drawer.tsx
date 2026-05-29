'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'

export function Drawer({
  open,
  title,
  children,
  onClose,
  className = '',
}: {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
  className?: string
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const previouslyFocusedRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!open) return
    previouslyFocusedRef.current = document.activeElement
    window.setTimeout(() => panelRef.current?.focus(), 0)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }

      if (event.key !== 'Tab' || !panelRef.current) return

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) {
        event.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocusedRef.current instanceof HTMLElement) {
        previouslyFocusedRef.current.focus()
      }
    }
  }, [onClose, open])

  if (!open) return null

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        ref={panelRef}
        aria-modal="true"
        className={`drawer-panel ${className}`.trim()}
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="drawer-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close drawer">
            ×
          </button>
        </div>
        <div className="drawer-content">{children}</div>
      </aside>
    </div>
  )
}
