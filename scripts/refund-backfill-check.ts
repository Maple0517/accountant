import fs from 'node:fs'
import path from 'node:path'

import type { SupabaseClient } from '@supabase/supabase-js'

import { getOrCreateRefundedCategory, REFUNDED_CATEGORY } from '@/lib/categories-db'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  findLikelyOriginalPurchase,
  isLikelyRefundCandidate,
} from '@/lib/transactions/refund-matching'

type TransactionRow = {
  id: string
  user_id: string
  account_id: string
  category_id: string | null
  amount: number
  date: string
  merchant_name: string | null
  description: string
  pending: boolean
  transaction_kind: string | null
  linked_transaction_id: string | null
  budget_effective_date: string | null
  refund_match_confidence: number | null
  refund_match_reason: string | null
  semantic_override_source: string | null
}

type CategoryRow = {
  id: string
  user_id: string
  name: string
  name_zh: string | null
}

type AccountRow = {
  id: string
  user_id: string
  name: string
  mask: string | null
}

type CandidateMatch = {
  refund: TransactionRow
  original: TransactionRow
  confidence: number
  reason: string
}

type LinkedDisplayUpdate = {
  refund: TransactionRow
  original: TransactionRow | null
}

type UserScan = {
  userId: string
  refundedCategoryId: string | null
  refundLikeCount: number
  alreadyLinkedCount: number
  alreadyCorrectLinkedCount: number
  linkedDisplayUpdates: LinkedDisplayUpdate[]
  candidateMatches: CandidateMatch[]
  unmatchedRefundLike: TransactionRow[]
}

type CliOptions = {
  apply: boolean
  userId?: string
  since?: string
  until?: string
  outDir: string
}

type QueryError = {
  message: string
}

type QueryResult<T> = {
  data: T[] | null
  error: QueryError | null
}

type QueryLike<T> = PromiseLike<QueryResult<T>> & {
  eq(column: string, value: unknown): QueryLike<T>
  gt(column: string, value: unknown): QueryLike<T>
  gte(column: string, value: unknown): QueryLike<T>
  in(column: string, values: unknown[]): QueryLike<T>
  is(column: string, value: unknown): QueryLike<T>
  lt(column: string, value: unknown): QueryLike<T>
  lte(column: string, value: unknown): QueryLike<T>
  not(column: string, operator: string, value: unknown): QueryLike<T>
  order(column: string, options?: { ascending?: boolean }): QueryLike<T>
  range(from: number, to: number): QueryLike<T>
}

const PAGE_SIZE = 1000

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    outDir: '.tmp-refund-backfill',
  }

  for (const arg of argv) {
    if (arg === '--apply') options.apply = true

    const [key, value] = arg.split('=', 2)
    if (!value) continue

    if (key === '--user-id') options.userId = value
    if (key === '--since') options.since = value
    if (key === '--until') options.until = value
    if (key === '--out-dir') options.outDir = value
  }

  return options
}

