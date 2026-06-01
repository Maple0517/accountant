import test from 'node:test'
import assert from 'node:assert/strict'

import {
  parseCategoryTranslationResponseText,
  translateCategoryNameWithGemini,
} from '@/lib/gemini/category-translator'

test('parseCategoryTranslationResponseText accepts fenced JSON and trims names', () => {
  const translated = parseCategoryTranslationResponseText(
    '```json\n{"name":"  Coffee  ","name_zh":" 咖啡 "}\n```'
  )

  assert.deepEqual(translated, { name: 'Coffee', name_zh: '咖啡' })
})

test('parseCategoryTranslationResponseText rejects Chinese in English name', () => {
  assert.throws(
    () => parseCategoryTranslationResponseText('{"name":"咖啡","name_zh":"咖啡"}'),
    /English name contains Chinese/
  )
})

test('translateCategoryNameWithGemini resolves default Chinese category names without API', async () => {
  const previousKey = process.env.GEMINI_API_KEY
  delete process.env.GEMINI_API_KEY

  try {
    const translated = await translateCategoryNameWithGemini('订阅')
    assert.deepEqual(translated, { name: 'Subscriptions', name_zh: '订阅' })
  } finally {
    if (previousKey === undefined) {
      delete process.env.GEMINI_API_KEY
    } else {
      process.env.GEMINI_API_KEY = previousKey
    }
  }
})
