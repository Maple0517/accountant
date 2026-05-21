'use client'

import { useState, useCallback, useEffect } from 'react'
import { usePlaidLink } from 'react-plaid-link'

interface PlaidLinkButtonProps {
  onSuccess?: () => void
}

export default function PlaidLinkButton({ onSuccess }: PlaidLinkButtonProps) {
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function createToken() {
      try {
        const response = await fetch('/api/plaid/create-link-token', {
          method: 'POST',
        })
        const data = await response.json()
        if (data.link_token) {
          setToken(data.link_token)
        } else {
          setError('Failed to get link token')
        }
      } catch {
        setError('Error initializing Plaid')
      }
    }
    createToken()
  }, [])

  const handleOnSuccess = useCallback(
    async (public_token: string) => {
      setLoading(true)
      try {
        // Exchange token
        const response = await fetch('/api/plaid/exchange-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_token }),
        })
        const data = await response.json()
        
        if (data.success && data.item_id) {
          // Sync transactions immediately
          await fetch('/api/plaid/sync-transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plaid_item_id: data.item_id }),
          })
          
          if (onSuccess) onSuccess()
        }
      } catch {
        setError('Error linking account')
      } finally {
        setLoading(false)
      }
    },
    [onSuccess]
  )

  const { open, ready } = usePlaidLink({
    token: token!,
    onSuccess: handleOnSuccess,
  })

  return (
    <div className="plaid-link-container">
      {error && <div className="error-message">{error}</div>}
      <button
        className="btn btn-primary btn-link-bank"
        onClick={() => open()}
        disabled={!ready || !token || loading}
      >
        {loading ? 'Connecting...' : '🏦 Connect Bank Account'}
      </button>

      
    </div>
  )
}
