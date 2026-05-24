import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/server'
import { AppShell } from '@/components/layout/AppShell'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user } = await getCurrentUser()

  if (!user) {
    redirect('/auth/login')
  }

  return <AppShell userEmail={user.email ?? null}>{children}</AppShell>
}
