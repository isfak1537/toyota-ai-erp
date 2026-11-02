import { describe, expect, it } from 'vitest'
import { formatDateTime, formatDays, formatMoney, formatNumber, humanize } from './format'

describe('format', () => {
  it('shows UTC timestamps in business time (UTC+6)', () => {
    expect(formatDateTime('2026-11-01T18:30:00Z')).toBe('02 Nov 2026, 00:30')
    expect(formatDateTime(null)).toBe('–')
  })

  it('formats numbers, days of cover (null means beyond the horizon) and money', () => {
    expect(formatNumber(1234.5)).toBe('1,235')
    expect(formatNumber(1.25, 1)).toBe('1.3')
    expect(formatNumber(null)).toBe('–')
    expect(formatDays(3.14159)).toBe('3.1')
    expect(formatDays(null)).toBe('30+')
    expect(formatMoney('48')).toBe('48.00')
  })

  it('humanizes enum codes', () => {
    expect(humanize('COVERED_BY_ON_ORDER')).toBe('Covered by on order')
  })
})
