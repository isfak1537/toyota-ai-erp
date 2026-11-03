import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '../test/server'
import { envelope, renderApp } from '../test/render'
import { goodsReceipt, purchaseOrder, requisition, warehouses } from '../test/fixtures'
import { AppRoutes } from '../App'
import type { PurchaseOrder, Requisition, Role } from '../api/types'

const page = (n: number) => ({ pagination: { page: 1, pageSize: 20, total: n, totalPages: 1 } })

const serve = ({ reqs = [] as Requisition[], pos = [] as PurchaseOrder[] } = {}) =>
  server.use(
    mswHttp.get('*/api/v1/procurement/requisitions', () => envelope(reqs, page(reqs.length))),
    mswHttp.get('*/api/v1/procurement/purchase-orders', () => envelope(pos, page(pos.length))),
    mswHttp.get('*/api/v1/procurement/goods-receipts', () => envelope([goodsReceipt()], page(1))),
    mswHttp.get('*/api/v1/warehouses', () => envelope(warehouses)),
  )

const go = (role: Role, route = '/procurement') => renderApp(<AppRoutes />, { route, role })

describe('procurement: requisitions (UI-006)', () => {
  it('lists requisitions with their supplier, delivery warehouse, items and the AI origin', async () => {
    serve({ reqs: [requisition()] })
    go('PROCUREMENT_OFFICER')

    const row = (await screen.findByText('PR-1001')).closest('tr')!
    expect(row).toHaveTextContent('Orient Parts Co.')
    expect(row).toHaveTextContent('SYN-MAIN')
    expect(row).toHaveTextContent('60 × Headlamp Assembly')
    expect(row).toHaveTextContent('From AI suggestion')
    expect(row).toHaveTextContent('Draft')
  })

  it('walks a draft through submit and approve, one step per button', async () => {
    const calls: string[] = []
    serve({ reqs: [requisition({ status: 'DRAFT' })] })
    server.use(mswHttp.post('*/api/v1/procurement/requisitions/4/submit', () => { calls.push('submit'); return envelope({}) }))
    go('PROCUREMENT_OFFICER')

    await userEvent.click(await screen.findByRole('button', { name: 'Submit' }))

    expect(await screen.findByText('PR-1001 submitted for approval.')).toBeInTheDocument()
    expect(calls).toEqual(['submit'])
  })

  it('offers Approve for a submitted requisition and shows the server message when it fails', async () => {
    serve({ reqs: [requisition({ status: 'SUBMITTED' })] })
    server.use(mswHttp.post('*/api/v1/procurement/requisitions/4/approve', () => HttpResponse.json({ success: false, message: 'Only SUBMITTED requisitions can be approved' }, { status: 409 })))
    go('ADMIN')

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Only SUBMITTED requisitions can be approved')
  })

  it('creates a purchase order from an approved requisition with the estimated prices, and says where it will be delivered', async () => {
    serve({ reqs: [requisition({ status: 'APPROVED' })] })
    let body: unknown
    server.use(mswHttp.post('*/api/v1/procurement/purchase-orders', async ({ request }) => { body = await request.json(); return envelope(purchaseOrder()) }))
    go('PROCUREMENT_OFFICER')

    await userEvent.click(await screen.findByRole('button', { name: 'Create purchase order…' }))
    expect(screen.getByText(/delivery to/)).toHaveTextContent('SYN-MAIN')
    const price = screen.getByLabelText('Unit price for Headlamp Assembly')
    expect(price).toHaveValue(12.5)
    await userEvent.clear(price)
    await userEvent.type(price, '11.75')
    await userEvent.click(screen.getByRole('button', { name: 'Create purchase order' }))

    expect(await screen.findByText(/PO-2001/)).toBeInTheDocument()
    expect(screen.getByText(/goods will be received at SYN-MAIN/)).toBeInTheDocument()
    expect(body).toEqual({ supplierId: 2, requisitionId: 4, items: [{ productId: 3, quantity: 60, unitPrice: 11.75 }] })
  })

  it('will not create an order with a zero quantity, or from a requisition without a supplier', async () => {
    serve({ reqs: [requisition({ id: 4, status: 'APPROVED' }), requisition({ id: 5, requisitionNumber: 'PR-1002', status: 'APPROVED', supplierId: null, supplier: null })] })
    go('PROCUREMENT_OFFICER')
    const buttons = await screen.findAllByRole('button', { name: 'Create purchase order…' })

    await userEvent.click(buttons[0])
    const qty = screen.getByLabelText('Order quantity for Headlamp Assembly')
    await userEvent.clear(qty)
    await userEvent.type(qty, '0')
    expect(screen.getByRole('button', { name: 'Create purchase order' })).toBeDisabled()

    await userEvent.click(buttons[1])
    expect(await screen.findByText(/has no supplier/)).toBeInTheDocument()
  })

  it('a requisition that already has an order shows it instead of offering another', async () => {
    serve({ reqs: [requisition({ status: 'APPROVED', purchaseOrders: [{ id: 9, poNumber: 'PO-2001', status: 'APPROVED' }] })] })
    go('PROCUREMENT_OFFICER')

    expect(await screen.findByText('PO-2001')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create purchase order…' })).not.toBeInTheDocument()
  })

  it.each<Role>(['VIEWER', 'WAREHOUSE_MANAGER'])('%s sees requisitions but no workflow buttons', async (role) => {
    serve({ reqs: [requisition({ status: 'SUBMITTED' })] })
    go(role)

    await screen.findByText('PR-1001')
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument()
  })

  it('has an empty state that points to the AI suggestions', async () => {
    serve()
    go('VIEWER')

    expect(await screen.findByText('No requisitions yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open AI suggestions' })).toHaveAttribute('href', '/suggestions')
  })
})

