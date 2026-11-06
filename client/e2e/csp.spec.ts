import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { loginAs } from './helpers'

// The production build, served with the Content-Security-Policy from vercel.json, must still work: no violations on any page.
// Run it against `vite preview` (E2E_BASE_URL=http://localhost:4173); the dev server needs inline scripts, the build does not.
const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as { headers: { headers: { key: string; value: string }[] }[] }
const csp = config.headers[0].headers.find((h) => h.key === 'Content-Security-Policy')!.value

test('the production build runs under the real content security policy without a single violation', async ({ page }) => {
  const violations: string[] = []

  await page.route('**/*', async (route) => {
    const response = await route.fetch()
    const headers = { ...response.headers() }

    if ((headers['content-type'] ?? '').includes('text/html')) headers['content-security-policy'] = csp

    await route.fulfill({ response, headers })
  })
  page.on('console', (m) => {
    if (/content security policy|refused to/i.test(m.text())) violations.push(m.text().slice(0, 200))
  })
  page.on('pageerror', (e) => violations.push(`page error: ${e.message}`))

  await loginAs(page, 'ADMIN')

  for (const path of ['/', '/suggestions', '/suggestions?tab=review', '/anomalies', '/procurement', '/ledger', '/admin/models', '/admin/audit']) {
    await page.goto(path)
    await page.getByRole('main').waitFor()
    await page.waitForLoadState('networkidle')
  }

  await page.goto('/')
  await page.getByRole('link', { name: 'Cabin Air Filter' }).first().click()
  await page.getByText('How accurate is it?').waitFor() // the lazily loaded chart page
  await page.getByRole('button', { name: /Ask the assistant/ }).click()
  await expect(page.getByRole('complementary', { name: 'AI assistant' })).toBeVisible()

  expect(violations).toEqual([])
})
