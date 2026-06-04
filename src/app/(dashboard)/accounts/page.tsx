'use client'

import '@/i18n/namespaces/accounts'
import { useState } from 'react'
import useSWR from 'swr'
import type { Account } from '@/types'
import AccountCard from '@/components/accounts/AccountCard'
import PlaidLinkButton from '@/components/accounts/PlaidLinkButton'
import PlaidManageAccountsButton from '@/components/accounts/PlaidManageAccountsButton'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Drawer } from '@/components/ui/Drawer'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusDot } from '@/components/ui/StatusDot'
import { formatCurrency } from '@/lib/currency'
import { normalizeCurrencyCode } from '@/lib/money/currency'
import { useI18n } from '@/i18n/client'

type AccountRow = Account
type AccountsApiResponse = {
  accounts?: AccountRow[]
  defaultCurrency?: string
  error?: string
}
type DisconnectMode = 'preserve_history' | 'delete_history'
type AccountLedgerGroup = {
  id: string
  title: string
  accounts: AccountRow[]
}
type AccountGroupMode = 'bank' | 'type'

const REQUEST_TIMEOUT_MS = 30_000

const fetcher = async (url: string): Promise<AccountsApiResponse> => {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(url, { signal: controller.signal })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || 'Failed to fetch accounts')
    return json
  } finally {
    window.clearTimeout(timeout)
  }
}

function latestSync(accounts: AccountRow[]) {
  const dates = accounts.map((account) => account.last_synced_at).filter(Boolean).sort()
  return dates.at(-1) || null
}

function getAccountUtilization(account: AccountRow) {
  if (account.type !== 'credit' || account.available_balance == null || account.current_balance == null) {
    return null
  }

  const current = Number(account.current_balance)
  const available = Number(account.available_balance)
  const limit = current + available

  if (!Number.isFinite(current) || !Number.isFinite(available) || limit <= 0) {
    return null
  }

  return Math.max(0, Math.min(current / limit, 1))
}

function getSyncTone(account: AccountRow) {
  if (account.last_sync_error) return 'warning' as const
  if (account.last_synced_at) return 'success' as const
  return 'neutral' as const
}

function getTypeTone(account: AccountRow) {
  if (account.type === 'credit') return 'warning' as const
  if (account.is_manual) return 'muted' as const
  return 'info' as const
}

function getTypeRank(account: AccountRow) {
  if (account.type === 'checking' || account.type === 'cash') return 1
  if (account.type === 'savings' || account.type === 'investment') return 2
  if (account.type === 'credit') return 3
  return 4
}

function sortAccountsForLedger(accounts: AccountRow[]) {
  return [...accounts].sort((a, b) => {
    const aSyncRisk = a.last_sync_error ? 1 : 0
    const bSyncRisk = b.last_sync_error ? 1 : 0
    if (aSyncRisk !== bSyncRisk) return bSyncRisk - aSyncRisk

    const aUtilization = getAccountUtilization(a) ?? -1
    const bUtilization = getAccountUtilization(b) ?? -1
    if (aUtilization !== bUtilization) return bUtilization - aUtilization

    const aBalance = Math.abs(Number(a.current_balance || 0))
    const bBalance = Math.abs(Number(b.current_balance || 0))
    if (aBalance !== bBalance) return bBalance - aBalance

    const aTypeRank = getTypeRank(a)
    const bTypeRank = getTypeRank(b)
    if (aTypeRank !== bTypeRank) return aTypeRank - bTypeRank

    return a.name.localeCompare(b.name)
  })
}

function getAccountBankGroup(account: AccountRow, manualTitle: string, unknownTitle: string) {
  if (account.institution_name) {
    return {
      id: `institution:${account.institution_name.toLocaleLowerCase()}`,
      title: account.institution_name,
    }
  }

  if (account.is_manual) {
    return {
      id: 'manual',
      title: manualTitle,
    }
  }

  return {
    id: 'unknown',
    title: unknownTitle,
  }
}

