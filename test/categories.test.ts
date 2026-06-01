import test from 'node:test'
import assert from 'node:assert/strict'

import { findDefaultCategoryByName } from '@/lib/categories'

test('findDefaultCategoryByName resolves localized default category names', () => {
  const category = findDefaultCategoryByName({ name: '订阅' })

  assert.equal(category?.name, 'Subscriptions')
  assert.equal(category?.name_zh, '订阅')
})

test('findDefaultCategoryByName resolves English default names back to Chinese labels', () => {
  const category = findDefaultCategoryByName({ name: 'Subscriptions' })

  assert.equal(category?.name, 'Subscriptions')
  assert.equal(category?.name_zh, '订阅')
})

test('findDefaultCategoryByName returns null for custom categories', () => {
  const category = findDefaultCategoryByName({ name: '自定义分类' })

  assert.equal(category, null)
})
