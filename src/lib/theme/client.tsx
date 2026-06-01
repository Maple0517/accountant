'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react'

export type ThemeMode = 'light' | 'dark'

type ThemeContextValue = {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
}

const STORAGE_KEY = 'accountant.theme'
const THEME_CHANGE_EVENT = 'accountant-theme-change'
const DEFAULT_THEME: ThemeMode = 'light'

const ThemeContext = createContext<ThemeContextValue | null>(null)
let clientThemeOverride: ThemeMode | null = null

function normalizeTheme(value: string | null | undefined): ThemeMode | null {
  return value === 'dark' || value === 'light' ? value : null
}

function readStoredTheme(): ThemeMode | null {
  try {
    return normalizeTheme(window.localStorage?.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

function persistTheme(theme: ThemeMode) {
  clientThemeOverride = theme
  try {
    window.localStorage?.setItem(STORAGE_KEY, theme)
  } catch {
    // Storage can be unavailable in embedded previews; keep the in-memory theme.
  }
  applyTheme(theme)
}

function detectTheme(): ThemeMode {
  if (clientThemeOverride) return clientThemeOverride
  return readStoredTheme() ?? DEFAULT_THEME
}

function subscribeToThemeChanges(callback: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const getThemeSnapshot = useCallback(() => detectTheme(), [])
  const getServerThemeSnapshot = useCallback(() => DEFAULT_THEME, [])
  const theme = useSyncExternalStore(
    subscribeToThemeChanges,
    getThemeSnapshot,
    getServerThemeSnapshot
  )

  const setTheme = useCallback((nextTheme: ThemeMode) => {
    persistTheme(nextTheme)
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
  }, [])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    setTheme,
    toggleTheme: () => setTheme(theme === 'light' ? 'dark' : 'light'),
  }), [theme, setTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
