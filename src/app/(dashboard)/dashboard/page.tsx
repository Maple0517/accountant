import { createClient } from '@/lib/supabase/server'
import { formatCurrency } from '@/lib/currency'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Fetch accounts
  const { data: accounts } = await supabase
    .from('accounts')
    .select('*')
    .eq('user_id', user.id)

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

  // Fetch current month's transactions
  const now = new Date()
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]

  const { data: monthTx } = await supabase
    .from('transactions')
    .select('amount, source')
    .eq('user_id', user.id)
    .gte('date', firstDayOfMonth)

  let monthlySpending = 0
  let monthlyIncome = 0

  if (monthTx) {
    monthTx.forEach(tx => {
      const amt = Number(tx.amount)
      // Plaid: positive = expense, negative = income
      // Manual: positive = expense, negative = income
      if (amt > 0) {
        monthlySpending += amt
      } else if (amt < 0) {
        monthlyIncome += Math.abs(amt)
      }
    })
  }

  const savingsRate = monthlyIncome > 0 ? ((monthlyIncome - monthlySpending) / monthlyIncome) * 100 : 0

  const stats = [
    { label: 'Total Balance', value: totalBalance, change: 'Updated', trend: 'neutral' },
    { label: 'Monthly Spending', value: monthlySpending, change: 'This Month', trend: 'neutral' },
    { label: 'Monthly Income', value: monthlyIncome, change: 'This Month', trend: 'neutral' },
    { label: 'Savings Rate', value: Math.max(0, savingsRate).toFixed(1), isPercentage: true, change: 'This Month', trend: 'neutral' },
  ]

  // Fetch recent transactions
  const { data: recentTx } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: false })
    .limit(5)

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
        <p className="text-secondary">Here's your financial overview.</p>
      </div>

      <div className="stats-grid">
        {stats.map((stat, i) => (
          <div key={i} className="card stat-card">
            <span className="stat-label">{stat.label}</span>
            <div className="stat-value-row">
              <span className="stat-value">
                {stat.isPercentage ? `${stat.value}%` : formatCurrency(stat.value)}
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
              <h3>Budget Progress (Coming Soon)</h3>
              <button className="btn btn-ghost text-sm">View All</button>
            </div>
            <div className="budget-list">
              <div className="budget-item">
                <div className="budget-info">
                  <span>🍔 Food & Dining</span>
                  <span className="budget-amounts">$450 / $600</span>
                </div>
                <div className="progress-bg">
                  <div className="progress-fill warning" style={{ width: '75%' }}></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="side-col">
          <div className="card transactions-card">
            <div className="card-header">
              <h3>Recent Transactions</h3>
              <button className="btn btn-ghost text-sm">View All</button>
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
