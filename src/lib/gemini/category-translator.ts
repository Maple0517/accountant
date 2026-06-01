import { GoogleGenAI } from '@google/genai'
import { findDefaultCategoryByName } from '@/lib/categories'
import { DEFAULT_GEMINI_MODEL } from './config'

export type CategoryTranslation = {
  name: string
  name_zh: string
}

export type CategoryTranslator = (name: string) => Promise<CategoryTranslation>

const MAX_CATEGORY_NAME_LENGTH = 60

function containsHan(value: string) {
  return /\p{Script=Han}/u.test(value)
}

function sanitizeCategoryName(value: unknown) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_CATEGORY_NAME_LENGTH)
    : ''
}

function extractFirstJsonObject(text: string) {
  const cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()

  const start = cleaned.indexOf('{')
  if (start === -1) return cleaned

  let depth = 0
  let inString = false
  let escaping = false

  for (let index = start; index < cleaned.length; index += 1) {
    const char = cleaned[index]

    if (inString) {
      if (escaping) {
        escaping = false
        continue
      }
      if (char === '\\') {
        escaping = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      if (depth === 0) return cleaned.slice(start, index + 1)
    }
  }

  return cleaned
}

export function parseCategoryTranslationResponseText(text: string): CategoryTranslation {
  const parsed = JSON.parse(extractFirstJsonObject(text)) as Record<string, unknown>
  const name = sanitizeCategoryName(parsed.name)
  const nameZh = sanitizeCategoryName(parsed.name_zh)

  if (!name || !nameZh) {
    throw new Error('Category translation response is missing name or name_zh')
  }

  if (containsHan(name)) {
    throw new Error('Category translation English name contains Chinese characters')
  }

  if (!containsHan(nameZh)) {
    throw new Error('Category translation Chinese name is not Chinese')
  }

  return { name, name_zh: nameZh }
}

function buildCategoryTranslationPrompt(rawName: string) {
  return `Translate this personal finance category name into a bilingual category record.

Rules:
- Return ONLY JSON, no markdown.
- "name" must be a short natural English category name, Title Case when appropriate.
- "name_zh" must be a short Simplified Chinese category name.
- Preserve the user's meaning. Do not add explanations.
- Use common personal finance category language.

Input category name: ${JSON.stringify(rawName)}

Output format:
{"name":"English Name","name_zh":"中文名"}`
}

export async function translateCategoryNameWithGemini(rawName: string): Promise<CategoryTranslation> {
  const trimmed = sanitizeCategoryName(rawName)
  if (!trimmed) {
    throw new Error('Category name is required')
  }

  const canonical = findDefaultCategoryByName({ name: trimmed })
  if (canonical) {
    return { name: canonical.name, name_zh: canonical.name_zh }
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured')
  }

  const genAI = new GoogleGenAI({ apiKey })
  const response = await genAI.models.generateContent({
    model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    contents: [
      {
        role: 'user',
        parts: [{ text: buildCategoryTranslationPrompt(trimmed) }],
      },
    ],
    config: {
      temperature: 0,
      responseMimeType: 'application/json',
    },
  })

  return parseCategoryTranslationResponseText(response.text ?? '')
}
