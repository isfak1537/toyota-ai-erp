import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '../test/server'
import { envelope, renderApp } from '../test/render'
import { inventoryRows, warehouses } from '../test/fixtures'
import { AppRoutes } from '../App'
import type { LedgerRow } from '../api/types'

const product = inventoryRows[2].product

const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  id: 100, productId: 3, warehouseId: 1, type: 'RECEIPT', quantity: 30, balanceAfter: 39, reservedAfter: 0, referenceType: 'GOODS_RECEIPT', referenceId: 5, reason: 'Goods receipt GR-3001',
  createdAt: '2026-11-02T12:00:00Z', product, warehouse: warehouses[0], createdBy: { id: 2, name: 'Wanda Warehouse', role: 'WAREHOUSE_MANAGER' }, ...over,
})

const seen: URLSearchParams[] = []

const serve = (rows: LedgerRow[] = [row(), row({ id: 99, type: 'ISSUE', quantity: -3, balanceAfter: 9, reservedAfter: null, referenceType: 'MANUAL_ISSUE', referenceId: null, reason: null, createdBy: null })], total = rows.length, totalPages = 1) => {
  seen.length = 0
  server.use(
    mswHttp.get('*/api/v1/products', () => envelope([product])),
    mswHttp.get('*/api/v1/warehouses', () => envelope(warehouses)),
    mswHttp.get('*/api/v1/inventory/transactions', ({ request }) => {
      seen.push(new URL(request.url).searchParams)

      return envelope(rows, { pagination: { page: Number(new URL(request.url).searchParams.get('page') ?? 1), pageSize: 25, total, totalPages } })
    }),
  )
}

const go = (route = '/ledger') => renderApp(<AppRoutes />, { route, role: 'VIEWER' })

describe('stock ledger page (UI-007)', () => {
  it('lists movements with signed quantity, balance, reserved, reference and who did it', async () => {
    serve()
    go()

    const received = (await screen.findByText('Goods receipt GR-3001')).closest('tr')!
    expect(received).toHaveTextContent('+30')
    expect(received).toHaveTextContent('39')
    expect(received).toHaveTextContent('Goods receipt #5')
    expect(received).toHaveTextContent('Wanda Warehouse')
    expect(received).toHaveTextContent('02 Nov 2026, 18:00') // UTC+6

    const issue = screen.getAllByRole('row').find((r) => r.textContent?.includes('Manual issue'))!
    expect(issue).toHaveTextContent('-3')
    expect(within(issue).getByText('system')).toBeInTheDocument()
    expect(within(issue).getAllByText('–').length).toBeGreaterThan(0) // reserved after was not recorded then
  })

  it('sends the chosen filters to the API, with dates taken as business days (UTC+6)', async () => {
    serve()
    go()
    await screen.findByText('Goods receipt GR-3001')

    await userEvent.selectOptions(screen.getByLabelText('Product'), 'SYN-ELE-003 · Headlamp Assembly')
    await userEvent.selectOptions(screen.getByLabelText('Warehouse'), 'SYN-DEPOT')
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'Issue')
    await userEvent.type(screen.getByLabelText('From'), '2026-10-20')
    await userEvent.type(screen.getByLabelText('To'), '2026-10-22')

    await waitFor(() => {
      const last = seen[seen.length - 1]

      expect(Object.fromEntries(last.entries())).toMatchObject({ productId: '3', warehouseId: '2', type: 'ISSUE', from: '2026-10-19T18:00:00.000Z', to: '2026-10-22T18:00:00.000Z', pageSize: '25' })
    })
  })

  it('opens already filtered from a link, and the filters can be cleared', async () => {
    serve()
    go('/ledger?productId=3&warehouseId=1&from=2026-11-01&to=2026-11-01')
    await screen.findByText('Goods receipt GR-3001')

    expect(screen.getByLabelText('Product')).toHaveValue('3')
    expect(seen[0].get('from')).toBe('2026-10-31T18:00:00.000Z')

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(screen.getByLabelText('Product')).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })

  it('highlights the movement the user came for', async () => {
    serve()
    go('/ledger?focus=99')

    await screen.findByText('Goods receipt GR-3001')
    const focused = screen.getAllByRole('row').filter((r) => r.getAttribute('aria-current') === 'true')

    expect(focused).toHaveLength(1)
    expect(focused[0]).toHaveTextContent('Manual issue')
  })

  it('pages through the results', async () => {
    serve([row()], 60, 3)
    go()
    await screen.findByText('Goods receipt GR-3001')

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => expect(seen[seen.length - 1].get('page')).toBe('2'))
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument()
  })

  it('says when nothing matches, and when the ledger is empty', async () => {
    serve([])
    go('/ledger?type=ISSUE')
    expect(await screen.findByText('No movements match these filters')).toBeInTheDocument()
  })

  it('shows an empty ledger without suggesting filters', async () => {
    serve([])
    go()
    expect(await screen.findByText('No stock movements yet')).toBeInTheDocument()
  })

  it('shows the error with a retry when the ledger cannot be loaded', async () => {
    server.use(
      mswHttp.get('*/api/v1/products', () => envelope([product])),
      mswHttp.get('*/api/v1/warehouses', () => envelope(warehouses)),
      mswHttp.get('*/api/v1/inventory/transactions', () => HttpResponse.json({ success: false, message: 'to must be after from' }, { status: 400 })),
    )
    go()

    expect(await screen.findByText('to must be after from')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