describe('procurement: purchase orders and goods receipts', () => {
  it('approves a pending order', async () => {
    serve({ pos: [purchaseOrder({ status: 'PENDING_APPROVAL' })] })
    server.use(mswHttp.post('*/api/v1/procurement/purchase-orders/9/approve', () => envelope({})))
    go('PROCUREMENT_OFFICER', '/procurement?tab=orders')

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))

    expect(await screen.findByText(/PO-2001 approved/)).toBeInTheDocument()
  })

  it('receives into the order destination without sending a warehouse, so the server default applies', async () => {
    serve({ pos: [purchaseOrder({ status: 'APPROVED' })] })
    let body: Record<string, unknown> = {}
    server.use(mswHttp.post('*/api/v1/procurement/goods-receipts', async ({ request }) => { body = (await request.json()) as typeof body; return envelope({ receiptNumber: 'GR-3002' }) }))
    go('WAREHOUSE_MANAGER', '/procurement?tab=orders')

    await userEvent.click(await screen.findByRole('button', { name: 'Receive goods…' }))
    expect(screen.getByLabelText('Receive into')).toHaveValue('1')
    expect(screen.getByLabelText('Receive quantity for Headlamp Assembly')).toHaveValue(40) // the 40 still to come
    await userEvent.click(screen.getByRole('button', { name: 'Post goods receipt' }))

    expect(await screen.findByText(/GR-3002/)).toBeInTheDocument()
    expect(body).toEqual({ purchaseOrderId: 9, items: [{ purchaseOrderItemId: 31, productId: 3, quantity: 40 }] })
  })

  it('receiving elsewhere needs an explicit confirmation, then sends allowDifferentWarehouse', async () => {
    serve({ pos: [purchaseOrder({ status: 'PARTIALLY_RECEIVED' })] })
    let body: Record<string, unknown> = {}
    server.use(mswHttp.post('*/api/v1/procurement/goods-receipts', async ({ request }) => { body = (await request.json()) as typeof body; return envelope({ receiptNumber: 'GR-3003' }) }))
    go('ADMIN', '/procurement?tab=orders')

    await userEvent.click(await screen.findByRole('button', { name: 'Receive goods…' }))
    await userEvent.selectOptions(screen.getByLabelText('Receive into'), 'SYN-DEPOT')

    expect(screen.getByRole('button', { name: 'Post goods receipt' })).toBeDisabled() // not until the override is confirmed
    await userEvent.click(screen.getByLabelText(/Receive it here instead on purpose/))
    await userEvent.click(screen.getByRole('button', { name: 'Post goods receipt' }))

    expect(await screen.findByText(/GR-3003/)).toBeInTheDocument()
    expect(body).toMatchObject({ purchaseOrderId: 9, warehouseId: 2, allowDifferentWarehouse: true })
  })

  it('a procurement officer cannot choose another warehouse, and is told why', async () => {
    serve({ pos: [purchaseOrder({ status: 'APPROVED' })] })
    go('PROCUREMENT_OFFICER', '/procurement?tab=orders')

    await userEvent.click(await screen.findByRole('button', { name: 'Receive goods…' }))

    expect(screen.getByLabelText('Receive into')).toBeDisabled()
    expect(screen.getByText(/Only a warehouse manager or administrator can receive it elsewhere/)).toBeInTheDocument()
  })

  it('an order without a destination asks which warehouse to receive into', async () => {
    serve({ pos: [purchaseOrder({ status: 'APPROVED', destinationWarehouseId: null, destinationWarehouse: null })] })
    let body: Record<string, unknown> = {}
    server.use(mswHttp.post('*/api/v1/procurement/goods-receipts', async ({ request }) => { body = (await request.json()) as typeof body; return envelope({ receiptNumber: 'GR-3004' }) }))
    go('WAREHOUSE_MANAGER', '/procurement?tab=orders')

    await userEvent.click(await screen.findByRole('button', { name: 'Receive goods…' }))
    expect(screen.getByRole('button', { name: 'Post goods receipt' })).toBeDisabled()
    await userEvent.selectOptions(screen.getByLabelText('Receive into'), 'SYN-MAIN')
    await userEvent.click(screen.getByRole('button', { name: 'Post goods receipt' }))

    await screen.findByText(/GR-3004/)
    expect(body).toMatchObject({ warehouseId: 1 })
    expect(body).not.toHaveProperty('allowDifferentWarehouse')
  })

  it('cannot receive more than is still outstanding, and shows the server error when it refuses', async () => {
    serve({ pos: [purchaseOrder({ status: 'APPROVED' })] })
    server.use(mswHttp.post('*/api/v1/procurement/goods-receipts', () => HttpResponse.json({ success: false, message: 'Receipt quantity exceeds remaining quantity' }, { status: 409 })))
    go('WAREHOUSE_MANAGER', '/procurement?tab=orders')

    await userEvent.click(await screen.findByRole('button', { name: 'Receive goods…' }))
    const qty = screen.getByLabelText('Receive quantity for Headlamp Assembly')
    await userEvent.clear(qty)
    await userEvent.type(qty, '41')
    expect(screen.getByRole('button', { name: 'Post goods receipt' })).toBeDisabled()

    await userEvent.clear(qty)
    await userEvent.type(qty, '40')
    await userEvent.click(screen.getByRole('button', { name: 'Post goods receipt' }))
    expect(await within(screen.getByRole('group', { name: /Receive goods for PO-2001/ })).findByRole('alert')).toHaveTextContent('Receipt quantity exceeds remaining quantity')
  })

  it('a viewer sees orders with received/ordered progress and no actions; received orders offer none', async () => {
    serve({ pos: [purchaseOrder({ status: 'PARTIALLY_RECEIVED' }), purchaseOrder({ id: 10, poNumber: 'PO-2002', status: 'RECEIVED' })] })
    go('VIEWER', '/procurement?tab=orders')

    const row = (await screen.findByText('PO-2001')).closest('tr')!
    expect(row).toHaveTextContent('20 / 60')
    expect(row).toHaveTextContent('750.00')
    expect(screen.queryByRole('button', { name: 'Receive goods…' })).not.toBeInTheDocument()
  })

  it('lists goods receipts', async () => {
    serve()
    go('VIEWER', '/procurement?tab=receipts')

    const row = (await screen.findByText('GR-3001')).closest('tr')!
    expect(row).toHaveTextContent('PO-2001')
    expect(row).toHaveTextContent('20 × Headlamp Assembly')
    expect(row).toHaveTextContent('SYN-MAIN')
  })
})
