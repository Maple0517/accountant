import { createClient } from '@/lib/supabase/server'
import { plaidClient } from '@/lib/plaid/client'
import { syncSingleTransactionIfEnabled } from '@/lib/notion/sync'

export const dynamic = 'force-dynamic'

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

    // Process added transactions
    const transactionsToInsert = added
      .filter(tx => accountMap.has(tx.account_id))
      .map(tx => ({
        user_id: user.id,
        account_id: accountMap.get(tx.account_id),
        plaid_transaction_id: tx.transaction_id,
        amount: tx.amount, // Plaid amounts are positive for expenses, negative for income/refunds
        iso_currency_code: tx.iso_currency_code || 'USD',
        date: tx.date,
        authorized_date: tx.authorized_date || null,
        merchant_name: tx.merchant_name || null,
        description: tx.name,
        payment_channel: tx.payment_channel,
        pending: tx.pending,
        source: 'plaid',
      }))

    if (transactionsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('transactions')
        .upsert(transactionsToInsert, { onConflict: 'plaid_transaction_id' })
      
      if (insertError) {
        console.error('Error inserting transactions:', insertError)
      } else {
        const insertedPlaidIds = transactionsToInsert.map(
          (tx) => tx.plaid_transaction_id
        )

        const { data: insertedTransactions } = await supabase
          .from('transactions')
          .select('id')
          .eq('user_id', user.id)
          .in('plaid_transaction_id', insertedPlaidIds)

        for (const transaction of insertedTransactions || []) {
          void syncSingleTransactionIfEnabled(user.id, transaction.id)
        }
      }
    }

    // Process modified transactions (upsert handles this if we map them same as added)
    const transactionsToUpdate = modified
      .filter(tx => accountMap.has(tx.account_id))
      .map(tx => ({
        user_id: user.id,
        account_id: accountMap.get(tx.account_id),
        plaid_transaction_id: tx.transaction_id,
        amount: tx.amount,
        iso_currency_code: tx.iso_currency_code || 'USD',
        date: tx.date,
        authorized_date: tx.authorized_date || null,
        merchant_name: tx.merchant_name || null,
        description: tx.name,
        payment_channel: tx.payment_channel,
        pending: tx.pending,
        source: 'plaid',
      }))

    if (transactionsToUpdate.length > 0) {
      const { error: updateError } = await supabase
        .from('transactions')
        .upsert(transactionsToUpdate, { onConflict: 'plaid_transaction_id' })
        
      if (updateError) {
        console.error('Error updating transactions:', updateError)
      } else {
        const updatedPlaidIds = transactionsToUpdate.map(
          (tx) => tx.plaid_transaction_id
        )

        const { data: updatedTransactions } = await supabase
          .from('transactions')
          .select('id')
          .eq('user_id', user.id)
          .in('plaid_transaction_id', updatedPlaidIds)

        for (const transaction of updatedTransactions || []) {
          void syncSingleTransactionIfEnabled(user.id, transaction.id)
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
