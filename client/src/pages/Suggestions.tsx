import { Fragment, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, post } from '../api/client'
import { useLatestRun, useSuggestions } from '../api/queries'
import type { Decision, ReviewSeries, Suggestion, SuggestionStatus } from '../api/types'
import { useAuth } from '../auth/auth-context'
import { AiNote, Badge, Banner, Button, DataState, PageHeader, Pager, TabPanel, Tabs } from '../components/ui'
import { formatDateTime, formatDays, formatNumber, humanize, onOrderMethodText } from '../lib/format'
import { can } from '../lib/permissions'
import { DECISION_LABEL, DECISION_TONE } from '../lib/decisions'

const STATUS_TONE: Record<SuggestionStatus, 'ai' | 'success' | 'danger' | 'neutral'> = { PENDING: 'ai', APPROVED: 'success', REJECTED: 'danger', EXPIRED: 'neutral' }

interface RunSummary {
  counts: Record<string, number>
  suggestions: Suggestion[]
}

export default function Suggestions() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'review' ? 'review' : 'suggestions'
  const queryClient = useQueryClient()
  const latest = useLatestRun()
  const [notice, setNotice] = useState<string | null>(null)

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['suggestions'] })
    void queryClient.invalidateQueries({ queryKey: ['latest-run'] })
  }

  const run = useMutation({
    mutationFn: async () => (await post<RunSummary>('/ai/replenishment/run', {})).data,
    onSuccess: (data) => {
      setNotice(
        `Run complete: ${data.counts.suggested} suggested, ${data.counts.notNeeded} not needed, ${data.counts.coveredByOnOrder} covered by open orders, ${data.counts.skipped} skipped. ${data.counts.explained} explanation(s) written by the language model.`,
      )
      refreshAll()
    },
  })

  return (
    <>
      <PageHeader
        title="AI suggestions"
        description="What to order, why, and from whom. Nothing is ordered until a person approves it: approving creates a draft requisition, never a purchase order."
        actions={
          can(user?.role, 'runReplenishment') && (
            <Button variant="ai" busy={run.isPending} onClick={() => run.mutate()}>
              Run replenishment
            </Button>
          )
        }
      />
      {run.isError && <Banner tone="danger">{run.error instanceof Error ? run.error.message : 'The run failed.'}</Banner>}
      {notice && !run.isError && <Banner tone="ai">{notice}</Banner>}

      <section className="card">
        <Tabs
          label="Suggestions views"
          active={tab}
          onChange={(id) => setParams(id === 'review' ? { tab: 'review' } : {})}
          tabs={[
            { id: 'suggestions', label: 'Suggestions' },
            { id: 'review', label: 'Replenishment review', count: latest.data?.data?.series.length },
          ]}
        />
        <TabPanel id="suggestions" active={tab}>
          <SuggestionList onChanged={refreshAll} />
        </TabPanel>
        <TabPanel id="review" active={tab}>
          <ReplenishmentReview latest={latest} />
        </TabPanel>
      </section>
    </>
  )
}

