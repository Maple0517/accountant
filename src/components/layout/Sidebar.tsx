'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  AccountsIcon,
  BudgetsIcon,
  InsightsIcon,
  IntegrationsIcon,
  OverviewIcon,
  ReviewIcon,
  TransactionsIcon,
} from './icons'

const NAV_ITEMS = [
  { name: 'Overview', href: '/dashboard', icon: OverviewIcon },
  { name: 'Review', href: '/review', icon: ReviewIcon },
  { name: 'Transactions', href: '/transactions', icon: TransactionsIcon },
  { name: 'Budgets', href: '/budgets', icon: BudgetsIcon },
  { name: 'Insights', href: '/analytics', icon: InsightsIcon },
  { name: 'Accounts', href: '/accounts', icon: AccountsIcon },
  { name: 'Integrations', href: '/settings', icon: IntegrationsIcon },
]

export default function Sidebar({ userEmail }: { userEmail: string | null }) {
  const pathname = usePathname()

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="sidebar-header">
        <span className="brand-mark">A</span>
        <div>
          <span className="sidebar-kicker">AI money cockpit</span>
          <h2>Accountant</h2>
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`nav-item ${isActive ? 'active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="nav-icon"><Icon /></span>
              <span className="nav-label">{item.name}</span>
            </Link>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="user-info">
          <div className="avatar">{userEmail ? userEmail.charAt(0).toUpperCase() : 'U'}</div>
          <div className="user-details">
            <span className="user-email">{userEmail || 'User'}</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