async function applyScan(supabase: SupabaseClient, scan: UserScan) {
  if (
    scan.linkedDisplayUpdates.length === 0 &&
    scan.candidateMatches.length === 0
  ) {
    return {
      userId: scan.userId,
      refundedCategoryId: scan.refundedCategoryId,
      linkedDisplayUpdatesApplied: 0,
      candidateMatchesApplied: 0,
      errors: [] as string[],
    }
  }

  const refundedCategory = await getOrCreateRefundedCategory(supabase, scan.userId)
  const errors: string[] = []

  if (!refundedCategory) {
    return {
      userId: scan.userId,
      refundedCategoryId: null,
      linkedDisplayUpdatesApplied: 0,
      candidateMatchesApplied: 0,
      errors: ['Failed to ensure refunded category'],
    }
  }

  let linkedDisplayUpdatesApplied = 0
  let candidateMatchesApplied = 0

  for (const { refund } of scan.linkedDisplayUpdates) {
    const { error } = await supabase
      .from('transactions')
      .update({
        category_id: refundedCategory.id,
        budget_behavior: 'count_as_spending',
        semantic_override_source:
          refund.semantic_override_source === 'user' || refund.semantic_override_source === 'rule'
            ? refund.semantic_override_source
            : 'system',
      })
      .eq('id', refund.id)
      .eq('user_id', scan.userId)
      .not('linked_transaction_id', 'is', null)

    if (error) {
      errors.push(`Failed linked display update for ${refund.id}: ${error.message}`)
    } else {
      linkedDisplayUpdatesApplied += 1
    }
  }

  for (const { refund, original, confidence, reason } of scan.candidateMatches) {
    const { error } = await supabase
      .from('transactions')
      .update({
        transaction_kind: 'refund',
        linked_transaction_id: original.id,
        category_id: refundedCategory.id,
        budget_effective_date: original.date,
        refund_match_confidence: confidence,
        refund_match_reason: reason,
        budget_behavior: 'count_as_spending',
        semantic_override_source:
          refund.semantic_override_source === 'user' || refund.semantic_override_source === 'rule'
            ? refund.semantic_override_source
            : 'system',
      })
      .eq('id', refund.id)
      .eq('user_id', scan.userId)
      .is('linked_transaction_id', null)

    if (error) {
      errors.push(`Failed candidate backfill for ${refund.id}: ${error.message}`)
    } else {
      candidateMatchesApplied += 1
    }
  }

  return {
    userId: scan.userId,
    refundedCategoryId: refundedCategory.id,
    linkedDisplayUpdatesApplied,
    candidateMatchesApplied,
    errors,
  }
}

function loadEnvFile(filename: string) {
  const filePath = path.resolve(process.cwd(), filename)
  if (!fs.existsSync(filePath)) return

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue

    const [, key, rawValue] = match
    if (process.env[key] !== undefined) continue

    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }
}

