import { Fragment, useState } from 'react'
import { useAuditLog } from '../api/queries'
import type { AuditEntry } from '../api/types'
import { Badge, Card, DataState, PageHeader, Pager, Button } from '../components/ui'
import { formatDateTime, humanize } from '../lib/format'
import { roleLabel } from '../lib/permissions'

type P = Record<string, unknown>
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v))
const count = (p: P, key: string) => str((p.counts as P | undefined)?.[key])

// One plain sentence per event type; the raw payload is one click away.
function summarize(e: AuditEntry): string {
  const p = e.payload as P

  switch (e.eventType) {
    case 'REPLENISHMENT_RUN':
      return `${count(p, 'suggested')} suggested of ${count(p, 'evaluated')} series; ${count(p, 'notNeeded')} not needed, ${count(p, 'coveredByOnOrder')} covered by open orders, ${count(p, 'skipped')} skipped`
    case 'SUGGESTION_APPROVED':
      return `Suggestion #${str(p.suggestionId)} approved: ${str(p.quantity)} units, requisition #${str(p.requisitionId)}`
    case 'SUGGESTION_REJECTED':
      return `Suggestion #${str(p.suggestionId)} rejected: ${str(p.reason)}`
    case 'ANOMALY_SYNC':
      return `${str(p.scored)} movements scored, ${str(p.flagged)} flagged (${str(p.created)} new)`
    case 'ANOMALY_REVIEWED':
      return `Flag #${str(p.anomalyFlagId)} reviewed${p.note ? `: ${str(p.note)}` : ''}`
    case 'MODEL_RETRAIN':
      return `Retrained: ${((p.versions as { type: string; version: string }[] | undefined) ?? []).map((v) => v.version).join(', ') || 'nothing new'}`
    case 'LLM_CALL':
      return `${str(p.provider)} · ${str(p.model)} · ${humanize(str(p.purpose))} · ${p.success ? 'ok' : `failed (${str(p.error)})`}${p.latencyMs !== undefined ? ` · ${str(p.latencyMs)} ms` : ''}`
    case 'LLM_SKIPPED':
      return `Not called: ${humanize(str(p.reason))} (${humanize(str(p.purpose))})`
    case 'ASSISTANT_QUESTION':
      return `“${str(p.question)}” → ${((p.tools as string[] | undefined) ?? []).join(', ') || 'no tools'}`
    case 'GOODS_RECEIPT_WAREHOUSE_OVERRIDE':
      return `Order #${str(p.purchaseOrderId)} received into warehouse ${str(p.receivedIntoWarehouseId)} instead of ${str(p.destinationWarehouseId)}`
    default:
      return JSON.stringify(p).slice(0, 120)
  }
}

const TONE: Record<string, 'ai' | 'success' | 'warning' | 'neutral'> = {
  SUGGESTION_APPROVED: 'success', SUGGESTION_REJECTED: 'warning', GOODS_RECEIPT_WAREHOUSE_OVERRIDE: 'warning', LLM_CALL: 'ai', LLM_SKIPPED: 'ai', ASSISTANT_QUESTION: 'ai', REPLENISHMENT_RUN: 'ai',
}

// F-11, AI-011, NFR-004: who did what with the AI features, and every language-model call (without prompts or keys).
export default function AuditLog() {
  const [eventType, setEventType] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<number | null>(null)
  const query = useAuditLog({ eventType: eventType || undefined, page, pageSize: 25 })
  const rows = query.data?.data ?? []
  const types = (query.data?.eventTypes ?? []) as { eventType: string; count: number }[]

  return (
    <>
      <PageHeader title="AI audit log" description="Replenishment runs, decisions on suggestions, anomaly reviews, retraining, assistant questions and every call to the language model. Prompts and keys are never stored here." />
      <Card flush>
        <div className="filters">
          <div className="field">
            <label htmlFor="event">Event</label>
            <select id="event" className="select" value={eventType} onChange={(e) => { setEventType(e.target.value); setPage(1); setOpen(null) }}>
              <option value="">All events</option>
              {types.map((t) => (
                <option key={t.eventType} value={t.eventType}>
                  {humanize(t.eventType)} ({t.count})
                </option>
              ))}
            </select>
          </div>
        </div>
        <DataState query={query} empty={{ when: rows.length === 0, title: 'Nothing logged yet', text: 'AI actions appear here as they happen.' }}>
          <div className="table-wrap">
            <table className="table table--dense">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Event</th>
                  <th>By</th>
                  <th>What happened</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <Fragment key={e.id}>
                    <tr>
                      <td className="faint">{formatDateTime(e.createdAt)}</td>
                      <td><Badge tone={TONE[e.eventType] ?? 'neutral'}>{humanize(e.eventType)}</Badge></td>
                      <td>{e.actor ? <>{e.actor.name}<div className="table__sub">{roleLabel[e.actor.role]}</div></> : <span className="faint">system</span>}</td>
                      <td className="wrap">{summarize(e)}</td>
                      <td><Button size="sm" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? 'Hide' : 'Details'}</Button></td>
                    </tr>
                    {open === e.id && (
                      <tr>
                        <td colSpan={5} style={{ background: 'var(--color-surface-muted)' }}>
                          <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto' }}>{JSON.stringify(e.payload, null, 2)}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {query.data?.pagination && <Pager page={page} totalPages={query.data.pagination.totalPages} total={query.data.pagination.total} onPage={setPage} />}
        </DataState>
      </Card>
    </>
  )
}