function getGroupRiskScore(accounts: AccountRow[]) {
  return accounts.reduce((score, account) => {
    if (account.last_sync_error) return score + 100
    return score + (getAccountUtilization(account) ?? 0)
  }, 0)
}

function buildBankGroups(
  accounts: AccountRow[],
  manualTitle: string,
  unknownTitle: string
): AccountLedgerGroup[] {
  const groups = new Map<string, AccountLedgerGroup>()

  for (const account of accounts) {
    const bankGroup = getAccountBankGroup(account, manualTitle, unknownTitle)
    const existing = groups.get(bankGroup.id)

    if (existing) {
      existing.accounts.push(account)
    } else {
      groups.set(bankGroup.id, {
        id: bankGroup.id,
        title: bankGroup.title,
        accounts: [account],
      })
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      accounts: sortAccountsForLedger(group.accounts),
    }))
    .sort((a, b) => {
      const riskDelta = getGroupRiskScore(b.accounts) - getGroupRiskScore(a.accounts)
      if (riskDelta !== 0) return riskDelta
      return a.title.localeCompare(b.title)
    })
}

function buildTypeGroups(
  accounts: AccountRow[],
  titles: {
    checking: string
    savings: string
    credit: string
    other: string
  }
): AccountLedgerGroup[] {
  const checkingAccounts = accounts.filter((a) => a.type === 'checking' || a.type === 'cash')
  const savingsAccounts = accounts.filter((a) => a.type === 'savings' || a.type === 'investment')
  const creditAccounts = accounts.filter((a) => a.type === 'credit')
  const otherAccounts = accounts.filter((a) => a.type === 'other' || !a.type)

  return [
    { id: 'cash-checking', title: titles.checking, accounts: sortAccountsForLedger(checkingAccounts) },
    { id: 'savings-investments', title: titles.savings, accounts: sortAccountsForLedger(savingsAccounts) },
    { id: 'credit-cards', title: titles.credit, accounts: sortAccountsForLedger(creditAccounts) },
    { id: 'other-accounts', title: titles.other, accounts: sortAccountsForLedger(otherAccounts) },
  ].filter((group) => group.accounts.length > 0)
}

