import 'server-only'

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

/**
 * Request-scoped authenticated user lookup.
 *
 * Dashboard layouts and pages often need the same Supabase user during a
 * single App Router render. React cache de-dupes that lookup for the request
 * while preserving the per-request cookie-bound Supabase client.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return { supabase, user }
})
