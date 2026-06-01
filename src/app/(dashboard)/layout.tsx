import { cookies } from 'next/headers'
import type { Locale } from '@/i18n/client'
import { AppShell } from '@/components/layout/AppShell'

const LOCALE_COOKIE_KEY = 'accountant.locale'

function parseLocale(value: string | undefined): Locale {
  return value === 'zh' ? 'zh' : 'en'
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const locale = parseLocale((await cookies()).get(LOCALE_COOKIE_KEY)?.value)

  return <AppShell userEmail={null} initialLocale={locale}>{children}</AppShell>
}
