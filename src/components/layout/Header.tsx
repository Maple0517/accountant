'use client'

import { useRouter } from 'next/navigation'
import { StatusDot } from '@/components/ui/StatusDot'
import { useI18n } from '@/i18n/client'
import { useTheme } from '@/lib/theme/client'

export default function Header({ userEmail }: { userEmail: string | null }) {
  const router = useRouter()
  const { locale, toggleLocale, t } = useI18n()
  const { theme, toggleTheme } = useTheme()

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
          <div className="topbar-brand">{t('app.brand')}</div>
          <p>{t('app.subtitle')}</p>
        </div>
        <div className="topbar-actions">
          <StatusDot tone="success" label={t('app.signedIn')} />
          <span className="topbar-status">{userEmail || t('app.user')}</span>
          <button
            className="btn btn-ghost btn-sm theme-toggle"
            onClick={toggleTheme}
            type="button"
            aria-label={theme === 'light' ? t('app.switchToDark') : t('app.switchToLight')}
            title={theme === 'light' ? t('app.switchToDark') : t('app.switchToLight')}
          >
            <span aria-hidden="true">{theme === 'light' ? '🌙' : '☀️'}</span>
          </button>
          <button
            className="btn btn-ghost btn-sm language-toggle"
            onClick={toggleLocale}
            type="button"
            aria-label={locale === 'en' ? t('app.switchToChinese') : t('app.switchToEnglish')}
            title={t('app.language')}
          >
            {locale === 'en' ? t('app.languageChinese') : t('app.languageEnglish')}
          </button>
          <button className="btn-signout btn-signout-inline" onClick={handleSignOut} type="button">
            {t('app.signOut')}
          </button>
        </div>
      </div>
    </header>
  )
}
