'use client'

import { useCallback, useEffect, useRef } from 'react'
import { usePlaidLink } from 'react-plaid-link'

export default function PlaidLinkLauncher({
  token,
  onExit,
  onSuccess,
}: {
  token: string
  onExit: () => void
  onSuccess: (publicToken: string) => void | Promise<void>
}) {
  const openedRef = useRef(false)
  const handleSuccess = useCallback(
    (publicToken: string) => {
      void onSuccess(publicToken)
    },
    [onSuccess]
  )
  const { open, ready } = usePlaidLink({
    token,
    onExit,
    onSuccess: handleSuccess,
  })

  useEffect(() => {
    if (ready && !openedRef.current) {
      openedRef.current = true
      open()
    }
  }, [open, ready])

  return null
}
