'use client'

export default function BudgetsPage() {
  return (
    <div className="budgets-page">
      <div className="page-header">
        <h1>Budgets</h1>
        <button className="btn btn-primary">➕ New Budget</button>
      </div>

      <div className="card empty-state">
        <span className="empty-icon">🎯</span>
        <h3>Stay on track</h3>
        <p className="text-secondary">
          Set up category budgets to monitor your spending limits.
        </p>
        <button className="btn btn-primary mt-4">Create First Budget</button>
      </div>

      
    </div>
  )
}
