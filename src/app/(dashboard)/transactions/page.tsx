'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/currency'
import type { Transaction } from '@/types'

type TransactionFilter = {
  search: string
  source: string
  currency: string
  dateFrom: string
  dateTo: string
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<TransactionFilter>({
    search: '',
    source: 'all',
    currency: 'all',
    dateFrom: '',
    dateTo: '',
  })

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    let isMounted = true

    async function fetchTransactions() {
      let query = supabase
        .from('transactions')
        .select(`*, categories ( name, icon, color ), accounts ( name, type )`)
        .order('date', { ascending: false })
        .limit(200)

      if (filters.search) {
        query = query.or(
          `merchant_name.ilike.%${filters.search}%,description.ilike.%${filters.search}%`
        )
      }
      if (filters.source !== 'all') {
        query = query.eq('source', filters.source)
      }
      if (filters.currency !== 'all') {
        query = query.eq('iso_currency_code', filters.currency)
      }
      if (filters.dateFrom) {
        query = query.gte('date', filters.dateFrom)
      }
      if (filters.dateTo) {
        query = query.lte('date', filters.dateTo)
      }

      const { data, error } = await query

      if (!isMounted) return

      if (error) {
        console.error('Error fetching transactions:', error)
      } else {
        setTransactions(data || [])
      }

      setLoading(false)
    }

    fetchTransactions()

    return () => {
      isMounted = false
    }
  }, [supabase, filters])

  // Group transactions by date
  const groupedTransactions = transactions.reduce(
    (groups, tx) => {
      const date = tx.date
      if (!groups[date]) groups[date] = []
      groups[date].push(tx)
      return groups
    },
    {} as Record<string, Transaction[]>
  )

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00')
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (dateStr === today.toISOString().split('T')[0]) return 'Today'
    if (dateStr === yesterday.toISOString().split('T')[0]) return 'Yesterday'

    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <div className="transactions-page">
      <div className="page-header">
        <h1>Transactions</h1>
        <p className="text-secondary">
          {transactions.length} transaction{transactions.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Filters */}
      <div className="card filters-bar">
        <div className="filter-group">
          <input
            type="text"
            className="input"
            placeholder="🔍 Search merchant or description..."
            value={filters.search}
            onChange={(e) =>
              setFilters((f) => ({ ...f, search: e.target.value }))
            }
          />
        </div>
        <div className="filter-row">
          <select
            className="input"
            value={filters.source}
            onChange={(e) =>
              setFilters((f) => ({ ...f, source: e.target.value }))
            }
          >
            <option value="all">All Sources</option>
            <option value="plaid">🏦 Plaid</option>
            <option value="manual">✏️ Manual</option>
            <option value="receipt">📸 Receipt</option>
          </select>
          <select
            className="input"
            value={filters.currency}
            onChange={(e) =>
              setFilters((f) => ({ ...f, currency: e.target.value }))
            }
          >
            <option value="all">All Currencies</option>
            <option value="USD">$ USD</option>
            <option value="CNY">¥ CNY</option>
          </select>
          <input
            type="date"
            className="input"
            value={filters.dateFrom}
            onChange={(e) =>
              setFilters((f) => ({ ...f, dateFrom: e.target.value }))
            }
            placeholder="From"
          />
          <input
            type="date"
            className="input"
            value={filters.dateTo}
            onChange={(e) =>
              setFilters((f) => ({ ...f, dateTo: e.target.value }))
            }
            placeholder="To"
          />
        </div>
      </div>

      {/* Transaction List */}
      {loading ? (
        <div className="loading-state">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="card skeleton-card">
              <div className="skeleton skeleton-line" style={{ width: '60%' }} />
              <div className="skeleton skeleton-line" style={{ width: '30%' }} />
            </div>
          ))}
        </div>
      ) : Object.keys(groupedTransactions).length === 0 ? (
        <div className="card empty-state">
          <span className="empty-icon">📭</span>
          <h3>No transactions yet</h3>
          <p className="text-secondary">
            Connect a bank account or add a manual transaction to get started.
          </p>
        </div>
      ) : (
        <div className="transaction-groups">
          {Object.entries(groupedTransactions).map(([date, txs]) => {
            const dayTotal = txs.reduce(
              (sum, tx) => sum + Number(tx.amount),
              0
            )
            return (
              <div key={date} className="transaction-group">
                <div className="group-header">
                  <span className="group-date">{formatDate(date)}</span>
                  <span
                    className={`group-total ${dayTotal <= 0 ? 'income' : 'expense'}`}
                  >
                    {formatCurrency(-dayTotal, txs[0]?.iso_currency_code || 'USD')}
                  </span>
                </div>
                <div className="card transaction-list-card">
                  {txs.map((tx) => (
                    <TransactionItem key={tx.id} transaction={tx} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      
    </div>
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function TransactionItem({ transaction: tx }: { transaction: any }) {
  const amount = Number(tx.amount)
  const isIncome = amount < 0
  const displayAmount = -amount
  const categoryIcon = tx.categories?.icon || '📦'
  const categoryName = tx.categories?.name || 'Uncategorized'
  const merchantName = tx.merchant_name || tx.description

  const sourceIcon =
    tx.source === 'plaid' ? '🏦' : tx.source === 'receipt' ? '📸' : '✏️'

  return (
    <div className="transaction-item">
      <div className="tx-icon">{categoryIcon}</div>
      <div className="tx-details">
        <span className="tx-merchant">{merchantName}</span>
        <span className="tx-meta">
          {categoryName} · {sourceIcon} {tx.source}
          {tx.pending && <span className="tx-pending"> · ⏳ Pending</span>}
        </span>
      </div>
      <div className={`tx-amount ${isIncome ? 'income' : 'expense'}`}>
        {formatCurrency(displayAmount, tx.iso_currency_code || 'USD')}
      </div>

      
    </div>
  )
}
