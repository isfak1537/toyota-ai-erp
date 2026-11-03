import type { Page } from '@playwright/test'

export const ACCOUNTS = {
  ADMIN: { email: 'admin@demo.synthetic', env: 'DEMO_ADMIN_PASSWORD' },
  PROCUREMENT_OFFICER: { email: 'procurement@demo.synthetic', env: 'DEMO_PROCUREMENT_PASSWORD' },
  WAREHOUSE_MANAGER: { email: 'warehouse@demo.synthetic', env: 'DEMO_WAREHOUSE_PASSWORD' },
  VIEWER: { email: 'viewer@demo.synthetic', env: 'DEMO_VIEWER_PASSWORD' },
} as const

export type DemoRole = keyof typeof ACCOUNTS

// Logs in through the real login form. The password comes from the environment, never from the repo.
export async function loginAs(page: Page, role: DemoRole) {
  const account = ACCOUNTS[role]
  const password = process.env[account.env]

  if (!password) throw new Error(`${account.env} is not set; run with the server .env loaded (see e2e/README.md)`)

  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByRole('navigation', { name: 'Main' }).waitFor()
}

export const SHOTS_DIR = '../docs/screenshots'

// Waits until nothing is loading, so a screenshot never shows a spinner.
export async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.waitForFunction(() => !document.querySelector('.spinner') && ![...document.querySelectorAll('.kpi__value')].some((el) => el.textContent === '…'))
  await page.mouse.move(2, 2) // no stray hover tooltips in screenshots
}
