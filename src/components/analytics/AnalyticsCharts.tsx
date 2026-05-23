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
import type { AnalyticsData } from '@/modules/analytics/analytics.types'

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

export default function AnalyticsCharts({ data }: { data: AnalyticsData }) {
  const pieData = {
    labels: data.byCategory.map((c) => `${c.icon} ${c.name}`),
    datasets: [
      {
        data: data.byCategory.map((c) => c.total),
        backgroundColor: [
          '#6c5ce7',
          '#ff5252',
          '#448aff',
          '#ffab40',
          '#00e676',
          '#ff6e40',
          '#7c4dff',
          '#64ffda',
          '#ffd740',
          '#e040fb',
        ],
        borderWidth: 0,
        borderRadius: 4,
        spacing: 2,
      },
    ],
  }

  const pieOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '70%',
    plugins: {
      legend: {
        position: 'right' as const,
        labels: {
          color: '#8888a0',
          padding: 12,
          font: { family: 'Inter', size: 12 },
          usePointStyle: true,
          pointStyleWidth: 10,
        },
      },
    },
  }

  const lineData = {
    labels: data.byDay.map((d) => {
      const date = new Date(`${d.date}T00:00:00`)
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    }),
    datasets: [
      {
        label: 'Daily Spending',
        data: data.byDay.map((d) => d.total),
        borderColor: '#6c5ce7',
        backgroundColor: (context: ScriptableContext<'line'>) => {
          const ctx = context.chart.ctx
          const gradient = ctx.createLinearGradient(0, 0, 0, 200)
          gradient.addColorStop(0, 'rgba(108, 92, 231, 0.3)')
          gradient.addColorStop(1, 'rgba(108, 92, 231, 0)')
          return gradient
        },
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointBackgroundColor: '#6c5ce7',
        pointBorderWidth: 0,
        borderWidth: 2,
      },
    ],
  }

  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,0.03)' },
        ticks: {
          color: '#555570',
          font: { size: 11 },
          maxTicksLimit: 10,
        },
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.03)' },
        ticks: {
          color: '#555570',
          font: { family: 'JetBrains Mono', size: 11 },
          callback: (v: string | number) => `$${v}`,
        },
      },
    },
    plugins: {
      legend: { display: false },
    },
  }

  const barData = {
    labels: data.byMonth.map((m) => {
      const [y, mo] = m.month.split('-')
      return new Date(Number(y), Number(mo) - 1).toLocaleDateString('en-US', {
        month: 'short',
        year: '2-digit',
      })
    }),
    datasets: [
      {
        label: 'Income',
        data: data.byMonth.map((m) => m.income),
        backgroundColor: 'rgba(0, 230, 118, 0.7)',
        borderRadius: 6,
        borderSkipped: false,
      },
      {
        label: 'Spending',
        data: data.byMonth.map((m) => m.spending),
        backgroundColor: 'rgba(255, 82, 82, 0.7)',
        borderRadius: 6,
        borderSkipped: false,
      },
    ],
  }

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: '#555570', font: { size: 11 } },
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.03)' },
        ticks: {
          color: '#555570',
          font: { family: 'JetBrains Mono', size: 11 },
          callback: (v: string | number) => `$${v}`,
        },
      },
    },
    plugins: {
      legend: {
        labels: {
          color: '#8888a0',
          font: { family: 'Inter', size: 12 },
          usePointStyle: true,
          pointStyleWidth: 10,
        },
      },
    },
  }

  return (
    <div className="charts-grid">
      <div className="card chart-card">
        <h3>Spending by Category</h3>
        <div className="chart-container pie-container">
          <Doughnut data={pieData} options={pieOptions} aria-label="Spending by category chart" />
        </div>
      </div>

      <div className="card chart-card">
        <h3>Daily Spending Trend</h3>
        <div className="chart-container">
          <Line data={lineData} options={lineOptions} aria-label="Daily spending trend chart" />
        </div>
      </div>

      <div className="card chart-card full-width">
        <h3>Income vs Spending</h3>
        <div className="chart-container">
          <Bar data={barData} options={barOptions} aria-label="Income versus spending chart" />
        </div>
      </div>
    </div>
  )
}
