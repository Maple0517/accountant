import { GoogleGenAI } from '@google/genai'
import type { CategoryRow } from '../categories-db'
import { DEFAULT_GEMINI_MODEL } from './config'

const DEFAULT_GEMINI_CLASSIFIER_RPM = 15
const DEFAULT_GEMINI_CLASSIFIER_TPM = 250_000
const DEFAULT_GEMINI_CLASSIFIER_RPD = 500
const DEFAULT_GEMINI_CLASSIFIER_BATCH_SIZE = 20
const DEFAULT_GEMINI_CLASSIFIER_MAX_REQUESTS_PER_RUN = 5
const DEFAULT_GEMINI_CLASSIFIER_MAX_INPUT_TOKENS = 200_000

type GeminiClassifierLimits = {
  rpm: number
  tpm: number
  rpd: number
  batchSize: number
  maxRequestsPerRun: number
  maxInputTokens: number
}

type GeminiRateEvent = {
  at: number
  estimatedTokens: number
}

const geminiRateState: {
  dayKey: string
  requestsToday: number
  recentEvents: GeminiRateEvent[]
} = {
  dayKey: '',
  requestsToday: 0,
  recentEvents: [],
}

export interface RawTransactionToClassify {
  id: string
  merchant_name: string | null
  description: string
  amount: number
}