function SuggestionList({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<string>('PENDING')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<number | null>(null)
  const query = useSuggestions({ status: status || undefined, page, pageSize: 20 })
  const rows = query.data?.data ?? []

  return (
    <>
      <div className="filters">
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); setOpen(null) }}>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="EXPIRED">Expired</option>
            <option value="">All</option>
          </select>
        </div>
      </div>
      <DataState
        query={query}
        empty={{
          when: rows.length === 0,
          title: status === 'PENDING' ? 'No suggestions waiting' : 'Nothing here',
          text: status === 'PENDING' ? 'Run replenishment to check every product against its forecast.' : 'No suggestion has this status.',
        }}
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Warehouse</th>
                <th>Supplier</th>
                <th className="num">Suggested qty</th>
                <th className="num">Available</th>
                <th className="num">Reorder point</th>
                <th>Status</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <Fragment key={s.id}>
                  <tr className={s.status === 'PENDING' ? 'is-flagged' : undefined}>
                    <td>
                      {s.product.name}
                      <div className="table__sub mono">{s.product.sku}</div>
                    </td>
                    <td>{s.warehouse.code}</td>
                    <td>{s.supplier.name}</td>
                    <td className="num"><strong>{formatNumber(s.suggestedQty)}</strong> {s.product.unit}</td>
                    <td className="num">{formatNumber(s.available)}</td>
                    <td className="num">{formatNumber(s.reorderPoint, 1)}</td>
                    <td><Badge tone={STATUS_TONE[s.status]}>{humanize(s.status)}</Badge></td>
                    <td className="faint">{formatDateTime(s.createdAt)}</td>
                    <td>
                      <Button size="sm" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                        {open === s.id ? 'Hide' : 'Review'}
                      </Button>
                    </td>
                  </tr>
                  {open === s.id && (
                    <tr>
                      <td colSpan={9} style={{ background: 'var(--color-surface-muted)' }}>
                        <SuggestionDetail suggestion={s} onChanged={onChanged} />
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
    </>
  )
}

interface DecisionResult {
  suggestion: Suggestion
  requisition?: { id: number; requisitionNumber: string; status: string }
  idempotent: boolean
}

