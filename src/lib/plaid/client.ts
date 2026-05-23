import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'

let plaidClient: PlaidApi | null = null

function getPlaidEnvironment() {
  const configuredEnv = process.env.PLAID_ENV || 'sandbox'
  return PlaidEnvironments[configuredEnv as keyof typeof PlaidEnvironments]
}

export function getPlaidClient() {
  if (plaidClient) {
    return plaidClient
  }

  const basePath = getPlaidEnvironment()
  const clientId = process.env.PLAID_CLIENT_ID
  const secret = process.env.PLAID_SECRET

  if (!basePath || !clientId || !secret) {
    throw new Error('Plaid environment variables are not configured')
  }

  const configuration = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': secret,
      },
    },
  })

  plaidClient = new PlaidApi(configuration)
  return plaidClient
}

export function resetPlaidClientForTests() {
  plaidClient = null
}
