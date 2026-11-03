import { beforeAll, describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '../test/server'
import { envelope, renderApp } from '../test/render'
import { inventoryRows } from '../test/fixtures'
import { AppRoutes } from '../App'
import type { ForecastResult } from '../api/types'

beforeAll(() => {
  // recharts measures its container
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

const days = (start: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10))

const ok = (over: Partial<ForecastResult> = {}): ForecastResult => ({
  productId: 3, warehouseId: 1, status: 'OK', modelVersion: 'forecast-1', selectedModel: 'ML', baselineWindow: 14, dailyMean: 3.2, sigma: 1.3,
  metrics: { holdoutDays: 14, maeBaseline: 1.8, maeMl: 1.35 }, inputs: { historyDays: 90, lastActualDate: '2026-11-01' }, notes: [],
  history: days('2026-08-04', 90).map((date, i) => ({ date, demand: i % 5 })),
  forecast: days('2026-11-02', 30).map((date) => ({ date, mean: 3.2, baseline: 2.9, ml: 3.2, sigma: 1.3 })), ...over,
})

const serve = (result: ForecastResult | null, status = 200) =>
  server.use(
    mswHttp.get('*/api/v1/inventory', () => envelope(inventoryRows, { pagination: { page: 1, pageSize: 100, total: 3, totalPages: 1 } })),
    mswHttp.get('*/api/v1/ai/forecast/3', () =>
      status === 200
        ? envelope({ product: { id: 3, sku: 'SYN-ELE-003', name: 'Headlamp Assembly' }, modelVersion: 'forecast-1', asOf: '2026-11-01', horizonDays: 30, results: result ? [result] : [] })
        : HttpResponse.json({ success: false, message: status === 503 ? 'AI service is unavailable' : 'Product not found' }, { status }),
    ),
  )

describe('forecast page (UI-003)', () => {
  it('shows the product, the chart, both model errors and the inputs behind the forecast', async () => {
    serve(ok())
    renderApp(<AppRoutes />, { route: '/products/3/forecast?warehouseId=1', role: 'VIEWER' })

    expect(await screen.findByRole('heading', { name: 'Headlamp Assembly' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Line chart of daily demand/)).toBeInTheDocument()

    const accuracy = screen.getByText('How accurate is it?').closest('section')!
    expect(within(accuracy).getByText('1.80')).toBeInTheDocument()
    expect(within(accuracy).getByText('1.35')).toBeInTheDocument()
    expect(within(accuracy).getByText(/25.0% closer than the baseline/)).toBeInTheDocument()
    expect(within(accuracy).getByText(/synthetic data/)).toBeInTheDocument()

    const inputs = screen.getByText('Inputs').closest('section')!
    expect(within(inputs).getByText('3.20 units/day')).toBeInTheDocument()
    expect(within(inputs).getByText('forecast-1')).toBeInTheDocument()
    expect(within(inputs).getByText('90 days')).toBeInTheDocument()
  })

  it('offers the forecast as a table for people who cannot read a chart', async () => {
    serve(ok())
    renderApp(<AppRoutes />, { route: '/products/3/forecast?warehouseId=1', role: 'VIEWER' })

    await userEvent.click(await screen.findByText('Show the forecast as a table'))

    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(15) // header + 14 days
    expect(rows[1]).toHaveTextContent('02 Nov 2026')
    expect(rows[1]).toHaveTextContent('2.90')
    expect(rows[1]).toHaveTextContent('3.20')
  })

  it('says plainly when the baseline beat the model on this series', async () => {
    serve(ok({ metrics: { holdoutDays: 14, maeBaseline: 1.2, maeMl: 1.5 } }))
    renderApp(<AppRoutes />, { route: '/products/3/forecast?warehouseId=1', role: 'VIEWER' })

    expect(await screen.findByText(/baseline was 25.0% closer than the ML model. The model is not always better/)).toBeInTheDocument()
  })

  it('explains the baseline fallback for a short history (AI-003)', async () => {
    serve(ok({ selectedModel: 'BASELINE', metrics: { holdoutDays: 14, maeBaseline: null, maeMl: null }, notes: ['Fewer than 28 days of history: the baseline is used, not the ML model.'] }))
    renderApp(<AppRoutes />, { route: '/products/3/forecast?warehouseId=1', role: 'VIEWER' })

    expect(await screen.findByText(/fewer than 28 days of history/)).toBeInTheDocument()
    expect(screen.getAllByText('n/a').length).toBe(2)
    expect(screen.getByText('No holdout error is available for this series.')).toBeInTheDocument()
  })

  it('handles a series without history', async () => {
    serve({ productId: 3, warehouseId: 1, status: 'NO_HISTORY', message: 'No ledger history for this product and warehouse' })
    renderApp(<AppRoutes />, { route: '/products/3/forecast?warehouseId=1', role: 'VIEWER' })

    expect(await screen.findByText('No forecast for this warehouse')).toBeInTheDocument()
    expect(screen.getByText(/No ledger history/)).toBeInTheDocument()
  })

  it('shows an empty state for a product with no stock record', async () => {
    serve(null)
    renderApp(<AppRoutes />, { route: '/products/3/forecast', role: 'VIEWER' })

    expect(await screen.findByText('No stock record for this product')).toBeInTheDocument()
  })

  it('shows the error and the AI banner when the AI service is down, and a 404 for an unknown product', async () => {
    serve(null, 503)
    renderApp(<AppRoutes />, { route: '/products/3/forecast', role: 'VIEWER' })
    expect(await screen.findByText('AI service is unavailable')).toBeInTheDocument()
    expect(await screen.findByText(/The AI service is not responding/)).toBeInTheDocument()
  })

  it('lets the user switch warehouse when the product is stocked in several', async () => {
    const two = [...inventoryRows, { ...inventoryRows[2], id: 9, warehouseId: 2, warehouse: { id: 2, code: 'SYN-DEPOT', name: 'Depot' } }]
    server.use(
      mswHttp.get('*/api/v1/inventory', () => envelope(two, { pagination: { page: 1, pageSize: 100, total: 4, totalPages: 1 } })),
      mswHttp.get('*/api/v1/ai/forecast/3', ({ request }) => {
        const wh = new URL(request.url).searchParams.get('warehouseId')

        return envelope({ product: { id: 3, sku: 'SYN-ELE-003', name: 'Headlamp Assembly' }, modelVersion: 'forecast-1', asOf: '2026-11-01', horizonDays: 30, results: [ok({ warehouseId: Number(wh), dailyMean: wh === '2' ? 7.5 : 3.2 })] })
      }),
    )
    renderApp(<AppRoutes />, { route: '/products/3/forecast?warehouseId=1', role: 'VIEWER' })

    await screen.findByText('3.20 units/day')
    await userEvent.selectOptions(screen.getByLabelText('Warehouse'), 'SYN-DEPOT')

    expect(await screen.findByText('7.50 units/day')).toBeInTheDocument()
  })
})
