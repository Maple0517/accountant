import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

import { getOrCreateCategory, getUserCategories } from '@/lib/categories-db'
import { classifyTransactionsBatch, RawTransactionToClassify } from '@/lib/gemini/classifier'
import { syncSingleTransactionIfEnabled } from '@/lib/notion/sync'
import { refreshJobCounts } from '@/lib/plaid/ai-classification-queue'
import {
  mergeTransactionClassification,
  shouldRefreshAiClassification,
} from '@/lib/plaid/classification'
import { shouldPreserveBudgetBehavior } from '@/lib/transactions/semantics'
import { normalizeTransactionSemantics } from '@/lib/transactions/treatment'

export const dynamic = 'force-dynamic'

type QueueItem = {
  id: string
  transaction_id: string
}

type QueueTransaction = {
  id: string
  category_id: string | null
  merchant_name: string | null
  description: string
  amount: number
  tags: string[] | null
  treatment?: string | null
  refund_source?: string | null
  transaction_kind?: string | null
  budget_behavior?: string | null
  semantic_override_source?: string | null
}

const DEFAULT_PROCESS_LIMIT = 20
const MAX_PROCESS_LIMIT = 20

function parseProcessLimit(value: unknown) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return DEFAULT_PROCESS_LIMIT
  }

  return Math.min(Math.floor(numericValue), MAX_PROCESS_LIMIT)
}

