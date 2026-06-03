'use client'

import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/currency'
import type { AnalyticsData } from '@/modules/analytics/analytics.types'
import { useI18n } from '@/i18n/client'

export function NeedsAttentionPanel({ data }: { data: AnalyticsData }) {
  const { categoryName, t } = useI18n()
  const items = data.attentionItems.slice(0, 6)

  return (
    <Card padding="none" className="insights-panel">
      <div className="card-header">
        <div>
          <h3>{t('analytics.needsAttention')}</h3>
          <p className="card-subtitle">{t('analytics.needsAttentionSubtitle')}</p>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="insights-empty-row">{t('analytics.noAttentionItems')}</div>
      ) : (
        <div className="insights-attention-list">
          {items.map((item) => {
            const displayCategory = categoryName({
              name: item.categoryName || 'Other',
              name_zh: item.categoryNameZh,
            })

            return (
              <Link key={item.id} href={item.href} className={`insights-attention-item ${item.severity}`}>
                <div>
                  <span className="insights-attention-title">
                    {t(item.titleKey, { category: displayCategory })}
                  </span>
                  <p>
                    {t(item.bodyKey, {
                      amount: item.amount === undefined ? '' : formatCurrency(item.amount, data.currencyCode),
                    })}
                  </p>
                </div>
                <span className="insights-action">
                  {item.actionTarget === 'budgets' ? t('analytics.openBudget') : t('analytics.viewTransactions')}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </Card>
  )
}
