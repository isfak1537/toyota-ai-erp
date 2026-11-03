import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { loginAs, settle } from './helpers'

// Automated accessibility check of every page against the real stack, as an administrator (who can open all of them).
// It fails on serious and critical findings (contrast, names, roles...). Automated checks do not replace trying the
// keyboard and a screen reader, but they catch the common mistakes.
const PAGES: [string, string][] = [
  ['Inventory', '/'],
  ['Forecast', '/products/__FIRST__/forecast'],
  ['AI suggestions', '/suggestions'],
  ['Replenishment review', '/suggestions?tab=review'],
  ['Anomalies (rule hits)', '/anomalies'],
  ['Anomalies (queue)', '/anomalies?tab=queue'],
  ['Procurement requisitions', '/procurement'],
  ['Procurement orders', '/procurement?tab=orders'],
  ['Procurement receipts', '/procurement?tab=receipts'],
  ['Ledger', '/ledger'],
  ['AI models', '/admin/models'],
  ['AI audit log', '/admin/audit'],
]

test('no serious accessibility violations on any page', async ({ page }) => {
  const failures: string[] = []
  const report = (name: string, violations: { impact?: string | null; id: string; help: string; nodes: { target: unknown[] }[] }[]) => {
    for (const v of violations.filter((x) => ['serious', 'critical'].includes(x.impact ?? ''))) {
      failures.push(`${name}: [${v.impact}] ${v.id} - ${v.help} (${v.nodes.length} element(s), e.g. ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')})`)
    }
  }

  await page.goto('/login')
  report('Login', (await new AxeBuilder({ page }).analyze()).violations)

  await loginAs(page, 'ADMIN')
  await settle(page)
  const href = await page.getByRole('link', { name: 'Cabin Air Filter' }).first().getAttribute('href')
  const productId = /products\/(\d+)\//.exec(href ?? '')?.[1] ?? '1'
  for (const [name, path] of PAGES) {
    await page.goto(path.replace('__FIRST__', productId))
    await page.getByRole('main').waitFor()
    await settle(page)
    await page.waitForTimeout(300)

    report(name, (await new AxeBuilder({ page }).analyze()).violations)
  }

  expect(failures).toEqual([])
})

test('no page scrolls sideways on a phone-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginAs(page, 'ADMIN')
  const overflowing: string[] = []

  for (const [name, path] of PAGES.filter(([n]) => n !== 'Forecast')) {
    await page.goto(path)
    await page.getByRole('main').waitFor()
    await settle(page)
    const wider = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

    if (wider > 1) overflowing.push(`${name}: ${wider}px wider than the screen`)
  }

  expect(overflowing).toEqual([])
})
