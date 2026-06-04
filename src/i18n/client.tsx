'use client'

import { findDefaultCategoryByName } from '@/lib/categories'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react'

export type Locale = 'en' | 'zh'

type TranslationValue = string | ((params?: Record<string, string | number>) => string)
export type TranslationDictionary = Record<string, TranslationValue>

const STORAGE_KEY = 'accountant.locale'
const COOKIE_KEY = 'accountant.locale'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365
const LOCALE_CHANGE_EVENT = 'accountant-locale-change'
let clientLocaleOverride: Locale | null = null

const en: TranslationDictionary = {
  'app.brand': 'Accountant',
  'app.kicker': 'AI money cockpit',
  'app.subtitle': 'AI-powered money review workspace',
  'app.signedIn': 'Signed in',
  'app.user': 'User',
  'app.signOut': 'Sign out',
  'app.language': 'Language',
  'app.switchToDark': 'Switch to dark mode',
  'app.switchToLight': 'Switch to light mode',
  'app.switchToChinese': 'Switch to Chinese',
  'app.switchToEnglish': 'Switch to English',
  'app.languageChinese': 'Chinese',
  'app.languageEnglish': 'English',
  'nav.primary': 'Primary navigation',
  'nav.overview': 'Overview',
  'nav.transactions': 'Transactions',
  'nav.budgets': 'Budgets',
  'nav.insights': 'Insights',
  'nav.accounts': 'Accounts',
  'nav.integrations': 'Integrations',
  'common.loading': 'Loading...',
  'common.saving': 'Saving...',
  'common.processing': 'Processing...',
  'common.working': 'Working...',
  'common.connecting': 'Connecting...',
  'common.create': 'Create',
  'common.cancel': 'Cancel',
  'common.account': 'Account',
  'common.copy': 'Copy',
  'common.active': 'Active',
  'common.revoked': 'Revoked',
  'common.connected': 'Connected',
  'common.notConnected': 'Not connected',
  'common.never': 'Never',
  'common.none': 'None',
  'common.unknown': 'Unknown',
  'common.uncategorized': 'Uncategorized',
  'common.manual': 'Manual',
  'common.receipt': 'Receipt',
  'common.pending': 'Pending',
  'common.transfer': 'Transfer',
  'common.refund': 'Refund',
  'common.reimbursement': 'Reimbursement',
  'common.excluded': 'Excluded',
  'common.matched': 'Matched',
  'common.suggested': 'Suggested',
  'common.unmatched': 'Unmatched',
  'common.notTransfer': 'Not transfer',
  'common.today': 'Today',
  'common.yesterday': 'Yesterday',
  'common.allClear': 'All clear',
  'common.noData': 'No data',
  'common.saveFailed': 'Save failed',
  'common.failedToFetch': 'Failed to fetch',
  'common.details': 'Details',
}

const zh: TranslationDictionary = {
  ...en,
  'app.kicker': 'AI 财务驾驶舱',
  'app.subtitle': 'AI 驱动的财务复核工作区',
  'app.signedIn': '已登录',
  'app.user': '用户',
  'app.signOut': '退出登录',
  'app.language': '语言',
  'app.switchToDark': '切换到深色模式',
  'app.switchToLight': '切换到浅色模式',
  'app.switchToChinese': '切换到中文',
  'app.switchToEnglish': '切换到英文',
  'app.languageChinese': '中文',
  'app.languageEnglish': '英文',
  'nav.primary': '主导航',
  'nav.overview': '总览',
  'nav.transactions': '交易',
  'nav.budgets': '预算',
  'nav.insights': '洞察',
  'nav.accounts': '账户',
  'nav.integrations': '集成',
  'common.loading': '加载中...',
  'common.saving': '保存中...',
  'common.processing': '处理中...',
  'common.working': '处理中...',
  'common.connecting': '连接中...',
  'common.create': '创建',
  'common.cancel': '取消',
  'common.account': '账户',
  'common.copy': '复制',
  'common.active': '启用',
  'common.revoked': '已撤销',
  'common.connected': '已连接',
  'common.notConnected': '未连接',
  'common.never': '从未',
  'common.none': '无',
  'common.unknown': '未知',
  'common.uncategorized': '未分类',
  'common.manual': '手动',
  'common.receipt': '收据',
  'common.pending': '待入账',
  'common.transfer': '转账',
  'common.refund': '退款',
  'common.reimbursement': '报销',
  'common.excluded': '已排除',
  'common.matched': '已匹配',
  'common.suggested': '建议',
  'common.unmatched': '未匹配',
  'common.notTransfer': '非转账',
  'common.today': '今天',
  'common.yesterday': '昨天',
  'common.allClear': '全部正常',
  'common.noData': '暂无数据',
  'common.saveFailed': '保存失败',
  'common.failedToFetch': '获取失败',
  'common.details': '详情',
}

