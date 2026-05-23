'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRouter } from 'next/navigation'

const NAV_ITEMS = [
  { name: 'Dashboard', href: '/dashboard', icon: '📊' },
  { name: 'Transactions', href: '/transactions', icon: '💳' },
  { name: 'Analytics', href: '/analytics', icon: '📈' },
  { name: 'Accounts', href: '/accounts', icon: '🏦' },
  { name: 'Budgets', href: '/budgets', icon: '🎯' },
  { name: 'Settings', href: '/settings', icon: '⚙️' },
]

export default function Sidebar({ userEmail }: { userEmail: string | null }) {
  const pathname = usePathname()
  const router = useRouter()

  const handleSignOut = async () => {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="logo">👛</span>
        <h2>Accountant</h2>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href)
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`nav-item ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.name}</span>
            </Link>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="user-info">
          <div className="avatar">
            {userEmail ? userEmail.charAt(0).toUpperCase() : 'U'}
          </div>
          <div className="user-details">
            <span className="user-email">{userEmail || 'User'}</span>
          </div>
        </div>
        <button className="btn-signout" onClick={handleSignOut}>
          Sign Out
        </button>
      </div>

      
    </aside>
  )
}
