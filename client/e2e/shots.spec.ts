import { test } from '@playwright/test'
import { SHOTS_DIR, loginAs, settle } from './helpers'

test('dashboard (procurement officer)', async ({ page }) => {
  await loginAs(page, 'PROCUREMENT_OFFICER')
  await settle(page)
  await page.screenshot({ path: `${SHOTS_DIR}/01-dashboard.png`, fullPage: true })
})
