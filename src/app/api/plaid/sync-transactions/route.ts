import { createClient } from '@/lib/supabase/server'
import { plaidClient } from '@/lib/plaid/client'
import { syncSingleTransactionIfEnabled } from '@/lib/notion/sync'
import { getUserCategories, getOrCreateCategory } from '@/lib/categories-db'
import { classifyTransactionsBatch, RawTransactionToClassify } from '@/lib/gemini/classifier'

export const dynamic = 'force-dynamic'

type ExistingTransactionSnapshot = {
  category_id: string | null
  merchant_name: string | null
}

export function mergeTransactionClassification(
  existingTransaction: ExistingTransactionSnapshot | undefined,
  plaidTransaction: {
    merchant_name: string | null
    name: string
  },
  classification?: {
    clean_merchant_name: string
    category?: {
      id: string
    }
  }
) {
  return {
    categoryId: classification?.category?.id ?? existingTransaction?.category_id ?? null,
    cleanName:
      classification?.clean_merchant_name ||
      existingTransaction?.merchant_name ||
      plaidTransaction.merchant_name ||
      plaidTransaction.name,
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { plaid_item_id } = await request.json()

    if (!plaid_item_id) {
      return Response.json({ error: 'Missing plaid_item_id' }, { status: 400 })
    }

    // Get the item from DB
    const { data: item, error: itemError } = await supabase
      .from('plaid_items')
      .select('access_token, cursor')
      .eq('id', plaid_item_id)
      .eq('user_id', user.id)
      .single()

    if (itemError || !item) {
      return Response.json({ error: 'Item not found' }, { status: 404 })
    }

    // Get accounts to map plaid_account_id to our internal account_id
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, plaid_account_id')
      .eq('plaid_item_id', plaid_item_id)

    const accountMap = new Map(accounts?.map(a => [a.plaid_account_id, a.id]) || [])

    // Fetch transactions from Plaid using sync
    let cursor = item.cursor || undefined
    let added: any[] = []
    let modified: any[] = []
    let removed: any[] = []
    let hasMore = true

    while (hasMore) {
      const response = await plaidClient.transactionsSync({
        access_token: item.access_token,
        cursor,
      })

      const data = response.data
      added = added.concat(data.added)
      modified = modified.concat(data.modified)
      removed = removed.concat(data.removed)
      hasMore = data.has_more
      cursor = data.next_cursor
    }

    const upsertList = [...added, ...modified].filter(tx => accountMap.has(tx.account_id))
    
    if (upsertList.length > 0) {
      const userCategories = await getUserCategories(supabase, user.id)

      const rawTxs: RawTransactionToClassify[] = upsertList.map((tx) => ({
        id: tx.transaction_id,
        merchant_name: tx.merchant_name || null,
        description: tx.name,
        amount: tx.amount,
      }))

      // Classify in batches if needed, but usually incremental sync is small
      let classified: any[] = []
      try {
        classified = await classifyTransactionsBatch(rawTxs, userCategories)
      } catch (err) {
        console.error('Classification failed, continuing with raw names', err)
      }

      const existingPlaidIds = upsertList.map((tx) => tx.transaction_id)
      const { data: existingTransactions, error: existingTransactionsError } = await supabase
        .from('transactions')
        .select('plaid_transaction_id, category_id, merchant_name')
        .eq('user_id', user.id)
        .in('plaid_transaction_id', existingPlaidIds)

      if (existingTransactionsError) {
        console.error('Error loading existing transactions:', existingTransactionsError)
      }

      const existingTransactionMap = new Map(
        (existingTransactions || []).map((tx) => [tx.plaid_transaction_id, tx])
      )

      const classMap = new Map(classified.map((c) => [c.id, c]))
      const transactionsToUpsert = []

      for (const tx of upsertList) {
        const existingTransaction = existingTransactionMap.get(tx.transaction_id)
        let classificationForMerge:
          | {
              clean_merchant_name: string
              category?: { id: string }
            }
          | undefined

        const cInfo = classMap.get(tx.transaction_id)
        if (cInfo) {
          if (cInfo.category) {
            const catRow = await getOrCreateCategory(
              supabase,
              user.id,
              cInfo.category,
              userCategories
            )
            if (catRow) {
              classificationForMerge = {
                clean_merchant_name: cInfo.clean_merchant_name,
                category: { id: catRow.id },
              }
            }
          }

          if (!classificationForMerge) {
            classificationForMerge = {
              clean_merchant_name: cInfo.clean_merchant_name,
            }
          }
        }

        const { categoryId, cleanName } = mergeTransactionClassification(
          existingTransaction,
          tx,
          classificationForMerge
        )

        transactionsToUpsert.push({
          user_id: user.id,
          account_id: accountMap.get(tx.account_id),
          category_id: categoryId,
          plaid_transaction_id: tx.transaction_id,
          amount: tx.amount,
          iso_currency_code: tx.iso_currency_code || 'USD',
          date: tx.date,
          authorized_date: tx.authorized_date || null,
          merchant_name: cleanName,
          description: tx.name,
          payment_channel: tx.payment_channel,
          pending: tx.pending,
          source: 'plaid',
        })
      }

      const { error: upsertError } = await supabase
        .from('transactions')
        .upsert(transactionsToUpsert, { onConflict: 'plaid_transaction_id' })

      if (upsertError) {
        console.error('Error upserting transactions:', upsertError)
      } else {
        const upsertedPlaidIds = transactionsToUpsert.map((tx) => tx.plaid_transaction_id)
        const { data: dbTransactions } = await supabase
          .from('transactions')
          .select('id')
          .eq('user_id', user.id)
          .in('plaid_transaction_id', upsertedPlaidIds)

        for (const transaction of dbTransactions || []) {
          await syncSingleTransactionIfEnabled(user.id, transaction.id)
        }
      }
    }

    // Process removed transactions
    if (removed.length > 0) {
      const removedIds = removed.map(tx => tx.transaction_id)
      const { error: deleteError } = await supabase
        .from('transactions')
        .delete()
        .in('plaid_transaction_id', removedIds)
        
      if (deleteError) {
        console.error('Error deleting transactions:', deleteError)
      }
    }

    // Update cursor
    if (cursor) {
      await supabase
        .from('plaid_items')
        .update({ cursor })
        .eq('id', plaid_item_id)
    }

    return Response.json({
      success: true,
      added: added.length,
      modified: modified.length,
      removed: removed.length,
    })
  } catch (error: any) {
    console.error('Error syncing transactions:', error)
    return Response.json(
      { error: error.message || 'Failed to sync transactions' },
      { status: 500 }
    )
  }
}
