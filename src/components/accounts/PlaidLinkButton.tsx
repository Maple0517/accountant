'use client'

import { useState, useCallback, useEffect } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import { useI18n } from '@/i18n/client'

interface PlaidLinkButtonProps {
  onSuccess?: () => void
}

export default function PlaidLinkButton({ onSuccess }: PlaidLinkButtonProps) {
  const { t } = useI18n()
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function createToken() {
      try {
        const response = await fetch('/api/plaid/create-link-token', { method: 'POST' })
        const data = await response.json()
        if (data.link_token) {
          setToken(data.link_token)
        } else {
          setError(t('accounts.linkTokenError'))
        }
      } catch {
        setError(t('accounts.plaidInitError'))
      }
    }
    createToken()
  }, [t])

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
      }
    },
    [onSuccess, t]
  )

  const { open, ready } = usePlaidLink({ token: token!, onSuccess: handleOnSuccess })

  return (
    <div className="plaid-link-container">
      {error && <div className="error-message">{error}</div>}
      <button className="btn btn-primary btn-md btn-link-bank" onClick={() => open()} disabled={!ready || !token || loading} type="button">
        {loading ? t('common.connecting') : t('accounts.connectBank')}
      </button>
    </div>
  )
}
