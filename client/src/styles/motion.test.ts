import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/styles/motion.css', 'utf8')
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> }

describe('motion', () => {
  it('is switched off for people who ask for reduced motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important[\s\S]*transition: none !important/)
  })

  it('uses no animation library and keeps every duration under a quarter second', () => {
    expect(Object.keys(pkg.dependencies).filter((name) => /framer|motion|gsap|animejs|lottie|react-spring/.test(name))).toEqual([])

    const durations = [...css.matchAll(/--motion-(?:fast|base):\s*(\d+)ms/g)].map((m) => Number(m[1]))

    expect(durations.length).toBeGreaterThan(0)
    expect(Math.max(...durations)).toBeLessThan(250)
  })
})
