import { I18nProvider, type Locale } from '@/i18n/client'
import { ThemeProvider } from '@/lib/theme/client'
import Sidebar from './Sidebar'
import Header from './Header'

export function AppShell({
  children,
  userEmail,
  initialLocale = 'en',
}: {
  children: React.ReactNode
  userEmail: string | null
  initialLocale?: Locale
}) {
  return (
    <ThemeProvider>
      <I18nProvider initialLocale={initialLocale}>
        <div className="app-layout">
          <Sidebar userEmail={userEmail} />
          <div className="main-content">
            <Header userEmail={userEmail} />
            <main className="page-content animate-fade-in">{children}</main>
          </div>
        </div>
      </I18nProvider>
    </ThemeProvider>
  )
}
