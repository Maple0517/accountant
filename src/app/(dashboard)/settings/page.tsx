'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import useSWR from 'swr'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import type { Profile, ReceiptApiKey } from '@/types'

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
  const visibleMessage = message || (profileError ? { text: profileError.message || 'Failed to load settings.', type: 'error' as const } : null)

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
        setMessage({ text: data.error || 'Failed to save settings.', type: 'error' })
      } else {
        setProfileDraft({})
        setNotionTokenInput('')
        mutateProfile({ profile: data.profile }, false)
        setMessage({ text: 'Settings saved successfully.', type: 'success' })
      }
    } catch {
      setMessage({ text: 'Failed to save settings.', type: 'error' })
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
          setMessage({ text: saveData.error || 'Failed to save Notion token.', type: 'error' })
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
        setMessage({ text: `Sync complete! Synced ${data.synced} transactions. ${data.failed > 0 ? `(${data.failed} failed)` : ''}`, type: 'success' })
        mutateProfile()
      }
    } catch {
      setMessage({ text: 'An unexpected error occurred.', type: 'error' })
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
        setMessage({ text: data.error || 'Failed to create API key.', type: 'error' })
        return
      }

      setGeneratedApiKey(data.token)
      mutateApiKeys((current) => ({ api_keys: [data.api_key, ...(current?.api_keys || [])] }), false)
      setMessage({ text: 'API key created. Copy it now; it will only be shown once.', type: 'success' })
    } catch {
      setMessage({ text: 'Failed to create API key.', type: 'error' })
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
        setMessage({ text: data.error || 'Failed to revoke API key.', type: 'error' })
        return
      }

      mutateApiKeys((current) => ({
        ...current,
        api_keys: (current?.api_keys || []).map((key) => key.id === id ? { ...key, revoked_at: new Date().toISOString() } : key),
      }), false)
      setMessage({ text: 'API key revoked.', type: 'success' })
    } catch {
      setMessage({ text: 'Failed to revoke API key.', type: 'error' })
    } finally {
      setApiKeyBusy(false)
    }
  }

  const handleCopy = async (text: string, label: string) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setMessage({ text: `${label} copied.`, type: 'success' })
    } catch {
      setMessage({ text: `Could not copy ${label.toLowerCase()}.`, type: 'error' })
    }
  }

  const formatTimestamp = (value?: string | null) => {
    if (!value) return 'Never'
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
  }

  return (
    <div className="settings-page">
      <PageHeader title="Integrations" subtitle="Manage profile settings, Notion sync, and iOS Shortcut capture without exposing raw internals by default." />

      {visibleMessage && <div className={`alert ${visibleMessage.type === 'success' ? 'alert-success' : 'alert-error'}`}>{visibleMessage.text}</div>}

      <form onSubmit={handleSave} className="settings-grid">
        <Card className="settings-card">
          <h2>Profile</h2>
          <p className="settings-card-intro">Defaults used across the workspace.</p>
          <div className="input-group">
            <label className="input-label" htmlFor="settings-display-name">Display name</label>
            <input id="settings-display-name" type="text" className="input" value={profile?.display_name || ''} onChange={(e) => setProfileDraft((p) => ({ ...p, display_name: e.target.value }))} />
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="settings-default-currency">Default currency</label>
            <select id="settings-default-currency" className="input" value={profile?.default_currency || 'USD'} onChange={(e) => setProfileDraft((p) => ({ ...p, default_currency: e.target.value }))}>
              <option value="USD">USD ($)</option>
              <option value="CNY">CNY (¥)</option>
            </select>
          </div>
        </Card>

        <Card className="settings-card">
          <div className="card-header" style={{ padding: 0, border: 0, marginBottom: '1rem' }}>
            <div>
              <h2>Notion</h2>
              <p className="settings-card-intro" style={{ marginBottom: 0 }}>Single-direction transaction sync to your own database.</p>
            </div>
            <Badge tone={profile?.notion_token_configured ? 'success' : 'muted'}>{profile?.notion_token_configured ? 'Connected' : 'Not connected'}</Badge>
          </div>

          <div className="toggle-group mb-4">
            <label className="toggle-label">
              <input type="checkbox" className="toggle-checkbox" checked={profile?.notion_sync_enabled || false} onChange={(e) => setProfileDraft((p) => ({ ...p, notion_sync_enabled: e.target.checked }))} />
              <span>Enable Notion sync</span>
            </label>
          </div>

          {profile?.notion_sync_enabled && (
            <>
              <div className="input-group">
                <label className="input-label" htmlFor="settings-notion-token">Notion internal integration token</label>
                <input id="settings-notion-token" type="password" className="input" placeholder={profile.notion_token_configured ? 'Leave blank to keep existing token' : 'secret_...'} value={notionTokenInput} onChange={(e) => setNotionTokenInput(e.target.value)} />
                {profile.notion_token_configured && <p className="input-hint">Token saved: {profile.notion_token_masked || 'configured'}.</p>}
              </div>

              {!profile?.notion_database_id ? (
                <div className="input-group">
                  <label className="input-label" htmlFor="settings-notion-parent-page">Initial setup parent page ID</label>
                  <input type="text" id="settings-notion-parent-page" className="input" placeholder="Share a Notion page with the integration and paste its ID" value={parentPageId} onChange={(e) => setParentPageId(e.target.value)} />
                </div>
              ) : (
                <div className="input-group">
                  <label className="input-label">Database</label>
                  <div className="code-block">Configured database ending in …{profile.notion_database_id.slice(-6)}</div>
                </div>
              )}

              <button type="button" className="btn btn-secondary" onClick={handleManualSync} disabled={syncing || (!profile.notion_token_configured && !notionTokenInput.trim()) || (!profile.notion_database_id && !parentPageId)}>
                {syncing ? 'Syncing...' : 'Force sync'}
              </button>
            </>
          )}
        </Card>

        <Card className="settings-card full-width">
          <div className="card-header" style={{ padding: 0, border: 0, marginBottom: '1rem' }}>
            <div>
              <h2>iOS Shortcut Capture</h2>
              <p className="settings-card-intro" style={{ marginBottom: 0 }}>Capture receipts or payment screenshots and convert them into transactions.</p>
            </div>
            <Badge tone={apiKeys.some((key) => !key.revoked_at) ? 'success' : 'muted'}>{apiKeys.some((key) => !key.revoked_at) ? 'Key active' : 'No active key'}</Badge>
          </div>

          {generatedApiKey && (
            <div className="api-key-reveal">
              <div>
                <label className="input-label">New API key</label>
                <div className="code-block"><code>{generatedApiKey}</code></div>
                <p className="input-hint mt-2">Copy this key now. It is stored as a hash and cannot be shown again.</p>
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => handleCopy(generatedApiKey, 'API key')}>Copy key</button>
            </div>
          )}

          {apiKeyMigrationRequired && <div className="alert alert-error mb-4">API key storage is not ready. Run <code>supabase/migrations/002_ios_receipt_api_keys.sql</code> in Supabase before generating Shortcut keys.</div>}

          <div className="api-key-actions">
            <div className="input-group api-key-name">
              <label className="input-label" htmlFor="settings-api-key-name">Key name</label>
              <input id="settings-api-key-name" type="text" className="input" value={apiKeyName} onChange={(e) => setApiKeyName(e.target.value)} />
            </div>
            <button type="button" className="btn btn-primary" onClick={handleCreateApiKey} disabled={apiKeyBusy || apiKeyMigrationRequired}>{apiKeyBusy ? 'Working...' : 'Generate key'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => handleCopy(receiptEndpoint, 'Endpoint')}>Copy endpoint</button>
          </div>

          <div className="api-key-list">
            {apiKeys.length === 0 ? <p className="text-muted text-sm">No API keys yet.</p> : apiKeys.map((key) => (
              <div key={key.id} className="api-key-row">
                <div>
                  <div className="api-key-title"><span>{key.name}</span><Badge tone={key.revoked_at ? 'danger' : 'success'}>{key.revoked_at ? 'Revoked' : 'Active'}</Badge></div>
                  <div className="api-key-meta"><code>{key.key_prefix}...</code><span>Created {formatTimestamp(key.created_at)}</span><span>Last used {formatTimestamp(key.last_used_at)}</span></div>
                </div>
                {!key.revoked_at && <button type="button" className="btn btn-danger" onClick={() => handleRevokeApiKey(key.id)} disabled={apiKeyBusy}>Revoke</button>}
              </div>
            ))}
          </div>

          <details className="advanced-details">
            <summary>Advanced endpoint details</summary>
            <div className="input-group mt-4">
              <label className="input-label">Capture endpoint</label>
              <div className="code-block"><code>{receiptEndpoint}</code></div>
              <p className="input-hint">Put this URL in the Shortcut “Get Contents of URL” action.</p>
            </div>
          </details>
        </Card>

        <div className="form-actions full-width">
          <button type="submit" className="btn btn-primary" disabled={saving || !profile}>{saving ? 'Saving...' : 'Save settings'}</button>
        </div>
      </form>
    </div>
  )
}
