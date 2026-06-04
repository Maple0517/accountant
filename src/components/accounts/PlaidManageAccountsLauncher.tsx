'use client'

import { useCallback, useEffect, useRef } from 'react'
import { usePlaidLink } from 'react-plaid-link'

type PlaidLinkSuccessMetadata = {
  accounts?: Array<{ id?: string | null }>
}

export default function PlaidManageAccountsLauncher({
  token,
  onExit,
  onSuccess,
}: {
  token: string
  onExit: () => void
  onSuccess: (publicToken: string, metadata: PlaidLinkSuccessMetadata) => void | Promise<void>
}) {
  const openedRef = useRef(false)
  const handleSuccess = useCallback(
    (publicToken: string, metadata: PlaidLinkSuccessMetadata) => {
      void onSuccess(publicToken, metadata)
    },
    [onSuccess]
  )
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: handleSuccess,
    onExit,
  })

  useEffect(() => {
    if (ready && !openedRef.current) {
      openedRef.current = true
      open()
    }
  }, [open, ready])

  return null
}
