import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('analytics explore section does not statically import Chart.js-backed charts', () => {
  const source = readFileSync('src/components/analytics/AnalyticsExploreSection.tsx', 'utf8')

  assert.equal(
    /import\s+AnalyticsCharts\s+from\s+['"]\.\/AnalyticsCharts['"]/.test(source),
    false,
    'AnalyticsCharts should be loaded dynamically because the chart area starts collapsed'
  )
  assert.match(source, /dynamic\(\s*\(\)\s*=>\s*import\(['"]\.\/AnalyticsCharts['"]\)/)
})

test('transactions page disables metadata fetching for append requests', () => {
  const source = readFileSync('src/app/(dashboard)/transactions/page.tsx', 'utf8')

  assert.match(source, /includeMetadata:\s*!append/)
})

test('transactions API honors includeMetadata=false before querying categories or accounts', () => {
  const source = readFileSync('src/app/api/transactions/route.ts', 'utf8')

  assert.match(source, /const\s+includeMetadata\s*=\s*searchParams\.get\(['"]includeMetadata['"]\)\s*!==\s*['"]false['"]/)
  assert.match(source, /includeMetadata\s*\?\s*supabase\s*\n?\s*\.from\(['"]categories['"]\)/)
  assert.match(source, /includeMetadata\s*\?\s*supabase\s*\n?\s*\.from\(['"]accounts['"]\)/)
})
