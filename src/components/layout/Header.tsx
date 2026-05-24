'use client'

import { useRouter } from 'next/navigation'
import { StatusDot } from '@/components/ui/StatusDot'

export default function Header({ userEmail }: { userEmail: string | null }) {
  const router = useRouter()

  const handleSignOut = async () => {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  return (
    <header className="topbar">
      <div className="topbar-content">
        <div className="topbar-title">
          <div className="topbar-brand">Accountant</div>
          <p>AI-powered money review workspace</p>
        </div>
        <div className="topbar-actions">
          <StatusDot tone="success" label="Signed in" />
          <span className="topbar-status">{userEmail || 'User'}</span>
          <button className="btn-signout btn-signout-inline" onClick={handleSignOut} type="button">
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}