function SuggestionDetail({ suggestion: s, onChanged }: { suggestion: Suggestion; onChanged: () => void }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [result, setResult] = useState<DecisionResult | null>(null)
  const canDecide = can(user?.role, 'decideSuggestion') && s.status === 'PENDING' && !result

  const approve = useMutation({
    mutationFn: async () => (await post<DecisionResult>(`/ai/suggestions/${s.id}/approve`, {})).data,
    onSuccess: (data) => {
      setResult(data)
      setConfirming(false)
      onChanged()
      void queryClient.invalidateQueries({ queryKey: ['requisitions'] })
    },
    onError: () => onChanged(), // a 409 means it changed under us: show the fresh state
  })

  const reject = useMutation({
    mutationFn: async () => (await post<DecisionResult>(`/ai/suggestions/${s.id}/reject`, { reason: reason.trim() })).data,
    onSuccess: (data) => {
      setResult(data)
      setRejecting(false)
      onChanged()
    },
    onError: () => onChanged(),
  })

  const explain = useMutation({
    mutationFn: async () => (await post<{ explanation: string | null; explanationSource: string | null }>(`/ai/suggestions/${s.id}/explain`, {})).data,
    onSuccess: () => onChanged(),
  })

  const onOrder = s.inputs.onOrder as { exact?: number; method?: string } | undefined
  const rawQty = typeof s.inputs.rawQty === 'number' ? s.inputs.rawQty : undefined
  const text = explain.data?.explanation ?? s.explanation
  const source = explain.data?.explanationSource ?? s.explanationSource
  const error = (approve.error ?? reject.error) as ApiError | null

  return (
    <div className="grid grid--two" style={{ padding: 'var(--space-4) 0' }}>
      <div className="stack">
        <div>
          <h3>Why this quantity</h3>
          <p className="muted">Computed by the replenishment formula from the values on the right, not by the language model.</p>
        </div>
        <dl className="facts">
          <dt>Forecast demand</dt><dd>{formatNumber(s.forecastDaily, 2)} units/day (σ {formatNumber(s.sigma, 2)})</dd>
          <dt>Lead time + review</dt><dd>{s.leadTimeDays} + {s.reviewDays} days</dd>
          <dt>Safety stock</dt><dd>{formatNumber(s.safetyStock, 1)} (z = {s.zValue})</dd>
          <dt>Reorder point</dt><dd>{formatNumber(s.reorderPoint, 1)}</dd>
          <dt>Available now</dt><dd>{formatNumber(s.available)}</dd>
          <dt>Already on order</dt>
          <dd>
            {s.onOrder === 0 && s.onOrderMethod === 'NONE'
              ? 'none'
              : `${formatNumber(s.onOrder)} (${onOrderMethodText(s.onOrderMethod)}${onOrder?.exact !== undefined && onOrder.exact !== s.onOrder ? `, exact ${formatNumber(onOrder.exact, 1)} rounded down` : ''})`}
          </dd>
          <dt>Calculated need (after stock on hand and on order)</dt>
          <dd>
            {rawQty === undefined ? '–' : `${formatNumber(rawQty)} ${s.product.unit}`}
            {rawQty !== undefined && s.inputs.outcome === 'SUGGEST_MOQ' && `, raised to minimum order ${s.minimumOrderQty}`}
          </dd>
          <dt>Minimum order qty</dt><dd>{s.minimumOrderQty}</dd>
          <dt>Suggested</dt><dd><strong>{formatNumber(s.suggestedQty)} {s.product.unit}</strong> from {s.supplier.name}</dd>
          <dt>Forecast model</dt><dd>{s.forecastModel === 'ML' ? 'Machine learning' : 'Moving average'} · <span className="mono">{s.modelVersion}</span></dd>
        </dl>
      </div>
      <div className="stack">
        <AiNote text={text} source={source} />
        {!text && can(user?.role, 'decideSuggestion') && (
          <div>
            <Button size="sm" busy={explain.isPending} onClick={() => explain.mutate()}>Try to generate an explanation</Button>
            {explain.isSuccess && !explain.data.explanation && <span className="muted"> The language model did not answer; the suggestion is unaffected.</span>}
          </div>
        )}

        {result && (
          <Banner tone="info">
            {result.requisition ? (
              <span>
                {result.idempotent ? 'Already approved earlier. ' : 'Approved. '}Draft requisition <strong>{result.requisition.requisitionNumber}</strong> created.{' '}
                <Link to="/procurement">Continue in procurement</Link>
              </span>
            ) : (
              <span>Rejected{result.suggestion.rejectReason ? `: ${result.suggestion.rejectReason}` : ''}.</span>
            )}
          </Banner>
        )}
        {s.status === 'APPROVED' && !result && <Banner tone="info">Approved{s.decidedAt ? ` on ${formatDateTime(s.decidedAt)}` : ''}. <Link to="/procurement">See the requisition in procurement</Link></Banner>}
        {s.status === 'REJECTED' && !result && <Banner tone="info">Rejected: {s.rejectReason}</Banner>}
        {s.status === 'EXPIRED' && <Banner tone="info">Expired: a newer replenishment run replaced it.</Banner>}
        {error && <Banner tone="danger">{error.status === 409 ? `${error.message}. The list has been refreshed.` : error.message}</Banner>}

        {canDecide && !confirming && !rejecting && (
          <div className="row">
            <Button variant="primary" onClick={() => setConfirming(true)}>Approve…</Button>
            <Button variant="danger" onClick={() => setRejecting(true)}>Reject…</Button>
          </div>
        )}
        {canDecide && confirming && (
          <div className="stack" role="group" aria-label="Confirm approval">
            <p>
              Create a <strong>draft requisition</strong> for <strong>{formatNumber(s.suggestedQty)} {s.product.unit}</strong> of {s.product.name} from {s.supplier.name}, to be received at {s.warehouse.code}? It can still be edited or cancelled before it becomes a purchase order.
            </p>
            <div className="row">
              <Button variant="primary" busy={approve.isPending} onClick={() => approve.mutate()}>Create draft requisition</Button>
              <Button onClick={() => setConfirming(false)}>Cancel</Button>
            </div>
          </div>
        )}
        {canDecide && rejecting && (
          <div className="stack" role="group" aria-label="Reject suggestion">
            <div className="field">
              <label htmlFor={`reason-${s.id}`}>Reason for rejecting (kept in the audit log)</label>
              <textarea id={`reason-${s.id}`} className="textarea" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="row">
              <Button variant="danger" busy={reject.isPending} disabled={!reason.trim()} onClick={() => reject.mutate()}>Reject suggestion</Button>
              <Button onClick={() => setRejecting(false)}>Cancel</Button>
            </div>
          </div>
        )}
        {!can(user?.role, 'decideSuggestion') && s.status === 'PENDING' && <p className="muted">Only a procurement officer or administrator can approve or reject.</p>}
      </div>
    </div>
  )
}

