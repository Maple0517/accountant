import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveShellUserEmail } from '@/components/layout/shell-user'

test('resolveShellUserEmail prefers the fetched shell user email', () => {
  assert.equal(resolveShellUserEmail(null, { email: 'maple@example.com' }), 'maple@example.com')
  assert.equal(resolveShellUserEmail('stale@example.com', { email: 'fresh@example.com' }), 'fresh@example.com')
})

test('resolveShellUserEmail falls back to the initial shell user email when fetch is empty', () => {
  assert.equal(resolveShellUserEmail('initial@example.com', { email: null }), 'initial@example.com')
  assert.equal(resolveShellUserEmail(null, null), null)
})
