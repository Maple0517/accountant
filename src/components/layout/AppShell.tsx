import { I18nProvider } from '@/i18n/client'
import Sidebar from './Sidebar'
import Header from './Header'

export function AppShell({
  children,
  userEmail,
}: {
  children: React.ReactNode
  userEmail: string | null
}) {
  return (
    <I18nProvider>
      <div className="app-layout">
      <Sidebar userEmail={userEmail} />
      <div className="main-content">
        <Header userEmail={userEmail} />
        <main className="page-content animate-fade-in">{children}</main>
      </div>
      </div>
    </I18nProvider>
  )
}
