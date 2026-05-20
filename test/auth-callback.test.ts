import test from 'node:test'
import assert from 'node:assert/strict'

import { getSafeRedirectPath } from '@/app/auth/callback/route'

test('getSafeRedirectPath allows in-app relative paths', () => {
  assert.equal(getSafeRedirectPath('/dashboard'), '/dashboard')
  assert.equal(getSafeRedirectPath('/transactions?tab=recent'), '/transactions?tab=recent')
})

test('getSafeRedirectPath falls back for missing or unsafe redirects', () => {
  assert.equal(getSafeRedirectPath(null), '/dashboard')
  assert.equal(getSafeRedirectPath('https://evil.example'), '/dashboard')
  assert.equal(getSafeRedirectPath('//evil.example'), '/dashboard')
  assert.equal(getSafeRedirectPath('dashboard'), '/dashboard')
})
