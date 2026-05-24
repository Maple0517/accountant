type ProgressTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent'

export function ProgressBar({
  value,
  tone = 'neutral',
  label,
}: {
  value: number | null | undefined
  tone?: ProgressTone
  label?: string
}) {
  const percent = Math.max(0, Math.min((value ?? 0) * 100, 100))
  return (
    <div className="progress" aria-label={label} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
      <div className={`progress-fill progress-${tone}`} style={{ width: `${percent}%` }} />
    </div>
  )
}
