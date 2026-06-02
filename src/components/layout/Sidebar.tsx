'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useI18n } from '@/i18n/client'
import { useShellUser } from './useShellUser'
import {
  AccountsIcon,
  BudgetsIcon,
  InsightsIcon,
  IntegrationsIcon,
  OverviewIcon,
  TransactionsIcon,
} from './icons'

const NAV_ITEMS = [
  { labelKey: 'nav.overview', href: '/dashboard', icon: OverviewIcon },
  { labelKey: 'nav.transactions', href: '/transactions', icon: TransactionsIcon },
  { labelKey: 'nav.budgets', href: '/budgets', icon: BudgetsIcon },
  { labelKey: 'nav.insights', href: '/analytics', icon: InsightsIcon },
  { labelKey: 'nav.accounts', href: '/accounts', icon: AccountsIcon },
  { labelKey: 'nav.integrations', href: '/settings', icon: IntegrationsIcon },
]

export default function Sidebar({ userEmail }: { userEmail: string | null }) {
  const pathname = usePathname()
  const { t } = useI18n()
  const resolvedUserEmail = useShellUser(userEmail)

  return (
    <aside className="sidebar" aria-label={t('nav.primary')}>
      <div className="sidebar-header">
        <span className="brand-mark">A</span>
        <div>
          <span className="sidebar-kicker">{t('app.kicker')}</span>
          <h2>{t('app.brand')}</h2>
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
              key={item.href}
              href={item.href}
              className={`nav-item ${isActive ? 'active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="nav-icon"><Icon /></span>
              <span className="nav-label">{t(item.labelKey)}</span>
            </Link>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="user-info">
          <div className="avatar">{resolvedUserEmail ? resolvedUserEmail.charAt(0).toUpperCase() : 'U'}</div>
          <div className="user-details">
            <span className="user-email">{resolvedUserEmail || t('app.user')}</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
