import { Link } from 'react-router'
import type { LatestRun } from '../api/types'
import { formatDateTime } from '../lib/format'
import { Card, EmptyState } from './ui'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// UI-002. Today's summary: plain sentences built only from numbers the dashboard already loads
// (the latest replenishment run, the pending and open counts). Nothing is calculated here beyond reading them.
export function TodaySummary({ run, pendingSuggestions, openAnomalies, lowStock }: {
  run: LatestRun | undefined
  pendingSuggestions: number | undefined
  openAnomalies: number | undefined
  lowStock: number | undefined
}) {
  return (
    <Card title="Today" subtitle={run ? `Latest replenishment run: ${formatDateTime(run.ranAt)}` : undefined}>
      {!run ? (
        <EmptyState title="Nothing to summarise yet">
          Today’s summary appears after the first replenishment run.
        </EmptyState>
      ) : (
        <ul className="summary">
          {pendingSuggestions !== undefined && (
            <li>
              <Link to="/suggestions">{plural(pendingSuggestions, 'suggestion is', 'suggestions are')} waiting for a decision</Link>
            </li>
          )}
          <li>
            The last run suggested {plural(run.counts.suggested ?? 0, 'order', 'orders')}; {run.counts.coveredByOnOrder ?? 0} already covered by open orders, {run.counts.notNeeded ?? 0} need nothing
            {(run.counts.skipped ?? 0) > 0 && `, ${run.counts.skipped} skipped (no forecast)`}.
          </li>
          {openAnomalies !== undefined && (
            <li>
              <Link to="/anomalies">{plural(openAnomalies, 'anomaly flag is', 'anomaly flags are')} not yet reviewed</Link>
            </li>
          )}
          {lowStock !== undefined && <li>{plural(lowStock, 'product-warehouse is', 'product-warehouses are')} at or below the static reorder level.</li>}
        </ul>
      )}
    </Card>
  )
}
