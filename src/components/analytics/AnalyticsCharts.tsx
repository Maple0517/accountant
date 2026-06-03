'use client'

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  ScriptableContext,
} from 'chart.js'
import { Doughnut, Line, Bar } from 'react-chartjs-2'
import { formatCurrency } from '@/lib/currency'
import type { AnalyticsData } from '@/modules/analytics/analytics.types'
import { useI18n } from '@/i18n/client'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

const gridColor = 'rgba(186, 203, 187, 0.55)'
const tickColor = '#7b8a82'
const textColor = '#56665d'
const chartRoundedFont = 'ui-rounded, "SF Pro Rounded", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI Rounded", "Segoe UI", system-ui, sans-serif'

function money(value: string | number, currencyCode: string) {
  return formatCurrency(Number(value), currencyCode).replace(/\.00$/, '')
}

export default function AnalyticsCharts({
  data,
  currencyCode = 'USD',
}: {
  data: AnalyticsData
  currencyCode?: string
}) {
  const { categoryName, locale, t } = useI18n()
  const positiveCategories = data.byCategory.filter((category) => category.total > 0)

  if (data.byDay.length === 0 && positiveCategories.length === 0 && data.byMonth.length === 0) {
    return null
  }

  const categoryData = {
    labels: positiveCategories.map((c) => `${c.icon} ${categoryName(c)}`),
    datasets: [
      {
        label: t('analytics.spending'),
        data: positiveCategories.map((c) => c.total),
        backgroundColor: positiveCategories.map((c) => c.color || '#176b4d'),
        borderRadius: 8,
        borderSkipped: false,
      },
    ],
  }

  const categoryOptions = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        grid: { color: gridColor },
        ticks: { color: tickColor, font: { family: chartRoundedFont, size: 11 }, callback: (value: string | number) => money(value, currencyCode) },
      },
      y: { grid: { display: false }, ticks: { color: textColor, font: { size: 11 } } },
    },
    plugins: { legend: { display: false } },
  }

  const lineData = {
    labels: data.byDay.map((d) => {
      const date = new Date(`${d.date}T00:00:00`)
      return date.toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })
    }),
    datasets: [
      {
        label: t('analytics.dailySpending'),
        data: data.byDay.map((d) => d.total),
        borderColor: '#176b4d',
        backgroundColor: (context: ScriptableContext<'line'>) => {
          const ctx = context.chart.ctx
          const gradient = ctx.createLinearGradient(0, 0, 0, 220)
          gradient.addColorStop(0, 'rgba(23, 107, 77, 0.22)')
          gradient.addColorStop(1, 'rgba(23, 107, 77, 0)')
          return gradient
        },
        fill: true,
        tension: 0.35,
        pointRadius: 2,
        pointBackgroundColor: '#176b4d',
        pointBorderWidth: 0,
        borderWidth: 2,
      },
    ],
  }

  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 11 }, maxTicksLimit: 10 } },
      y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { family: chartRoundedFont, size: 11 }, callback: (value: string | number) => money(value, currencyCode) } },
    },
    plugins: { legend: { display: false } },
  }

  const barData = {
    labels: data.byMonth.map((m) => {
      const [y, mo] = m.month.split('-')
      return new Date(Number(y), Number(mo) - 1).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', year: '2-digit' })
    }),
    datasets: [
      { label: t('analytics.income'), data: data.byMonth.map((m) => m.income), backgroundColor: 'rgba(18, 128, 92, 0.72)', borderRadius: 8, borderSkipped: false },
      { label: t('analytics.spending'), data: data.byMonth.map((m) => m.spending), backgroundColor: 'rgba(200, 63, 73, 0.72)', borderRadius: 8, borderSkipped: false },
    ],
  }

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { grid: { display: false }, ticks: { color: tickColor, font: { size: 11 } } },
      y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { family: chartRoundedFont, size: 11 }, callback: (value: string | number) => money(value, currencyCode) } },
    },
    plugins: { legend: { labels: { color: textColor, font: { size: 12 }, usePointStyle: true, pointStyleWidth: 10 } } },
  }

  const donutData = {
    labels: positiveCategories.map((c) => categoryName(c)),
    datasets: [{ data: positiveCategories.map((c) => c.total), backgroundColor: positiveCategories.map((c) => c.color || '#176b4d'), borderWidth: 0, spacing: 2 }],
  }

  const donutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '72%',
    plugins: { legend: { display: false } },
  }

  return (
    <div className="charts-grid">
      <div className="card chart-card full-width">
        <h3>{t('analytics.categoryRanking')}</h3>
        <div className="chart-container">
          <Bar data={categoryData} options={categoryOptions} aria-label={t('analytics.categoryRankingAria')} />
        </div>
      </div>

      <div className="card chart-card">
        <h3>{t('analytics.dailyTrend')}</h3>
        <div className="chart-container">
          <Line data={lineData} options={lineOptions} aria-label={t('analytics.dailyTrendAria')} />
        </div>
      </div>

      <div className="card chart-card">
        <h3>{t('analytics.categoryShare')}</h3>
        <div className="chart-container pie-container">
          <Doughnut data={donutData} options={donutOptions} aria-label={t('analytics.categoryShareAria')} />
        </div>
      </div>

      <div className="card chart-card full-width">
        <h3>{t('analytics.incomeVsSpending')}</h3>
        <div className="chart-container">
          <Bar data={barData} options={barOptions} aria-label={t('analytics.incomeVsSpendingAria')} />
        </div>
      </div>
    </div>
  )
}
