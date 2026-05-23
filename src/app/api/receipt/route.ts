import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashApiKey } from '@/lib/api-keys'
import {
  parseReceipt,
  ReceiptParsingQuotaError,
} from '@/lib/gemini/receipt-parser'
import { syncSingleTransactionIfEnabled } from '@/lib/notion/sync'
import { getUserCategories, getOrCreateCategory } from '@/lib/categories-db'
import { deriveBudgetBehavior } from '@/lib/transactions/semantics'

export const dynamic = 'force-dynamic'

type ReceiptAuth = {
  userId: string
  apiKeyId?: string
}

type ReceiptStatus = 'parsed' | 'confirmed' | 'error'

async function updateReceiptRecord(
  receiptId: string | undefined,
  updates: {
    status: ReceiptStatus
    transaction_id?: string
    error_message?: string
  }
) {
  if (!receiptId) return

  try {
    const supabase = createAdminClient()
    await supabase.from('receipts').update(updates).eq('id', receiptId)
  } catch (error) {
    console.error('Failed to update receipt status:', error)
  }
}

async function markApiKeyUsed(apiKeyId: string | undefined) {
  if (!apiKeyId) return

  try {
    const supabase = createAdminClient()
    await supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', apiKeyId)
  } catch (error) {
    console.error('Failed to update API key usage timestamp:', error)
  }
}

