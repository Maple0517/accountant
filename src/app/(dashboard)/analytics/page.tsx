'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/currency'
import { Chart, registerables } from 'chart.js'

Chart.register(...registerables)

type AnalyticsData = {
  totalSpending: number
  totalIncome: number
  byCategory: Array<{ name: string; icon: string; color: string; total: number }>
  byMonth: Array<{ month: string; spending: number; income: number }>
  byDay: Array<{ date: string; total: number }>
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('month')
  const [loading, setLoading] = useState(true)

  const pieChartRef = useRef<HTMLCanvasElement>(null)
  const lineChartRef = useRef<HTMLCanvasElement>(null)
  const barChartRef = useRef<HTMLCanvasElement>(null)
  const pieChartInstance = useRef<Chart | null>(null)
  const lineChartInstance = useRef<Chart | null>(null)
  const barChartInstance = useRef<Chart | null>(null)

  const supabase = createClient()

  const fetchAnalytics = useCallback(async () => {
    setLoading(true)

    const now = new Date()
    let dateFrom: string

    switch (period) {
      case 'week':
        dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0]
        break
      case 'month':
        dateFrom = new Date(now.getFullYear(), now.getMonth(), 1)
          .toISOString()
          .split('T')[0]
        break
      case 'year':
        dateFrom = new Date(now.getFullYear(), 0, 1)
          .toISOString()
          .split('T')[0]
        break
    }

    const { data: transactions } = await supabase
      .from('transactions')
      .select('*, categories ( name, icon, color )')
      .gte('date', dateFrom)
      .order('date', { ascending: true })

    if (!transactions) {
      setLoading(false)
      return
    }

    // Calculate analytics
    let totalSpending = 0
    let totalIncome = 0
    const categoryMap = new Map<
      string,
      { name: string; icon: string; color: string; total: number }
    >()
    const monthMap = new Map<string, { spending: number; income: number }>()
    const dayMap = new Map<string, number>()

    for (const tx of transactions) {
      const amount = Number(tx.amount)

      if (amount < 0) {
        totalSpending += Math.abs(amount)
      } else {
        totalIncome += amount
      }

      // By category (expenses only)
      if (amount < 0) {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const cat = tx.categories as any
        const catName = cat?.name || 'Other'
        const existing = categoryMap.get(catName) || {
          name: catName,
          icon: cat?.icon || '📦',
          color: cat?.color || '#8888a0',
          total: 0,
        }
        existing.total += Math.abs(amount)
        categoryMap.set(catName, existing)
      }

      // By month
      const monthKey = tx.date.substring(0, 7)
      const monthData = monthMap.get(monthKey) || {
        spending: 0,
        income: 0,
      }
      if (amount < 0) monthData.spending += Math.abs(amount)
      else monthData.income += amount
      monthMap.set(monthKey, monthData)

      // By day
      const dayData = dayMap.get(tx.date) || 0
      dayMap.set(tx.date, dayData + Math.abs(amount))
    }

    setData({
      totalSpending,
      totalIncome,
      byCategory: Array.from(categoryMap.values()).sort(
        (a, b) => b.total - a.total
      ),
      byMonth: Array.from(monthMap.entries()).map(([month, d]) => ({
        month,
        ...d,
      })),
      byDay: Array.from(dayMap.entries()).map(([date, total]) => ({
        date,
        total,
      })),
    })

    setLoading(false)
  }, [supabase, period])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAnalytics()
  }, [fetchAnalytics])

  // Render charts
  useEffect(() => {
    if (!data) return

    // Pie Chart - Spending by Category
    if (pieChartRef.current) {
      if (pieChartInstance.current) pieChartInstance.current.destroy()
      const ctx = pieChartRef.current.getContext('2d')
      if (ctx) {
        pieChartInstance.current = new Chart(ctx, {
          type: 'doughnut',
          data: {
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
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
              legend: {
                position: 'right',
                labels: {
                  color: '#8888a0',
                  padding: 12,
                  font: { family: 'Inter', size: 12 },
                  usePointStyle: true,
                  pointStyleWidth: 10,
                },
              },
            },
          },
        })
      }
    }

    // Line Chart - Daily Spending Trend
    if (lineChartRef.current) {
      if (lineChartInstance.current) lineChartInstance.current.destroy()
      const ctx = lineChartRef.current.getContext('2d')
      if (ctx) {
        const gradient = ctx.createLinearGradient(0, 0, 0, 200)
        gradient.addColorStop(0, 'rgba(108, 92, 231, 0.3)')
        gradient.addColorStop(1, 'rgba(108, 92, 231, 0)')

        lineChartInstance.current = new Chart(ctx, {
          type: 'line',
          data: {
            labels: data.byDay.map((d) => {
              const date = new Date(d.date + 'T00:00:00')
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
                backgroundColor: gradient,
                fill: true,
                tension: 0.4,
                pointRadius: 3,
                pointBackgroundColor: '#6c5ce7',
                pointBorderWidth: 0,
                borderWidth: 2,
              },
            ],
          },
          options: {
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
                  callback: (v) => `$${v}`,
                },
              },
            },
            plugins: {
              legend: { display: false },
            },
          },
        })
      }
    }

    // Bar Chart - Monthly Income vs Spending
    if (barChartRef.current) {
      if (barChartInstance.current) barChartInstance.current.destroy()
      const ctx = barChartRef.current.getContext('2d')
      if (ctx) {
        barChartInstance.current = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: data.byMonth.map((m) => {
              const [y, mo] = m.month.split('-')
              return new Date(Number(y), Number(mo) - 1).toLocaleDateString(
                'en-US',
                { month: 'short', year: '2-digit' }
              )
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
          },
          options: {
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
                  callback: (v) => `$${v}`,
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
          },
        })
      }
    }

    return () => {
      pieChartInstance.current?.destroy()
      lineChartInstance.current?.destroy()
      barChartInstance.current?.destroy()
    }
  }, [data])

  return (
    <div className="analytics-page">
      <div className="page-header">
        <h1>Analytics</h1>
        <div className="period-toggle">
          {(['week', 'month', 'year'] as const).map((p) => (
            <button
              key={p}
              className={`btn btn-ghost ${period === p ? 'active' : ''}`}
              onClick={() => setPeriod(p)}
            >
              {p === 'week' ? 'Week' : p === 'month' ? 'Month' : 'Year'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="loading-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card skeleton-chart">
              <div className="skeleton skeleton-line" style={{ width: '40%' }} />
              <div
                className="skeleton"
                style={{ height: '200px', width: '100%', marginTop: '1rem' }}
              />
            </div>
          ))}
        </div>
      ) : !data ? (
        <div className="card empty-state">
          <span style={{ fontSize: '3rem' }}>📊</span>
          <h3>No data yet</h3>
          <p className="text-secondary">
            Connect a bank account to see your spending analytics.
          </p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="summary-grid">
            <div className="card summary-card expense">
              <span className="summary-label">Total Spending</span>
              <span className="summary-value">
                {formatCurrency(-data.totalSpending, 'USD')}
              </span>
            </div>
            <div className="card summary-card income">
              <span className="summary-label">Total Income</span>
              <span className="summary-value">
                {formatCurrency(data.totalIncome, 'USD')}
              </span>
            </div>
            <div className="card summary-card net">
              <span className="summary-label">Net</span>
              <span className="summary-value">
                {formatCurrency(
                  data.totalIncome - data.totalSpending,
                  'USD'
                )}
              </span>
            </div>
            <div className="card summary-card categories">
              <span className="summary-label">Categories</span>
              <span className="summary-value">{data.byCategory.length}</span>
            </div>
          </div>

          {/* Charts Grid */}
          <div className="charts-grid">
            <div className="card chart-card">
              <h3>Spending by Category</h3>
              <div className="chart-container pie-container">
                <canvas ref={pieChartRef} />
              </div>
            </div>

            <div className="card chart-card">
              <h3>Daily Spending Trend</h3>
              <div className="chart-container">
                <canvas ref={lineChartRef} />
              </div>
            </div>

            <div className="card chart-card full-width">
              <h3>Income vs Spending</h3>
              <div className="chart-container">
                <canvas ref={barChartRef} />
              </div>
            </div>
          </div>

          {/* Top Categories Breakdown */}
          <div className="card">
            <h3 style={{ padding: '1.25rem 1.25rem 0' }}>
              Top Categories
            </h3>
            <div className="category-list">
              {data.byCategory.slice(0, 8).map((cat, i) => {
                const percentage =
                  data.totalSpending > 0
                    ? (cat.total / data.totalSpending) * 100
                    : 0
                return (
                  <div key={i} className="category-item">
                    <div className="cat-info">
                      <span className="cat-icon">{cat.icon}</span>
                      <span className="cat-name">{cat.name}</span>
                    </div>
                    <div className="cat-bar-wrapper">
                      <div
                        className="cat-bar"
                        style={{
                          width: `${percentage}%`,
                          backgroundColor: cat.color || '#6c5ce7',
                        }}
                      />
                    </div>
                    <div className="cat-amount">
                      <span className="cat-value">
                        {formatCurrency(-cat.total, 'USD')}
                      </span>
                      <span className="cat-pct">{percentage.toFixed(1)}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      
    </div>
  )
}
