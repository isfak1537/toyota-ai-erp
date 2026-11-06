import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '../test/server'
import { envelope, renderApp } from '../test/render'
import { daysOfCover, inventoryRows, latestRun } from '../test/fixtures'
import { AppRoutes } from '../App'

const page = (total: number) => ({ pagination: { page: 1, pageSize: 1, total, totalPages: total } })

// the product names also appear in the comparison panel, so look inside the stock card only
const stockCard = async () => (await screen.findByText('Stock by product and warehouse')).closest('section')!

const serve = (over: { cover?: unknown; latest?: unknown; inventory?: unknown } = {}) =>
  server.use(
    mswHttp.get('*/api/v1/inventory', () => (over.inventory ? (over.inventory as Response) : envelope(inventoryRows, { pagination: { page: 1, pageSize: 100, total: 3, totalPages: 1 } }))),
    mswHttp.get('*/api/v1/ai/days-of-cover', () => (over.cover ? (over.cover as Response) : envelope(daysOfCover))),
    mswHttp.get('*/api/v1/ai/replenishment/latest', () => (over.latest ? (over.latest as Response) : envelope(latestRun))),
    mswHttp.get('*/api/v1/ai/suggestions', () => envelope([], page(2))),
    mswHttp.get('*/api/v1/ai/anomalies', () => envelope([], page(5))),
  )

describe('inventory dashboard (UI-002)', () => {
  it('shows the four key figures', async () => {
    serve()
    renderApp(<AppRoutes />, { role: 'VIEWER' })

    const kpis = await screen.findByLabelText('Key figures')
    await within(kpis).findByText('3.0 days')
    expect(within(kpis).getByText('Low stock').nextSibling).toHaveTextContent('1') // 9 available <= 24
    expect(within(kpis).getByText('Pending suggestions').nextSibling).toHaveTextContent('2')
    expect(within(kpis).getByText('Open anomalies').nextSibling).toHaveTextContent('5')
    expect(within(kpis).getByText('SYN-ELE-003 · SYN-MAIN')).toBeInTheDocument()
  })

  it('lists stock with available = on hand − reserved, low stock first, and days of cover', async () => {
    serve()
    renderApp(<AppRoutes />, { role: 'VIEWER' })

    const rows = await within(await stockCard()).findAllByRole('row')
    const stockRows = rows.filter((r) => within(r).queryByText('Low stock') || within(r).queryByText('OK'))

    expect(stockRows[0]).toHaveTextContent('Headlamp Assembly')
    expect(stockRows[0]).toHaveTextContent('Low stock')
    expect(stockRows[0]).toHaveTextContent('3.0 d')
    const caliper = stockRows.find((r) => r.textContent?.includes('Brake Caliper'))!
    expect(within(caliper).getAllByRole('cell')[4]).toHaveTextContent('26') // 30 on hand − 4 reserved
    expect(stockRows.find((r) => r.textContent?.includes('Timing Belt'))).toHaveTextContent('30+ d')
  })

  it('filters by search, warehouse and low stock only', async () => {
    serve()
    renderApp(<AppRoutes />, { role: 'VIEWER' })
    const card = await stockCard()
    await within(card).findByText('Timing Belt Kit')

    await userEvent.type(screen.getByLabelText('Search'), 'belt')
    expect(within(card).queryByText('Headlamp Assembly')).not.toBeInTheDocument()
    expect(within(card).getByText('Timing Belt Kit')).toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText('Search'))
    await userEvent.click(screen.getByLabelText('Low stock only'))
    expect(within(card).queryByText('Timing Belt Kit')).not.toBeInTheDocument()
    expect(within(card).getByText('Headlamp Assembly')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Search'), 'zzz')
    expect(within(card).getByText('No stock matches these filters')).toBeInTheDocument()
  })

  it('compares the static reorder level with the AI reorder point side by side, with the reason they differ', async () => {
    serve()
    renderApp(<AppRoutes />, { role: 'VIEWER' })

    const panel = (await screen.findByText('Static reorder level vs AI reorder point')).closest('section')!
    expect(await within(panel).findByText(/recomputed from the latest demand forecast/)).toBeInTheDocument()
    const headlamp = within(panel).getByText('Headlamp Assembly').closest('tr')!
    expect(headlamp).toHaveTextContent('24') // static
    expect(headlamp).toHaveTextContent('40.5') // AI
    expect(headlamp).toHaveTextContent('+16.5')
    expect(headlamp).toHaveTextContent('Order suggested')
    expect(within(panel).queryByText('New Part')).not.toBeInTheDocument() // a skipped series has no AI reorder point
    expect(within(panel).getAllByRole('row')[1]).toHaveTextContent('Headlamp Assembly') // the series with an order suggestion comes first
  })

  it('says so when no replenishment run exists yet', async () => {
    serve({ latest: HttpResponse.json({ success: true, data: null }) })
    renderApp(<AppRoutes />, { role: 'VIEWER' })

    expect(await screen.findByText('No replenishment run yet')).toBeInTheDocument()
  })

  it('keeps stock usable and explains the gap when the forecasting service is down', async () => {
    serve({ cover: HttpResponse.json({ success: true, data: { forecastAvailable: false, message: 'down', fallback: { total: 1, items: [] } } }) })
    renderApp(<AppRoutes />, { role: 'VIEWER' })

    expect(await screen.findByText(/Days of cover need the forecasting service/)).toBeInTheDocument()
    expect(await within(await stockCard()).findByText('Headlamp Assembly')).toBeInTheDocument()
    expect(screen.getAllByText('–').length).toBeGreaterThan(0)
    expect(screen.getByText('forecast unavailable')).toBeInTheDocument()
  })

  it('shows an error with a retry when stock cannot be loaded, and an empty state when there is none', async () => {
    serve({ inventory: HttpResponse.json({ success: false, message: 'Database is down' }, { status: 500 }) })
    renderApp(<AppRoutes />, { role: 'VIEWER' })
    expect(await screen.findByText('Database is down')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('shows an empty state when there is no stock at all', async () => {
    serve({ inventory: HttpResponse.json({ success: true, data: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } }) })
    renderApp(<AppRoutes />, { role: 'VIEWER' })

    expect(await screen.findByText('No stock records yet')).toBeInTheDocument()
  })
})

describe('today summary (UI-002)', () => {
  it('summarises the latest run and the pending and open counts in plain sentences', async () => {
    serve()
    renderApp(<AppRoutes />, { role: 'VIEWER' })

    const card = (await screen.findByText('Today')).closest('section')!
    expect(await within(card).findByRole('link', { name: '2 suggestions are waiting for a decision' })).toHaveAttribute('href', '/suggestions')
    expect(within(card).getByRole('link', { name: '5 anomaly flags are not yet reviewed' })).toHaveAttribute('href', '/anomalies')
    expect(card).toHaveTextContent(/The last run suggested \d+ orders?; \d+ already covered by open orders/)
    expect(card).toHaveTextContent('Latest replenishment run')
  })

  it('shows an empty state when no run exists yet', async () => {
    serve({ latest: HttpResponse.json({ success: true, data: null }) })
    renderApp(<AppRoutes />, { role: 'VIEWER' })

    const card = (await screen.findByText('Today')).closest('section')!
    expect(within(card).getByText('Nothing to summarise yet')).toBeInTheDocument()
  })
})
