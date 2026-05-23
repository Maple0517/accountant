import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/server'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user } = await getCurrentUser()

  if (!user) {
    redirect('/auth/login')
  }

  return (
    <div className="app-layout">
      <Sidebar userEmail={user.email ?? null} />
      <div className="main-content">
        <Header />
        <main className="page-content animate-fade-in">
          {children}
        </main>
      </div>

    </div>
  )
}