/**
 * POST /api/receipt
 * Accepts a receipt, payment screenshot, or transaction screenshot and parses it using Gemini Vision.
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
  let receiptId: string | undefined

  try {
    const contentType = request.headers.get('content-type') || ''
    let imageBase64: string
    let mimeType: string = 'image/jpeg'
    let currency: string | undefined
    let notes: string | undefined
    let auth: ReceiptAuth | undefined

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
        auth = await authenticateWithApiKey(apiKey)
      } else {
        auth = await authenticateWithSession()
      }

      if (!auth) {
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
        auth = await authenticateWithApiKey(body.api_key)
      } else {
        auth = await authenticateWithSession()
      }

      if (!auth) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    // Fetch categories for Gemini to reuse if possible
    const supabase = createAdminClient()
    const userCategories = await getUserCategories(supabase, auth.userId)

    // Parse image with Gemini Vision
    const parsed = await parseReceipt(imageBase64, mimeType, currency, userCategories)

    const { data: receipt, error: receiptError } = await supabase
      .from('receipts')
      .insert({
        user_id: auth.userId,
        image_url: `data:${mimeType};base64,${imageBase64.substring(0, 100)}...`, // Store reference, not full image
        parsed_data: parsed,
        status: 'parsed',
      })
      .select()
      .single()

    if (receiptError) {
      console.error('Failed to store receipt:', receiptError)
    } else {
      receiptId = receipt.id
    }

    const accountId = await getOrCreateIosCaptureAccount(
      auth.userId,
      parsed.currency
    )

    if (!accountId) {
      await updateReceiptRecord(receiptId, {
        status: 'error',
        error_message: 'Failed to prepare iOS Capture account',
      })

      return Response.json(
        { error: 'Failed to prepare iOS Capture account' },
        { status: 500 }
      )
    }

    let transactionId: string | undefined

    const signedAmount = toTransactionAmount(
      parsed.total_amount,
      parsed.transaction_type
    )
    const mergedNotes = [
      notes,
      `Captured from ${parsed.capture_type}.`,
      `Payment method: ${parsed.payment_method || 'unknown'}.`,
      `AI confidence: ${Math.round(parsed.confidence_score * 100)}%.`,
    ]
      .filter(Boolean)
      .join('\n')

    let categoryId = null
    if (parsed.category) {
      const catRow = await getOrCreateCategory(
        supabase,
        auth.userId,
        parsed.category,
        userCategories
      )
      if (catRow) {
        categoryId = catRow.id
      }
    }

    const transactionKind =
      parsed.transaction_type === 'transfer' ? 'transfer' : 'normal'
    const categoryForBudgetBehavior = categoryId
      ? userCategories.find((category) => category.id === categoryId)
      : null
    const budgetBehavior = deriveBudgetBehavior({
      transactionKind,
      category: categoryForBudgetBehavior,
      transactionType: parsed.transaction_type,
    })

    const { data: transaction, error: txError } = await supabase
      .from('transactions')
      .insert({
        user_id: auth.userId,
        account_id: accountId,
        category_id: categoryId,
        amount: signedAmount,
        iso_currency_code: parsed.currency,
        date: parsed.date,
        merchant_name: parsed.store_name,
        description: parsed.description || parsed.store_name,
        source: 'receipt',
        tags: [parsed.capture_type, parsed.transaction_type].filter(
          (tag) => tag !== 'unknown'
        ),
        notes: mergedNotes || undefined,
        transaction_kind: transactionKind,
        budget_behavior: budgetBehavior,
        budget_effective_date: parsed.date,
        semantic_override_source: 'ai',
      })
      .select()
      .single()

    if (txError) {
      console.error('Failed to create transaction:', txError)
      await updateReceiptRecord(receiptId, {
        status: 'error',
        error_message: txError.message,
      })

      return Response.json(
        { error: 'Failed to create transaction', details: txError.message },
        { status: 500 }
      )
    } else if (transaction) {
      transactionId = transaction.id

      // Link receipt to transaction
      await updateReceiptRecord(receiptId, {
        transaction_id: transaction.id,
        status: 'confirmed',
      })

      await syncSingleTransactionIfEnabled(auth.userId, transaction.id)
    }

    await markApiKeyUsed(auth.apiKeyId)

    return Response.json({
      success: true,
      receipt: {
        capture_type: parsed.capture_type,
        transaction_type: parsed.transaction_type,
        store_name: parsed.store_name,
        description: parsed.description,
        date: parsed.date,
        items: parsed.items,
        total: parsed.total_amount,
        currency: parsed.currency,
        payment_method: parsed.payment_method,
      },
      confidence: parsed.confidence_score,
      transaction_id: transactionId,
    })
  } catch (error) {
    console.error('Receipt processing error:', error)

    await updateReceiptRecord(receiptId, {
      status: 'error',
      error_message: error instanceof Error ? error.message : String(error),
    })

    if (error instanceof ReceiptParsingQuotaError) {
      const retryAfterSeconds = error.retryAfterSeconds ?? 30

      return Response.json(
        {
          error: 'AI parsing is temporarily busy',
          details: `Gemini quota is temporarily exhausted. Please try again in about ${retryAfterSeconds} seconds.`,
          retry_after_seconds: retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfterSeconds),
          },
        }
      )
    }

    return Response.json(
      { error: 'Failed to process receipt', details: String(error) },
      { status: 500 }
    )
  }
}

async function getOrCreateIosCaptureAccount(
  userId: string,
  currency: string
): Promise<string | undefined> {
  const supabase = createAdminClient()

  const { data: existingAccount } = await supabase
    .from('accounts')
    .select('id')
    .eq('user_id', userId)
    .eq('is_manual', true)
    .eq('name', 'iOS Capture')
    .maybeSingle()

  if (existingAccount?.id) {
    return existingAccount.id
  }

  const { data: newAccount, error } = await supabase
    .from('accounts')
    .insert({
      user_id: userId,
      name: 'iOS Capture',
      type: 'cash',
      subtype: 'shortcut',
      iso_currency_code: currency || 'USD',
      is_manual: true,
      current_balance: 0,
      available_balance: 0,
    })
    .select('id')
    .single()

  if (error) {
    console.error('Failed to create iOS capture account:', error)
    return undefined
  }

  return newAccount?.id
}

function toTransactionAmount(
  amount: number,
  transactionType: 'expense' | 'income' | 'transfer' | 'unknown'
) {
  const positiveAmount = Math.abs(amount)

  if (transactionType === 'income') {
    return -positiveAmount
  }

  return positiveAmount
}

/**
 * Authenticate using Supabase session (web app)
 */
async function authenticateWithSession(): Promise<ReceiptAuth | undefined> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user?.id ? { userId: user.id } : undefined
  } catch {
    return undefined
  }
}

/**
 * Authenticate using API key (iOS Shortcut)
 * API keys are stored as SHA-256 hashes, so the raw ak_ token is only visible once.
 */
async function authenticateWithApiKey(
  apiKey: string
): Promise<ReceiptAuth | undefined> {
  try {
    const normalizedApiKey = apiKey.trim()
    if (!normalizedApiKey) return undefined

    const supabase = createAdminClient()
    const keyHash = hashApiKey(normalizedApiKey)

    const { data } = await supabase
      .from('api_keys')
      .select('id, user_id')
      .eq('key_hash', keyHash)
      .is('revoked_at', null)
      .single()

    if (!data?.user_id) return undefined

    return { userId: data.user_id, apiKeyId: data.id }
  } catch {
    return undefined
  }
}
