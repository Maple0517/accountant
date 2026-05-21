export type Transaction = {
  id: string
  user_id: string
  account_id: string
  category_id?: string
  plaid_transaction_id?: string
  amount: number
  iso_currency_code?: string
  date: string
  authorized_date?: string
  merchant_name?: string
  description: string
  payment_channel?: string
  pending: boolean
  source: 'plaid' | 'manual' | 'receipt'
  receipt_url?: string
  notion_page_id?: string
  tags?: string[]
  notes?: string
  created_at: string
  updated_at: string
}

export type Account = {
  id: string
  user_id: string
  plaid_item_id?: string
  plaid_account_id?: string
  name: string
  official_name?: string
  type: 'checking' | 'savings' | 'credit' | 'cash' | 'investment' | 'other'
  subtype?: string
  mask?: string
  current_balance?: number
  available_balance?: number
  iso_currency_code?: string
  is_manual: boolean
  last_synced_at?: string | null
  last_sync_error?: string | null
  created_at: string
  updated_at: string
}

export type Category = {
  id: string
  user_id: string
  name: string
  name_zh?: string
  icon?: string
  color?: string
  plaid_primary?: string
  plaid_detailed?: string
  type: 'income' | 'expense' | 'transfer'
  is_excluded_from_budget?: boolean
  sort_order: number
  created_at: string
}

export type PlaidItem = {
  id: string
  user_id: string
  access_token: string
  item_id: string
  institution_name?: string
  institution_id?: string
  cursor?: string
  status: 'active' | 'error' | 'login_required'
  error_code?: string
  last_synced_at?: string | null
  last_sync_error?: string | null
  created_at: string
  updated_at: string
}

export type Budget = {
  id: string
  user_id: string
  category_id: string
  amount: number
  period: 'weekly' | 'monthly' | 'yearly'
  month?: number
  year?: number
  alert_threshold: number
  created_at: string
  updated_at: string
}

export type Profile = {
  id: string
  display_name?: string
  default_currency: string
  notion_sync_enabled: boolean
  notion_token?: string
  notion_database_id?: string
  created_at: string
  updated_at: string
}

export type ReceiptApiKey = {
  id: string
  user_id?: string
  name: string
  key_prefix: string
  last_used_at?: string
  revoked_at?: string
  created_at: string
}