export async function POST(request: Request) {
  try {
    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))
    const jobId = body.job_id
    const limit = parseProcessLimit(body.limit)

    if (!jobId || typeof jobId !== 'string') {
      return Response.json({ error: 'Missing job_id' }, { status: 400 })
    }

    const { data: job, error: jobError } = await supabase
      .from('ai_classification_jobs')
      .select('id, status')
      .eq('id', jobId)
      .eq('user_id', user.id)
      .single()

    if (jobError || !job) {
      return Response.json({ error: 'Job not found' }, { status: 404 })
    }

    if (job.status === 'completed' || job.status === 'canceled') {
      const refreshedJob = await refreshJobCounts(supabase, jobId, user.id)
      return Response.json({
        success: true,
        claimed: 0,
        updated: 0,
        failed: 0,
        job: refreshedJob,
      })
    }

    const { data: items, error: itemError } = await supabase
      .from('ai_classification_job_items')
      .select('id, transaction_id')
      .eq('job_id', jobId)
      .eq('user_id', user.id)
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(limit)

    if (itemError) {
      return Response.json(
        { error: 'Failed to claim AI classification queue items' },
        { status: 500 }
      )
    }

    const queueItems = (items || []) as QueueItem[]
    if (queueItems.length === 0) {
      const refreshedJob = await refreshJobCounts(supabase, jobId, user.id)
      return Response.json({
        success: true,
        claimed: 0,
        updated: 0,
        failed: 0,
        job: refreshedJob,
      })
    }

    const itemIds = queueItems.map((item) => item.id)
    const { data: claimedItems, error: claimError } = await supabase
      .from('ai_classification_job_items')
      .update({
        status: 'processing',
        attempts: 1,
        updated_at: new Date().toISOString(),
      })
      .in('id', itemIds)
      .eq('user_id', user.id)
      .eq('status', 'queued')
      .select('id, transaction_id')

    if (claimError) {
      return Response.json(
        { error: 'Failed to claim AI classification queue items' },
        { status: 500 }
      )
    }

    const actuallyClaimedItems = (claimedItems || []) as QueueItem[]
    if (actuallyClaimedItems.length === 0) {
      const refreshedJob = await refreshJobCounts(supabase, jobId, user.id)
      return Response.json({
        success: true,
        claimed: 0,
        updated: 0,
        failed: 0,
        job: refreshedJob,
      })
    }

    const claimedItemIds = actuallyClaimedItems.map((item) => item.id)
    const claimedTransactionIds = actuallyClaimedItems.map((item) => item.transaction_id)

    await supabase
      .from('ai_classification_jobs')
      .update({ status: 'running', updated_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('user_id', user.id)

    const { data: transactions, error: transactionError } = await supabase
      .from('transactions')
      .select('id, category_id, merchant_name, description, amount, tags, treatment, refund_source, transaction_kind, budget_behavior, semantic_override_source')
      .eq('user_id', user.id)
      .eq('source', 'plaid')
      .in('id', claimedTransactionIds)

    if (transactionError) {
      await supabase
        .from('ai_classification_job_items')
        .update({
          status: 'failed',
          error_message: transactionError.message,
          updated_at: new Date().toISOString(),
        })
        .in('id', claimedItemIds)
        .eq('user_id', user.id)

      const refreshedJob = await refreshJobCounts(supabase, jobId, user.id)
      return Response.json(
        {
          error: 'Failed to load transactions for AI classification',
          job: refreshedJob,
        },
        { status: 500 }
      )
    }

    const transactionMap = new Map(
      ((transactions || []) as QueueTransaction[]).map((tx) => [tx.id, tx])
    )
    const refreshableItems = actuallyClaimedItems.filter((item) => {
      const transaction = transactionMap.get(item.transaction_id)
      return transaction && shouldRefreshAiClassification(transaction)
    })
    const skippedItems = actuallyClaimedItems.filter(
      (item) => !refreshableItems.includes(item)
    )

    if (skippedItems.length > 0) {
      await supabase
        .from('ai_classification_job_items')
        .update({
          status: 'skipped',
          updated_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        })
        .in('id', skippedItems.map((item) => item.id))
        .eq('user_id', user.id)
    }

    if (refreshableItems.length === 0) {
      const refreshedJob = await refreshJobCounts(supabase, jobId, user.id)
      return Response.json({
        success: true,
        claimed: actuallyClaimedItems.length,
        updated: 0,
        failed: 0,
        skipped: skippedItems.length,
        job: refreshedJob,
      })
    }

    const userCategories = await getUserCategories(supabase, user.id)
    const rawTransactions: RawTransactionToClassify[] = refreshableItems.map((item) => {
      const tx = transactionMap.get(item.transaction_id)!
      return {
        id: tx.id,
        merchant_name: tx.merchant_name,
        description: tx.description,
        amount: Number(tx.amount),
      }
    })

    let classified
    try {
      classified = await classifyTransactionsBatch(rawTransactions, userCategories)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'AI classification failed'

      await supabase
        .from('ai_classification_job_items')
        .update({
          status: 'queued',
          error_message: errorMessage,
          updated_at: new Date().toISOString(),
        })
        .in('id', refreshableItems.map((item) => item.id))
        .eq('user_id', user.id)

      await supabase
        .from('ai_classification_jobs')
        .update({
          error_message: errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)
        .eq('user_id', user.id)

      const refreshedJob = await refreshJobCounts(supabase, jobId, user.id)
      return Response.json(
        {
          error: errorMessage,
          retryable: true,
          job: refreshedJob,
        },
        { status: 429 }
      )
    }

    const classificationMap = new Map(classified.map((item) => [item.id, item]))
    let updated = 0
    let failed = 0

    for (const item of refreshableItems) {
      const tx = transactionMap.get(item.transaction_id)!
      const classification = classificationMap.get(tx.id)

      if (!classification?.category) {
        failed += 1
        await supabase
          .from('ai_classification_job_items')
          .update({
            status: 'failed',
            error_message: 'No AI classification returned',
            updated_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          })
          .eq('id', item.id)
          .eq('user_id', user.id)
        continue
      }

      const category = await getOrCreateCategory(
        supabase,
        user.id,
        classification.category,
        userCategories
      )

      if (!category) {
        failed += 1
        await supabase
          .from('ai_classification_job_items')
          .update({
            status: 'failed',
            error_message: 'Failed to resolve category',
            updated_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          })
          .eq('id', item.id)
          .eq('user_id', user.id)
        continue
      }

      const { categoryId, cleanName, tags } = mergeTransactionClassification(
        {
          category_id: tx.category_id,
          merchant_name: tx.merchant_name,
          tags: tx.tags,
        },
        {
          merchant_name: tx.merchant_name,
          name: tx.description,
        },
        {
          clean_merchant_name: classification.clean_merchant_name,
          category: { id: category.id },
        }
      )

      const updatePayload: Record<string, unknown> = {
        category_id: categoryId,
        merchant_name: cleanName,
        tags,
      }

      if (!shouldPreserveBudgetBehavior(tx.semantic_override_source)) {
        const semantics = normalizeTransactionSemantics({
          treatment: tx.treatment,
          refundSource: tx.refund_source,
          transactionKind: tx.transaction_kind,
          budgetBehavior: tx.budget_behavior,
          category,
        })
        updatePayload.treatment = semantics.treatment
        updatePayload.refund_source = semantics.refundSource
        updatePayload.transaction_kind = semantics.transactionKind
        updatePayload.budget_behavior = semantics.budgetBehavior
        updatePayload.semantic_override_source = 'ai'
      }

      const { error: updateError } = await supabase
        .from('transactions')
        .update(updatePayload)
        .eq('user_id', user.id)
        .eq('id', tx.id)

      if (updateError) {
        failed += 1
        await supabase
          .from('ai_classification_job_items')
          .update({
            status: 'failed',
            error_message: updateError.message,
            updated_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          })
          .eq('id', item.id)
          .eq('user_id', user.id)
        continue
      }

      updated += 1
      await supabase
        .from('ai_classification_job_items')
        .update({
          status: 'completed',
          error_message: null,
          updated_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        })
        .eq('id', item.id)
        .eq('user_id', user.id)

      const notionResult = await syncSingleTransactionIfEnabled(user.id, tx.id)
      if (notionResult.status === 'failed') {
        console.warn('AI-classified transaction failed to sync to Notion:', notionResult)
      }
    }

    const refreshedJob = await refreshJobCounts(supabase, jobId, user.id)

    return Response.json({
      success: true,
      claimed: actuallyClaimedItems.length,
      updated,
      failed,
      skipped: skippedItems.length,
      job: refreshedJob,
    })
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'Failed to process AI classification queue'

    return Response.json({ error: errorMessage }, { status: 500 })
  }
}