function formatAccountMask(account: AccountRow, fallback: string) {
  if (account.mask) return `•••• ${account.mask}`
  return account.subtype || account.type || fallback
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

export default function AccountsPage() {
  const { formatDate, t } = useI18n()
  const { data: payload, error, mutate, isLoading } = useSWR<AccountsApiResponse>('/api/plaid/accounts', fetcher)
  const accounts = payload?.accounts || []
  const defaultCurrency = normalizeCurrencyCode(payload?.defaultCurrency)
  const defaultCurrencyAccounts = accounts.filter((account) => normalizeCurrencyCode(account.iso_currency_code) === defaultCurrency)
  const [selectedConnection, setSelectedConnection] = useState<AccountRow | null>(null)
  const [disconnectingMode, setDisconnectingMode] = useState<DisconnectMode | null>(null)
  const [disconnectConfirmed, setDisconnectConfirmed] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [groupMode, setGroupMode] = useState<AccountGroupMode>('bank')

  const handleRefresh = async (plaidItemId: string) => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    setMessage(null)
    try {
      const response = await fetch('/api/plaid/sync-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plaid_item_id: plaidItemId }),
        signal: controller.signal,
      })
      const json = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(json.error || t('accounts.refreshError'))
      }

      setMessage({ type: 'success', text: json.message || t('accounts.refreshSuccess') })
      void mutate().catch((error) => {
        console.error(t('accounts.fetchError'), error)
      })
    } catch (e) {
      console.error(t('accounts.refreshError'), e)
      const isAbortError = e instanceof DOMException && e.name === 'AbortError'
      setMessage({
        type: 'error',
        text: isAbortError
          ? t('accounts.refreshTimeout')
          : e instanceof Error ? e.message : t('accounts.refreshError'),
      })
    } finally {
      window.clearTimeout(timeout)
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

  const failedSyncCount = accounts.filter((account) => account.last_sync_error).length
  const totalCash = defaultCurrencyAccounts.filter((a) => a.type !== 'credit').reduce((sum, account) => sum + Number(account.current_balance || 0), 0)
  const creditDebt = defaultCurrencyAccounts.filter((a) => a.type === 'credit').reduce((sum, account) => sum + Number(account.current_balance || 0), 0)
  const hasMultipleCurrencies = new Set(accounts.map((account) => normalizeCurrencyCode(account.iso_currency_code))).size > 1
  const lastSync = latestSync(accounts)
  const accountGroups =
    groupMode === 'bank'
      ? buildBankGroups(
          accounts,
          t('accounts.manualAccounts'),
          t('accounts.unknownInstitution')
        )
      : buildTypeGroups(accounts, {
          checking: t('accounts.cashChecking'),
          savings: t('accounts.savingsInvestments'),
          credit: t('accounts.creditCards'),
          other: t('accounts.otherAccounts'),
        })

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
            <span className="metric-value">{formatCurrency(totalCash, defaultCurrency)}</span>
          </Card>
          <Card padding="md" className="account-health-card">
            <span className="metric-label">{t('dashboard.cardDebt')}</span>
            <span className="metric-value" style={{ color: creditDebt > 0 ? 'var(--expense)' : undefined }}>{formatCurrency(creditDebt, defaultCurrency)}</span>
          </Card>
        </div>
      )}

      {accounts.length > 0 && hasMultipleCurrencies && (
        <p className="text-secondary">
          {t('accounts.defaultCurrencyOnly', { currency: defaultCurrency })}
        </p>
      )}

      {accounts.length > 0 && (
        <div className="account-group-toolbar">
          <span className="account-group-toolbar-label">{t('accounts.groupBy')}</span>
          <div className="segmented-control" role="group" aria-label={t('accounts.groupBy')}>
            <button
              className={groupMode === 'bank' ? 'active' : ''}
              type="button"
              onClick={() => setGroupMode('bank')}
            >
              {t('accounts.groupByBank')}
            </button>
            <button
              className={groupMode === 'type' ? 'active' : ''}
              type="button"
              onClick={() => setGroupMode('type')}
            >
              {t('accounts.groupByType')}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="loading-state"><div className="skeleton-card" /><div className="skeleton-card" /></div>
      ) : accounts.length === 0 ? (
        <EmptyState title={t('accounts.noAccountsTitle')}>{t('accounts.noAccountsCopy')}</EmptyState>
      ) : (
        <>
          <div className="account-ledger-stack">
            {accountGroups.map((group) => (
              <AccountLedgerSection
                key={group.id}
                title={group.title}
                accounts={group.accounts}
                defaultCurrency={defaultCurrency}
                onRefresh={handleRefresh}
                onManageConnection={openConnectionDrawer}
              />
            ))}
          </div>

          <div className="account-groups account-card-groups-mobile">
            {accountGroups.map((group) => (
              <AccountGroup
                key={group.id}
                title={group.title}
                accounts={group.accounts}
                onRefresh={handleRefresh}
                onManageConnection={openConnectionDrawer}
              />
            ))}
          </div>
        </>
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

function AccountLedgerSection({
  title,
  accounts,
  defaultCurrency,
  onRefresh,
  onManageConnection,
}: {
  title: string
  accounts: AccountRow[]
  defaultCurrency: string
  onRefresh: (plaidItemId: string) => void | Promise<void>
  onManageConnection: (account: AccountRow) => void
}) {
  const { t } = useI18n()

  if (accounts.length === 0) return null

  return (
    <Card padding="none" className="account-ledger-card">
      <div className="account-ledger-header">
        <div>
          <h2>{title}</h2>
          <p className="card-subtitle">
            {t('accounts.ledgerGroupCount', {
              count: accounts.length,
              plural: accounts.length === 1 ? '' : 's',
            })}
          </p>
        </div>
      </div>
      <div className="account-ledger-table-wrap">
        <table className="account-ledger-table">
          <thead>
            <tr>
              <th>{t('accounts.ledgerAccount')}</th>
              <th>{t('accounts.ledgerType')}</th>
              <th className="numeric">{t('accounts.currentBalance')}</th>
              <th className="numeric">{t('accounts.ledgerAvailable')}</th>
              <th>{t('accounts.utilization')}</th>
              <th>{t('accounts.ledgerSync')}</th>
              <th className="actions">{t('accounts.ledgerActions')}</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <AccountLedgerRow
                key={account.id}
                account={account}
                defaultCurrency={defaultCurrency}
                onRefresh={onRefresh}
                onManageConnection={onManageConnection}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function AccountLedgerRow({
  account,
  defaultCurrency,
  onRefresh,
  onManageConnection,
}: {
  account: AccountRow
  defaultCurrency: string
  onRefresh: (plaidItemId: string) => void | Promise<void>
  onManageConnection: (account: AccountRow) => void
}) {
  const { formatDate, t } = useI18n()
  const [refreshing, setRefreshing] = useState(false)
  const currencyCode = account.iso_currency_code || defaultCurrency
  const utilization = getAccountUtilization(account)
  const syncTone = getSyncTone(account)
  const availableAmount =
    account.available_balance === null || account.available_balance === undefined
      ? null
      : Number(account.available_balance)

  const handleRefresh = async () => {
    if (!account.plaid_item_id) return
    setRefreshing(true)
    try {
      await onRefresh(account.plaid_item_id)
    } finally {
      setRefreshing(false)
    }
  }

  const syncLabel = (() => {
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
  })()

  return (
    <tr className={account.last_sync_error ? 'account-ledger-row-warning' : undefined}>
      <td className="account-ledger-account-cell">
        <strong>{account.name}</strong>
        <span>{formatAccountMask(account, t('common.unknown'))}</span>
      </td>
      <td>
        <Badge tone={getTypeTone(account)}>{account.type || t('common.unknown')}</Badge>
      </td>
      <td className="numeric account-ledger-balance">
        {formatCurrency(Number(account.current_balance || 0), currencyCode)}
      </td>
      <td className="numeric">
        {availableAmount === null ? (
          <span className="account-ledger-muted">—</span>
        ) : (
          formatCurrency(availableAmount, currencyCode)
        )}
      </td>
      <td className="account-ledger-utilization-cell">
        {utilization === null ? (
          <span className="account-ledger-muted">—</span>
        ) : (
          <div className="account-ledger-utilization">
            <div className="account-ledger-utilization-meta">
              <span>{formatPercent(utilization)}</span>
            </div>
            <div className="progress account-ledger-progress">
              <div
                className={`progress-fill ${utilization >= 0.75 ? 'progress-danger' : utilization >= 0.5 ? 'progress-warning' : 'progress-success'}`}
                style={{ width: formatPercent(utilization) }}
              />
            </div>
          </div>
        )}
      </td>
      <td>
        <StatusDot tone={syncTone} label={syncLabel} />
      </td>
      <td className="account-ledger-actions">
        {account.plaid_item_id ? (
          <>
            <button
              className={`btn btn-ghost btn-sm ${refreshing ? 'syncing' : ''}`}
              onClick={handleRefresh}
              disabled={refreshing}
              type="button"
            >
              {refreshing ? t('accounts.checkingUpdates') : t('accounts.checkUpdates')}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => onManageConnection(account)}
              disabled={refreshing}
              type="button"
            >
              {t('accounts.manageConnection')}
            </button>
          </>
        ) : (
          <span className="account-ledger-muted">{t('accounts.manualAccount')}</span>
        )}
      </td>
    </tr>
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
