import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getAuthRedirectPath,
  isProtectedPath,
} from '@/proxy'

test('proxy treats review as a protected route', () => {
  assert.equal(isProtectedPath('/review'), true)
  assert.equal(isProtectedPath('/review/queue'), true)
  assert.equal(isProtectedPath('/auth/login'), false)
})

test('proxy picks the correct auth redirect target for protected paths', () => {
  assert.equal(getAuthRedirectPath({ pathname: '/dashboard', hasUser: false }), '/auth/login')
  assert.equal(getAuthRedirectPath({ pathname: '/review', hasUser: false }), '/auth/login')
  assert.equal(getAuthRedirectPath({ pathname: '/auth/login', hasUser: true }), '/dashboard')
  assert.equal(getAuthRedirectPath({ pathname: '/', hasUser: true }), '/dashboard')
  assert.equal(getAuthRedirectPath({ pathname: '/dashboard', hasUser: true }), null)
})
