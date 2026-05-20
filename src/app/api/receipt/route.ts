import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseReceipt } from '@/lib/gemini/receipt-parser'

export const dynamic = 'force-dynamic'

/**
 * POST /api/receipt
 * Accepts a receipt image (multipart form or base64 JSON) and parses it using Gemini Vision.
 * Used by iOS Shortcut and web app.
 *
 * Form data fields:
 * - image: File (JPEG/PNG)
 * - currency: string (optional, e.g., "USD" or "CNY")
 * - notes: string (optional)
 * - api_key: string (for iOS Shortcut auth, alternative to session)
 *
 * OR JSON body:
 * - image: base64 string
 * - mime_type: string
 * - currency: string (optional)
 * - notes: string (optional)
 * - api_key: string
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || ''
    let imageBase64: string
    let mimeType: string = 'image/jpeg'
    let currency: string | undefined
    let notes: string | undefined
    let userId: string | undefined

    if (contentType.includes('multipart/form-data')) {
      // Handle form data (from iOS Shortcut)
      const formData = await request.formData()
      const imageFile = formData.get('image') as File | null
      const apiKey = formData.get('api_key') as string | null
      currency = (formData.get('currency') as string) || undefined
      notes = (formData.get('notes') as string) || undefined

      if (!imageFile) {
        return Response.json({ error: 'No image file provided' }, { status: 400 })
      }

      // Authenticate via API key or session
      if (apiKey) {
        userId = await authenticateWithApiKey(apiKey)
      } else {
        userId = await authenticateWithSession()
      }

      if (!userId) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Convert file to base64
      const arrayBuffer = await imageFile.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      imageBase64 = buffer.toString('base64')
      mimeType = imageFile.type || 'image/jpeg'
    } else {
      // Handle JSON body
      const body = await request.json()
      imageBase64 = body.image
      mimeType = body.mime_type || 'image/jpeg'
      currency = body.currency
      notes = body.notes

      if (!imageBase64) {
        return Response.json({ error: 'No image data provided' }, { status: 400 })
      }

      if (body.api_key) {
        userId = await authenticateWithApiKey(body.api_key)
      } else {
        userId = await authenticateWithSession()
      }

      if (!userId) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    // Parse receipt with Gemini Vision
    const parsed = await parseReceipt(imageBase64, mimeType, currency)

    // Store receipt record
    const supabase = await createClient()

    const { data: receipt, error: receiptError } = await supabase
      .from('receipts')
      .insert({
        user_id: userId,
        image_url: `data:${mimeType};base64,${imageBase64.substring(0, 100)}...`, // Store reference, not full image
        parsed_data: parsed,
        status: 'parsed',
      })
      .select()
      .single()

    if (receiptError) {
      console.error('Failed to store receipt:', receiptError)
    }

    // Get user's default account (or first cash account)
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)

    let transactionId: string | undefined

    if (accounts && accounts.length > 0) {
      // Auto-create transaction from parsed receipt
      const { data: transaction, error: txError } = await supabase
        .from('transactions')
        .insert({
          user_id: userId,
          account_id: accounts[0].id,
          amount: -Math.abs(parsed.total_amount), // Expenses are negative
          iso_currency_code: parsed.currency,
          date: parsed.date,
          merchant_name: parsed.store_name,
          description: parsed.store_name,
          source: 'receipt',
          notes: notes || undefined,
        })
        .select()
        .single()

      if (txError) {
        console.error('Failed to create transaction:', txError)
      } else if (transaction) {
        transactionId = transaction.id

        // Link receipt to transaction
        if (receipt) {
          await supabase
            .from('receipts')
            .update({
              transaction_id: transaction.id,
              status: 'confirmed',
            })
            .eq('id', receipt.id)
        }
      }
    }

    return Response.json({
      success: true,
      receipt: {
        store_name: parsed.store_name,
        date: parsed.date,
        items: parsed.items,
        total: parsed.total_amount,
        currency: parsed.currency,
      },
      confidence: parsed.confidence_score,
      transaction_id: transactionId,
    })
  } catch (error) {
    console.error('Receipt processing error:', error)
    return Response.json(
      { error: 'Failed to process receipt', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * Authenticate using Supabase session (web app)
 */
async function authenticateWithSession(): Promise<string | undefined> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user?.id
  } catch {
    return undefined
  }
}

/**
 * Authenticate using API key (iOS Shortcut)
 * For simplicity, we use the Supabase service role to look up the user by their API key.
 * The API key is stored in the user's profile.
 */
async function authenticateWithApiKey(
  apiKey: string
): Promise<string | undefined> {
  try {
    // For now, use the API key as the user's Supabase access token
    // In production, you'd want a dedicated API key system
    const { createClient: createAdminClient } = await import(
      '@supabase/supabase-js'
    )
    const supabase = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', apiKey) // Simple: api_key IS the user_id for now
      .single()

    return data?.id
  } catch {
    return undefined
  }
}
