import { test, type Page } from '@playwright/test'
import { SHOTS_DIR, loginAs, settle } from './helpers'

// One login per role (the API limits login attempts), then every page of that role in a row.
test.describe.configure({ mode: 'serial' })

async function shot(page: Page, name: string) {
  // the floating button would sit in the middle of a stitched full-page image
  await page.addStyleTag({ content: name.startsWith('10-') ? '' : '.assistant-fab { display: none !important }' })
  await settle(page)
  await page.waitForTimeout(250)
  await page.mouse.move(2, 2)
  await page.screenshot({ path: `${SHOTS_DIR}/${name}.png`, fullPage: true })
}

test('procurement officer: dashboard, forecast, suggestions', async ({ page }) => {
  await loginAs(page, 'PROCUREMENT_OFFICER')
  await shot(page, '01-dashboard')

  await page.getByRole('link', { name: 'Cabin Air Filter' }).first().click()
  await page.getByRole('heading', { name: 'Cabin Air Filter' }).waitFor()
  await shot(page, '02-forecast')

  await page.getByRole('link', { name: 'AI suggestions' }).click()
  await page.getByRole('heading', { name: 'AI suggestions' }).waitFor()
  await page.getByRole('button', { name: 'Review' }).first().click()
  await page.getByText('Why this quantity').waitFor()
  await shot(page, '03-suggestions')

  await page.getByRole('tab', { name: /Replenishment review/ }).click()
  await page.getByText(/Every product and warehouse the latest run looked at/).waitFor()
  await shot(page, '04-replenishment-review')
})

test('warehouse manager: anomalies (rule hits and review queue)', async ({ page }) => {
  await loginAs(page, 'WAREHOUSE_MANAGER')
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Anomalies' }).click()
  await page.getByRole('heading', { name: 'Anomalies' }).waitFor()
  await page.getByRole('button', { name: 'Details' }).first().click()
  await page.getByText('Detected by').waitFor()
  await shot(page, '05-anomalies-rule-hits')

  await page.getByRole('tab', { name: /Weekly review queue/ }).click()
  await page.getByRole('columnheader', { name: 'Rank' }).waitFor()
  await shot(page, '06-anomalies-review-queue')

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Procurement' }).click()
  await page.getByRole('heading', { name: 'Procurement' }).waitFor()
  await shot(page, '07-procurement-requisitions')

  await page.getByRole('tab', { name: 'Purchase orders' }).click()
  await page.getByRole('button', { name: 'Receive goods…' }).first().click()
  await page.getByRole('button', { name: 'Post goods receipt' }).waitFor()
  await shot(page, '08-procurement-receive-goods')

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Stock ledger' }).click()
  await page.getByRole('heading', { name: 'Stock ledger' }).waitFor()
  await shot(page, '09-ledger')
})

test('administrator: assistant, models, audit log', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.getByRole('button', { name: /Ask the assistant/ }).click()
  await page.getByLabel('Your question').fill('Which products will run out soonest?')
  await page.getByRole('button', { name: 'Ask' }).click()
  await page.getByText('AI-written').waitFor({ timeout: 60000 })
  await shot(page, '10-assistant')
  await page.getByRole('button', { name: 'Close the assistant' }).click()

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'AI models' }).click()
  await page.getByRole('heading', { name: 'AI models' }).waitFor()
  await shot(page, '11-models')

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'AI audit log' }).click()
  await page.getByRole('heading', { name: 'AI audit log' }).waitFor()
  await shot(page, '12-audit-log')
})
