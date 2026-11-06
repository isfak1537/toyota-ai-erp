import { Fragment, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { post } from '../api/client'
import { useAnomalies } from '../api/queries'
import type { AnomalyFlag } from '../api/types'
import { useAuth } from '../auth/auth-context'
import { AiNote, Badge, Banner, Button, DataState, PageHeader, Pager, TabPanel, Tabs } from '../components/ui'
import { businessDate, formatDateTime, formatNumber, humanize } from '../lib/format'
import { can } from '../lib/permissions'
import { ruleLabel } from '../lib/rules'

type Kind = 'rule' | 'queue'

// The two lists are different things and are never shown as one: "Confirmed rule hits" are movements a
// written rule flagged; the "Weekly review queue" is the model's ranking of the riskiest movements of each week.
const KINDS: { id: Kind; label: string; intro: string }[] = [
  {
    id: 'rule',
    label: 'Confirmed rule hits',
    intro: 'Movements that broke one of five written rules (for example a large negative adjustment or activity outside business hours). Each one says which rule and why.',
  },
  {
    id: 'queue',
    label: 'Weekly review queue',
    intro: 'The ten riskiest movements of each week according to the statistical model, ranked. A place in the queue means "worth a look", not "wrong": most are ordinary large movements.',
  },
]

export default function Anomalies() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab: Kind = params.get('tab') === 'queue' ? 'queue' : 'rule'
  const queryClient = useQueryClient()
  const [days, setDays] = useState('30')
  const rule = useAnomalies({ kind: 'rule', status: 'OPEN', pageSize: 1 })
  const queue = useAnomalies({ kind: 'queue', status: 'OPEN', pageSize: 1 })

  const sync = useMutation({
    mutationFn: async () => {
      const to = new Date()
      const from = new Date(to.getTime() - Number(days) * 86400000)

      return (await post<{ scored: number; flagged: number; created: number; updated: number; explained: number }>('/ai/anomalies/sync', { from: from.toISOString(), to: to.toISOString() })).data
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['anomalies'] }),
  })

  return (
    <>
      <PageHeader
        title="Anomalies"
        description="Unusual stock movements to look at. Rule hits and the model's review queue are kept apart on purpose: they mean different things."
        actions={
          can(user?.role, 'syncAnomalies') && (
            <div className="row">
              <div className="field">
                <label htmlFor="days" className="visually-hidden">Window</label>
                <select id="days" className="select" value={days} onChange={(e) => setDays(e.target.value)}>
                  <option value="7">Last 7 days</option>
                  <option value="14">Last 14 days</option>
                  <option value="30">Last 30 days</option>
                </select>
              </div>
              <Button variant="ai" busy={sync.isPending} onClick={() => sync.mutate()}>
                Score recent movements
              </Button>
            </div>
          )
        }
      />
      {sync.isError && <Banner tone="danger">{sync.error instanceof Error ? sync.error.message : 'Scoring failed.'}</Banner>}
      {sync.isSuccess && (
        <Banner tone="ai">
          Scored {sync.data.scored} movements: {sync.data.flagged} flagged ({sync.data.created} new, {sync.data.updated} refreshed). {sync.data.explained} explanation(s) written.
        </Banner>
      )}

      <section className="card">
        <Tabs
          label="Anomaly lists"
          active={tab}
          onChange={(id) => setParams(id === 'queue' ? { tab: 'queue' } : {})}
          tabs={KINDS.map((k) => ({ id: k.id, label: k.label, count: (k.id === 'rule' ? rule : queue).data?.pagination?.total }))}
        />
        {KINDS.map((k) => (
          <TabPanel key={k.id} id={k.id} active={tab}>
            <FlagList kind={k.id} intro={k.intro} />
          </TabPanel>
        ))}
      </section>
    </>
  )
}

