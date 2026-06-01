export type ShellUserPayload = {
  email: string | null
}

export function resolveShellUserEmail(
  initialEmail: string | null,
  payload: ShellUserPayload | null | undefined
) {
  return payload?.email ?? initialEmail
}
