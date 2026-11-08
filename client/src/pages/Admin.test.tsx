import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '../test/server'
import { envelope, renderApp } from '../test/render'
import { AppRoutes } from '../App'
import type { AuditEntry, ModelRun, Role } from '../api/types'

const page = (n: number) => ({ pagination: { page: 1, pageSize: 25, total: n, totalPages: 1 } })

const forecast: ModelRun = { id: 2, modelType: 'FORECAST', version: 'forecast-20261101-abc', isActive: true, trainedAt: '2026-11-02T10:00:00Z', metrics: { as_of: '2026-11-01T00:00:00', holdout_start: '2026-10-19T00:00:00', holdout_end: '2026-11-01T00:00:00', holdout_days: 14, policy_ml: 24, policy_baseline: 2, overall: { baseline: { macro_mae: 1.418, series: 26 }, policy: { macro_mae: 1.216, series: 26 } } } }
const anomaly: ModelRun = { id: 3, modelType: 'ANOMALY', version: 'anomaly-20261101-def', isActive: true, trainedAt: '2026-11-02T10:00:01Z', metrics: { as_of: '2026-11-01T00:00:00', transactions: 2986, eligible_transactions: 2767, flagged: 150 } }
const old: ModelRun = { id: 1, modelType: 'FORECAST', version: 'forecast-old', isActive: false, trainedAt: '2026-10-01T10:00:00Z', metrics: { as_of: '2026-10-01' } }

const entry = (over: Partial<AuditEntry>): AuditEntry => ({ id: 1, eventType: 'MODEL_RETRAIN', actorUserId: 1, actor: { id: 1, name: 'Demo Admin', role: 'ADMIN' }, payload: {}, createdAt: '2026-11-02T10:00:00Z', ...over })

describe('AI models page (admin)', () => {
  it('shows headline figures of the active models and the history', async () => {
    server.use(mswHttp.get('*/api/v1/ai/models', () => envelope([anomaly, forecast, old], page(3))))
    renderApp(<AppRoutes />, { route: '/admin/models', role: 'ADMIN' })

    const card = (await screen.findByText('Demand forecast model')).closest('section')!
    expect(within(card).getByText('1.42')).toBeInTheDocument() // baseline MAE
    expect(within(card).getByText('1.22')).toBeInTheDocument() // model in use
    expect(within(card).getByText(/synthetic data/)).toBeInTheDocument()
    // the figures are labelled so they cannot be mistaken for the report's (which averages only the series that have an ML forecast)
    expect(within(card).getByText('Baseline error (MAE, units/day)')).toHaveAttribute('title', expect.stringContaining('Every series counts equally'))
    expect(within(card).getByText('26 (24 with ML, 2 baseline only)')).toBeInTheDocument()
    expect(within(card).getByText(/to .* \(14 days\)/)).toBeInTheDocument()
    expect(within(card).getByText(/the evaluation report averages only series with an ML forecast/)).toBeInTheDocument()
    const anomalyCard = screen.getByText('Anomaly model').closest('section')!
    expect(within(anomalyCard).getByText('2,986')).toBeInTheDocument()
    expect(screen.getByText('Superseded')).toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: 'Metrics' })[2])
    expect(screen.getByText(/"as_of": "2026-10-01"/)).toBeInTheDocument()
  })

  it('retraining needs a confirmation, then reports the new versions', async () => {
    let calls = 0
    server.use(
      mswHttp.get('*/api/v1/ai/models', () => envelope([forecast], page(1))),
      mswHttp.post('*/api/v1/ai/models/retrain', () => { calls += 1; return envelope([{ ...forecast, version: 'forecast-new' }]) }),
    )
    renderApp(<AppRoutes />, { route: '/admin/models', role: 'ADMIN' })

    await userEvent.click(await screen.findByRole('button', { name: 'Retrain models…' }))
    expect(calls).toBe(0)
    expect(screen.getByText(/The current models keep serving meanwhile/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retrain now' }))

    expect(await screen.findByText(/Trained 1 model\(s\): forecast-new/)).toBeInTheDocument()
    expect(calls).toBe(1)
  })

  it('shows the error when the AI service is down', async () => {
    server.use(mswHttp.get('*/api/v1/ai/models', () => envelope([forecast], page(1))), mswHttp.post('*/api/v1/ai/models/retrain', () => HttpResponse.json({ success: false, message: 'AI service is unavailable' }, { status: 503 })))
    renderApp(<AppRoutes />, { route: '/admin/models', role: 'ADMIN' })

    await userEvent.click(await screen.findByRole('button', { name: 'Retrain models…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Retrain now' }))

    expect((await screen.findAllByText('AI service is unavailable')).length).toBeGreaterThan(0)
  })

  it.each<Role>(['VIEWER', 'WAREHOUSE_MANAGER', 'PROCUREMENT_OFFICER'])('%s cannot open it and does not see it in the menu', async (role) => {
    renderApp(<AppRoutes />, { route: '/admin/models', role })

    expect(await screen.findByText('You do not have access to this')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'AI models' })).not.toBeInTheDocument()
  })

  it('has an empty state before anything is trained', async () => {
    server.use(mswHttp.get('*/api/v1/ai/models', () => envelope([], page(0))))
    renderApp(<AppRoutes />, { route: '/admin/models', role: 'ADMIN' })

    expect(await screen.findByText('No model has been trained yet')).toBeInTheDocument()
  })
})

