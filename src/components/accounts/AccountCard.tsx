'use client'

import { formatCurrency } from '@/lib/currency'
import type { Account } from '@/types'
import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { StatusDot } from '@/components/ui/StatusDot'
import { useI18n } from '@/i18n/client'

interface AccountCardProps {
  account: Account
  onRefresh?: (plaidItemId: string) => void | Promise<void>
  onManageConnection?: (account: Account) => void
}

export default function AccountCard({ account, onRefresh, onManageConnection }: AccountCardProps) {
  const { formatDate, t } = useI18n()
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
    if (account.last_sync_error) return t('accounts.lastSyncFailed')
    if (account.last_synced_at) {
      return t('accounts.lastChecked', {
        time: formatDate(new Date(account.last_synced_at), {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }),
      })
    }
    return account.is_manual ? t('accounts.manualAccount') : t('accounts.notChecked')
  }

  const syncTone = account.last_sync_error ? 'warning' : account.last_synced_at ? 'success' : 'neutral'
  const isCredit = account.type === 'credit'
  const typeTone = isCredit ? 'warning' : account.is_manual ? 'muted' : 'info'
  const utilization =
    isCredit && account.available_balance != null && account.current_balance != null
      ? Number(account.current_balance) / Math.max(Number(account.current_balance) + Number(account.available_balance), 1)
      : null

  return (
    <div className="account-card card">
      <div className="card-header" style={{ padding: 0, border: 0 }}>
        <div className="account-info">
          <div className="account-title-row">
            <h3>{account.name}</h3>
            <Badge tone={typeTone}>{account.type}</Badge>
          </div>
          <div className="account-meta-row">
            <span className="account-mask">{account.mask ? `•••• ${account.mask}` : account.subtype || account.type}</span>
            {account.institution_name && <span className="account-institution">{account.institution_name}</span>}
          </div>
        </div>
      </div>

      <div className="card-body">
        <div className="balance-panel">
          <div className="balance-info">
            <span className="balance-label">{t('accounts.currentBalance')}</span>
            <span className="balance-amount">{formatCurrency(account.current_balance || 0, account.iso_currency_code || 'USD')}</span>
          </div>

          {account.available_balance !== null && account.available_balance !== undefined && (
            <div className="balance-info available">
              <span className="balance-label">{isCredit ? t('accounts.availableCredit') : t('accounts.availableBalance')}</span>
              <span className="balance-amount-small">{formatCurrency(account.available_balance, account.iso_currency_code || 'USD')}</span>
            </div>
          )}
        </div>

        {utilization !== null && Number.isFinite(utilization) && (
          <div className="utilization-block">
            <div className="utilization-header">
              <span className="balance-label">{t('accounts.utilization')}</span>
              <span className="text-secondary text-xs">{Math.round(utilization * 100)}%</span>
            </div>
            <div className="progress"><div className="progress-fill progress-warning" style={{ width: `${Math.min(utilization * 100, 100)}%` }} /></div>
          </div>
        )}
      </div>

      <div className={`sync-status ${account.last_sync_error ? 'error' : ''}`}>
        <StatusDot tone={syncTone} label={getSyncStatusText()} />
      </div>

      {account.plaid_item_id && (
        <div className="account-card-actions">
          {onRefresh && (
            <button className={`btn btn-ghost btn-sm ${refreshing ? 'syncing' : ''}`} onClick={handleRefresh} disabled={refreshing} type="button">
              {refreshing ? t('accounts.checkingUpdates') : t('accounts.checkUpdates')}
            </button>
          )}
          {onManageConnection && (
            <button className="btn btn-danger btn-sm" onClick={() => onManageConnection(account)} disabled={refreshing} type="button">
              {t('accounts.manageConnection')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
