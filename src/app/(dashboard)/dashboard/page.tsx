'use client'

import { formatCurrency } from '@/lib/currency'
import Link from 'next/link'
import useSWR from 'swr'

function getMonthlySemanticAmounts(tx: {
  amount: number | string
  budget_behavior?: string | null
}) {
  const amount = Number(tx.amount)

  if (!Number.isFinite(amount)) {
    return { spending: 0, income: 0 }
  }

  if (tx.budget_behavior === 'exclude_as_transfer' || tx.budget_behavior === 'exclude_manual') {
    return { spending: 0, income: 0 }
  }

  if (tx.budget_behavior === 'count_as_income') {
    return { spending: 0, income: Math.abs(amount) }
  }

  if (tx.budget_behavior === 'count_as_spending') {
    return { spending: amount, income: 0 }
  }

  if (amount > 0) return { spending: amount, income: 0 }
  if (amount < 0) return { spending: 0, income: Math.abs(amount) }
  return { spending: 0, income: 0 }
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Failed to fetch')
  return json.data
}

export default function DashboardPage() {
  const { data, error, isLoading } = useSWR('/api/dashboard', fetcher)

  let totalBalance = 0
  let monthlySpending = 0
  let monthlyIncome = 0

  if (data) {
    if (data.accounts) {
      data.accounts.forEach((acc: any) => {
        if (acc.type === 'credit' || acc.type === 'loan') {
          totalBalance -= Number(acc.current_balance || 0)
        } else {
          totalBalance += Number(acc.current_balance || 0)
        }
      })
    }

    if (data.monthTx) {
      data.monthTx.forEach((tx: any) => {
        const amounts = getMonthlySemanticAmounts(tx)
        monthlySpending += amounts.spending
        monthlyIncome += amounts.income
      })
    }
  }

  const savingsRate = monthlyIncome > 0 ? ((monthlyIncome - monthlySpending) / monthlyIncome) * 100 : 0

  const stats = [
    { label: 'Total Balance', value: totalBalance, change: 'Updated', trend: 'neutral' },
    { label: 'Monthly Spending', value: monthlySpending, change: 'This Month', trend: 'neutral' },
    { label: 'Monthly Income', value: monthlyIncome, change: 'This Month', trend: 'neutral' },
    { label: 'Savings Rate', value: Math.max(0, savingsRate), isPercentage: true, change: 'This Month', trend: 'neutral' },
  ]

  const getIcon = (category: string | null) => {
    const c = (category || '').toLowerCase()
    if (c.includes('food') || c.includes('groceries')) return '🛒'
    if (c.includes('transport') || c.includes('uber') || c.includes('lyft')) return '🚗'
    if (c.includes('entertainment') || c.includes('netflix')) return '🎬'
    if (c.includes('income') || c.includes('salary')) return '💰'
    if (c.includes('coffee') || c.includes('starbucks')) return '☕'
    return '💳'
  }

  const recentTransactions = data?.recentTx?.map((tx: any) => ({
    id: tx.id,
    merchant: tx.merchant_name || tx.description || 'Unknown',
    category: tx.categories?.name_zh || tx.categories?.name || 'Uncategorized',
    amount: -Number(tx.amount),
    date: tx.date,
    icon: tx.categories?.icon || getIcon(tx.description)
  })) || []

  return (
    <div className="dashboard">
      <div className="welcome-section">
        <h2>Welcome back! 👋</h2>
        <p className="text-secondary">Here&apos;s your financial overview.</p>
      </div>

      {isLoading && !data && (
        <div className="loading-state animate-fade-in" style={{ marginBottom: '2rem' }}>
          <div className="card skeleton-card" style={{ height: '120px' }} />
        </div>
      )}

      {error && !data && (
         <div className="card alert alert-error" style={{ marginBottom: '2rem', padding: '1.5rem' }}>
           ⚠️ {error.message}
         </div>
      )}

      {data && (
        <>
          <div className="stats-grid">
            {stats.map((stat, i) => (
              <div key={i} className="card stat-card">
                <span className="stat-label">{stat.label}</span>
                <div className="stat-value-row">
                  <span className="stat-value">
                    {stat.isPercentage ? `${stat.value.toFixed(1)}%` : formatCurrency(stat.value)}
                  </span>
                  <span className={`stat-change ${stat.trend}`}>
                    {stat.change}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="dashboard-content">
            <div className="main-col">
              <div className="card chart-card">
                <div className="card-header">
                  <h3>Spending Overview</h3>
                  <select className="input select-small" defaultValue="This Month">
                    <option>This Month</option>
                    <option>Last Month</option>
                    <option>This Year</option>
                  </select>
                </div>
                <div className="chart-placeholder">
                  <div className="placeholder-bars">
                    {[40, 60, 30, 80, 50, 90, 70].map((h, i) => (
                      <div key={i} className="bar" style={{ height: `${h}%` }}></div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="card budgets-card">
                <div className="card-header">
                  <h3>Budget Progress</h3>
                  <Link href="/budgets" className="btn btn-ghost text-sm">View All</Link>
                </div>
                <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  Visit the <Link href="/budgets" style={{ color: 'var(--accent-primary)' }}>Budgets page</Link> to set up monthly spending limits.
                </div>
              </div>
            </div>

            <div className="side-col">
              <div className="card transactions-card">
                <div className="card-header">
                  <h3>Recent Transactions</h3>
                  <Link href="/transactions" className="btn btn-ghost text-sm">View All</Link>
                </div>
                <div className="transaction-list">
                  {recentTransactions.length > 0 ? (
                    recentTransactions.map((tx: any) => (
                      <div key={tx.id} className="tx-item">
                        <div className="tx-icon">{tx.icon}</div>
                        <div className="tx-details">
                          <span className="tx-merchant">{tx.merchant}</span>
                          <span className="tx-category">{tx.category} • {tx.date}</span>
                        </div>
                        <span className={`tx-amount ${tx.amount > 0 ? 'income' : 'expense'}`}>
                          {formatCurrency(tx.amount)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                      No recent transactions
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
