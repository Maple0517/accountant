type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent'

export function StatusDot({ tone = 'neutral', label }: { tone?: StatusTone; label: string }) {
  return (
    <span className="status-dot-wrap">
      <span className={`status-dot status-${tone}`} aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}
