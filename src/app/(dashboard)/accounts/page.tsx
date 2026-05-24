'use client'

import useSWR from 'swr'
import type { Account } from '@/types'
import AccountCard from '@/components/accounts/AccountCard'
import PlaidLinkButton from '@/components/accounts/PlaidLinkButton'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusDot } from '@/components/ui/StatusDot'
import { formatCurrency } from '@/lib/currency'
import { useI18n } from '@/i18n/client'

type AccountRow = Account

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

      {accounts.length > 0 && (
        <div className="account-health-grid">
          <Card padding="md"><span className="metric-label">{t('accounts.syncHealth')}</span><StatusDot tone={failedSyncCount > 0 ? 'warning' : 'success'} label={failedSyncCount > 0 ? t('accounts.accountIssues', { count: failedSyncCount, plural: failedSyncCount === 1 ? '' : 's' }) : t('common.allClear')} /></Card>
          <Card padding="md"><span className="metric-label">{t('accounts.lastSuccessfulSync')}</span><span className="metric-value" style={{ fontSize: '1rem' }}>{lastSync ? formatDate(new Date(lastSync), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : t('common.never')}</span></Card>
          <Card padding="md"><span className="metric-label">{t('accounts.cashAssets')}</span><span className="metric-value">{formatCurrency(totalCash)}</span></Card>
          <Card padding="md"><span className="metric-label">{t('dashboard.cardDebt')}</span><span className="metric-value" style={{ color: creditDebt > 0 ? 'var(--expense)' : undefined }}>{formatCurrency(creditDebt)}</span></Card>
        </div>
      )}

      {isLoading ? (
        <div className="loading-state"><div className="skeleton-card" /><div className="skeleton-card" /></div>
      ) : accounts.length === 0 ? (
        <EmptyState title={t('accounts.noAccountsTitle')}>{t('accounts.noAccountsCopy')}</EmptyState>
      ) : (
        <div className="account-groups">
          <AccountGroup title={t('accounts.cashChecking')} accounts={checkingAccounts} onRefresh={handleRefresh} />
          <AccountGroup title={t('accounts.savingsInvestments')} accounts={savingsAccounts} onRefresh={handleRefresh} />
          <AccountGroup title={t('accounts.creditCards')} accounts={creditAccounts} onRefresh={handleRefresh} />
          <AccountGroup title={t('accounts.otherAccounts')} accounts={otherAccounts} onRefresh={handleRefresh} />
        </div>
      )}
    </div>
  )
}

function AccountGroup({ title, accounts, onRefresh }: { title: string; accounts: AccountRow[]; onRefresh: (plaidItemId: string) => void }) {
  if (accounts.length === 0) return null
  return (
    <section className="account-group">
      <h2 className="group-title">{title}</h2>
      <div className="accounts-grid">
        {accounts.map((account) => <AccountCard key={account.id} account={account} onRefresh={onRefresh} />)}
      </div>
    </section>
  )
}
