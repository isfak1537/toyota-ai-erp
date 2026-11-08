import { expect, test } from '@playwright/test'
import { ACCOUNTS, loginAs, MENU, settle, type DemoRole } from './helpers'

// Read-only smoke test of the real stack: logins, role-based menus and actions, the assistant, logout.
// (It asks the assistant one question, which writes one audit row; nothing else is written.)
const nav = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Main' })

for (const role of Object.keys(ACCOUNTS) as DemoRole[]) {
  test(`${role}: logs in, sees the right menu and the dashboard`, async ({ page }) => {
    await loginAs(page, role)
    await settle(page)

    for (const item of MENU[role].has) await expect(nav(page).getByRole('link', { name: item })).toBeVisible()
    for (const item of MENU[role].hasNot) await expect(nav(page).getByRole('link', { name: item })).toHaveCount(0)

    await expect(page.getByLabel('Key figures')).toContainText('Low stock')
    await expect(page.getByLabel('Key figures')).not.toContainText('…')
    await expect(page.getByText('Not an official Toyota product.')).toBeVisible()
  })
}

test('a viewer can read suggestions but not run or decide on them', async ({ page }) => {
  await loginAs(page, 'VIEWER')
  await nav(page).getByRole('link', { name: 'AI suggestions' }).click()
  await page.getByRole('heading', { name: 'AI suggestions' }).waitFor()
  await settle(page)

  await expect(page.getByRole('button', { name: 'Run replenishment' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Review' }).first().click()
  await expect(page.getByText('Only a procurement officer or administrator can approve or reject')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve…' })).toHaveCount(0)
})

test('the replenishment review lists every series the latest run looked at', async ({ page }) => {
  await loginAs(page, 'VIEWER')
  await page.goto('/suggestions?tab=review')
  await page.getByText(/Every product and warehouse the latest run looked at/).waitFor()
  await settle(page)

  expect(await page.getByRole('row').count()).toBeGreaterThan(20)
  await expect(page.getByRole('cell', { name: 'No order needed' }).first()).toBeVisible()
})

test('the two anomaly lists are separate tabs', async ({ page }) => {
  await loginAs(page, 'VIEWER')
  await page.goto('/anomalies')
  await expect(page.getByRole('tab', { name: /Confirmed rule hits/ })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: /Weekly review queue/ }).click()
  await expect(page.getByRole('columnheader', { name: 'Rank' })).toBeVisible()
})

test('a wrong password is refused and a deep link to an admin page is blocked for a viewer', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(ACCOUNTS.VIEWER.email)
  await page.getByLabel('Password').fill('definitely-the-wrong-password')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('alert')).toContainText('Invalid email or password')

  await loginAs(page, 'VIEWER')
  await page.goto('/admin/audit')
  await expect(page.getByText('You do not have access to this')).toBeVisible()
})

test('the assistant answers from the system data', async ({ page }) => {
  await loginAs(page, 'VIEWER')
  await page.getByRole('button', { name: /Ask the assistant/ }).click()
  await page.getByRole('button', { name: 'Which products will run out soonest?' }).click()

  await expect(page.getByText('AI-written')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(/looked at:/)).toBeVisible()
})

test('logging out returns to the login page and protected pages need a new login', async ({ page }) => {
  await loginAs(page, 'ADMIN')
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()

  await page.goto('/ledger')
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
})
