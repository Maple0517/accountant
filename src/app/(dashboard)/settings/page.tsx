'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types'

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [parentPageId, setParentPageId] = useState('')

  const supabase = createClient()

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single()
        
        if (data) {
          setProfile(data)
        }
      }
      setLoading(false)
    }
    loadProfile()
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
          .select('*')
          .eq('id', profile!.id)
          .single()
        if (newProfile) setProfile(newProfile)
      }
    } catch (e) {
      setMessage({ text: 'An unexpected error occurred.', type: 'error' })
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return (
      <div className="settings-page">
        <h1>Settings</h1>
        <div className="card skeleton" style={{ height: '400px' }}></div>
      </div>
    )
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
          <h2>iOS Shortcut & Receipt API</h2>
          <p className="text-secondary mb-4 text-sm">
            Use the Apple Shortcuts app to scan receipts via the Gemini Vision API.
          </p>
          
          <div className="input-group">
            <label className="input-label">Your API Key (User ID)</label>
            <div className="code-block">
              <code>{profile?.id || 'Loading...'}</code>
            </div>
            <p className="text-muted text-xs mt-2">
              Use this key in your iOS Shortcut to authenticate with the /api/receipt endpoint.
            </p>
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
