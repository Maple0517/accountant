'use client'

import { formatCurrency } from '@/lib/currency'
import type { Account } from '@/types'
import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { StatusDot } from '@/components/ui/StatusDot'

interface AccountCardProps {
  account: Account
  onRefresh?: (plaidItemId: string) => void | Promise<void>
}

export default function AccountCard({ account, onRefresh }: AccountCardProps) {
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    if (!account.plaid_item_id || !onRefresh) return
    setRefreshing(true)
    try {
      await onRefresh(account.plaid_item_id)
    } finally {
      setRefreshing(false)
    }
  }

  const getSyncStatusText = () => {
    if (account.last_sync_error) return 'Last sync failed. Try again later.'
    if (account.last_synced_at) {
      return `Last checked ${new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(account.last_synced_at))}`
    }
    return account.is_manual ? 'Manual account' : 'Not checked yet'
  }

  const syncTone = account.last_sync_error ? 'warning' : account.last_synced_at ? 'success' : 'neutral'
  const isCredit = account.type === 'credit'
  const utilization =
    isCredit && account.available_balance != null && account.current_balance != null
      ? Number(account.current_balance) / Math.max(Number(account.current_balance) + Number(account.available_balance), 1)
      : null

  return (
    <div className="account-card card">
      <div className="card-header" style={{ padding: 0, border: 0 }}>
        <div className="account-info">
          <h3>{account.name}</h3>
          <span className="account-mask">{account.mask ? `•••• ${account.mask}` : account.subtype || account.type}</span>
        </div>
        <Badge tone={isCredit ? 'warning' : account.is_manual ? 'muted' : 'info'}>{account.type}</Badge>
      </div>

      <div className="card-body">
        <div className="balance-info">
          <span className="balance-label">Current balance</span>
          <span className="balance-amount">{formatCurrency(account.current_balance || 0, account.iso_currency_code || 'USD')}</span>
        </div>

        {account.available_balance !== null && account.available_balance !== undefined && (
          <div className="balance-info available">
            <span className="balance-label">Available {isCredit ? 'credit' : 'balance'}</span>
            <span className="balance-amount-small">{formatCurrency(account.available_balance, account.iso_currency_code || 'USD')}</span>
          </div>
        )}

        {utilization !== null && Number.isFinite(utilization) && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
              <span className="balance-label">Utilization</span>
              <span className="text-secondary text-xs">{Math.round(utilization * 100)}%</span>
            </div>
            <div className="progress"><div className="progress-fill progress-warning" style={{ width: `${Math.min(utilization * 100, 100)}%` }} /></div>
          </div>
        )}
      </div>

      <div className={`sync-status ${account.last_sync_error ? 'error' : ''}`}>
        <StatusDot tone={syncTone} label={getSyncStatusText()} />
      </div>

      {account.plaid_item_id && onRefresh && (
        <button className={`btn btn-ghost btn-sm ${refreshing ? 'syncing' : ''}`} onClick={handleRefresh} disabled={refreshing} type="button">
          {refreshing ? 'Checking...' : 'Check updates'}
        </button>
      )}
    </div>
  )
}
