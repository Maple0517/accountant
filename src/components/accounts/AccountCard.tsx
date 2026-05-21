'use client'

import { formatCurrency } from '@/lib/currency'
import type { Account } from '@/types'
import { useState } from 'react'

interface AccountCardProps {
  account: Account
  onRefresh?: (plaidItemId: string) => void
}

export default function AccountCard({ account, onRefresh }: AccountCardProps) {
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    if (!account.plaid_item_id || !onRefresh) return
    
    setRefreshing(true)
    await onRefresh(account.plaid_item_id)
    setRefreshing(false)
  }

  const getSyncStatusText = () => {
    if (account.last_sync_error) {
      return 'Last sync failed. Try again later.'
    }

    if (account.last_synced_at) {
      return `Last checked: ${new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(account.last_synced_at))}`
    }

    return null
  }

  const syncStatusText = getSyncStatusText()

  // Generate a gradient based on account name/type
  const getGradient = () => {
    if (account.type === 'credit') {
      return 'linear-gradient(135deg, rgba(255, 82, 82, 0.1) 0%, rgba(255, 82, 82, 0.05) 100%)'
    } else if (account.type === 'savings') {
      return 'linear-gradient(135deg, rgba(0, 230, 118, 0.1) 0%, rgba(0, 230, 118, 0.05) 100%)'
    }
    return 'linear-gradient(135deg, rgba(68, 138, 255, 0.1) 0%, rgba(68, 138, 255, 0.05) 100%)'
  }

  const getBorderColor = () => {
    if (account.type === 'credit') return 'rgba(255, 82, 82, 0.2)'
    if (account.type === 'savings') return 'rgba(0, 230, 118, 0.2)'
    return 'rgba(68, 138, 255, 0.2)'
  }

  return (
    <div className="account-card card" style={{ 
      background: getGradient(),
      borderColor: getBorderColor()
    }}>
      <div className="card-header">
        <div className="account-info">
          <h3>{account.name}</h3>
          <span className="account-mask">
            {account.mask ? `•••• ${account.mask}` : account.type}
          </span>
        </div>
        {account.plaid_item_id && onRefresh && (
          <button 
            className={`btn-sync ${refreshing ? 'syncing' : ''}`}
            onClick={handleRefresh}
            disabled={refreshing}
            title="Check for available updates"
          >
            🔄
          </button>
        )}
      </div>
      
      <div className="card-body">
        <div className="balance-info">
          <span className="balance-label">Current Balance</span>
          <span className="balance-amount">
            {formatCurrency(account.current_balance || 0, account.iso_currency_code || 'USD')}
          </span>
        </div>
        
        {account.available_balance !== null && account.available_balance !== undefined && (
          <div className="balance-info available">
            <span className="balance-label">Available Balance</span>
            <span className="balance-amount-small">
              {formatCurrency(account.available_balance, account.iso_currency_code || 'USD')}
            </span>
          </div>
        )}
      </div>

      {syncStatusText && (
        <div className={`sync-status ${account.last_sync_error ? 'error' : ''}`}>
          {syncStatusText}
        </div>
      )}

      
    </div>
  )
}
