import { Client } from '@notionhq/client'

let notionClient: Client | null = null

export function getNotionClient(token?: string): Client {
  const authToken = token || process.env.NOTION_TOKEN
  if (!authToken) {
    throw new Error('Notion token is required')
  }

  if (!notionClient) {
    notionClient = new Client({ auth: authToken })
  }

  return notionClient
}

/**
 * Reset the cached client (useful when token changes)
 */
export function resetNotionClient(): void {
  notionClient = null
}
