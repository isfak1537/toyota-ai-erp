import { test } from '@playwright/test'
import { SHOTS_DIR, loginAs, settle } from './helpers'

test('dashboard (procurement officer)', async ({ page }) => {
  await loginAs(page, 'PROCUREMENT_OFFICER')
  await settle(page)
  await page.screenshot({ path: `${SHOTS_DIR}/01-dashboard.png`, fullPage: true })
})

test('forecast (trending product)', async ({ page }) => {
  await loginAs(page, 'PROCUREMENT_OFFICER')
  await page.getByRole('link', { name: 'Cabin Air Filter' }).first().click()
  await page.getByRole('heading', { name: 'Cabin Air Filter' }).waitFor()
  await settle(page)
  await page.waitForTimeout(300)
  await page.mouse.move(2, 2)
  await page.screenshot({ path: `${SHOTS_DIR}/02-forecast.png`, fullPage: true })
})
