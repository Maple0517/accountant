'use client'

import useSWR from 'swr'
import { resolveShellUserEmail, type ShellUserPayload } from './shell-user'

const fetchShellUser = async (url: string): Promise<ShellUserPayload | null> => {
  const response = await fetch(url)
  if (!response.ok) {
    return null
  }

  const payload = (await response.json().catch(() => null)) as ShellUserPayload | null
  return payload
}

export function useShellUser(initialEmail: string | null) {
  const { data } = useSWR<ShellUserPayload | null>('/api/auth/me', fetchShellUser, {
    revalidateOnFocus: false,
  })

  return resolveShellUserEmail(initialEmail, data)
}