function ReplenishmentReview({ latest }: { latest: ReturnType<typeof useLatestRun> }) {
  const [decision, setDecision] = useState('')
  const run = latest.data?.data
  const rows: ReviewSeries[] = (run?.series ?? []).filter((s) => !decision || s.decision === decision)
  const order: Record<Decision, number> = { ORDERED: 0, COVERED_BY_ON_ORDER: 1, SKIPPED: 2, NOT_NEEDED: 3 }
  const sorted = [...rows].sort((a, b) => order[a.decision] - order[b.decision] || (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity))

  return (
    <DataState query={latest} empty={{ when: !run, title: 'No replenishment run yet', text: 'Run replenishment to see, for every product and warehouse, whether an order is needed and why.' }}>
      {run && (
        <>
          <div className="card__body">
            <p className="muted">
              Every product and warehouse the latest run looked at, including the ones where nothing is needed. Run on {formatDateTime(run.ranAt)} · demand as of {run.asOf} · model{' '}
              <span className="mono">{run.modelVersion}</span> · service level z = {run.params.z}, review {run.params.reviewDays} days.
            </p>
          </div>
          <div className="filters">
            <div className="field">
              <label htmlFor="decision">Decision</label>
              <select id="decision" className="select" value={decision} onChange={(e) => setDecision(e.target.value)}>
                <option value="">All ({run.series.length})</option>
                {(Object.keys(DECISION_LABEL) as Decision[]).map((d) => (
                  <option key={d} value={d}>
                    {DECISION_LABEL[d]} ({run.series.filter((s) => s.decision === d).length})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table table--dense">
              <thead>
                <tr>
                  <th>Product · warehouse</th>
                  <th>Decision</th>
                  <th>Why</th>
                  <th className="num" title="Available: on hand minus reserved">Avail.</th>
                  <th className="num" title="AI reorder point">AI ROP</th>
                  <th className="num" title="Days of cover">Cover (d)</th>
                  <th className="num" title="Supplier lead time">Lead (d)</th>
                  <th className="num">On order</th>
                  <th className="num" title="Suggested order quantity">Order qty</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr key={`${s.productId}-${s.warehouseId}`}>
                    <td>
                      <Link to={`/products/${s.productId}/forecast?warehouseId=${s.warehouseId}`}>{s.name}</Link>
                      <div className="table__sub mono">{s.sku} · {s.warehouse}</div>
                    </td>
                    <td><Badge tone={DECISION_TONE[s.decision]}>{DECISION_LABEL[s.decision]}</Badge></td>
                    <td className="wrap">{s.reason}</td>
                    <td className="num">{formatNumber(s.available)}</td>
                    <td className="num">{formatNumber(s.reorderPoint, 1)}</td>
                    <td className="num">{s.decision === 'SKIPPED' && s.daysOfCover === null ? '–' : formatDays(s.daysOfCover)}</td>
                    <td className="num">{s.leadTimeDays === null ? '–' : s.leadTimeDays}</td>
                    <td className="num">
                      {s.onOrder === null ? '–' : formatNumber(s.onOrder)}
                      {s.onOrderMethod && s.onOrderMethod !== 'NONE' && <div className="table__sub" title="How the open orders were matched to this warehouse">{onOrderMethodText(s.onOrderMethod)}</div>}
                    </td>
                    <td className="num">{s.suggestedQty === null ? '–' : <strong>{formatNumber(s.suggestedQty)}</strong>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </DataState>
  )
}
