import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '../test/server'
import { envelope, renderApp } from '../test/render'
import { flag } from '../test/fixtures'
import { AppRoutes } from '../App'
import type { AnomalyFlag, Role } from '../api/types'

// the API filters by kind, so the fake does too: rule = has rule codes, queue = has a queue rank
const all: AnomalyFlag[] = [
  flag({ id: 1, source: 'RULE', ruleCodes: ['R3'], queueRank: null, topFeatures: null, reason: 'Receipt at 23:42 local time, outside business hours (08:00-17:00)' }),
  flag({ id: 2, source: 'BOTH', ruleCodes: ['R2'], queueRank: 2 }),
  flag({ id: 3, source: 'MODEL', ruleCodes: [], queueRank: 1, reason: 'Risk 0.994, rank 1 in the review queue', explanation: null, explanationSource: null, topFeatures: [{ feature: 'hours outside business hours', value: 5, typical: 0, contribution: 0.2 }] }),
]

const serve = () =>
  server.use(
    mswHttp.get('*/api/v1/ai/anomalies', ({ request }) => {
      const url = new URL(request.url)
      const kind = url.searchParams.get('kind')
      const status = url.searchParams.get('status')
      const rows = all.filter((f) => (kind === 'rule' ? f.ruleCodes.length > 0 : kind === 'queue' ? f.queueRank !== null : true)).filter((f) => !status || f.status === status)

      return envelope(rows, { pagination: { page: 1, pageSize: 20, total: rows.length, totalPages: 1 } })
    }),
  )

const render = (role: Role = 'WAREHOUSE_MANAGER', route = '/anomalies') => {
  serve()
  renderApp(<AppRoutes />, { route, role })
}

