import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

import type { AiClassificationJob } from '@/types'
import { loadRefreshCandidateIds } from '@/lib/plaid/ai-classification-queue'

export const dynamic = 'force-dynamic'

const INSERT_CHUNK_SIZE = 500

function isMissingQueueTableError(error: { message?: string; code?: string }) {
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    error.message?.includes('ai_classification_jobs') ||
    error.message?.includes('ai_classification_job_items')
  )
}

async function getUser() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  const supabase = user ? createAdminClient() : null

  return { supabase, user }
}

export async function GET() {
  try {
    const { supabase, user } = await getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!supabase) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: job, error } = await supabase
      .from('ai_classification_jobs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      if (isMissingQueueTableError(error)) {
        return Response.json({
          job: null,
          queue_unavailable: true,
          error:
            'AI classification queue tables are missing. Run Supabase migration 003_ai_classification_queue.sql.',
        })
      }

      return Response.json(
        { error: 'Failed to load AI classification job' },
        { status: 500 }
      )
    }

    return Response.json({ job: (job as AiClassificationJob | null) || null })
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'Failed to load AI classification job'

    return Response.json({ error: errorMessage }, { status: 500 })
  }
}

export async function POST() {
  try {
    const { supabase, user } = await getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!supabase) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const candidateIds = await loadRefreshCandidateIds(supabase, user.id)

    const { data: activeJob, error: activeJobError } = await supabase
      .from('ai_classification_jobs')
      .select('*')
      .eq('user_id', user.id)
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (activeJobError) {
      if (isMissingQueueTableError(activeJobError)) {
        return Response.json(
          {
            error:
              'AI classification queue tables are missing. Run Supabase migration 003_ai_classification_queue.sql.',
          },
          { status: 503 }
        )
      }

      return Response.json(
        { error: 'Failed to load active AI classification job' },
        { status: 500 }
      )
    }

    if (activeJob) {
      return Response.json({
        success: true,
        reused: true,
        job: activeJob as AiClassificationJob,
      })
    }

    const { data: job, error: jobError } = await supabase
      .from('ai_classification_jobs')
      .insert({
        user_id: user.id,
        status: candidateIds.length > 0 ? 'queued' : 'completed',
        total_count: candidateIds.length,
        pending_count: candidateIds.length,
        completed_count: 0,
        failed_count: 0,
        completed_at:
          candidateIds.length === 0 ? new Date().toISOString() : undefined,
      })
      .select('*')
      .single()

    if (jobError || !job) {
      if (jobError && isMissingQueueTableError(jobError)) {
        return Response.json(
          {
            error:
              'AI classification queue tables are missing. Run Supabase migration 003_ai_classification_queue.sql.',
          },
          { status: 503 }
        )
      }

      return Response.json(
        { error: 'Failed to create AI classification job' },
        { status: 500 }
      )
    }

    for (let index = 0; index < candidateIds.length; index += INSERT_CHUNK_SIZE) {
      const chunk = candidateIds.slice(index, index + INSERT_CHUNK_SIZE)
      const { error: itemError } = await supabase
        .from('ai_classification_job_items')
        .insert(
          chunk.map((transactionId) => ({
            job_id: job.id,
            user_id: user.id,
            transaction_id: transactionId,
          }))
        )

      if (itemError) {
        if (isMissingQueueTableError(itemError)) {
          return Response.json(
            {
              error:
                'AI classification queue tables are missing. Run Supabase migration 003_ai_classification_queue.sql.',
            },
            { status: 503 }
          )
        }

        await supabase
          .from('ai_classification_jobs')
          .update({
            status: 'failed',
            error_message: itemError.message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)
          .eq('user_id', user.id)

        return Response.json(
          { error: 'Failed to enqueue AI classification items' },
          { status: 500 }
        )
      }
    }

    return Response.json({
      success: true,
      job: job as AiClassificationJob,
    })
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'Failed to create AI classification job'

    return Response.json({ error: errorMessage }, { status: 500 })
  }
}
