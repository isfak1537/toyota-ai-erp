import { Fragment, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, post } from '../api/client'
import { useGoodsReceipts, usePurchaseOrders, useRequisitions, useWarehouses } from '../api/queries'
import type { PurchaseOrder, PurchaseOrderStatus, Requisition, RequisitionStatus } from '../api/types'
import { useAuth } from '../auth/auth-context'
import { Badge, Banner, Button, DataState, PageHeader, Pager, TabPanel, Tabs } from '../components/ui'
import { NewRequisition } from './NewRequisition'
import { formatDate, formatDateTime, formatMoney, formatNumber, humanize } from '../lib/format'
import { can } from '../lib/permissions'

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'ai'
const REQ_TONE: Record<RequisitionStatus, Tone> = { DRAFT: 'neutral', SUBMITTED: 'info', APPROVED: 'success', REJECTED: 'danger', CANCELLED: 'neutral' }
const PO_TONE: Record<PurchaseOrderStatus, Tone> = { DRAFT: 'neutral', PENDING_APPROVAL: 'warning', APPROVED: 'info', PARTIALLY_RECEIVED: 'warning', RECEIVED: 'success', CANCELLED: 'neutral' }

type TabId = 'requisitions' | 'orders' | 'receipts'

// One hook for every workflow step: it posts, reports success or the server's message, and refreshes what changed.
function useStep<T = unknown>(path: string, onDone?: (data: T) => void) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (body: unknown) => (await post<T>(path, body ?? {})).data,
    onSuccess: (data) => {
      for (const key of ['requisitions', 'purchase-orders', 'goods-receipts', 'inventory', 'ledger', 'days-of-cover']) void queryClient.invalidateQueries({ queryKey: [key] })
      onDone?.(data)
    },
    onError: () => {
      // a 409 usually means someone else moved it first: show the current state
      for (const key of ['requisitions', 'purchase-orders']) void queryClient.invalidateQueries({ queryKey: [key] })
    },
  })
}

const errorText = (error: unknown) => (error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'The action failed.')

export default function Procurement() {
  const [params, setParams] = useSearchParams()
  const tab: TabId = params.get('tab') === 'orders' ? 'orders' : params.get('tab') === 'receipts' ? 'receipts' : 'requisitions'
  const [notice, setNotice] = useState<React.ReactNode>(null)

  return (
    <>
      <PageHeader title="Procurement" description="From requisition to purchase order to goods receipt. Every step is a person's decision and is recorded with who took it." />
      {notice && <Banner tone="info">{notice}</Banner>}
      <section className="card">
        <Tabs
          label="Procurement documents"
          active={tab}
          onChange={(id) => setParams(id === 'requisitions' ? {} : { tab: id })}
          tabs={[
            { id: 'requisitions', label: 'Requisitions' },
            { id: 'orders', label: 'Purchase orders' },
            { id: 'receipts', label: 'Goods receipts' },
          ]}
        />
        <TabPanel id="requisitions" active={tab}>
          <Requisitions onNotice={setNotice} />
        </TabPanel>
        <TabPanel id="orders" active={tab}>
          <PurchaseOrders onNotice={setNotice} />
        </TabPanel>
        <TabPanel id="receipts" active={tab}>
          <Receipts />
        </TabPanel>
      </section>
    </>
  )
}

// ------------------------------------------------------------------ requisitions

function Requisitions({ onNotice }: { onNotice: (n: React.ReactNode) => void }) {
  const { user } = useAuth()
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const query = useRequisitions(page)
  const queryClient = useQueryClient()
  const rows = query.data?.data ?? []
  const write = can(user?.role, 'procurementWrite')

  return (
    <>
      {write && !creating && (
        <div className="filters">
          <Button variant="primary" onClick={() => setCreating(true)}>New requisition</Button>
          <span className="muted">Or approve an AI suggestion to create one with the numbers filled in.</span>
        </div>
      )}
      {creating && (
        <div style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-muted)' }}>
          <NewRequisition
            onCancel={() => setCreating(false)}
            onCreated={(r) => {
              setCreating(false)
              void queryClient.invalidateQueries({ queryKey: ['requisitions'] })
              onNotice(<span>Draft requisition <strong>{r.requisitionNumber}</strong> created. Submit it for approval from the list.</span>)
            }}
          />
        </div>
      )}
      <RequisitionTable query={query} rows={rows} write={write} page={page} setPage={setPage} open={open} setOpen={setOpen} onNotice={onNotice} />
    </>
  )
}

