import { existsSync, readFileSync } from 'node:fs'
import { defineConfig } from '@playwright/test'

// The demo passwords live in server/.env (or the environment). Only DEMO_*_PASSWORD is read from that
// file, never any other variable, and nothing is printed.
const envFile = process.env.E2E_ENV_FILE ?? '../server/.env'

if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^(DEMO_[A-Z]+_PASSWORD)=(.*)$/.exec(line.trim())

    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
    }
  }
}

// Runs against the REAL stack (ERP API, AI service, database) that the developer has started:
//   ERP API on :5001, AI service on :8000, and `npm run dev` on :5173 (it proxies /api to :5001).
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    trace: 'off',
  },
})