export type I18nNamespace = {
  en: TranslationDictionary
  zh?: TranslationDictionary
}

export function registerI18nNamespace(namespace: I18nNamespace) {
  Object.assign(en, namespace.en)
  Object.assign(zh, namespace.zh ?? namespace.en)
}

function readCookieLocale(): Locale | null {
  try {
    const cookies = document.cookie.split(';')
    for (const cookie of cookies) {
      const [rawKey, ...rawValue] = cookie.trim().split('=')
      if (rawKey !== COOKIE_KEY) continue
      const value = decodeURIComponent(rawValue.join('='))
      return value === 'en' || value === 'zh' ? value : null
    }
  } catch {
    return null
  }
  return null
}

function detectBrowserLocale(fallback: Locale = 'en'): Locale {
  if (clientLocaleOverride) return clientLocaleOverride
  const cookieLocale = readCookieLocale()
  return cookieLocale ?? fallback
}

function persistLocale(locale: Locale) {
  clientLocaleOverride = locale
  try {
    window.localStorage?.setItem(STORAGE_KEY, locale)
  } catch {
    // Some embedded browser contexts deny storage; keep the in-memory locale.
  }
  try {
    document.cookie = `${COOKIE_KEY}=${locale}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`
  } catch {
    // Cookie writes can also be unavailable in sandboxed previews.
  }
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
}

function subscribeToLocaleChanges(onStoreChange: () => void) {
  window.addEventListener('storage', onStoreChange)
  window.addEventListener(LOCALE_CHANGE_EVENT, onStoreChange)
  return () => {
    window.removeEventListener('storage', onStoreChange)
    window.removeEventListener(LOCALE_CHANGE_EVENT, onStoreChange)
  }
}

function translateFromDictionary(
  dictionary: TranslationDictionary,
  key: string,
  params?: Record<string, string | number>
) {
  const value = dictionary[key] ?? en[key] ?? key
  return typeof value === 'function' ? value(params) : value
}

type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  toggleLocale: () => void
  t: (key: string, params?: Record<string, string | number>) => string
  formatDate: (value: string | Date, options?: Intl.DateTimeFormatOptions) => string
  categoryName: (category?: { name?: string | null; name_zh?: string | null } | null, fallback?: string) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({
  children,
  initialLocale = 'en',
}: {
  children: React.ReactNode
  initialLocale?: Locale
}) {
  const getLocaleSnapshot = useCallback(
    () => detectBrowserLocale(initialLocale),
    [initialLocale]
  )
  const getServerLocaleSnapshot = useCallback(() => initialLocale, [initialLocale])
  const locale = useSyncExternalStore(
    subscribeToLocaleChanges,
    getLocaleSnapshot,
    getServerLocaleSnapshot
  )

  const setLocale = useCallback((nextLocale: Locale) => {
    persistLocale(nextLocale)
    window.dispatchEvent(new Event(LOCALE_CHANGE_EVENT))
  }, [])

  useEffect(() => {
    persistLocale(locale)
  }, [locale])

  const value = useMemo<I18nContextValue>(() => {
    const dictionary = locale === 'zh' ? zh : en
    const t = (key: string, params?: Record<string, string | number>) =>
      translateFromDictionary(dictionary, key, params)

    return {
      locale,
      setLocale,
      toggleLocale: () => setLocale(locale === 'en' ? 'zh' : 'en'),
      t,
      formatDate: (value, options) => {
        const date = typeof value === 'string' ? new Date(value) : value
        return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', options).format(date)
      },
      categoryName: (category, fallback) => {
        if (!category) return fallback ?? t('common.uncategorized')
        const canonicalCategory = findDefaultCategoryByName(category)
        const englishName = canonicalCategory?.name || category.name?.trim()
        const chineseName = category.name_zh?.trim() || canonicalCategory?.name_zh

        if (locale === 'zh') {
          return chineseName || englishName || fallback || t('common.uncategorized')
        }

        return englishName || fallback || t('common.uncategorized')
      },
    }
  }, [locale, setLocale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider')
  }
  return context
}
