import { GoogleGenAI } from '@google/genai'
import type { CategoryRow } from '../categories-db'

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

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

export async function classifyTransactionsBatch(
  transactions: RawTransactionToClassify[],
  existingCategories: CategoryRow[]
): Promise<ClassifiedTransaction[]> {
  if (transactions.length === 0) return []

  const apiKey = process.env.GEMINI_API_KEY
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured')
  }

  const genAI = new GoogleGenAI({ apiKey })

  const prompt = `You are a financial transaction classifier.
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

    const parsed: ClassifiedTransaction[] = JSON.parse(cleanedText)
    
    // Ensure all requested IDs are in the response
    return parsed
  } catch (parseError) {
    console.error('Failed to parse Gemini classification response:', text)
    throw new Error(`Failed to parse classification data: ${parseError}`)
  }
}
