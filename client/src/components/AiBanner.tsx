import { useEffect, useState } from 'react'
import { onApiEvent } from '../api/events'
import { Banner } from './ui'

// Shown when an AI route answered 503, until an AI route works again. ERP pages keep working (NFR-014).
export function AiBanner() {
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    const offDown = onApiEvent('ai-unavailable', () => setUnavailable(true))
    const offOk = onApiEvent('ai-ok', () => setUnavailable(false))

    return () => {
      offDown()
      offOk()
    }
  }, [])

  if (!unavailable) return null

  return (
    <Banner tone="warning">
      <span>
        <strong>The AI service is not responding.</strong> Forecasts, days of cover, suggestions and the assistant may be missing or out of date. Inventory, procurement and the
        ledger are not affected.
      </span>
    </Banner>
  )
}
