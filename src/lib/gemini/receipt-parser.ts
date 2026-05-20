import { GoogleGenAI } from '@google/genai'

export interface ParsedReceipt {
  store_name: string
  date: string
  items: Array<{
    name: string
    quantity: number
    price: number
  }>
  total_amount: number
  currency: string
  confidence_score: number
}

const RECEIPT_PROMPT = `You are a receipt parser. Analyze this receipt image and extract the following information in JSON format:

{
  "store_name": "Name of the store/merchant",
  "date": "Date in YYYY-MM-DD format",
  "items": [
    {"name": "Item name", "quantity": 1, "price": 10.50}
  ],
  "total_amount": 10.50,
  "currency": "USD or CNY (ISO 4217 code, detect from currency symbols: $ = USD, ¥/元/人民币 = CNY)",
  "confidence_score": 0.95
}

Rules:
- If the date is not visible, use today's date
- If the currency is unclear, default to USD
- The total_amount should be positive
- The confidence_score should reflect how confident you are in the extraction (0.0-1.0)
- If some items are unclear, still include them with your best guess
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
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured')
  }

  const genAI = new GoogleGenAI({ apiKey })

  const prompt = currencyOverride
    ? `${RECEIPT_PROMPT}\n\nIMPORTANT: The user specified the currency is ${currencyOverride}. Use this regardless of what the receipt shows.`
    : RECEIPT_PROMPT

  const response = await genAI.models.generateContent({
    model: 'gemini-2.0-flash',
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

  const text = response.text ?? ''

  try {
    // Clean the response text - remove any markdown fencing
    const cleanedText = text
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim()

    const parsed: ParsedReceipt = JSON.parse(cleanedText)

    // Validate and sanitize
    if (!parsed.store_name) parsed.store_name = 'Unknown Store'
    if (!parsed.date) parsed.date = new Date().toISOString().split('T')[0]
    if (!parsed.items) parsed.items = []
    if (!parsed.total_amount || parsed.total_amount <= 0) {
      // Try to calculate from items
      parsed.total_amount = parsed.items.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      )
    }
    if (!parsed.currency) parsed.currency = currencyOverride || 'USD'
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
