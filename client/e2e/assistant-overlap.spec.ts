import { expect, test } from '@playwright/test'
import { loginAs, settle } from './helpers'

// The assistant launcher must never sit on top of page content (it used to float over the right-hand "Details" /
// "Receive goods…" / "Next" buttons). For every page and several scroll positions, each button, link and field in the
// content must be the element actually hit at its own centre, i.e. nothing is drawn over it.
const PAGES = ['/', '/suggestions', '/suggestions?tab=review', '/anomalies', '/anomalies?tab=queue', '/procurement', '/procurement?tab=orders', '/procurement?tab=receipts', '/ledger', '/admin/models', '/admin/audit']

for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 800 }]] as const) {
  test(`nothing covers the page content on any page (${label})`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await loginAs(page, 'ADMIN')
    const covered: string[] = []

    for (const path of PAGES) {
      await page.goto(path)
      await settle(page)

      const found = await page.evaluate(() => {
        const out: string[] = []
        const max = document.documentElement.scrollHeight - innerHeight

        for (let y = 0; y <= max + 100; y += 150) {
          scrollTo(0, Math.min(y, max))

          for (const el of document.querySelectorAll<HTMLElement>('main button, main a, main input, main select')) {
            const r = el.getBoundingClientRect()
            if (!r.width || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue
            // the middle of the part that is inside the window
            const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1)
            const top = Math.max(r.top, 0)
            const bottom = Math.min(r.bottom, innerHeight)
            const hit = document.elementFromPoint(x, (top + bottom) / 2)

            if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) out.push(`${(el.textContent || '').trim().slice(0, 24)} under ${hit.className || hit.tagName}`)
          }
        }

        return [...new Set(out)]
      })

      covered.push(...found.map((f) => `${path}: ${f}`))
    }

    expect(covered).toEqual([])
  })
}
