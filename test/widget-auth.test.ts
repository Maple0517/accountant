import test from 'node:test'
import assert from 'node:assert/strict'

import { authenticateWidgetRequest } from '@/app/api/widget/recent-transactions/route'

test('authenticateWidgetRequest uses bearer API key before checking session cookies', async () => {
  let sessionLookups = 0
  let apiKeyLookups = 0

  const auth = await authenticateWidgetRequest(
    new Request('https://example.test/api/widget/recent-transactions', {
      headers: { Authorization: 'Bearer ak_widget_key' },
    }),
    {
      async createServerClient() {
        sessionLookups += 1
        throw new Error('session auth should not run for API key widget calls')
      },
      async authenticateApiKey(apiKey: string) {
        apiKeyLookups += 1
        assert.equal(apiKey, 'ak_widget_key')
        return { userId: 'user_1', apiKeyId: 'key_1' }
      },
    }
  )

  assert.deepEqual(auth, { userId: 'user_1', apiKeyId: 'key_1' })
  assert.equal(apiKeyLookups, 1)
  assert.equal(sessionLookups, 0)
})

test('authenticateWidgetRequest falls back to browser session when no API key is present', async () => {
  let sessionLookups = 0
  let apiKeyLookups = 0

  const auth = await authenticateWidgetRequest(
    new Request('https://example.test/api/widget/recent-transactions'),
    {
      async createServerClient() {
        sessionLookups += 1
        return {
          auth: {
            async getUser() {
              return { data: { user: { id: 'session_user' } } }
            },
          },
        } as never
      },
      async authenticateApiKey() {
        apiKeyLookups += 1
        throw new Error('API key auth should not run without a key')
      },
    }
  )

  assert.deepEqual(auth, { userId: 'session_user' })
  assert.equal(sessionLookups, 1)
  assert.equal(apiKeyLookups, 0)
})
