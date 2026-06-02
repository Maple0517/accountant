import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getAuthRedirectPath,
  isProtectedPath,
} from '@/proxy'

test('proxy only protects active app routes', () => {
  assert.equal(isProtectedPath('/dashboard'), true)
  assert.equal(isProtectedPath('/transactions'), true)
  assert.equal(isProtectedPath('/review'), false)
  assert.equal(isProtectedPath('/auth/login'), false)
})

test('proxy picks the correct auth redirect target for protected paths', () => {
  assert.equal(getAuthRedirectPath({ pathname: '/dashboard', hasUser: false }), '/auth/login')
  assert.equal(getAuthRedirectPath({ pathname: '/auth/login', hasUser: true }), '/dashboard')
  assert.equal(getAuthRedirectPath({ pathname: '/', hasUser: true }), '/dashboard')
  assert.equal(getAuthRedirectPath({ pathname: '/dashboard', hasUser: true }), null)
})
