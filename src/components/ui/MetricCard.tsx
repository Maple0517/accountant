import { Card } from './Card'

type MetricTone = 'neutral' | 'positive' | 'negative' | 'warning' | 'accent'

export function MetricCard({
  label,
  value,
  helper,
  tone = 'neutral',
}: {
  label: string
  value: string
  helper?: string
  tone?: MetricTone
}) {
  return (
    <Card className={`metric-card metric-${tone}`} padding="md">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
      {helper && <span className="metric-helper">{helper}</span>}
    </Card>
  )
}
