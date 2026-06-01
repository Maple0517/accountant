import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export const PROTECTED_PATH_PREFIXES = [
  '/dashboard',
  '/transactions',
  '/analytics',
  '/accounts',
  '/budgets',
  '/settings',
  '/review',
] as const

export function isProtectedPath(pathname: string) {
  return PROTECTED_PATH_PREFIXES.some((prefix) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

export function getAuthRedirectPath({
  pathname,
  hasUser,
}: {
  pathname: string
  hasUser: boolean
}) {
  if (!hasUser && isProtectedPath(pathname)) {
    return '/auth/login'
  }

  if (hasUser && (pathname === '/' || pathname.startsWith('/auth/login'))) {
    return '/dashboard'
  }

  return null
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Avoid turning the whole site into a 500 if preview/runtime env injection is missing.
  if (!supabaseUrl || !supabaseAnonKey) {
    return supabaseResponse
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const redirectPath = getAuthRedirectPath({
    pathname: request.nextUrl.pathname,
    hasUser: Boolean(user),
  })

  if (redirectPath) {
    const url = request.nextUrl.clone()
    url.pathname = redirectPath
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/',
    '/auth/login',
    '/dashboard/:path*',
    '/transactions/:path*',
    '/analytics/:path*',
    '/accounts/:path*',
    '/budgets/:path*',
    '/review/:path*',
    '/settings/:path*',
  ],
}
