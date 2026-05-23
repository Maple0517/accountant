import { createAdminClient } from '@/lib/supabase/admin'
import { deriveBudgetBehavior } from '@/lib/transactions/semantics'
import type { BudgetBehavior, TransactionKind } from '@/types'

export type TransactionRow = {
  id: string
  user_id: string
  category_id: string | null
  amount: number
  date: string
  transaction_kind: TransactionKind | null
  budget_behavior: BudgetBehavior | null
  semantic_override_source: string | null
  categories: {
    type: 'income' | 'expense' | 'transfer' | null
    is_excluded_from_budget: boolean | null
  } | null
}

export type SupabaseTransactionRow = Omit<TransactionRow, 'categories'> & {
  categories:
    | TransactionRow['categories']
    | NonNullable<TransactionRow['categories']>[]
}

export type CliOptions = {
  apply: boolean
  userId?: string
  limit: number
}

type QueryError = {
  message?: string
}

type QueryResult<T> = {
  data: T[] | null
  error: QueryError | null
}

export type SemanticsBackfillQuery<T> = PromiseLike<QueryResult<T>> & {
  select(columns: string): SemanticsBackfillQuery<T>
  order(
    column: string,
    options?: { ascending?: boolean }
  ): SemanticsBackfillQuery<T>
  limit(count: number): SemanticsBackfillQuery<T>
  eq(column: string, value: unknown): SemanticsBackfillQuery<T>
  update(payload: Record<string, unknown>): SemanticsBackfillQuery<unknown>
}

export type SemanticsBackfillClient = {
  from<T = unknown>(table: string): SemanticsBackfillQuery<T>
}

export type SemanticsBackfillSummary = {
  scanned: number
  missing_budget_behavior: number
  system_mismatches: number
  would_update: number
  applied: number
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    limit: 1000,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--apply') {
      options.apply = true
    } else if (arg === '--user-id') {
      options.userId = argv[index + 1]
      index += 1
    } else if (arg === '--limit') {
      const limit = Number(argv[index + 1])
      if (Number.isFinite(limit) && limit > 0) {
        options.limit = limit
      }
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

export function expectedBudgetBehavior(tx: TransactionRow): BudgetBehavior {
  return deriveBudgetBehavior({
    transactionKind: tx.transaction_kind ?? 'normal',
    category: tx.categories,
  })
}

export function normalizeTransactionRow(row: SupabaseTransactionRow): TransactionRow {
  return {
    ...row,
    categories: Array.isArray(row.categories)
      ? row.categories[0] ?? null
      : row.categories,
  }
}

export function summarizeSemanticsBackfill(
  transactions: TransactionRow[]
) {
  const missing = transactions.filter((tx) => tx.budget_behavior == null)
  const systemMismatches = transactions.filter((tx) => {
    if (tx.budget_behavior == null) return false
    if (tx.semantic_override_source === 'user' || tx.semantic_override_source === 'rule') {
      return false
    }
    return tx.budget_behavior !== expectedBudgetBehavior(tx)
  })
  const rowsToApply = [...missing, ...systemMismatches]

  return {
    missing,
    systemMismatches,
    rowsToApply,
    summary: {
      scanned: transactions.length,
      missing_budget_behavior: missing.length,
      system_mismatches: systemMismatches.length,
      would_update: rowsToApply.length,
      applied: 0,
    } satisfies SemanticsBackfillSummary,
  }
}

export async function runSemanticsBackfillCheck(
  supabase: SemanticsBackfillClient,
  options: CliOptions
): Promise<SemanticsBackfillSummary> {
  let query = supabase
    .from<SupabaseTransactionRow>('transactions')
    .select(`
      id,
      user_id,
      category_id,
      amount,
      date,
      transaction_kind,
      budget_behavior,
      semantic_override_source,
      categories (
        type,
        is_excluded_from_budget
      )
    `)
    .order('date', { ascending: false })
    .limit(options.limit)

  if (options.userId) {
    query = query.eq('user_id', options.userId)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to load transactions: ${error.message}`)
  }

  const transactions = (data ?? []).map(normalizeTransactionRow)
  const { rowsToApply, summary } = summarizeSemanticsBackfill(transactions)

  if (options.apply && rowsToApply.length > 0) {
    for (const tx of rowsToApply) {
      const { error: updateError } = await supabase
        .from('transactions')
        .update({
          budget_behavior: expectedBudgetBehavior(tx),
          semantic_override_source: tx.semantic_override_source ?? 'system',
        })
        .eq('id', tx.id)
        .eq('user_id', tx.user_id)

      if (updateError) {
        throw new Error(`Failed to update ${tx.id}: ${updateError.message}`)
      }
    }
  }

  return {
    ...summary,
    applied: options.apply ? rowsToApply.length : 0,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const supabase = createAdminClient()
  const summary = await runSemanticsBackfillCheck(
    supabase as unknown as SemanticsBackfillClient,
    options
  )

  console.log(
    JSON.stringify(
      summary,
      null,
      2
    )
  )
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
