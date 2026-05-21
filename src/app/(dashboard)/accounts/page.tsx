'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Account } from '@/types'
import AccountCard from '@/components/accounts/AccountCard'
import PlaidLinkButton from '@/components/accounts/PlaidLinkButton'

type PlaidSyncMetadata = {
  last_synced_at?: string | null
  last_sync_error?: string | null
}

type AccountRow = Account & {
  plaid_items?: PlaidSyncMetadata | PlaidSyncMetadata[] | null
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  
  const supabase = useMemo(() => createClient(), [])

  const fetchAccounts = useCallback(async () => {
    setLoading(true)
    try {
      let { data, error } = await supabase
        .from('accounts')
        .select('*, plaid_items(last_synced_at, last_sync_error)')
        .order('created_at', { ascending: false })

      if (error) {
        console.warn('Failed to fetch account sync metadata, falling back to accounts only:', error)
        const fallback = await supabase
          .from('accounts')
          .select('*')
          .order('created_at', { ascending: false })

        data = fallback.data
        error = fallback.error
      }

      if (error) {
        console.error('Failed to fetch accounts:', error)
        setAccounts([])
        return
      }

      const accountsWithSyncMetadata = ((data || []) as AccountRow[]).map((account) => {
        const plaidItem = Array.isArray(account.plaid_items)
          ? account.plaid_items[0]
          : account.plaid_items

        return {
          ...account,
          last_synced_at: plaidItem?.last_synced_at || null,
          last_sync_error: plaidItem?.last_sync_error || null,
        }
      })

      setAccounts(accountsWithSyncMetadata)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    void Promise.resolve().then(fetchAccounts)
  }, [fetchAccounts])

  const handleRefresh = async (plaidItemId: string) => {
    try {
      await fetch('/api/plaid/sync-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plaid_item_id: plaidItemId }),
      })
      fetchAccounts()
    } catch (e) {
      console.error('Failed to check for Plaid updates', e)
    }
  }

  // Group accounts by type
  const checkingAccounts = accounts.filter(a => a.type === 'checking' || a.type === 'cash')
  const savingsAccounts = accounts.filter(a => a.type === 'savings' || a.type === 'investment')
  const creditAccounts = accounts.filter(a => a.type === 'credit')
  const otherAccounts = accounts.filter(a => a.type === 'other' || !a.type)

  return (
    <div className="accounts-page">
      <div className="page-header">
        <h1>Accounts</h1>
        <PlaidLinkButton onSuccess={fetchAccounts} />
      </div>

      {loading ? (
        <div className="loading-state">
          <div className="skeleton-card card"></div>
          <div className="skeleton-card card"></div>
          <div className="skeleton-card card"></div>
        </div>
      ) : accounts.length === 0 ? (
        <div className="card empty-state">
          <span className="empty-icon">🏦</span>
          <h3>No accounts yet</h3>
          <p className="text-secondary">
            Connect your first bank account securely via Plaid to start syncing transactions automatically.
          </p>
        </div>
      ) : (
        <div className="account-groups">
          {checkingAccounts.length > 0 && (
            <div className="account-group">
              <h2 className="group-title">Cash & Checking</h2>
              <div className="accounts-grid">
                {checkingAccounts.map(account => (
                  <AccountCard 
                    key={account.id} 
                    account={account} 
                    onRefresh={handleRefresh} 
                  />
                ))}
              </div>
            </div>
          )}

          {savingsAccounts.length > 0 && (
            <div className="account-group">
              <h2 className="group-title">Savings & Investments</h2>
              <div className="accounts-grid">
                {savingsAccounts.map(account => (
                  <AccountCard 
                    key={account.id} 
                    account={account} 
                    onRefresh={handleRefresh} 
                  />
                ))}
              </div>
            </div>
          )}

          {creditAccounts.length > 0 && (
            <div className="account-group">
              <h2 className="group-title">Credit Cards</h2>
              <div className="accounts-grid">
                {creditAccounts.map(account => (
                  <AccountCard 
                    key={account.id} 
                    account={account} 
                    onRefresh={handleRefresh} 
                  />
                ))}
              </div>
            </div>
          )}

          {otherAccounts.length > 0 && (
            <div className="account-group">
              <h2 className="group-title">Other Accounts</h2>
              <div className="accounts-grid">
                {otherAccounts.map(account => (
                  <AccountCard 
                    key={account.id} 
                    account={account} 
                    onRefresh={handleRefresh} 
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      
    </div>
  )
}