function FlagList({ kind, intro }: { kind: Kind; intro: string }) {
  const [status, setStatus] = useState('OPEN')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<number | null>(null)
  const query = useAnomalies({ kind, status: status || undefined, page, pageSize: 20 })
  const rows = query.data?.data ?? []

  return (
    <>
      <div className="card__body">
        <p className="muted">{intro}</p>
      </div>
      <div className="filters" style={{ borderTop: '1px solid var(--color-border)' }}>
        <div className="field">
          <label htmlFor={`status-${kind}`}>Status</label>
          <select id={`status-${kind}`} className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); setOpen(null) }}>
            <option value="OPEN">Open</option>
            <option value="REVIEWED">Reviewed</option>
            <option value="">All</option>
          </select>
        </div>
      </div>
      <DataState query={query} empty={{ when: rows.length === 0, title: status === 'OPEN' ? 'Nothing to review' : 'Nothing here', text: status === 'OPEN' ? 'No open flags in this list. Score recent movements to look for new ones.' : undefined }}>
        <div className="table-wrap">
          <table className="table table--dense">
            <thead>
              <tr>
                {kind === 'queue' && <th className="num">Rank</th>}
                <th>Movement</th>
                <th>When</th>
                <th>{kind === 'rule' ? 'Rule' : 'Most unusual about it'}</th>
                <th className="num">Score</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((flag) => (
                <Fragment key={flag.id}>
                  <tr>
                    {kind === 'queue' && (
                      <td className="num">
                        <strong>{flag.queueRank}</strong>
                        <div className="table__sub">{flag.period?.replace('/', ' → ')}</div>
                      </td>
                    )}
                    <td>
                      <strong>{humanize(flag.transaction.type)}</strong> {formatNumber(flag.transaction.quantity)}
                      <div className="table__sub">{flag.transaction.product.name} · {flag.transaction.warehouse.code}</div>
                    </td>
                    <td className="faint">{formatDateTime(flag.transaction.createdAt)}</td>
                    <td className="wrap">
                      {kind === 'rule' ? (
                        <>
                          <div className="row" style={{ gap: 6 }}>
                            {flag.ruleCodes.map((code) => (
                              <Badge key={code} tone="warning" title={ruleLabel(code)}>{code}</Badge>
                            ))}
                          </div>
                          <div style={{ marginTop: 4 }}>{flag.reason}</div>
                        </>
                      ) : (
                        <TopFeatures flag={flag} />
                      )}
                    </td>
                    <td className="num">{formatNumber(flag.score, 3)}</td>
                    <td>
                      {flag.status === 'OPEN' ? <Badge tone="warning">Open</Badge> : <Badge tone="success">Reviewed</Badge>}
                      {flag.source === 'BOTH' && <div className="table__sub">also in the {kind === 'rule' ? 'queue' : 'rule list'}</div>}
                    </td>
                    <td>
                      <Button size="sm" aria-expanded={open === flag.id} onClick={() => setOpen(open === flag.id ? null : flag.id)}>
                        {open === flag.id ? 'Hide' : 'Details'}
                      </Button>
                    </td>
                  </tr>
                  {open === flag.id && (
                    <tr>
                      <td colSpan={kind === 'queue' ? 7 : 6} style={{ background: 'var(--color-surface-muted)' }}>
                        <FlagDetail flag={flag} />
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

// Each line is a sentence the AI service wrote from the numbers; older flags without one fall back to the label and numbers.
function TopFeatures({ flag }: { flag: AnomalyFlag }) {
  const features = flag.topFeatures ?? []

  if (features.length === 0) return <span>{flag.reason}</span>

  return (
    <ul style={{ margin: 0, paddingLeft: '1.1em' }}>
      {features.map((f) => (
        <li key={f.feature}>
          {f.text ?? (
            <>
              {f.feature}: <strong>{formatNumber(f.value, 1)}</strong> <span className="muted">(typical {formatNumber(f.typical, 1)})</span>
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

function FlagDetail({ flag }: { flag: AnomalyFlag }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [reviewing, setReviewing] = useState(false)
  const [note, setNote] = useState('')
  const [done, setDone] = useState(false)

  const review = useMutation({
    mutationFn: async () => (await post(`/ai/anomalies/${flag.id}/review`, note.trim() ? { note: note.trim() } : {})).data,
    onSuccess: () => {
      setDone(true)
      setReviewing(false)
      void queryClient.invalidateQueries({ queryKey: ['anomalies'] })
    },
  })

  const explain = useMutation({
    mutationFn: async () => (await post<{ explanation: string | null; explanationSource: string | null }>(`/ai/anomalies/${flag.id}/explain`, {})).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['anomalies'] }),
  })

  const text = explain.data?.explanation ?? flag.explanation
  const source = explain.data?.explanationSource ?? flag.explanationSource
  const canReview = can(user?.role, 'reviewAnomaly')

  return (
    <div className="grid grid--two" style={{ padding: 'var(--space-4) 0' }}>
      <div className="stack">
        <dl className="facts">
          <dt>Detected by</dt>
          <dd>{flag.source === 'BOTH' ? 'A rule and the model' : flag.source === 'RULE' ? 'A rule' : 'The statistical model'}</dd>
          <dt>Reason</dt>
          <dd>{flag.reason}</dd>
          {flag.ruleCodes.length > 0 && (
            <>
              <dt>Rules</dt>
              <dd>{flag.ruleCodes.map((c) => `${c} ${ruleLabel(c)}`).join(' · ')}</dd>
            </>
          )}
          <dt>Balance after</dt>
          <dd>{formatNumber(flag.transaction.balanceAfter)}</dd>
          <dt>Ledger</dt>
          <dd>
            <Link to={`/ledger?productId=${flag.transaction.product.id}&warehouseId=${flag.transaction.warehouse.id}&from=${businessDate(flag.transaction.createdAt)}&to=${businessDate(flag.transaction.createdAt)}&focus=${flag.transaction.id}`}>Open this movement in the ledger</Link>
          </dd>
          {flag.modelVersion && (
            <>
              <dt>Model</dt>
              <dd className="mono">{flag.modelVersion}</dd>
            </>
          )}
        </dl>
        {flag.status === 'REVIEWED' && (
          <Banner tone="info">
            Reviewed{flag.reviewedBy ? ` by ${flag.reviewedBy.name}` : ''} on {formatDateTime(flag.reviewedAt)}
            {flag.reviewNote ? `: “${flag.reviewNote}”` : '.'}
          </Banner>
        )}
      </div>
      <div className="stack">
        <AiNote text={text} source={source} />
        {!text && canReview && (
          <div>
            <Button size="sm" busy={explain.isPending} onClick={() => explain.mutate()}>Try to generate an explanation</Button>
            {explain.isSuccess && !explain.data.explanation && <span className="muted"> The language model did not answer.</span>}
          </div>
        )}
        {review.isError && <Banner tone="danger">{review.error instanceof Error ? review.error.message : 'Review failed.'}</Banner>}
        {done && <Banner tone="info">Marked as reviewed.</Banner>}
        {flag.status === 'OPEN' && !done && canReview && !reviewing && <div><Button variant="primary" onClick={() => setReviewing(true)}>Mark as reviewed…</Button></div>}
        {flag.status === 'OPEN' && !done && canReview && reviewing && (
          <div className="stack" role="group" aria-label="Review this flag">
            <div className="field">
              <label htmlFor={`note-${flag.id}`}>Note (optional, e.g. what you found)</label>
              <textarea id={`note-${flag.id}`} className="textarea" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="row">
              <Button variant="primary" busy={review.isPending} onClick={() => review.mutate()}>Confirm review</Button>
              <Button onClick={() => setReviewing(false)}>Cancel</Button>
            </div>
          </div>
        )}
        {flag.status === 'OPEN' && !canReview && <p className="muted">Only a warehouse manager or administrator can review flags.</p>}
      </div>
    </div>
  )
}
