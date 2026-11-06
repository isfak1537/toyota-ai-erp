// Times are stored in UTC and shown in business time (Asia/Dhaka, UTC+6), the same convention as the
// anomaly rules and the demand series (see the README's time convention).
const BUSINESS_TZ = 'Asia/Dhaka'

const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: BUSINESS_TZ,
})
const dateOnly = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: BUSINESS_TZ })

export const formatDateTime = (iso: string | null | undefined) => (iso ? dateTime.format(new Date(iso)) : '–')
export const formatDate = (iso: string | null | undefined) => (iso ? dateOnly.format(new Date(iso)) : '–')

export const formatNumber = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined ? '–' : value.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export const formatDays = (days: number | null | undefined, horizon = 30) =>
  days === null || days === undefined ? `${horizon}+` : formatNumber(days, 1)

export const formatMoney = (value: string | number | null | undefined) =>
  value === null || value === undefined ? '–' : Number(value).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// "COVERED_BY_ON_ORDER" -> "Covered by on order"; acronyms keep their capitals
export const humanize = (code: string) =>
  code
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .replace(/\bllm\b/gi, 'LLM')
    .replace(/\bpo\b/gi, 'PO')

// The calendar date (YYYY-MM-DD) of an instant in business time.
export const businessDate = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: BUSINESS_TZ }).format(new Date(iso))

// [start of the day, start of the next day) in business time, as ISO instants for the API's from/to filters.
export const businessDayRange = (from?: string, to?: string) => ({
  from: from ? new Date(`${from}T00:00:00+06:00`).toISOString() : undefined,
  to: to ? new Date(new Date(`${to}T00:00:00+06:00`).getTime() + 86400000).toISOString() : undefined,
})

// How open purchase orders were matched to a warehouse (AI-004); plain words for the review screens
export const ON_ORDER_METHOD_TEXT: Record<string, string> = {
  NONE: 'none',
  DESTINATION: 'matched by destination warehouse',
  DEMAND_SHARE: "share of orders without a destination warehouse, by this warehouse's demand",
  'DESTINATION+DEMAND_SHARE': "matched by destination warehouse, plus a share of orders without one, by this warehouse's demand",
}

export const onOrderMethodText = (method: string | null | undefined) =>
  method ? ON_ORDER_METHOD_TEXT[method] ?? humanize(method) : ''
