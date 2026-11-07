import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { loginAs, settle } from './helpers'

// Verification sweep (SRS section 12): open every MVP page as an administrator against the real stack, fail on any console
// error, page error or failed request, and save a screenshot of each. Read-only: the only non-GET request allowed is the login.
const OUT = '../docs/screenshots/verify'
const PAGES: [string, string, string][] = [
  ['dashboard', 'Dashboard (inventory)', '/'],
  ['forecast', 'Forecast', '/products/__FIRST__/forecast'],
  ['suggestions', 'AI suggestions', '/suggestions'],
  ['suggestions-review', 'Replenishment review', '/suggestions?tab=review'],
  ['anomalies-rules', 'Anomalies (confirmed rule hits)', '/anomalies'],
  ['anomalies-queue', 'Anomalies (weekly review queue)', '/anomalies?tab=queue'],
  ['procurement-requisitions', 'Procurement: requisitions', '/procurement'],
  ['procurement-orders', 'Procurement: purchase orders', '/procurement?tab=orders'],
  ['procurement-receipts', 'Procurement: goods receipts', '/procurement?tab=receipts'],
  ['ledger', 'Stock ledger', '/ledger'],
  ['models', 'AI models', '/admin/models'],
  ['audit', 'AI audit log', '/admin/audit'],
]

test('every MVP page opens as admin with no console error and no failed request', async ({ page }) => {
  mkdirSync(OUT, { recursive: true })
  const problems: string[] = []
  let current = 'login'
  const checked: string[] = []

  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${current}: console error: ${m.text()}`) })
  page.on('pageerror', (e) => problems.push(`${current}: page error: ${e.message}`))
  page.on('requestfailed', (r) => problems.push(`${current}: request failed: ${r.method()} ${r.url()} (${r.failure()?.errorText})`))
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`${current}: HTTP ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`)
    if (r.request().method() !== 'GET' && !r.url().includes('/auth/login')) problems.push(`${current}: unexpected write ${r.request().method()} ${new URL(r.url()).pathname}`)
  })

  await loginAs(page, 'ADMIN')
  await settle(page)
  const href = await page.getByRole('link', { name: 'Cabin Air Filter' }).first().getAttribute('href')
  const productId = /products\/(\d+)\//.exec(href ?? '')?.[1] ?? '1'

  for (const [file, name, path] of PAGES) {
    current = name
    await page.goto(path.replace('__FIRST__', productId))
    await page.getByRole('main').waitFor()
    await settle(page)
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: true })
    checked.push(name)
  }

  expect(checked).toHaveLength(PAGES.length)
  expect(problems).toEqual([])
})
