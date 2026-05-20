import type { SupabaseClient } from '@supabase/supabase-js'
import { shouldRefreshAiClassification } from './classification'

export type AiClassificationJob = {
  id: string
  user_id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled'
  total_count: number
  pending_count: number
  completed_count: number
  failed_count: number
  error_message: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

type RefreshCandidateRow = {
  id: string
  category_id: string | null
  tags: string[] | null
}

const PAGE_SIZE = 1000

export async function loadRefreshCandidateIds(
  supabase: SupabaseClient,
  userId: string
) {
  const candidateIds: string[] = []
  let from = 0

  while (true) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await supabase
      .from('transactions')
      .select('id, category_id, tags')
      .eq('user_id', userId)
      .eq('source', 'plaid')
      .order('date', { ascending: false })
      .range(from, to)

    if (error) {
      throw new Error(`Failed to load pending AI transactions: ${error.message}`)
    }

    const rows = (data || []) as RefreshCandidateRow[]
    candidateIds.push(
      ...rows
        .filter((tx) => shouldRefreshAiClassification(tx))
        .map((tx) => tx.id)
    )

    if (rows.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return candidateIds
}

export async function refreshJobCounts(
  supabase: SupabaseClient,
  jobId: string,
  userId: string
) {
  const statuses = ['queued', 'processing', 'completed', 'failed'] as const
  const counts = {
    queued: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  }

  await Promise.all(
    statuses.map(async (status) => {
      const { count, error } = await supabase
        .from('ai_classification_job_items')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', jobId)
        .eq('user_id', userId)
        .eq('status', status)

      if (error) {
        throw new Error(`Failed to count ${status} queue items: ${error.message}`)
      }

      counts[status] = count || 0
    })
  )

  const pendingCount = counts.queued + counts.processing
  const status = pendingCount === 0 ? 'completed' : 'running'
  const updates: Partial<AiClassificationJob> = {
    status,
    pending_count: pendingCount,
    completed_count: counts.completed,
    failed_count: counts.failed,
    updated_at: new Date().toISOString(),
  }

  if (status === 'completed') {
    updates.completed_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('ai_classification_jobs')
    .update(updates)
    .eq('id', jobId)
    .eq('user_id', userId)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Failed to update job counts: ${error.message}`)
  }

  return data as AiClassificationJob
}
