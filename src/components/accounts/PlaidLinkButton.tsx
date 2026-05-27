'use client'

import dynamic from 'next/dynamic'
import { useState, useCallback } from 'react'
import { useI18n } from '@/i18n/client'

const PlaidLinkLauncher = dynamic(() => import('./PlaidLinkLauncher'), {
  ssr: false,
})

interface PlaidLinkButtonProps {
  onSuccess?: () => void
}

export default function PlaidLinkButton({ onSuccess }: PlaidLinkButtonProps) {
  const { t } = useI18n()
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createToken = useCallback(async () => {
    setLoading(true)
    setError(null)
    setToken(null)
    try {
      const response = await fetch('/api/plaid/create-link-token', { method: 'POST' })
      const data = await response.json()
      if (data.link_token) {
        setToken(data.link_token)
      } else {
        setError(t('accounts.linkTokenError'))
        setLoading(false)
      }
    } catch {
      setError(t('accounts.plaidInitError'))
      setLoading(false)
    }
  }, [t])

  const handleOnExit = useCallback(() => {
    setLoading(false)
    setToken(null)
  }, [])

  const handleOnSuccess = useCallback(
    async (public_token: string) => {
      setLoading(true)
      try {
        const response = await fetch('/api/plaid/exchange-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_token }),
        })
        const data = await response.json()

        if (data.success && data.item_id) {
          await fetch('/api/plaid/sync-transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plaid_item_id: data.item_id }),
          })
          if (onSuccess) onSuccess()
        }
      } catch {
        setError(t('accounts.linkError'))
      } finally {
        setLoading(false)
        setToken(null)
      }
    },
    [onSuccess, t]
  )

  return (
    <div className="plaid-link-container">
      {error && <div className="error-message">{error}</div>}
      <button className="btn btn-primary btn-md btn-link-bank" onClick={createToken} disabled={loading} type="button">
        {loading ? t('common.connecting') : t('accounts.connectBank')}
      </button>
      {token && (
        <PlaidLinkLauncher
          token={token}
          onExit={handleOnExit}
          onSuccess={handleOnSuccess}
        />
      )}
    </div>
  )
}
