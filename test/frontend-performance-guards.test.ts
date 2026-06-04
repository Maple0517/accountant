import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

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


test('dashboard API does not run unused analytics work for overview load', () => {
  const source = readFileSync('src/app/api/dashboard/route.ts', 'utf8')

  assert.equal(
    source.includes('getAnalyticsSummary'),
    false,
    'Dashboard overview should not import or execute analytics summary when the page does not consume it'
  )
})

test('dashboard page consumes server summary instead of reducing full month transactions on the client', () => {
  const source = readFileSync('src/app/(dashboard)/dashboard/page.tsx', 'utf8')

  assert.equal(
    source.includes('data?.monthTx'),
    false,
    'Dashboard page should not receive/reduce full month transaction rows for overview metrics'
  )
  assert.match(source, /data\?\.summary/)
})

test('accounts manage Plaid link hook is lazy-loaded behind a launcher', () => {
  const buttonSource = readFileSync('src/components/accounts/PlaidManageAccountsButton.tsx', 'utf8')
  const launcherPath = 'src/components/accounts/PlaidManageAccountsLauncher.tsx'

  assert.equal(
    buttonSource.includes('react-plaid-link'),
    false,
    'The accounts page button should not statically import react-plaid-link'
  )
  assert.match(buttonSource, /dynamic\(\s*\(\)\s*=>\s*import\(['"]\.\/PlaidManageAccountsLauncher['"]\)/)
  assert.equal(existsSync(launcherPath), true, 'Plaid manage launcher file should exist')
  const launcherSource = readFileSync(launcherPath, 'utf8')
  assert.match(launcherSource, /from ['"]react-plaid-link['"]/)
})

test('transactions split editor is lazy-loaded outside the transactions page bundle', () => {
  const source = readFileSync('src/app/(dashboard)/transactions/page.tsx', 'utf8')

  assert.equal(
    /function\s+SplitEditorDrawer/.test(source),
    false,
    'SplitEditorDrawer should live outside the already-large transactions page bundle'
  )
  assert.match(source, /dynamic\(\s*\(\)\s*=>\s*import\(['"]@\/components\/transactions\/SplitEditorDrawer['"]\)/)
})