export interface ClassifiedTransaction {
  id: string
  clean_merchant_name: string
  category: {
    name: string
    name_zh?: string
    icon?: string
    type: 'expense' | 'income' | 'transfer'
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback

  return Math.floor(parsed)
}

function getGeminiClassifierLimits(): GeminiClassifierLimits {
  return {
    rpm: parsePositiveInteger(
      process.env.GEMINI_CLASSIFIER_RPM_LIMIT,
      DEFAULT_GEMINI_CLASSIFIER_RPM
    ),
    tpm: parsePositiveInteger(
      process.env.GEMINI_CLASSIFIER_TPM_LIMIT,
      DEFAULT_GEMINI_CLASSIFIER_TPM
    ),
    rpd: parsePositiveInteger(
      process.env.GEMINI_CLASSIFIER_RPD_LIMIT,
      DEFAULT_GEMINI_CLASSIFIER_RPD
    ),
    batchSize: parsePositiveInteger(
      process.env.GEMINI_CLASSIFIER_BATCH_SIZE,
      DEFAULT_GEMINI_CLASSIFIER_BATCH_SIZE
    ),
    maxRequestsPerRun: parsePositiveInteger(
      process.env.GEMINI_CLASSIFIER_MAX_REQUESTS_PER_RUN,
      DEFAULT_GEMINI_CLASSIFIER_MAX_REQUESTS_PER_RUN
    ),
    maxInputTokens: parsePositiveInteger(
      process.env.GEMINI_CLASSIFIER_MAX_INPUT_TOKENS,
      DEFAULT_GEMINI_CLASSIFIER_MAX_INPUT_TOKENS
    ),
  }
}

function getDayKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function estimateGeminiTokens(text: string) {
  return Math.ceil(text.length / 4)
}

function isValidCategoryType(
  value: unknown
): value is 'expense' | 'income' | 'transfer' {
  return value === 'expense' || value === 'income' || value === 'transfer'
}

export function validateClassificationResponse(
  parsed: unknown,
  transactions: RawTransactionToClassify[]
): ClassifiedTransaction[] {
  if (!Array.isArray(parsed)) {
    throw new Error('Classifier response is not an array')
  }

  if (parsed.length !== transactions.length) {
    throw new Error(
      `Classifier returned ${parsed.length} items for ${transactions.length} transactions`
    )
  }

  const expectedIds = new Set(transactions.map((tx) => tx.id))
  const seenIds = new Set<string>()

  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Classifier item ${index} is not an object`)
    }

    const candidate = item as Record<string, unknown>
    const id = candidate.id
    const cleanMerchantName = candidate.clean_merchant_name
    const category = candidate.category

    if (typeof id !== 'string' || !expectedIds.has(id) || seenIds.has(id)) {
      throw new Error(`Classifier item ${index} has invalid id`)
    }
    seenIds.add(id)

    if (typeof cleanMerchantName !== 'string' || cleanMerchantName.trim() === '') {
      throw new Error(`Classifier item ${index} has invalid clean_merchant_name`)
    }

    if (!category || typeof category !== 'object') {
      throw new Error(`Classifier item ${index} is missing category`)
    }

    const categoryRecord = category as Record<string, unknown>
    if (
      typeof categoryRecord.name !== 'string' ||
      categoryRecord.name.trim() === '' ||
      !isValidCategoryType(categoryRecord.type)
    ) {
      throw new Error(`Classifier item ${index} has invalid category data`)
    }

    return {
      id,
      clean_merchant_name: cleanMerchantName.trim(),
      category: {
        name: categoryRecord.name.trim(),
        name_zh:
          typeof categoryRecord.name_zh === 'string' &&
          categoryRecord.name_zh.trim() !== ''
            ? categoryRecord.name_zh.trim()
            : undefined,
        icon:
          typeof categoryRecord.icon === 'string' && categoryRecord.icon.trim() !== ''
            ? categoryRecord.icon.trim()
            : undefined,
        type: categoryRecord.type,
      },
    }
  })
}

function buildClassificationPrompt(
  transactions: RawTransactionToClassify[],
  existingCategories: CategoryRow[]
) {
  return `You are a financial transaction classifier.
You will be provided with a JSON array of raw bank transactions and a list of the user's existing categories.

Your task is to:
1. Clean up the merchant name or description into a readable, short 'clean_merchant_name' (e.g., "SQ *APPLE STORE" -> "Apple Store", "TST* LUCKY REST" -> "Lucky Restaurant", "UBER   *TRIP" -> "Uber").
2. Assign the most appropriate category for each transaction. 
   - You MUST try to use one of the existing categories if it fits well. Match the name exactly.
   - If NO existing category fits, you may create a new one. Provide a short English name, a Chinese translation (name_zh), an appropriate Emoji (icon), and the type (expense/income/transfer).

CRITICAL RULES:
- In the provided transactions, a POSITIVE amount means an EXPENSE. A NEGATIVE amount means an INCOME or REFUND.
- Return ONLY a valid JSON array, with exactly the same number of items as the input, in the exact same order.
- Do NOT wrap the JSON in markdown code blocks like \`\`\`json. Just output the raw JSON array.

Existing Categories:
${JSON.stringify(
  existingCategories.map((c) => ({
    name: c.name,
    name_zh: c.name_zh,
    icon: c.icon,
    type: c.type,
  }))
)}

Transactions to classify:
${JSON.stringify(transactions)}

Format of the output JSON array:
[
  {
    "id": "original_transaction_id",
    "clean_merchant_name": "Cleaned Name",
    "category": {
      "name": "Category Name",
      "name_zh": "Category Name in Chinese",
      "icon": "🍔",
      "type": "expense"
    }
  }
]`
}

export function chunkTransactionsForGemini(
  transactions: RawTransactionToClassify[],
  existingCategories: CategoryRow[],
  limits: Pick<GeminiClassifierLimits, 'batchSize' | 'maxInputTokens'> =
    getGeminiClassifierLimits()
) {
  const chunks: RawTransactionToClassify[][] = []
  let currentChunk: RawTransactionToClassify[] = []

  for (const transaction of transactions) {
    const candidateChunk = [...currentChunk, transaction]
    const candidatePrompt = buildClassificationPrompt(
      candidateChunk,
      existingCategories
    )
    const candidateTokens = estimateGeminiTokens(candidatePrompt)
    const candidateExceedsTokenLimit =
      candidateTokens > limits.maxInputTokens && currentChunk.length > 0
    const candidateExceedsBatchSize = candidateChunk.length > limits.batchSize

    if (candidateExceedsTokenLimit || candidateExceedsBatchSize) {
      chunks.push(currentChunk)
      currentChunk = [transaction]
    } else {
      currentChunk = candidateChunk
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk)
  }

  return chunks
}

async function waitForGeminiClassifierLimit(
  estimatedTokens: number,
  limits: GeminiClassifierLimits
) {
  const now = Date.now()
  const dayKey = getDayKey(now)

  if (geminiRateState.dayKey !== dayKey) {
    geminiRateState.dayKey = dayKey
    geminiRateState.requestsToday = 0
    geminiRateState.recentEvents = []
  }

  if (geminiRateState.requestsToday >= limits.rpd) {
    throw new Error('Gemini classifier daily request limit reached')
  }

  const oneMinuteAgo = now - 60_000
  geminiRateState.recentEvents = geminiRateState.recentEvents.filter(
    (event) => event.at > oneMinuteAgo
  )

  const recentRequestCount = geminiRateState.recentEvents.length
  const recentTokenCount = geminiRateState.recentEvents.reduce(
    (sum, event) => sum + event.estimatedTokens,
    0
  )

  const oldestRecentEvent = geminiRateState.recentEvents[0]
  const rpmWaitMs =
    recentRequestCount >= limits.rpm && oldestRecentEvent
      ? oldestRecentEvent.at + 60_000 - now
      : 0
  const tpmWaitMs =
    recentTokenCount + estimatedTokens > limits.tpm && oldestRecentEvent
      ? oldestRecentEvent.at + 60_000 - now
      : 0
  const minSpacingMs = Math.ceil(60_000 / limits.rpm)
  const latestRecentEvent =
    geminiRateState.recentEvents[geminiRateState.recentEvents.length - 1]
  const spacingWaitMs = latestRecentEvent
    ? latestRecentEvent.at + minSpacingMs - now
    : 0
  const waitMs = Math.max(rpmWaitMs, tpmWaitMs, spacingWaitMs, 0)

  if (waitMs > 0) {
    await sleep(waitMs)
  }

  const recordedAt = Date.now()
  geminiRateState.recentEvents.push({ at: recordedAt, estimatedTokens })
  geminiRateState.requestsToday += 1
}

async function classifyTransactionChunk(
  transactions: RawTransactionToClassify[],
  existingCategories: CategoryRow[],
  genAI: GoogleGenAI,
  model: string,
  limits: GeminiClassifierLimits
) {
  const prompt = buildClassificationPrompt(transactions, existingCategories)
  const estimatedTokens = estimateGeminiTokens(prompt)

  await waitForGeminiClassifierLimit(estimatedTokens, limits)

  let response
  try {
    response = await genAI.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      config: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    })
  } catch (error) {
    console.error('Gemini Classification API Error:', error)
    throw new Error(`Failed to classify transactions: ${error}`)
  }

  const text = response.text ?? ''

  try {
    const cleanedText = text
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim()

    const parsed: unknown = JSON.parse(cleanedText)

    return validateClassificationResponse(parsed, transactions)
  } catch (parseError) {
    console.error('Failed to parse Gemini classification response:', text)
    throw new Error(`Failed to parse classification data: ${parseError}`)
  }
}

export async function classifyTransactionsBatch(
  transactions: RawTransactionToClassify[],
  existingCategories: CategoryRow[]
): Promise<ClassifiedTransaction[]> {
  if (transactions.length === 0) return []

  const apiKey = process.env.GEMINI_API_KEY
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL
  const limits = getGeminiClassifierLimits()

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured')
  }

  const genAI = new GoogleGenAI({ apiKey })
  const chunks = chunkTransactionsForGemini(
    transactions,
    existingCategories,
    limits
  )
  const chunksToClassify = chunks.slice(0, limits.maxRequestsPerRun)
  const skippedCount = chunks
    .slice(limits.maxRequestsPerRun)
    .reduce((sum, chunk) => sum + chunk.length, 0)

  if (skippedCount > 0) {
    console.warn(
      `Skipping AI classification for ${skippedCount} transactions to stay within Gemini limits`
    )
  }

  const classified: ClassifiedTransaction[] = []
  for (const chunk of chunksToClassify) {
    const chunkResult = await classifyTransactionChunk(
      chunk,
      existingCategories,
      genAI,
      model,
      limits
    )
    classified.push(...chunkResult)
  }

  return classified
}
