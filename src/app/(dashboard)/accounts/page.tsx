'use client'

import { useState } from 'react'
import useSWR from 'swr'
import type { Account } from '@/types'
import AccountCard from '@/components/accounts/AccountCard'
import PlaidLinkButton from '@/components/accounts/PlaidLinkButton'
import PlaidManageAccountsButton from '@/components/accounts/PlaidManageAccountsButton'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { Drawer } from '@/components/ui/Drawer'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusDot } from '@/components/ui/StatusDot'
import { formatCurrency } from '@/lib/currency'
import { useI18n } from '@/i18n/client'

type AccountRow = Account
type DisconnectMode = 'preserve_history' | 'delete_history'

const fetcher = async (url: string): Promise<{ accounts?: AccountRow[]; error?: string }> => {
  const res = await fetch(url)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Failed to fetch accounts')
  return json
}

function latestSync(accounts: AccountRow[]) {
  const dates = accounts.map((account) => account.last_synced_at).filter(Boolean).sort()
  return dates.at(-1) || null
}


export default function AccountsPage() {
  const { formatDate, t } = useI18n()
  const { data: payload, error, mutate, isLoading } = useSWR<{ accounts?: AccountRow[]; error?: string }>('/api/plaid/accounts', fetcher)
  const accounts = payload?.accounts || []
  const [selectedConnection, setSelectedConnection] = useState<AccountRow | null>(null)
  const [disconnectingMode, setDisconnectingMode] = useState<DisconnectMode | null>(null)
  const [disconnectConfirmed, setDisconnectConfirmed] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleRefresh = async (plaidItemId: string) => {
    try {
      await fetch('/api/plaid/sync-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plaid_item_id: plaidItemId }),
      })
      mutate()
    } catch (e) {
      console.error(t('accounts.refreshError'), e)
    }
  }

  const openConnectionDrawer = (account: AccountRow) => {
    setSelectedConnection(account)
    setDisconnectConfirmed(false)
    setMessage(null)
  }

  const closeConnectionDrawer = () => {
    if (disconnectingMode) return
    setSelectedConnection(null)
    setDisconnectConfirmed(false)
  }

  const handleDisconnect = async (mode: DisconnectMode) => {
    if (!selectedConnection?.plaid_item_id) return

    setDisconnectingMode(mode)
    setMessage(null)
    try {
      const response = await fetch(`/api/plaid/items/${selectedConnection.plaid_item_id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const json = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(json.error || t('accounts.disconnectError'))
      }

      await mutate()
      setSelectedConnection(null)
      setDisconnectConfirmed(false)
      setMessage({
        type: 'success',
        text:
          mode === 'delete_history'
            ? t('accounts.deleteHistorySuccess')
            : t('accounts.disconnectSuccess'),
      })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : t('accounts.disconnectError'),
      })
    } finally {
      setDisconnectingMode(null)
    }
  }

  const checkingAccounts = accounts.filter((a) => a.type === 'checking' || a.type === 'cash')
  const savingsAccounts = accounts.filter((a) => a.type === 'savings' || a.type === 'investment')
  const creditAccounts = accounts.filter((a) => a.type === 'credit')
  const otherAccounts = accounts.filter((a) => a.type === 'other' || !a.type)
  const failedSyncCount = accounts.filter((account) => account.last_sync_error).length
  const totalCash = accounts.filter((a) => a.type !== 'credit').reduce((sum, account) => sum + Number(account.current_balance || 0), 0)
  const creditDebt = creditAccounts.reduce((sum, account) => sum + Number(account.current_balance || 0), 0)
  const lastSync = latestSync(accounts)

  return (
    <div className="accounts-page">
      <PageHeader
        title={t('accounts.title')}
        subtitle={t('accounts.subtitle')}
        actions={<PlaidLinkButton onSuccess={() => mutate()} />}
      />

      {error && <div className="alert alert-error">{error.message}</div>}
      {message && (
        <div className={`alert ${message.type === 'error' ? 'alert-error' : 'alert-success'}`}>
          {message.text}
        </div>
      )}

      {accounts.length > 0 && (
        <div className="account-health-grid">
          <Card padding="md" className="account-health-card">
            <span className="metric-label">{t('accounts.syncHealth')}</span>
            <StatusDot tone={failedSyncCount > 0 ? 'warning' : 'success'} label={failedSyncCount > 0 ? t('accounts.accountIssues', { count: failedSyncCount, plural: failedSyncCount === 1 ? '' : 's' }) : t('common.allClear')} />
          </Card>
          <Card padding="md" className="account-health-card account-health-card-compact">
            <span className="metric-label">{t('accounts.lastSuccessfulSync')}</span>
            <span className="metric-value">{lastSync ? formatDate(new Date(lastSync), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : t('common.never')}</span>
          </Card>
          <Card padding="md" className="account-health-card">
            <span className="metric-label">{t('accounts.cashAssets')}</span>
            <span className="metric-value">{formatCurrency(totalCash)}</span>
          </Card>
          <Card padding="md" className="account-health-card">
            <span className="metric-label">{t('dashboard.cardDebt')}</span>
            <span className="metric-value" style={{ color: creditDebt > 0 ? 'var(--expense)' : undefined }}>{formatCurrency(creditDebt)}</span>
          </Card>
        </div>
      )}

      {isLoading ? (
        <div className="loading-state"><div className="skeleton-card" /><div className="skeleton-card" /></div>
      ) : accounts.length === 0 ? (
        <EmptyState title={t('accounts.noAccountsTitle')}>{t('accounts.noAccountsCopy')}</EmptyState>
      ) : (
        <div className="account-groups">
          <AccountGroup title={t('accounts.cashChecking')} accounts={checkingAccounts} onRefresh={handleRefresh} onManageConnection={openConnectionDrawer} />
          <AccountGroup title={t('accounts.savingsInvestments')} accounts={savingsAccounts} onRefresh={handleRefresh} onManageConnection={openConnectionDrawer} />
          <AccountGroup title={t('accounts.creditCards')} accounts={creditAccounts} onRefresh={handleRefresh} onManageConnection={openConnectionDrawer} />
          <AccountGroup title={t('accounts.otherAccounts')} accounts={otherAccounts} onRefresh={handleRefresh} onManageConnection={openConnectionDrawer} />
        </div>
      )}

      <Drawer open={Boolean(selectedConnection)} title={t('accounts.manageConnection')} onClose={closeConnectionDrawer}>
        {selectedConnection && (
          <div className="connection-drawer">
            <div className="connection-summary">
              <span className="metric-label">{t('accounts.connection')}</span>
              <strong>{selectedConnection.institution_name || selectedConnection.name}</strong>
              <span className="text-secondary text-sm">
                {t('accounts.connectionAccountCount', {
                  count: selectedConnection.connection_account_count || 1,
                })}
              </span>
            </div>

            <div className="drawer-section">
              <h3>{t('accounts.manageSharedAccountsTitle')}</h3>
              <p className="drawer-copy">{t('accounts.manageSharedAccountsCopy')}</p>
              {selectedConnection.plaid_item_id && (
                <PlaidManageAccountsButton
                  plaidItemId={selectedConnection.plaid_item_id}
                  onSuccess={async () => {
                    await mutate()
                    setSelectedConnection(null)
                    setDisconnectConfirmed(false)
                    setMessage({ type: 'success', text: t('accounts.manageSharedAccountsSuccess') })
                  }}
                />
              )}
            </div>

            <div className="drawer-section">
              <h3>{t('accounts.disconnectKeepHistoryTitle')}</h3>
              <p className="drawer-copy">{t('accounts.disconnectKeepHistoryCopy')}</p>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => handleDisconnect('preserve_history')}
                disabled={Boolean(disconnectingMode)}
              >
                {disconnectingMode === 'preserve_history'
                  ? t('accounts.disconnecting')
                  : t('accounts.disconnectKeepHistory')}
              </button>
            </div>

            <div className="drawer-section danger-zone">
              <h3>{t('accounts.deleteHistoryTitle')}</h3>
              <p className="drawer-copy">{t('accounts.deleteHistoryCopy')}</p>
              <label className="danger-confirm">
                <input
                  type="checkbox"
                  checked={disconnectConfirmed}
                  onChange={(event) => setDisconnectConfirmed(event.target.checked)}
                  disabled={Boolean(disconnectingMode)}
                />
                <span>{t('accounts.deleteHistoryConfirm')}</span>
              </label>
              <button
                className="btn btn-danger"
                type="button"
                onClick={() => handleDisconnect('delete_history')}
                disabled={!disconnectConfirmed || Boolean(disconnectingMode)}
              >
                {disconnectingMode === 'delete_history'
                  ? t('accounts.deletingHistory')
                  : t('accounts.deleteHistory')}
              </button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}

function AccountGroup({
  title,
  accounts,
  onRefresh,
  onManageConnection,
}: {
  title: string
  accounts: AccountRow[]
  onRefresh: (plaidItemId: string) => void
  onManageConnection: (account: AccountRow) => void
}) {
  if (accounts.length === 0) return null
  return (
    <section className="account-group">
      <h2 className="group-title">{title}</h2>
      <div className="accounts-grid">
        {accounts.map((account) => (
          <AccountCard
            key={account.id}
            account={account}
            onRefresh={onRefresh}
            onManageConnection={onManageConnection}
          />
        ))}
      </div>
    </section>
  )
}
