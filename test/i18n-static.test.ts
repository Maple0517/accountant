import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const i18nSource = readFileSync(join(root, 'src/i18n/client.tsx'), 'utf8')
const i18nNamespaceDir = join(root, 'src/i18n/namespaces')

function walk(dir: string, files: string[] = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      walk(fullPath, files)
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(fullPath)
    }
  }
  return files
}

function extractDictionaryKeys(dictionaryName: 'en' | 'zh') {
  const sources = [i18nSource]
  if (existsSync(i18nNamespaceDir)) {
    for (const entry of readdirSync(i18nNamespaceDir)) {
      if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
        sources.push(readFileSync(join(i18nNamespaceDir, entry), 'utf8'))
      }
    }
  }

  return new Set(
    sources.flatMap((source) =>
      Array.from(source.matchAll(
        new RegExp(`(?:const|export const)\\s+${dictionaryName}\\w*\\s*[:=][\\s\\S]*?\\{([\\s\\S]*?)\\n\\}`, 'g')
      )).flatMap((match) =>
        Array.from(match[1].matchAll(/^\s*'([^']+)':/gm), (keyMatch) => keyMatch[1])
      )
    )
  )
}

test('all literal translation keys used by t() exist in the English dictionary', () => {
  const enKeys = extractDictionaryKeys('en')
  const files = walk(join(root, 'src'))
  const missing: string[] = []

  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) {
      const key = match[1]
      if (!enKeys.has(key)) {
        missing.push(`${relative(root, file)}: ${key}`)
      }
    }
  }

  assert.deepEqual(missing, [])
})

test('English UI source does not contain hardcoded Chinese outside dictionaries and data layer', () => {
  const files = [
    ...walk(join(root, 'src/app')),
    ...walk(join(root, 'src/components')),
    ...walk(join(root, 'src/features')),
  ]
  const offenders: string[] = []

  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    if (/\p{Script=Han}/u.test(source)) {
      offenders.push(relative(root, file))
    }
  }

  assert.deepEqual(offenders, [])
})


test('locale detection does not auto-switch from browser language or stale localStorage', () => {
  assert.equal(i18nSource.includes('navigator.language'), false)
  assert.equal(i18nSource.includes('navigator.languages'), false)
  assert.equal(i18nSource.includes('readStoredLocale'), false)
})

test('route translation namespaces stay outside the shared i18n client bundle', () => {
  const routePrefixes = [
    'accounts',
    'analytics',
    'auth',
    'budgets',
    'dashboard',
    'settings',
    'transactions',
  ]

  for (const prefix of routePrefixes) {
    assert.equal(
      i18nSource.includes(`'${prefix}.`),
      false,
      `${prefix} translations should live in src/i18n/namespaces/${prefix}.ts instead of the shared client bundle`
    )
    const namespacePath = join(i18nNamespaceDir, `${prefix}.ts`)
    assert.equal(existsSync(namespacePath), true, `${prefix} namespace file should exist`)
    const namespaceSource = readFileSync(namespacePath, 'utf8')
    assert.match(namespaceSource, /registerI18nNamespace\(/)
  }
})
