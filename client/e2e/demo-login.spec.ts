import { expect, test } from '@playwright/test'
import { MENU, settle, type DemoRole } from './helpers'

// Needs the API started with DEMO_LOGIN_ENABLED=true (passed as a process variable, never written to a file).
// Clicking a button signs in without a password; the dashboard and the role-based menu must then be right.
const BUTTONS: Record<DemoRole, RegExp> = {
  ADMIN: /^Admin/,
  WAREHOUSE_MANAGER: /^Warehouse manager/,
  PROCUREMENT_OFFICER: /^Procurement officer/,
  VIEWER: /^Viewer/,
}

for (const role of Object.keys(BUTTONS) as DemoRole[]) {
  test(`${role}: the demo button signs in and shows the right menu`, async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: BUTTONS[role] }).click()
    await page.getByRole('navigation', { name: 'Main' }).waitFor()
    await settle(page)

    const nav = page.getByRole('navigation', { name: 'Main' })

    for (const item of MENU[role].has) await expect(nav.getByRole('link', { name: item })).toBeVisible()
    for (const item of MENU[role].hasNot) await expect(nav.getByRole('link', { name: item })).toHaveCount(0)

    await expect(page.getByLabel('Key figures')).toContainText('Low stock')
    await expect(page.getByLabel('Key figures')).not.toContainText('…')
  })
}
