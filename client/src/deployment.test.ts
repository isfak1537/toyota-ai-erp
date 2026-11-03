import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')

describe('hosting files', () => {
  const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as {
    rewrites: { source: string; destination: string }[]
    headers: { source: string; headers: { key: string; value: string }[] }[]
  }

  it('sends every path to the single-page app', () => {
    expect(config.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }])
  })

  it('sets a content security policy that allows no framing, no foreign scripts and no inline scripts', () => {
    const csp = config.headers[0].headers.find((h) => h.key === 'Content-Security-Policy')!.value

    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/)
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("connect-src 'self' https:") // the API lives on another https origin; tighten to it after deploying
  })

  it('sets the other security headers and caches only the hashed assets', () => {
    const keys = config.headers[0].headers.map((h) => h.key)

    expect(keys).toEqual(expect.arrayContaining(['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy']))
    expect(config.headers[1]).toMatchObject({ source: '/assets/(.*)' })
  })

  it('documents every VITE_ variable the source reads, and holds no value that looks like a secret', () => {
    const used = new Set<string>()
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)

        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts')) for (const m of readFileSync(path, 'utf8').matchAll(/import\.meta\.env\.(VITE_[A-Z_]+)/g)) used.add(m[1])
      }
    }
    walk(join(root, 'src'))
    const example = readFileSync(join(root, '.env.example'), 'utf8')

    expect(used.size).toBeGreaterThan(0)
    for (const name of used) expect(example).toMatch(new RegExp(`^${name}=`, 'm'))
    expect(example).not.toMatch(/(secret|password|token|key)\s*=\s*\S+/i)
  })

  it('the dev server proxies /api, so development needs no CORS setup', () => {
    expect(readFileSync(join(root, 'vite.config.ts'), 'utf8')).toMatch(/proxy:\s*\{\s*'\/api'/)
  })
})
