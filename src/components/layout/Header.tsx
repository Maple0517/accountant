'use client'

import { useRouter } from 'next/navigation'
import { StatusDot } from '@/components/ui/StatusDot'
import { useI18n } from '@/i18n/client'

export default function Header({ userEmail }: { userEmail: string | null }) {
  const router = useRouter()
  const { locale, toggleLocale, t } = useI18n()

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
            className="btn btn-ghost btn-sm language-toggle"
            onClick={toggleLocale}
            type="button"
            aria-label={locale === 'en' ? t('app.switchToChinese') : t('app.switchToEnglish')}
            title={t('app.language')}
          >
            {locale === 'en' ? '中文' : 'EN'}
          </button>
          <button className="btn-signout btn-signout-inline" onClick={handleSignOut} type="button">
            {t('app.signOut')}
          </button>
        </div>
      </div>
    </header>
  )
}