describe('AI audit log page (admin, F-11)', () => {
  const rows: AuditEntry[] = [
    entry({ id: 5, eventType: 'SUGGESTION_APPROVED', payload: { suggestionId: 7, requisitionId: 4, quantity: 60 }, actor: { id: 2, name: 'Olivia Officer', role: 'PROCUREMENT_OFFICER' } }),
    entry({ id: 4, eventType: 'LLM_CALL', actor: null, actorUserId: null, payload: { provider: 'groq', model: 'openai/gpt-oss-120b', purpose: 'explain_suggestion', success: false, error: 'HTTP_429', latencyMs: 210 } }),
    entry({ id: 3, eventType: 'REPLENISHMENT_RUN', payload: { counts: { suggested: 1, evaluated: 27, notNeeded: 20, coveredByOnOrder: 5, skipped: 1 }, seriesCount: 27 } }),
    entry({ id: 2, eventType: 'ASSISTANT_QUESTION', payload: { question: 'Which products will run out soonest?', tools: ['get_days_of_cover'] } }),
  ]
  const serve = () => server.use(mswHttp.get('*/api/v1/ai/audit', ({ request }) => {
    const type = new URL(request.url).searchParams.get('eventType')
    const list = rows.filter((r) => !type || r.eventType === type)

    return envelope(list, { ...page(list.length), eventTypes: [{ eventType: 'SUGGESTION_APPROVED', count: 1 }, { eventType: 'LLM_CALL', count: 1 }] })
  }))

  it('summarises each event in one sentence with who did it', async () => {
    serve()
    renderApp(<AppRoutes />, { route: '/admin/audit', role: 'ADMIN' })

    expect(await screen.findByText('Suggestion #7 approved: 60 units, requisition #4')).toBeInTheDocument()
    expect(screen.getByText('Olivia Officer')).toBeInTheDocument()
    expect(screen.getByText('groq · openai/gpt-oss-120b · Explain suggestion · failed (HTTP_429) · 210 ms')).toBeInTheDocument()
    expect(screen.getByText('system')).toBeInTheDocument()
    expect(screen.getByText('1 suggested of 27 series; 20 not needed, 5 covered by open orders, 1 skipped')).toBeInTheDocument()
    expect(screen.getByText(/“Which products will run out soonest\?” → get_days_of_cover/)).toBeInTheDocument()
  })

  it('filters by event and shows the raw payload on request', async () => {
    serve()
    renderApp(<AppRoutes />, { route: '/admin/audit', role: 'ADMIN' })
    await screen.findByText(/Suggestion #7 approved/)

    await userEvent.selectOptions(screen.getByLabelText('Event'), 'LLM call (1)')
    expect(await screen.findByText(/failed \(HTTP_429\)/)).toBeInTheDocument()
    expect(screen.queryByText(/Suggestion #7 approved/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByText(/"latencyMs": 210/)).toBeInTheDocument()
  })

  it.each<Role>(['VIEWER', 'WAREHOUSE_MANAGER', 'PROCUREMENT_OFFICER'])('%s is refused and has no menu entry', async (role) => {
    renderApp(<AppRoutes />, { route: '/admin/audit', role })

    expect(await screen.findByText('You do not have access to this')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'AI audit log' })).not.toBeInTheDocument()
  })

  it('has an empty state', async () => {
    server.use(mswHttp.get('*/api/v1/ai/audit', () => envelope([], { ...page(0), eventTypes: [] })))
    renderApp(<AppRoutes />, { route: '/admin/audit', role: 'ADMIN' })

    expect(await screen.findByText('Nothing logged yet')).toBeInTheDocument()
  })
})