function RequisitionTable({ query, rows, write, page, setPage, open, setOpen, onNotice }: {
  query: ReturnType<typeof useRequisitions>
  rows: Requisition[]
  write: boolean
  page: number
  setPage: (p: number) => void
  open: number | null
  setOpen: (id: number | null) => void
  onNotice: (n: React.ReactNode) => void
}) {
  return (
    <DataState query={query} empty={{ when: rows.length === 0, title: 'No requisitions yet', text: 'Create one above, or approve an AI suggestion.', action: <Link to="/suggestions">Open AI suggestions</Link> }}>
      <div className="table-wrap">
        <table className="table table--dense">
          <thead>
            <tr>
              <th>Requisition</th>
              <th>Supplier</th>
              <th>Deliver to</th>
              <th>Items</th>
              <th>Status</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr>
                  <td>
                    <strong className="mono">{r.requisitionNumber}</strong>
                    <div className="table__sub">{r.requesterName}{r.sourceType === 'AI_SUGGESTION' && ' · '}{r.sourceType === 'AI_SUGGESTION' && <Badge tone="ai">From AI suggestion</Badge>}</div>
                  </td>
                  <td>{r.supplier?.name ?? <span className="faint">–</span>}</td>
                  <td>{r.destinationWarehouse?.code ?? <span className="faint">not set</span>}</td>
                  <td>{r.items.map((i) => `${formatNumber(i.quantity)} × ${i.product.name}`).join(', ')}</td>
                  <td><Badge tone={REQ_TONE[r.status]}>{humanize(r.status)}</Badge></td>
                  <td className="faint">{formatDateTime(r.createdAt)}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      {write && r.status === 'DRAFT' && <StepButton label="Submit" path={`/procurement/requisitions/${r.id}/submit`} onNotice={onNotice} done={`${r.requisitionNumber} submitted for approval.`} />}
                      {write && r.status === 'SUBMITTED' && <StepButton label="Approve" variant="primary" path={`/procurement/requisitions/${r.id}/approve`} onNotice={onNotice} done={`${r.requisitionNumber} approved. It can now become a purchase order.`} />}
                      {write && r.status === 'APPROVED' && r.purchaseOrders.length === 0 && <Button size="sm" variant="primary" onClick={() => setOpen(open === r.id ? null : r.id)}>Create purchase order…</Button>}
                      {r.purchaseOrders.map((po) => (
                        <Badge key={po.id} tone="neutral">{po.poNumber}</Badge>
                      ))}
                    </div>
                  </td>
                </tr>
                {open === r.id && (
                  <tr>
                    <td colSpan={7} style={{ background: 'var(--color-surface-muted)' }}>
                      <CreateOrder requisition={r} onDone={(po) => { setOpen(null); onNotice(<span>Purchase order <strong>{po.poNumber}</strong> created and waiting for approval{po.destinationWarehouse ? `; goods will be received at ${po.destinationWarehouse.code}` : ''}.</span>) }} />
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
  )
}

function StepButton({ label, path, onNotice, done, variant }: { label: string; path: string; onNotice: (n: React.ReactNode) => void; done: string; variant?: 'primary' }) {
  const step = useStep(path, () => onNotice(done))

  return (
    <>
      <Button size="sm" variant={variant} busy={step.isPending} onClick={() => step.mutate({})}>
        {label}
      </Button>
      {step.isError && <span className="field__error" role="alert">{errorText(step.error)}</span>}
    </>
  )
}

function CreateOrder({ requisition: r, onDone }: { requisition: Requisition; onDone: (po: PurchaseOrder) => void }) {
  const [qty, setQty] = useState<Record<number, number>>(Object.fromEntries(r.items.map((i) => [i.productId, i.quantity])))
  const [price, setPrice] = useState<Record<number, string>>(Object.fromEntries(r.items.map((i) => [i.productId, i.estimatedUnitPrice])))
  const step = useStep<PurchaseOrder>('/procurement/purchase-orders', onDone)

  if (!r.supplierId) return <Banner tone="warning">This requisition has no supplier, so a purchase order cannot be created from it here.</Banner>

  const valid = r.items.every((i) => qty[i.productId] > 0 && Number(price[i.productId]) >= 0)

  return (
    <div className="stack" role="group" aria-label={`Create a purchase order from ${r.requisitionNumber}`} style={{ padding: 'var(--space-4) 0' }}>
      <p className="muted">
        Supplier <strong>{r.supplier?.name}</strong>
        {r.destinationWarehouse ? <> · delivery to <strong>{r.destinationWarehouse.code}</strong> is taken from the requisition</> : ' · no delivery warehouse is set on the requisition'}. Prices start from the estimate; adjust them to the supplier’s quote.
      </p>
      <table className="table table--dense">
        <thead>
          <tr><th>Product</th><th className="num">Requisitioned</th><th className="num">Order quantity</th><th className="num">Unit price</th></tr>
        </thead>
        <tbody>
          {r.items.map((i) => (
            <tr key={i.id}>
              <td>{i.product.name}<div className="table__sub mono">{i.product.sku}</div></td>
              <td className="num">{formatNumber(i.quantity)}</td>
              <td className="num"><input aria-label={`Order quantity for ${i.product.name}`} className="input num" style={{ width: 90 }} type="number" min={1} value={qty[i.productId]} onChange={(e) => setQty({ ...qty, [i.productId]: Number(e.target.value) })} /></td>
              <td className="num"><input aria-label={`Unit price for ${i.product.name}`} className="input num" style={{ width: 100 }} type="number" min={0} step="0.01" value={price[i.productId]} onChange={(e) => setPrice({ ...price, [i.productId]: e.target.value })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {step.isError && <Banner tone="danger">{errorText(step.error)}</Banner>}
      <div className="row">
        <Button variant="primary" busy={step.isPending} disabled={!valid} onClick={() => step.mutate({ supplierId: r.supplierId, requisitionId: r.id, items: r.items.map((i) => ({ productId: i.productId, quantity: qty[i.productId], unitPrice: Number(price[i.productId]) })) })}>
          Create purchase order
        </Button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ purchase orders

function PurchaseOrders({ onNotice }: { onNotice: (n: React.ReactNode) => void }) {
  const { user } = useAuth()
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<number | null>(null)
  const query = usePurchaseOrders(page)
  const rows = query.data?.data ?? []

  return (
    <DataState query={query} empty={{ when: rows.length === 0, title: 'No purchase orders yet', text: 'Create one from an approved requisition.' }}>
      <div className="table-wrap">
        <table className="table table--dense">
          <thead>
            <tr>
              <th>Purchase order</th>
              <th>Supplier</th>
              <th>Deliver to</th>
              <th className="num">Received</th>
              <th className="num">Total</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((po) => {
              const ordered = po.items.reduce((n, i) => n + i.quantity, 0)
              const received = po.items.reduce((n, i) => n + i.receivedQuantity, 0)

              return (
                <Fragment key={po.id}>
                  <tr>
                    <td>
                      <strong className="mono">{po.poNumber}</strong>
                      <div className="table__sub">{po.requisition ? `from ${po.requisition.requisitionNumber}` : 'no requisition'} · {formatDate(po.createdAt)}</div>
                    </td>
                    <td>{po.supplier.name}</td>
                    <td>{po.destinationWarehouse?.code ?? <span className="faint">not set</span>}</td>
                    <td className="num">{formatNumber(received)} / {formatNumber(ordered)}</td>
                    <td className="num">{formatMoney(po.totalAmount)}</td>
                    <td><Badge tone={PO_TONE[po.status]}>{humanize(po.status)}</Badge></td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        {can(user?.role, 'procurementWrite') && po.status === 'PENDING_APPROVAL' && <StepButton label="Approve" variant="primary" path={`/procurement/purchase-orders/${po.id}/approve`} onNotice={onNotice} done={`${po.poNumber} approved. Goods can now be received against it.`} />}
                        {can(user?.role, 'receiveGoods') && ['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status) && (
                          <Button size="sm" variant="primary" onClick={() => setOpen(open === po.id ? null : po.id)}>Receive goods…</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {open === po.id && (
                    <tr>
                      <td colSpan={7} style={{ background: 'var(--color-surface-muted)' }}>
                        <ReceiveForm order={po} onDone={(receiptNumber) => { setOpen(null); onNotice(<span>Goods receipt <strong>{receiptNumber}</strong> posted: stock and the ledger are updated. <Link to="/ledger">See the ledger</Link></span>) }} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {query.data?.pagination && <Pager page={page} totalPages={query.data.pagination.totalPages} total={query.data.pagination.total} onPage={setPage} />}
    </DataState>
  )
}

function ReceiveForm({ order: po, onDone }: { order: PurchaseOrder; onDone: (receiptNumber: string) => void }) {
  const { user } = useAuth()
  const warehouses = useWarehouses()
  const canOverride = can(user?.role, 'overrideReceiptWarehouse')
  const [warehouseId, setWarehouseId] = useState<number | ''>(po.destinationWarehouseId ?? '')
  const [override, setOverride] = useState(false)
  const remaining = (i: PurchaseOrder['items'][number]) => i.quantity - i.receivedQuantity
  const [qty, setQty] = useState<Record<number, number>>(Object.fromEntries(po.items.map((i) => [i.id, Math.max(remaining(i), 0)])))
  const step = useStep<{ receiptNumber: string }>('/procurement/goods-receipts', (data) => onDone(data.receiptNumber))

  const different = po.destinationWarehouseId !== null && warehouseId !== '' && warehouseId !== po.destinationWarehouseId
  const lines = po.items.filter((i) => qty[i.id] > 0)
  const valid = lines.length > 0 && lines.every((i) => qty[i.id] <= remaining(i)) && warehouseId !== '' && (!different || (override && canOverride))

  const submit = () =>
    step.mutate({
      purchaseOrderId: po.id,
      // the warehouse is left out when it is the order's destination, so the server's default applies
      ...(different || po.destinationWarehouseId === null ? { warehouseId } : {}),
      ...(different ? { allowDifferentWarehouse: true } : {}),
      items: lines.map((i) => ({ purchaseOrderItemId: i.id, productId: i.productId, quantity: qty[i.id] })),
    })

  return (
    <div className="stack" role="group" aria-label={`Receive goods for ${po.poNumber}`} style={{ padding: 'var(--space-4) 0' }}>
      <div className="row">
        <div className="field">
          <label htmlFor={`wh-${po.id}`}>Receive into</label>
          <select id={`wh-${po.id}`} className="select" value={warehouseId} disabled={po.destinationWarehouseId !== null && !canOverride} onChange={(e) => setWarehouseId(e.target.value ? Number(e.target.value) : '')}>
            {po.destinationWarehouseId === null && <option value="">Choose a warehouse…</option>}
            {(warehouses.data?.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.code}{w.id === po.destinationWarehouseId ? ' (order destination)' : ''}
              </option>
            ))}
          </select>
        </div>
        {po.destinationWarehouseId !== null && !canOverride && <p className="muted">This order is destined for {po.destinationWarehouse?.code}. Only a warehouse manager or administrator can receive it elsewhere.</p>}
      </div>
      {different && (
        <Banner tone="warning">
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            <span>This order is destined for <strong>{po.destinationWarehouse?.code}</strong>. Receive it here instead on purpose (this is written to the audit log).</span>
          </label>
        </Banner>
      )}
      <table className="table table--dense">
        <thead>
          <tr><th>Product</th><th className="num">Ordered</th><th className="num">Already received</th><th className="num">Receive now</th></tr>
        </thead>
        <tbody>
          {po.items.map((i) => (
            <tr key={i.id}>
              <td>{i.product.name}<div className="table__sub mono">{i.product.sku}</div></td>
              <td className="num">{formatNumber(i.quantity)}</td>
              <td className="num">{formatNumber(i.receivedQuantity)}</td>
              <td className="num">
                <input aria-label={`Receive quantity for ${i.product.name}`} className="input num" style={{ width: 90 }} type="number" min={0} max={remaining(i)} value={qty[i.id]} onChange={(e) => setQty({ ...qty, [i.id]: Number(e.target.value) })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {step.isError && <Banner tone="danger">{errorText(step.error)}</Banner>}
      <div className="row">
        <Button variant="primary" busy={step.isPending} disabled={!valid} onClick={submit}>Post goods receipt</Button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ receipts

function Receipts() {
  const [page, setPage] = useState(1)
  const query = useGoodsReceipts(page)
  const rows = query.data?.data ?? []

  return (
    <DataState query={query} empty={{ when: rows.length === 0, title: 'No goods receipts yet', text: 'Receiving goods against an approved purchase order adds stock and writes the ledger.' }}>
      <div className="table-wrap">
        <table className="table table--dense">
          <thead>
            <tr>
              <th>Receipt</th>
              <th>Purchase order</th>
              <th>Supplier</th>
              <th>Warehouse</th>
              <th>Items</th>
              <th>Received</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id}>
                <td><strong className="mono">{g.receiptNumber}</strong></td>
                <td className="mono">{g.purchaseOrder.poNumber}</td>
                <td>{g.purchaseOrder.supplier.name}</td>
                <td>{g.warehouse.code}</td>
                <td>{g.items.map((i) => `${formatNumber(i.quantity)} × ${i.product.name}`).join(', ')}</td>
                <td className="faint">{formatDateTime(g.receiptDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {query.data?.pagination && <Pager page={page} totalPages={query.data.pagination.totalPages} total={query.data.pagination.total} onPage={setPage} />}
    </DataState>
  )
}
