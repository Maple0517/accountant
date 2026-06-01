'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { StatusDot } from '@/components/ui/StatusDot'
import { useI18n } from '@/i18n/client'

type ThemeMode = 'light' | 'dark'

const THEME_STORAGE_KEY = 'accountant.theme'

function detectPreferredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light'

  try {
    const stored = window.localStorage?.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // ignore storage failures
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') return

  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme

  try {
    window.localStorage?.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // ignore storage failures
  }
}

export default function Header({ userEmail }: { userEmail: string | null }) {
  const router = useRouter()
  const { locale, toggleLocale, t } = useI18n()
  const [theme, setTheme] = useState<ThemeMode>(() => detectPreferredTheme())

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const handleSignOut = async () => {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const toggleTheme = () => {
    setTheme((currentTheme) => currentTheme === 'light' ? 'dark' : 'light')
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
