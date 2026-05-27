import { processNotionSyncOutbox } from '@/lib/notion/sync'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const expected = process.env.CRON_SECRET

  if (!expected || authHeader !== `Bearer ${expected}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await processNotionSyncOutbox()
    return Response.json({ success: true, ...result })
  } catch (error) {
    console.error('Error processing Notion sync outbox:', error)
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to process Notion sync outbox',
      },
      { status: 500 }
    )
  }
}
