'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import useSWR from 'swr'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import type { Profile, ReceiptApiKey } from '@/types'
import { useI18n } from '@/i18n/client'

type SafeProfile = Omit<Profile, 'notion_token'> & {
  notion_token?: never
  notion_token_configured?: boolean
  notion_token_masked?: string | null
}

type NotionPayload = { profile?: SafeProfile }
type ApiKeysPayload = { api_keys?: ReceiptApiKey[]; migration_required?: boolean }

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to load')
  return data as T
}

function subscribeReceiptEndpoint() {
  return () => {}
}

function getClientReceiptEndpoint() {
  return `${window.location.origin}/api/receipt`
}

function getServerReceiptEndpoint() {
  return '/api/receipt'
}

function mergeProfile(base: SafeProfile | null, draft: Partial<SafeProfile>): SafeProfile | null {
  return base ? { ...base, ...draft } : null
}

export default function SettingsPage() {
  const { formatDate, t } = useI18n()
  const { data: profileData, error: profileError, mutate: mutateProfile } = useSWR<NotionPayload>('/api/settings/notion', fetcher)
  const { data: apiKeysData, mutate: mutateApiKeys } = useSWR<ApiKeysPayload>('/api/settings/api-keys', fetcher)

  const loadedProfile = profileData?.profile ?? null
  const [profileDraft, setProfileDraft] = useState<Partial<SafeProfile>>({})
  const profile = useMemo(() => mergeProfile(loadedProfile, profileDraft), [loadedProfile, profileDraft])
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [apiKeyBusy, setApiKeyBusy] = useState(false)
  const [apiKeyName, setApiKeyName] = useState('iOS Shortcut')
  const [generatedApiKey, setGeneratedApiKey] = useState('')
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [parentPageId, setParentPageId] = useState('')
  const [notionTokenInput, setNotionTokenInput] = useState('')
  const receiptEndpoint = useSyncExternalStore(
    subscribeReceiptEndpoint,
    getClientReceiptEndpoint,
    getServerReceiptEndpoint
  )

  const apiKeys = apiKeysData?.api_keys || []
  const apiKeyMigrationRequired = Boolean(apiKeysData?.migration_required)
  const visibleMessage = message || (profileError ? { text: profileError.message || t('settings.loadSettingsError'), type: 'error' as const } : null)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile) return

    setSaving(true)
    setMessage(null)

    try {
      const payload: Record<string, unknown> = {
        display_name: profile.display_name,
        default_currency: profile.default_currency,
        notion_sync_enabled: profile.notion_sync_enabled,
        notion_database_id: profile.notion_database_id,
      }
      if (notionTokenInput.trim()) payload.notion_token = notionTokenInput.trim()

      const response = await fetch('/api/settings/notion', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json()

      if (!response.ok) {
        setMessage({ text: data.error || t('settings.saveError'), type: 'error' })
      } else {
        setProfileDraft({})
        setNotionTokenInput('')
        mutateProfile({ profile: data.profile }, false)
        setMessage({ text: t('settings.saveSuccess'), type: 'success' })
      }
    } catch {
      setMessage({ text: t('settings.saveError'), type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const handleManualSync = async () => {
    setSyncing(true)
    setMessage(null)

    try {
      if (!profile?.notion_token_configured && notionTokenInput.trim()) {
        const saveResponse = await fetch('/api/settings/notion', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            display_name: profile?.display_name,
            default_currency: profile?.default_currency,
            notion_sync_enabled: profile?.notion_sync_enabled,
            notion_database_id: profile?.notion_database_id,
            notion_token: notionTokenInput.trim(),
          }),
        })
        const saveData = await saveResponse.json()
        if (!saveResponse.ok) {
          setMessage({ text: saveData.error || t('settings.saveTokenError'), type: 'error' })
          return
        }
        setProfileDraft({})
        setNotionTokenInput('')
        mutateProfile({ profile: saveData.profile }, false)
      }

      const response = await fetch('/api/notion/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent_page_id: parentPageId }),
      })
      const data = await response.json()

      if (data.error) {
        setMessage({ text: data.error, type: 'error' })
      } else {
        setMessage({ text: t('settings.syncComplete', { synced: data.synced, failedPart: data.failed > 0 ? t('settings.syncFailedPart', { failed: data.failed }) : '' }), type: 'success' })
        mutateProfile()
      }
    } catch {
      setMessage({ text: t('settings.unexpectedError'), type: 'error' })
    } finally {
      setSyncing(false)
    }
  }

  const handleCreateApiKey = async () => {
    setApiKeyBusy(true)
    setMessage(null)

    try {
      const response = await fetch('/api/settings/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: apiKeyName }),
      })
      const data = await response.json()

      if (!response.ok) {
        setMessage({ text: data.error || t('settings.createKeyError'), type: 'error' })
        return
      }

      setGeneratedApiKey(data.token)
      mutateApiKeys((current) => ({ api_keys: [data.api_key, ...(current?.api_keys || [])] }), false)
      setMessage({ text: t('settings.keyCreated'), type: 'success' })
    } catch {
      setMessage({ text: t('settings.createKeyError'), type: 'error' })
    } finally {
      setApiKeyBusy(false)
    }
  }

  const handleRevokeApiKey = async (id: string) => {
    setApiKeyBusy(true)
    setMessage(null)

    try {
      const response = await fetch('/api/settings/api-keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = await response.json()

      if (!response.ok) {
        setMessage({ text: data.error || t('settings.revokeKeyError'), type: 'error' })
        return
      }

      mutateApiKeys((current) => ({
        ...current,
        api_keys: (current?.api_keys || []).map((key) => key.id === id ? { ...key, revoked_at: new Date().toISOString() } : key),
      }), false)
      setMessage({ text: t('settings.keyRevoked'), type: 'success' })
    } catch {
      setMessage({ text: t('settings.revokeKeyError'), type: 'error' })
    } finally {
      setApiKeyBusy(false)
    }
  }

  const handleCopy = async (text: string, label: string) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setMessage({ text: t('settings.copied', { label }), type: 'success' })
    } catch {
      setMessage({ text: t('settings.copyError', { label: label.toLowerCase() }), type: 'error' })
    }
  }

  const formatTimestamp = (value?: string | null) => {
    if (!value) return t('common.never')
    return formatDate(new Date(value), { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  return (
    <div className="settings-page">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      {visibleMessage && <div className={`alert ${visibleMessage.type === 'success' ? 'alert-success' : 'alert-error'}`}>{visibleMessage.text}</div>}

      <form onSubmit={handleSave} className="settings-grid settings-workspace">
        <div className="settings-form-rail">
          <Card className="settings-card settings-profile-card">
            <h2>{t('settings.profile')}</h2>
            <p className="settings-card-intro">{t('settings.profileIntro')}</p>
            <div className="input-group">
              <label className="input-label" htmlFor="settings-display-name">{t('settings.displayName')}</label>
              <input id="settings-display-name" type="text" className="input" value={profile?.display_name || ''} onChange={(e) => setProfileDraft((p) => ({ ...p, display_name: e.target.value }))} />
            </div>
            <div className="input-group">
              <label className="input-label" htmlFor="settings-default-currency">{t('settings.defaultCurrency')}</label>
              <select id="settings-default-currency" className="input" value={profile?.default_currency || 'USD'} onChange={(e) => setProfileDraft((p) => ({ ...p, default_currency: e.target.value }))}>
                <option value="USD">USD ($)</option>
                <option value="CNY">CNY (¥)</option>
              </select>
            </div>
          </Card>

          <div className="settings-save-panel">
            <button type="submit" className="btn btn-primary" disabled={saving || !profile}>{saving ? t('settings.saving') : t('settings.saveSettings')}</button>
          </div>
        </div>

        <div className="settings-main-stack">
          <Card className="settings-card">
            <div className="card-header settings-section-header">
              <div>
                <h2>{t('settings.notion')}</h2>
                <p className="settings-card-intro">{t('settings.notionIntro')}</p>
              </div>
              <Badge tone={profile?.notion_token_configured ? 'success' : 'muted'}>{profile?.notion_token_configured ? t('common.connected') : t('common.notConnected')}</Badge>
            </div>

            <div className="toggle-group mb-4">
              <label className="toggle-label">
                <input type="checkbox" className="toggle-checkbox" checked={profile?.notion_sync_enabled || false} onChange={(e) => setProfileDraft((p) => ({ ...p, notion_sync_enabled: e.target.checked }))} />
                <span>{t('settings.enableNotion')}</span>
              </label>
            </div>

            {profile?.notion_sync_enabled && (
              <>
                <div className="input-group">
                  <label className="input-label" htmlFor="settings-notion-token">{t('settings.notionToken')}</label>
                  <input id="settings-notion-token" type="password" className="input" placeholder={profile.notion_token_configured ? t('settings.keepTokenPlaceholder') : 'secret_...'} value={notionTokenInput} onChange={(e) => setNotionTokenInput(e.target.value)} />
                  {profile.notion_token_configured && <p className="input-hint">{t('settings.tokenSaved', { token: profile.notion_token_masked || t('settings.configured') })}</p>}
                </div>

                {!profile?.notion_database_id ? (
                  <div className="input-group">
                    <label className="input-label" htmlFor="settings-notion-parent-page">{t('settings.parentPage')}</label>
                    <input type="text" id="settings-notion-parent-page" className="input" placeholder={t('settings.parentPagePlaceholder')} value={parentPageId} onChange={(e) => setParentPageId(e.target.value)} />
                  </div>
                ) : (
                  <div className="input-group">
                    <label className="input-label">{t('settings.database')}</label>
                    <div className="code-block">{t('settings.databaseConfigured', { suffix: profile.notion_database_id.slice(-6) })}</div>
                  </div>
                )}

                <button type="button" className="btn btn-secondary" onClick={handleManualSync} disabled={syncing || (!profile.notion_token_configured && !notionTokenInput.trim()) || (!profile.notion_database_id && !parentPageId)}>
                  {syncing ? t('settings.syncing') : t('settings.forceSync')}
                </button>
              </>
            )}
          </Card>

        <Card className="settings-card settings-capture-card">
          <div className="card-header settings-section-header">
            <div>
              <h2>{t('settings.iosCapture')}</h2>
              <p className="settings-card-intro">{t('settings.iosCaptureIntro')}</p>
            </div>
            <Badge tone={apiKeys.some((key) => !key.revoked_at) ? 'success' : 'muted'}>{apiKeys.some((key) => !key.revoked_at) ? t('settings.keyActive') : t('settings.noActiveKey')}</Badge>
          </div>

          {generatedApiKey && (
            <div className="api-key-reveal">
              <div>
                <label className="input-label">{t('settings.newApiKey')}</label>
                <div className="code-block"><code>{generatedApiKey}</code></div>
                <p className="input-hint mt-2">{t('settings.copyNow')}</p>
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => handleCopy(generatedApiKey, t('settings.apiKeyLabel'))}>{t('settings.copyKey')}</button>
            </div>
          )}

          {apiKeyMigrationRequired && <div className="alert alert-error mb-4">{t('settings.apiKeyStorageNotReady')}</div>}

          <div className="api-key-actions">
            <div className="input-group api-key-name">
              <label className="input-label" htmlFor="settings-api-key-name">{t('settings.keyName')}</label>
              <input id="settings-api-key-name" type="text" className="input" value={apiKeyName} onChange={(e) => setApiKeyName(e.target.value)} />
            </div>
            <button type="button" className="btn btn-primary" onClick={handleCreateApiKey} disabled={apiKeyBusy || apiKeyMigrationRequired}>{apiKeyBusy ? t('common.working') : t('settings.generateKey')}</button>
            <button type="button" className="btn btn-ghost" onClick={() => handleCopy(receiptEndpoint, t('settings.endpointLabel'))}>{t('settings.copyEndpoint')}</button>
          </div>

          <div className="api-key-list">
            {apiKeys.length === 0 ? <p className="text-muted text-sm">{t('settings.noApiKeys')}</p> : apiKeys.map((key) => (
              <div key={key.id} className="api-key-row">
                <div>
                  <div className="api-key-title"><span>{key.name}</span><Badge tone={key.revoked_at ? 'danger' : 'success'}>{key.revoked_at ? t('common.revoked') : t('common.active')}</Badge></div>
                  <div className="api-key-meta"><code>{key.key_prefix}...</code><span>{t('settings.created', { time: formatTimestamp(key.created_at) })}</span><span>{t('settings.lastUsed', { time: formatTimestamp(key.last_used_at) })}</span></div>
                </div>
                {!key.revoked_at && <button type="button" className="btn btn-danger" onClick={() => handleRevokeApiKey(key.id)} disabled={apiKeyBusy}>{t('settings.revoke')}</button>}
              </div>
            ))}
          </div>

          <details className="advanced-details">
            <summary>{t('settings.advancedEndpoint')}</summary>
            <div className="input-group mt-4">
              <label className="input-label">{t('settings.captureEndpoint')}</label>
              <div className="code-block"><code>{receiptEndpoint}</code></div>
              <p className="input-hint">{t('settings.shortcutHint')}</p>
            </div>
          </details>
        </Card>
        </div>
      </form>
    </div>
  )
}