async function fetchAll<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  configure: (query: QueryLike<T>) => QueryLike<T>
): Promise<T[]> {
  const rows: T[] = []
  let offset = 0

  while (true) {
    const query = configure(
      supabase
        .from(table)
        .select(columns)
        .range(offset, offset + PAGE_SIZE - 1) as unknown as QueryLike<T>
    )
    const { data, error } = await query

    if (error) {
      throw new Error(`Failed to load ${table}: ${error.message}`)
    }

    const page = (data || []) as T[]
    rows.push(...page)

    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return rows
}

function dateInRange(tx: TransactionRow, options: CliOptions) {
  if (options.since && tx.date < options.since) return false
  if (options.until && tx.date > options.until) return false
  return true
}

function categoryLabel(category: CategoryRow | null | undefined) {
  if (!category) return 'Uncategorized'
  return category.name_zh || category.name
}

function merchantLabel(tx: TransactionRow) {
  return tx.merchant_name || tx.description
}

function isRefundedCategory(category: CategoryRow) {
  return (
    category.name.trim().toLocaleLowerCase('en-US') ===
      REFUNDED_CATEGORY.name.toLocaleLowerCase('en-US') ||
    category.name_zh === REFUNDED_CATEGORY.name_zh
  )
}

function isRefundLikeStoredTransaction(tx: TransactionRow) {
  if (tx.pending) return false
  if (tx.linked_transaction_id) return true
  if (tx.transaction_kind === 'refund' || tx.transaction_kind === 'reimbursement') {
    return Number(tx.amount) < 0
  }

  return isLikelyRefundCandidate({
    amount: Number(tx.amount),
    merchant_name: tx.merchant_name,
    name: tx.description,
  })
}

async function scanUser(
  supabase: SupabaseClient,
  userId: string,
  transactions: TransactionRow[],
  categories: CategoryRow[]
): Promise<UserScan> {
  const transactionsById = new Map(transactions.map((tx) => [tx.id, tx]))
  const refundedCategory = categories.find(isRefundedCategory) || null
  const refundLike = transactions.filter((tx) => isRefundLikeStoredTransaction(tx))

  const linkedRows = refundLike.filter((tx) => tx.linked_transaction_id)
  const linkedDisplayUpdates = linkedRows
    .filter((tx) => tx.category_id !== refundedCategory?.id)
    .map((tx) => ({
      refund: tx,
      original: tx.linked_transaction_id
        ? transactionsById.get(tx.linked_transaction_id) || null
        : null,
    }))

  const alreadyCorrectLinkedCount = linkedRows.length - linkedDisplayUpdates.length
  const candidateMatches: CandidateMatch[] = []
  const unmatchedRefundLike: TransactionRow[] = []

  for (const tx of refundLike) {
    if (tx.linked_transaction_id) continue

    const match = await findLikelyOriginalPurchase({
      supabase,
      userId,
      accountId: tx.account_id,
      refundAmountAbs: Math.abs(Number(tx.amount)),
      merchantName: merchantLabel(tx),
      refundDate: tx.date,
    })

    if (!match) {
      unmatchedRefundLike.push(tx)
      continue
    }

    const original = transactionsById.get(match.original.id)
    candidateMatches.push({
      refund: tx,
      original: original || {
        id: match.original.id,
        user_id: userId,
        account_id: match.original.account_id,
        category_id: match.original.category_id,
        amount: match.original.amount,
        date: match.original.date,
        merchant_name: match.original.merchant_name,
        description: match.original.description,
        pending: false,
        transaction_kind: 'normal',
        linked_transaction_id: null,
        budget_effective_date: null,
        refund_match_confidence: null,
        refund_match_reason: null,
        semantic_override_source: null,
      },
      confidence: match.confidence,
      reason: match.reason,
    })
  }

  return {
    userId,
    refundedCategoryId: refundedCategory?.id || null,
    refundLikeCount: refundLike.length,
    alreadyLinkedCount: linkedRows.length,
    alreadyCorrectLinkedCount,
    linkedDisplayUpdates,
    candidateMatches,
    unmatchedRefundLike,
  }
}

function money(value: number) {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function tableRows(rows: string[][]) {
  if (rows.length === 0) return '_None._\n'

  const header = rows[0]
  const divider = header.map(() => '---')
  return [header, divider, ...rows.slice(1)]
    .map((row) => `| ${row.map((cell) => cell.replace(/\|/g, '\\|')).join(' | ')} |`)
    .join('\n')
}

function renderReport(
  scans: UserScan[],
  categoriesById: Map<string, CategoryRow>,
  accountsById: Map<string, AccountRow>,
  options: CliOptions
) {
  const generatedAt = new Date().toISOString()
  const candidateCount = scans.reduce(
    (sum, scan) => sum + scan.candidateMatches.length,
    0
  )
  const linkedUpdateCount = scans.reduce(
    (sum, scan) => sum + scan.linkedDisplayUpdates.length,
    0
  )
  const unmatchedCount = scans.reduce(
    (sum, scan) => sum + scan.unmatchedRefundLike.length,
    0
  )

  const lines: string[] = [
    '# Refund Backfill Check',
    '',
    `Generated at: ${generatedAt}`,
    options.apply
      ? 'Mode: applied; matching database rows were updated.'
      : 'Mode: dry-run only; no database rows were changed.',
    options.userId ? `User filter: ${options.userId}` : 'User filter: all users',
    options.since || options.until
      ? `Date filter: ${options.since || 'beginning'} to ${options.until || 'now'}`
      : 'Date filter: all history',
    '',
    '## Summary',
    '',
    tableRows([
      ['Users', 'Refund-like rows', 'Already linked', 'Linked display updates', 'New candidate matches', 'Unmatched'],
      [
        String(scans.length),
        String(scans.reduce((sum, scan) => sum + scan.refundLikeCount, 0)),
        String(scans.reduce((sum, scan) => sum + scan.alreadyLinkedCount, 0)),
        String(linkedUpdateCount),
        String(candidateCount),
        String(unmatchedCount),
      ],
    ]),
    '',
    '## Per User',
    '',
    tableRows([
      ['User', 'Refunded category', 'Refund-like', 'Already correct linked', 'Needs display update', 'New matches', 'Unmatched'],
      ...scans.map((scan) => [
        scan.userId,
        scan.refundedCategoryId || 'missing',
        String(scan.refundLikeCount),
        String(scan.alreadyCorrectLinkedCount),
        String(scan.linkedDisplayUpdates.length),
        String(scan.candidateMatches.length),
        String(scan.unmatchedRefundLike.length),
      ]),
    ]),
    '',
    '## Linked Rows That Would Display As Refunded',
    '',
    tableRows([
      ['Date', 'Refund', 'Amount', 'Current category', 'Original date', 'Original', 'Original category'],
      ...scans.flatMap((scan) =>
        scan.linkedDisplayUpdates.map(({ refund, original }) => [
          refund.date,
          merchantLabel(refund),
          money(Number(refund.amount)),
          categoryLabel(categoriesById.get(refund.category_id || '')),
          original?.date || 'unknown',
          original ? merchantLabel(original) : refund.linked_transaction_id || 'unknown',
          categoryLabel(categoriesById.get(original?.category_id || '')),
        ])
      ),
    ]),
    '',
    '## New Candidate Matches',
    '',
    tableRows([
      ['Refund date', 'Account', 'Refund', 'Amount', 'Current category', 'Original date', 'Original', 'Original amount', 'Original category', 'Confidence', 'Reason'],
      ...scans.flatMap((scan) =>
        scan.candidateMatches.map(({ refund, original, confidence, reason }) => {
          const account = accountsById.get(refund.account_id)
          const accountLabel = account?.mask ? `${account.name} *${account.mask}` : account?.name || ''

          return [
            refund.date,
            accountLabel,
            merchantLabel(refund),
            money(Number(refund.amount)),
            categoryLabel(categoriesById.get(refund.category_id || '')),
            original.date,
            merchantLabel(original),
            money(Number(original.amount)),
            categoryLabel(categoriesById.get(original.category_id || '')),
            confidence.toFixed(2),
            reason,
          ]
        })
      ),
    ]),
    '',
    '## Unmatched Refund-like Rows',
    '',
    tableRows([
      ['Date', 'Account', 'Refund', 'Amount', 'Current category', 'Kind'],
      ...scans.flatMap((scan) =>
        scan.unmatchedRefundLike.map((tx) => {
          const account = accountsById.get(tx.account_id)
          const accountLabel = account?.mask ? `${account.name} *${account.mask}` : account?.name || ''

          return [
            tx.date,
            accountLabel,
            merchantLabel(tx),
            money(Number(tx.amount)),
            categoryLabel(categoriesById.get(tx.category_id || '')),
            tx.transaction_kind || 'normal',
          ]
        })
      ),
    ]),
    '',
  ]

  return lines.join('\n')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  loadEnvFile('.env.local')

  const supabase = createAdminClient()
  const transactionColumns = `
    id,
    user_id,
    account_id,
    category_id,
    amount,
    date,
    merchant_name,
    description,
    pending,
    transaction_kind,
    linked_transaction_id,
    budget_effective_date,
    refund_match_confidence,
    refund_match_reason,
    semantic_override_source
  `

  const allTransactions = (
    await fetchAll<TransactionRow>(
      supabase,
      'transactions',
      transactionColumns,
      (query) => {
        let scoped = query.lt('amount', 0).order('date', { ascending: true })
        if (options.userId) scoped = scoped.eq('user_id', options.userId)
        if (options.since) scoped = scoped.gte('date', options.since)
        if (options.until) scoped = scoped.lte('date', options.until)
        return scoped
      }
    )
  ).filter((tx) => dateInRange(tx, options))

  const userIds = Array.from(new Set(allTransactions.map((tx) => tx.user_id))).sort()
  const allUserTransactions = await fetchAll<TransactionRow>(
    supabase,
    'transactions',
    transactionColumns,
    (query) => {
      let scoped = query.order('date', { ascending: true })
      if (userIds.length > 0) scoped = scoped.in('user_id', userIds)
      if (options.userId) scoped = scoped.eq('user_id', options.userId)
      return scoped
    }
  )
  const allCategories = await fetchAll<CategoryRow>(
    supabase,
    'categories',
    'id, user_id, name, name_zh',
    (query) => {
      let scoped = query.order('name', { ascending: true })
      if (userIds.length > 0) scoped = scoped.in('user_id', userIds)
      if (options.userId) scoped = scoped.eq('user_id', options.userId)
      return scoped
    }
  )
  const allAccounts = await fetchAll<AccountRow>(
    supabase,
    'accounts',
    'id, user_id, name, mask',
    (query) => {
      let scoped = query.order('name', { ascending: true })
      if (userIds.length > 0) scoped = scoped.in('user_id', userIds)
      if (options.userId) scoped = scoped.eq('user_id', options.userId)
      return scoped
    }
  )

  const transactionsByUser = new Map<string, TransactionRow[]>()
  for (const tx of allUserTransactions) {
    const rows = transactionsByUser.get(tx.user_id) || []
    rows.push(tx)
    transactionsByUser.set(tx.user_id, rows)
  }

  const categoriesByUser = new Map<string, CategoryRow[]>()
  for (const category of allCategories) {
    const rows = categoriesByUser.get(category.user_id) || []
    rows.push(category)
    categoriesByUser.set(category.user_id, rows)
  }

  const categoriesById = new Map(allCategories.map((category) => [category.id, category]))
  const accountsById = new Map(allAccounts.map((account) => [account.id, account]))

  const scans: UserScan[] = []
  for (const userId of userIds) {
    const scannedIds = new Set(
      allTransactions
        .filter((tx) => tx.user_id === userId)
        .map((tx) => tx.id)
    )
    const userTransactions = (transactionsByUser.get(userId) || []).filter(
      (tx) => scannedIds.has(tx.id) || Number(tx.amount) > 0
    )

    scans.push(
      await scanUser(
        supabase,
        userId,
        userTransactions,
        categoriesByUser.get(userId) || []
      )
    )
  }

  const outDir = path.resolve(process.cwd(), options.outDir)
  fs.mkdirSync(outDir, { recursive: true })

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const markdownPath = path.join(outDir, `refund-backfill-check-${stamp}.md`)
  const jsonPath = path.join(outDir, `refund-backfill-check-${stamp}.json`)
  const report = renderReport(scans, categoriesById, accountsById, options)
  const applyResults = options.apply
    ? await Promise.all(scans.map((scan) => applyScan(supabase, scan)))
    : []

  fs.writeFileSync(markdownPath, report)
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        mode: options.apply ? 'applied' : 'dry-run',
        options,
        scans,
        apply_results: applyResults,
      },
      null,
      2
    )
  )

  const totalMatches = scans.reduce(
    (sum, scan) => sum + scan.candidateMatches.length,
    0
  )
  const totalLinkedUpdates = scans.reduce(
    (sum, scan) => sum + scan.linkedDisplayUpdates.length,
    0
  )
  const totalUnmatched = scans.reduce(
    (sum, scan) => sum + scan.unmatchedRefundLike.length,
    0
  )

  console.log(
    options.apply
      ? `Refund backfill applied.`
      : `Refund backfill check complete.`
  )
  console.log(`Users scanned: ${scans.length}`)
  console.log(`New candidate matches: ${totalMatches}`)
  console.log(`Linked display updates: ${totalLinkedUpdates}`)
  console.log(`Unmatched refund-like rows: ${totalUnmatched}`)
  if (options.apply) {
    const appliedLinked = applyResults.reduce(
      (sum, result) => sum + result.linkedDisplayUpdatesApplied,
      0
    )
    const appliedMatches = applyResults.reduce(
      (sum, result) => sum + result.candidateMatchesApplied,
      0
    )
    const errors = applyResults.flatMap((result) => result.errors)

    console.log(`Applied linked display updates: ${appliedLinked}`)
    console.log(`Applied candidate matches: ${appliedMatches}`)
    if (errors.length > 0) {
      console.log(`Apply errors: ${errors.length}`)
      for (const error of errors) {
        console.log(`- ${error}`)
      }
    }
  }
  console.log(`Markdown report: ${markdownPath}`)
  console.log(`JSON report: ${jsonPath}`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Refund backfill check failed: ${message}`)
  process.exit(1)
})
