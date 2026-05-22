import { Client } from '@notionhq/client'

const notionClients = new Map<string, Client>()

export function getNotionClient(token?: string): Client {
  const authToken = token || process.env.NOTION_TOKEN
  if (!authToken) {
    throw new Error('Notion token is required')
  }

  const cachedClient = notionClients.get(authToken)
  if (cachedClient) {
    return cachedClient
  }

  const client = new Client({ auth: authToken })
  notionClients.set(authToken, client)
  return client
}

/**
 * Reset cached clients (useful when tokens change or in tests)
 */
export function resetNotionClient(): void {
  notionClients.clear()
}
