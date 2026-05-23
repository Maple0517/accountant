'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile, ReceiptApiKey } from '@/types'

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [apiKeyBusy, setApiKeyBusy] = useState(false)
  const [apiKeys, setApiKeys] = useState<ReceiptApiKey[]>([])
  const [apiKeyMigrationRequired, setApiKeyMigrationRequired] = useState(false)
  const [apiKeyName, setApiKeyName] = useState('iOS Shortcut')
  const [generatedApiKey, setGeneratedApiKey] = useState('')
  const [receiptEndpoint, setReceiptEndpoint] = useState('')
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [parentPageId, setParentPageId] = useState('')

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('id, display_name, default_currency, notion_sync_enabled, notion_token, notion_database_id, created_at, updated_at')
          .eq('id', user.id)
          .single()
        
        if (data) {
          setProfile(data)
        }
      }
    }
    async function loadInitialApiKeys() {
      const response = await fetch('/api/settings/api-keys')
      const data = await response.json()

      if (response.ok) {
        setApiKeys(data.api_keys || [])
        setApiKeyMigrationRequired(Boolean(data.migration_required))
      }
    }

    const frameId = window.requestAnimationFrame(() => {
      setReceiptEndpoint(`${window.location.origin}/api/receipt`)
    })
    loadProfile()
    loadInitialApiKeys()

    return () => window.cancelAnimationFrame(frameId)
  }, [supabase])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile) return

    setSaving(true)
    setMessage(null)

    const { error } = await supabase
      .from('profiles')
      .update({
        display_name: profile.display_name,
        default_currency: profile.default_currency,
        notion_sync_enabled: profile.notion_sync_enabled,
        notion_token: profile.notion_token,
        notion_database_id: profile.notion_database_id,
      })
      .eq('id', profile.id)

    setSaving(false)

    if (error) {
      setMessage({ text: 'Failed to save settings.', type: 'error' })
    } else {
      setMessage({ text: 'Settings saved successfully.', type: 'success' })
    }
  }

  const handleManualSync = async () => {
    setSyncing(true)
    setMessage(null)

    try {
      const response = await fetch('/api/notion/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent_page_id: parentPageId }),
      })
      
      const data = await response.json()
      
      if (data.error) {
        setMessage({ text: data.error, type: 'error' })
      } else {
        setMessage({ 
          text: `Sync complete! Synced ${data.synced} transactions. ${data.failed > 0 ? `(${data.failed} failed)` : ''}`, 
          type: 'success' 
        })
        
        // Reload profile in case DB ID was set
        const { data: newProfile } = await supabase
          .from('profiles')
          .select('id, display_name, default_currency, notion_sync_enabled, notion_token, notion_database_id, created_at, updated_at')
          .eq('id', profile!.id)
          .single()
        if (newProfile) setProfile(newProfile)
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
      setApiKeys((keys) => [data.api_key, ...keys])
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

      setApiKeys((keys) =>
        keys.map((key) =>
          key.id === id ? { ...key, revoked_at: new Date().toISOString() } : key
        )
      )
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

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value))
  }

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      {message && (
        <div className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-error'}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSave} className="settings-grid">
        <div className="card settings-card">
          <h2>Profile</h2>
          <div className="input-group">
            <label className="input-label">Display Name</label>
            <input
              type="text"
              className="input"
              value={profile?.display_name || ''}
              onChange={(e) => setProfile(p => p ? { ...p, display_name: e.target.value } : null)}
            />
          </div>
          
          <div className="input-group">
            <label className="input-label">Default Currency</label>
            <select
              className="input"
              value={profile?.default_currency || 'USD'}
              onChange={(e) => setProfile(p => p ? { ...p, default_currency: e.target.value } : null)}
            >
              <option value="USD">USD ($)</option>
              <option value="CNY">CNY (¥)</option>
            </select>
          </div>
        </div>

        <div className="card settings-card">
          <h2>Notion Integration</h2>
          <p className="text-secondary mb-4 text-sm">
            Automatically sync your transactions to a Notion database.
          </p>
          
          <div className="toggle-group mb-4">
            <label className="toggle-label">
              <input
                type="checkbox"
                className="toggle-checkbox"
                checked={profile?.notion_sync_enabled || false}
                onChange={(e) => setProfile(p => p ? { ...p, notion_sync_enabled: e.target.checked } : null)}
              />
              <span>Enable Notion Sync</span>
            </label>
          </div>

          {profile?.notion_sync_enabled && (
            <>
              <div className="input-group">
                <label className="input-label">Notion Internal Integration Token</label>
                <input
                  type="password"
                  className="input"
                  placeholder="secret_..."
                  value={profile?.notion_token || ''}
                  onChange={(e) => setProfile(p => p ? { ...p, notion_token: e.target.value } : null)}
                />
              </div>

              {!profile?.notion_database_id ? (
                <div className="input-group">
                  <label className="input-label">Initial Setup: Parent Page ID</label>
                  <p className="text-muted text-xs mb-2">
                    To create the database, share a Notion page with your Integration and paste its ID here.
                  </p>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. 1a2b3c4d5e6f7g8h9i0j"
                    value={parentPageId}
                    onChange={(e) => setParentPageId(e.target.value)}
                  />
                </div>
              ) : (
                <div className="input-group">
                  <label className="input-label">Database ID (Configured)</label>
                  <input
                    type="text"
                    className="input"
                    value={profile?.notion_database_id || ''}
                    disabled
                  />
                  <p className="text-muted text-xs mt-1">Database successfully connected.</p>
                </div>
              )}

              <div className="sync-actions mt-4">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleManualSync}
                  disabled={syncing || !profile.notion_token || (!profile.notion_database_id && !parentPageId)}
                >
                  {syncing ? 'Syncing...' : 'Force Sync to Notion'}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="card settings-card full-width">
          <h2>iOS Shortcut Capture</h2>
          <p className="text-secondary mb-4 text-sm">
            Capture receipts, payment screenshots, or transaction screens and turn them into app transactions.
          </p>
          
          <div className="input-group">
            <label className="input-label">Capture Endpoint</label>
            <div className="code-block">
              <code>{receiptEndpoint || '/api/receipt'}</code>
            </div>
            <p className="text-muted text-xs mt-2">
              Put this URL in the Shortcut “Get Contents of URL” action.
            </p>
          </div>

          {generatedApiKey && (
            <div className="api-key-reveal">
              <div>
                <label className="input-label">New API Key</label>
                <div className="code-block">
                  <code>{generatedApiKey}</code>
                </div>
                <p className="text-muted text-xs mt-2">
                  Copy this key now. It is stored as a hash and cannot be shown again.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => handleCopy(generatedApiKey, 'API key')}
              >
                Copy Key
              </button>
            </div>
          )}

          {apiKeyMigrationRequired && (
            <div className="alert alert-error mb-4">
              API key storage is not ready. Run <code>supabase/migrations/002_ios_receipt_api_keys.sql</code> in Supabase before generating Shortcut keys.
            </div>
          )}

          <div className="api-key-actions">
            <div className="input-group api-key-name">
              <label className="input-label">Key Name</label>
              <input
                type="text"
                className="input"
                value={apiKeyName}
                onChange={(e) => setApiKeyName(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCreateApiKey}
              disabled={apiKeyBusy || apiKeyMigrationRequired}
            >
              {apiKeyBusy ? 'Working...' : 'Generate Key'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => handleCopy(receiptEndpoint, 'Endpoint')}
            >
              Copy Endpoint
            </button>
          </div>

          <div className="api-key-list">
            {apiKeys.length === 0 ? (
              <p className="text-muted text-sm">No API keys yet.</p>
            ) : (
              apiKeys.map((key) => (
                <div key={key.id} className="api-key-row">
                  <div>
                    <div className="api-key-title">
                      <span>{key.name}</span>
                      <span className={key.revoked_at ? 'badge api-key-revoked' : 'badge api-key-active'}>
                        {key.revoked_at ? 'Revoked' : 'Active'}
                      </span>
                    </div>
                    <div className="api-key-meta">
                      <code>{key.key_prefix}...</code>
                      <span>Created {formatTimestamp(key.created_at)}</span>
                      <span>Last used {formatTimestamp(key.last_used_at)}</span>
                    </div>
                  </div>
                  {!key.revoked_at && (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => handleRevokeApiKey(key.id)}
                      disabled={apiKeyBusy}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="form-actions full-width">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>

      
    </div>
  )
}
