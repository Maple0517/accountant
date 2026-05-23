import { getCurrentUser } from '@/lib/auth/server'
import { formatCurrency } from '@/lib/currency'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'


function toMonthStart(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

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


export default async function DashboardPage() {
  const { supabase, user } = await getCurrentUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Fetch current month's transactions
  const now = new Date()
  const firstDayOfMonth = toMonthStart(now)

  const [{ data: accounts }, { data: monthTx }, { data: recentTx }] =
    await Promise.all([
      supabase
        .from('accounts')
        .select('type, current_balance')
        .eq('user_id', user.id),
      supabase
        .from('transactions')
        .select('amount, budget_behavior, budget_effective_date, date')
        .eq('user_id', user.id)
        .eq('pending', false)
        .or(`and(budget_effective_date.gte.${firstDayOfMonth}),and(budget_effective_date.is.null,date.gte.${firstDayOfMonth})`),
      supabase
        .from('transactions')
        .select('id, merchant_name, description, amount, date, source')
        .eq('user_id', user.id)
        .order('date', { ascending: false })
        .limit(5),
    ])

  let totalBalance = 0
  if (accounts) {
    accounts.forEach(acc => {
      if (acc.type === 'credit' || acc.type === 'loan') {
        totalBalance -= Number(acc.current_balance || 0)
      } else {
        totalBalance += Number(acc.current_balance || 0)
      }
    })
  }

  let monthlySpending = 0
  let monthlyIncome = 0

  if (monthTx) {
    monthTx.forEach(tx => {
      const amounts = getMonthlySemanticAmounts(tx)
      monthlySpending += amounts.spending
      monthlyIncome += amounts.income
    })
  }

  const savingsRate = monthlyIncome > 0 ? ((monthlyIncome - monthlySpending) / monthlyIncome) * 100 : 0

  const stats = [
    { label: 'Total Balance', value: totalBalance, change: 'Updated', trend: 'neutral' },
    { label: 'Monthly Spending', value: monthlySpending, change: 'This Month', trend: 'neutral' },
    { label: 'Monthly Income', value: monthlyIncome, change: 'This Month', trend: 'neutral' },
    { label: 'Savings Rate', value: Math.max(0, savingsRate), isPercentage: true, change: 'This Month', trend: 'neutral' },
  ]

  // Mapping categories to icons roughly
  const getIcon = (category: string | null) => {
    const c = (category || '').toLowerCase()
    if (c.includes('food') || c.includes('groceries')) return '🛒'
    if (c.includes('transport') || c.includes('uber') || c.includes('lyft')) return '🚗'
    if (c.includes('entertainment') || c.includes('netflix')) return '🎬'
    if (c.includes('income') || c.includes('salary')) return '💰'
    if (c.includes('coffee') || c.includes('starbucks')) return '☕'
    return '💳'
  }

  const recentTransactions = recentTx?.map(tx => ({
    id: tx.id,
    merchant: tx.merchant_name || tx.description || 'Unknown',
    category: tx.source === 'plaid' ? 'Bank Sync' : 'Manual',
    amount: -Number(tx.amount), // negate because DB positive = expense. We want expense to show as negative in UI.
    date: tx.date,
    icon: getIcon(tx.description)
  })) || []

  return (
    <div className="dashboard">
      <div className="welcome-section">
        <h2>Welcome back! 👋</h2>
        <p className="text-secondary">Here&apos;s your financial overview.</p>
      </div>

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
                recentTransactions.map((tx) => (
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
    </div>
  )
}
