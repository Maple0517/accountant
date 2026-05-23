export type AppCategory = {
  name: string
  name_zh: string
  icon: string
  color: string
  type: 'income' | 'expense' | 'transfer'
  isExcludedFromBudget?: boolean
  plaidPrimary?: string[]
}

export const DEFAULT_CATEGORIES: AppCategory[] = [
  { name: 'Food & Drink', name_zh: '餐饮美食', icon: '🍔', color: '#ff9800', type: 'expense', plaidPrimary: ['FOOD_AND_DRINK'] },
  { name: 'Transportation', name_zh: '交通出行', icon: '🚗', color: '#2196f3', type: 'expense', plaidPrimary: ['TRANSPORTATION'] },
  { name: 'Shopping', name_zh: '购物消费', icon: '🛍️', color: '#e91e63', type: 'expense', plaidPrimary: ['SHOPS', 'GENERAL_MERCHANDISE', 'HOME_IMPROVEMENT'] },
  { name: 'Entertainment', name_zh: '休闲娱乐', icon: '🎬', color: '#9c27b0', type: 'expense', plaidPrimary: ['ENTERTAINMENT', 'RECREATION'] },
  { name: 'Bills & Utilities', name_zh: '生活缴费', icon: '💡', color: '#ffc107', type: 'expense', plaidPrimary: ['BILLS_AND_UTILITIES', 'RENT_AND_UTILITIES', 'BANK_FEES', 'LOAN_PAYMENTS'] },
  { name: 'Health', name_zh: '医疗保健', icon: '🏥', color: '#f44336', type: 'expense', plaidPrimary: ['HEALTHCARE', 'MEDICAL', 'PERSONAL_CARE'] },
  { name: 'Education', name_zh: '学习教育', icon: '📚', color: '#3f51b5', type: 'expense', plaidPrimary: ['EDUCATION'] },
  { name: 'Travel', name_zh: '旅行度假', icon: '✈️', color: '#00bcd4', type: 'expense', plaidPrimary: ['TRAVEL'] },
  { name: 'Income', name_zh: '收入', icon: '💰', color: '#4caf50', type: 'income', plaidPrimary: ['INCOME'] },
  { name: 'Transfer', name_zh: '转账', icon: '🔄', color: '#9e9e9e', type: 'transfer', plaidPrimary: ['TRANSFER', 'TRANSFER_IN', 'TRANSFER_OUT'] },
  { name: 'Other', name_zh: '其他', icon: '📦', color: '#607d8b', type: 'expense', plaidPrimary: ['OTHER', 'GENERAL_SERVICES', 'GOVERNMENT_AND_NON_PROFIT'] },
  { name: 'Refunded', name_zh: '已退款', icon: '↩️', color: '#14b8a6', type: 'expense' },
  { name: 'Excluded', name_zh: '不计入', icon: '🚫', color: '#9e9e9e', type: 'expense', isExcludedFromBudget: true },
]

export function getCategoryFromPlaid(primary: string | null | undefined): AppCategory {
  if (!primary) return DEFAULT_CATEGORIES.find(c => c.name === 'Other')!

  const normalizedPrimary = primary
    .trim()
    .toUpperCase()
    .replace(/&/g, 'AND')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  
  const category = DEFAULT_CATEGORIES.find(c => 
    c.plaidPrimary?.includes(normalizedPrimary)
  )
  
  return category || DEFAULT_CATEGORIES.find(c => c.name === 'Other')!
}