describe('anomalies page (UI-005)', () => {
  it('shows confirmed rule hits and the weekly review queue as two separate lists, never one', async () => {
    render()

    const ruleTab = await screen.findByRole('tab', { name: /Confirmed rule hits\s*2/ })
    expect(screen.getByRole('tab', { name: /Weekly review queue\s*2/ })).toBeInTheDocument()
    expect(ruleTab).toHaveAttribute('aria-selected', 'true')

    // rule tab: only rows with rule codes, with the rule and its reason; no queue ranks
    expect(await screen.findByText(/Receipt at 23:42 local time/)).toBeInTheDocument()
    expect(screen.getByText('R3')).toBeInTheDocument()
    expect(screen.queryByText(/Risk 0.994/)).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Rank' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: /Weekly review queue/ }))

    expect(await screen.findByRole('columnheader', { name: 'Rank' })).toBeInTheDocument()
    expect(screen.getByText(/hours outside business hours/)).toBeInTheDocument()
    expect(screen.queryByText('R3')).not.toBeInTheDocument() // the rule-only row is not in the queue
    expect(screen.getAllByRole('row')).toHaveLength(3) // header + 2 queue rows
  })

  it('a row that is both appears in each list and says so', async () => {
    render()
    await screen.findByText('R2') // the rows, not the introduction above them
    expect(screen.getByText('also in the queue')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: /Weekly review queue/ }))
    expect(await screen.findByText('also in the rule list')).toBeInTheDocument()
  })

  it('opens details with the reason, the rule meaning, the AI explanation and a ledger link', async () => {
    render('VIEWER')
    await userEvent.click((await screen.findAllByRole('button', { name: 'Details' }))[1])

    expect(screen.getByText('A rule and the model')).toBeInTheDocument()
    expect(screen.getByText('R2 Quantity far above normal')).toBeInTheDocument()
    expect(screen.getByText(/A 10-unit issue is far larger/)).toBeInTheDocument()
    expect(screen.getByText('groq · openai/gpt-oss-120b')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open this movement in the ledger/ })).toHaveAttribute('href', '/ledger?productId=3&warehouseId=1&from=2026-11-01&to=2026-11-01&focus=11')
  })

  it('reviews a flag with a note after a confirmation step', async () => {
    render()
    let body: unknown
    server.use(mswHttp.post('*/api/v1/ai/anomalies/2/review', async ({ request }) => { body = await request.json(); return envelope({ flag: flag({ id: 2, status: 'REVIEWED' }), idempotent: false }) }))
    await userEvent.click((await screen.findAllByRole('button', { name: 'Details' }))[1])

    await userEvent.click(screen.getByRole('button', { name: 'Mark as reviewed…' }))
    await userEvent.type(screen.getByLabelText(/Note/), ' Counted the shelf, matches ')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm review' }))

    expect(await screen.findByText('Marked as reviewed.')).toBeInTheDocument()
    expect(body).toEqual({ note: 'Counted the shelf, matches' })
  })

  it('shows who reviewed a flag, when and what they wrote', async () => {
    all[1] = flag({ id: 2, status: 'REVIEWED', reviewedAt: '2026-11-02T08:00:00Z', reviewNote: 'Fine', reviewedBy: { id: 5, name: 'Wanda Warehouse' } })
    render()
    await userEvent.selectOptions(await screen.findByLabelText('Status'), 'Reviewed')
    await userEvent.click(await screen.findByRole('button', { name: 'Details' }))

    expect(screen.getByText(/Reviewed by Wanda Warehouse on 02 Nov 2026/)).toBeInTheDocument()
    expect(screen.getByText(/“Fine”/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark as reviewed…' })).not.toBeInTheDocument()
    all[1] = flag({ id: 2, source: 'BOTH', ruleCodes: ['R2'], queueRank: 2 })
  })

  it.each<Role>(['VIEWER', 'PROCUREMENT_OFFICER'])('%s can read flags but not review or score them', async (role) => {
    render(role)
    await userEvent.click((await screen.findAllByRole('button', { name: 'Details' }))[0])

    expect(screen.queryByRole('button', { name: 'Mark as reviewed…' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Score recent movements' })).not.toBeInTheDocument()
    expect(screen.getByText(/Only a warehouse manager or administrator can review flags/)).toBeInTheDocument()
  })

  it('scores recent movements over the chosen window and reports the counts', async () => {
    render('ADMIN')
    let body: { from: string; to: string } | undefined
    server.use(mswHttp.post('*/api/v1/ai/anomalies/sync', async ({ request }) => { body = (await request.json()) as typeof body; return envelope({ scored: 976, flagged: 55, created: 55, updated: 0, explained: 9 }) }))

    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Window' }), 'Last 7 days')
    await userEvent.click(screen.getByRole('button', { name: 'Score recent movements' }))

    expect(await screen.findByText(/Scored 976 movements: 55 flagged \(55 new, 0 refreshed\). 9 explanation/)).toBeInTheDocument()
    expect(Date.parse(body!.to) - Date.parse(body!.from)).toBe(7 * 86400000)
  })

  it('shows a clear error when scoring fails because the AI service is down', async () => {
    render('ADMIN')
    server.use(mswHttp.post('*/api/v1/ai/anomalies/sync', () => HttpResponse.json({ success: false, message: 'AI service is unavailable' }, { status: 503 })))

    await userEvent.click(await screen.findByRole('button', { name: 'Score recent movements' }))

    expect((await screen.findAllByText('AI service is unavailable')).length).toBeGreaterThan(0)
  })

  it('shows the empty state when there is nothing open, and the queue tab opens from the address', async () => {
    server.use(mswHttp.get('*/api/v1/ai/anomalies', () => envelope([], { pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } })))
    renderApp(<AppRoutes />, { route: '/anomalies?tab=queue', role: 'VIEWER' })

    expect(await screen.findByText('Nothing to review')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('tab', { name: /Weekly review queue/ })).toHaveAttribute('aria-selected', 'true'))
    expect(within(screen.getByRole('tabpanel')).getByText(/ten riskiest movements of each week/)).toBeInTheDocument()
  })
})
