export type TransactionKind = 'normal' | 'refund' | 'reimbursement' | 'transfer'
export type BudgetBehavior =
  | 'count_as_spending'
  | 'count_as_income'
  | 'exclude_as_transfer'
  | 'exclude_manual'

export type TransferMatchStatus =
  | 'unmatched'
  | 'auto_matched'
  | 'suggested'
  | 'manually_matched'
  | 'ignored'

export type SemanticOverrideSource = 'system' | 'user' | 'rule' | 'ai'

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
  transaction_kind?: TransactionKind
  budget_behavior?: BudgetBehavior | null
  linked_transaction_id?: string | null
  budget_effective_date?: string | null
  refund_match_confidence?: number | null
  refund_match_reason?: string | null
  transfer_group_id?: string | null
  transfer_match_status?: TransferMatchStatus | null
  transfer_match_confidence?: number | null
  transfer_match_reason?: string | null
  semantic_override_source?: SemanticOverrideSource | null
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
  institution_name?: string | null
  institution_id?: string | null
  connection_account_count?: number
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
  notion_token_configured?: boolean
  notion_token_masked?: string | null
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

export type Receipt = {
  id: string
  user_id: string
  parsed_data?: Record<string, unknown>
  idempotency_key?: string | null
  status: 'pending' | 'parsed' | 'confirmed' | 'error'
  transaction_id?: string
  created_at: string
  updated_at: string
}

export type AiClassificationJob = {
  id: string
  user_id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled'
  total_count: number
  pending_count: number
  completed_count: number
  failed_count: number
  error_message: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type AiClassificationJobItem = {
  id: string
  job_id: string
  user_id: string
  transaction_id: string
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'skipped'
  attempts: number
  error_message: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}
