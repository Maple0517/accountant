'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from 'react-plaid-link'
import { useI18n } from '@/i18n/client'

export default function PlaidManageAccountsButton({
  plaidItemId,
  onSuccess,
}: {
  plaidItemId: string
  onSuccess?: () => void | Promise<void>
}) {
  const { t } = useI18n()
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [updating, setUpdating] = useState(false)
  const shouldOpenWhenReady = useRef(false)
  const [error, setError] = useState<string | null>(null)

  const requestLinkToken = useCallback(async () => {
    const response = await fetch('/api/plaid/create-link-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'update_accounts',
        plaid_item_id: plaidItemId,
      }),
    })
    const data = await response.json().catch(() => ({}))

    if (!response.ok || !data.link_token) {
      throw new Error(data.error || t('accounts.linkTokenError'))
    }

    return data.link_token as string
  }, [plaidItemId, t])

  const createLinkToken = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      setToken(await requestLinkToken())
    } catch (error) {
      setToken(null)
      setError(error instanceof Error ? error.message : t('accounts.manageSharedAccountsError'))
    } finally {
      setLoading(false)
    }
  }, [requestLinkToken, t])

  const handleOnSuccess = useCallback(
    async (_publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
      setUpdating(true)
      setError(null)

      try {
        const selectedIds = (metadata.accounts || [])
          .map((account) => account.id)
          .filter((id): id is string => Boolean(id))

        const response = await fetch(`/api/plaid/items/${plaidItemId}/accounts`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selected_plaid_account_ids: selectedIds }),
        })
        const data = await response.json().catch(() => ({}))

        if (!response.ok) {
          throw new Error(data.error || t('accounts.manageSharedAccountsError'))
        }

        await onSuccess?.()
      } catch (error) {
        setError(error instanceof Error ? error.message : t('accounts.manageSharedAccountsError'))
      } finally {
        setUpdating(false)
        setToken(null)
      }
    },
    [onSuccess, plaidItemId, t]
  )

  const { open, ready } = usePlaidLink({
    token,
    onSuccess: handleOnSuccess,
    onExit: () => {
      setToken(null)
      shouldOpenWhenReady.current = false
    },
  })

  useEffect(() => {
    if (!shouldOpenWhenReady.current || !token || !ready) return

    shouldOpenWhenReady.current = false
    open()
  }, [open, ready, token])

  const handleOpen = async () => {
    setError(null)
    if (!token) {
      shouldOpenWhenReady.current = true
      await createLinkToken()
      return
    }
    if (!ready) return
    open()
  }

  const disabled = updating || loading || Boolean(token && !ready)

  return (
    <div className="plaid-link-container">
      {error && <div className="error-message">{error}</div>}
      <button className="btn btn-secondary" type="button" onClick={handleOpen} disabled={disabled}>
        {loading || updating ? t('common.loading') : t('accounts.manageSharedAccounts')}
      </button>
    </div>
  )
}
