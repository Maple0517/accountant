import { GoogleGenAI } from '@google/genai'

export class ReceiptParsingQuotaError extends Error {
  retryAfterSeconds?: number

  constructor(message: string, retryAfterSeconds?: number) {
    super(message)
    this.name = 'ReceiptParsingQuotaError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export interface ParsedReceipt {
  capture_type: 'receipt' | 'payment_screenshot' | 'bank_transaction' | 'other'
  transaction_type: 'expense' | 'income' | 'transfer' | 'unknown'
  store_name: string
  description: string
  date: string
  items: Array<{
    name: string
    quantity: number
    price: number
  }>
  total_amount: number
  currency: string
  payment_method?: string
  confidence_score: number
}

const CAPTURE_TYPES = new Set([
  'receipt',
  'payment_screenshot',
  'bank_transaction',
  'other',
])
const TRANSACTION_TYPES = new Set(['expense', 'income', 'transfer', 'unknown'])
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash'

const RECEIPT_PROMPT = `You are a personal finance transaction parser. Analyze the image. It may be a paper receipt photo, a payment app screenshot, an online order confirmation, a credit card transaction screen, or a banking transaction screenshot.

Extract exactly one transaction if possible and return JSON in this format:

{
  "capture_type": "receipt | payment_screenshot | bank_transaction | other",
  "transaction_type": "expense | income | transfer | unknown",
  "store_name": "merchant, payee, payer, or counterparty name",
  "description": "short human-readable description",
  "date": "Date in YYYY-MM-DD format",
  "items": [
    {"name": "Item name", "quantity": 1, "price": 10.50}
  ],
  "total_amount": 10.50,
  "currency": "USD or CNY (ISO 4217 code, detect from currency symbols: $ = USD, ¥/元/人民币 = CNY)",
  "payment_method": "card, cash, Apple Pay, Alipay, WeChat Pay, bank transfer, or unknown",
  "confidence_score": 0.95
}

Rules:
- Classify money paid by the user as "expense".
- Classify money received by the user as "income".
- Classify movement between the user's own accounts as "transfer".
- If direction is unclear, use "expense" for merchant receipts and payment confirmations, otherwise "unknown".
- If the date is not visible, use today's date: ${new Date().toISOString().split('T')[0]}
- If the currency is unclear, default to USD
- The total_amount should be positive
- Ignore account balances, credit limits, reward points, tips that are not part of the final amount, and unrelated UI totals
- The confidence_score should reflect how confident you are in the extraction (0.0-1.0)
- If line items are not visible, return an empty items array
- Return ONLY valid JSON, no markdown or other text`

/**
 * Parse a receipt image using Gemini Vision API
 */
export async function parseReceipt(
  imageBase64: string,
  mimeType: string = 'image/jpeg',
  currencyOverride?: string
): Promise<ParsedReceipt> {
  const apiKey = process.env.GEMINI_API_KEY
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured')
  }

  const genAI = new GoogleGenAI({ apiKey })

  const prompt = currencyOverride
    ? `${RECEIPT_PROMPT}\n\nIMPORTANT: The user specified the currency is ${currencyOverride}. Use this regardless of what the receipt shows.`
    : RECEIPT_PROMPT

  let response

  try {
    response = await genAI.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: imageBase64,
              },
            },
            { text: prompt },
          ],
        },
      ],
      config: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    })
  } catch (error) {
    throw normalizeGeminiError(error)
  }

  const text = response.text ?? ''

  try {
    // Clean the response text - remove any markdown fencing
    const cleanedText = text
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim()

    const parsed: ParsedReceipt = JSON.parse(cleanedText)

    // Validate and sanitize
    if (!CAPTURE_TYPES.has(parsed.capture_type)) parsed.capture_type = 'other'
    if (!TRANSACTION_TYPES.has(parsed.transaction_type)) {
      parsed.transaction_type = 'unknown'
    }
    if (!parsed.store_name) parsed.store_name = 'Unknown Merchant'
    if (!parsed.description) parsed.description = parsed.store_name
    if (!parsed.date) parsed.date = new Date().toISOString().split('T')[0]
    if (!parsed.items) parsed.items = []
    if (!parsed.total_amount || parsed.total_amount <= 0) {
      // Try to calculate from items
      parsed.total_amount = parsed.items.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      )
    }
    parsed.currency = (parsed.currency || currencyOverride || 'USD').toUpperCase()
    if (!parsed.payment_method) parsed.payment_method = 'unknown'
    if (
      !parsed.confidence_score ||
      parsed.confidence_score < 0 ||
      parsed.confidence_score > 1
    ) {
      parsed.confidence_score = 0.5
    }

    // Override currency if specified
    if (currencyOverride) {
      parsed.currency = currencyOverride
    }

    return parsed
  } catch (parseError) {
    console.error('Failed to parse Gemini response:', text)
    throw new Error(`Failed to parse receipt data: ${parseError}`)
  }
}

function normalizeGeminiError(error: unknown) {
  const errorText = String(error)

  if (
    errorText.includes('RESOURCE_EXHAUSTED') ||
    errorText.includes('quota') ||
    errorText.includes('429')
  ) {
    const retryMatch = errorText.match(/retry in\s+([0-9.]+)s/i)
    const retryAfterSeconds = retryMatch
      ? Math.max(1, Math.ceil(Number(retryMatch[1])))
      : undefined

    return new ReceiptParsingQuotaError(
      'Gemini API quota exceeded',
      retryAfterSeconds
    )
  }

  return error instanceof Error ? error : new Error(errorText)
}
