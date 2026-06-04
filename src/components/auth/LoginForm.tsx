'use client'

import '@/i18n/namespaces/auth'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { I18nProvider, useI18n } from '@/i18n/client'

function LoginFormContent() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const router = useRouter()
  const { locale, toggleLocale, t } = useI18n()

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()

      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${location.origin}/auth/callback`,
          },
        })
        if (error) throw error
        setError(t('auth.checkEmail'))
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (error) throw error
        router.push('/dashboard')
        router.refresh()
      }
    } catch (error: unknown) {
      setError(
        error instanceof Error
          ? error.message
          : t('auth.genericError')
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card card animate-slide-up">
        <div className="brand">
          <button
            type="button"
            className="btn btn-ghost btn-sm language-toggle"
            onClick={toggleLocale}
            aria-label={locale === 'en' ? t('app.switchToChinese') : t('app.switchToEnglish')}
            style={{ alignSelf: 'flex-end' }}
          >
            {locale === 'en' ? t('app.languageChinese') : t('app.languageEnglish')}
          </button>
          <span className="logo-emoji">👛</span>
          <h1>Accountant</h1>
          <p className="subtitle">{t('auth.subtitle')}</p>
        </div>

        <form onSubmit={handleAuth} className="auth-form">
          {error && (
            <div
              className={`alert ${
                isSignUp && !error.includes('error')
                  ? 'alert-success'
                  : 'alert-error'
              }`}
            >
              {error}
            </div>
          )}

          <div className="input-group">
            <label className="input-label" htmlFor="email">
              {t('auth.email')}
            </label>
            <input
              id="email"
              type="email"
              className="input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="input-group">
            <label className="input-label" htmlFor="password">
              {t('auth.password')}
            </label>
            <input
              id="password"
              type="password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary w-full mt-4"
            disabled={loading}
          >
            {loading ? t('common.processing') : isSignUp ? t('auth.createAccount') : t('auth.signIn')}
          </button>
        </form>

        <div className="toggle-mode">
          <p className="text-secondary">
            {isSignUp ? t('auth.haveAccount') : t('auth.noAccount')}{' '}
            <button
              type="button"
              className="text-btn"
              onClick={() => {
                setIsSignUp(!isSignUp)
                setError(null)
              }}
            >
              {isSignUp ? t('auth.signIn') : t('auth.signUp')}
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}

export default function LoginForm() {
  return (
    <I18nProvider>
      <LoginFormContent />
    </I18nProvider>
  )
}
