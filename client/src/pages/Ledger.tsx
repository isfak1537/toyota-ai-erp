import { useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router'
import { useLedger, useProducts, useWarehouses } from '../api/queries'
import type { TransactionType } from '../api/types'
import { Badge, Button, Card, DataState, PageHeader, Pager } from '../components/ui'
import { businessDayRange, formatDateTime, formatNumber, humanize } from '../lib/format'

const TYPES: TransactionType[] = ['RECEIPT', 'ISSUE', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'RESERVATION', 'RELEASE']
const TYPE_TONE: Record<TransactionType, 'success' | 'danger' | 'warning' | 'info' | 'neutral'> = {
  RECEIPT: 'success', ISSUE: 'danger', ADJUSTMENT: 'warning', TRANSFER_IN: 'info', TRANSFER_OUT: 'info', RESERVATION: 'neutral', RELEASE: 'neutral',
}

// Filters live in the address, so a filtered ledger can be linked to (the anomaly page does).
export default function Ledger() {
  const [params, setParams] = useSearchParams()
  const filters = {
    productId: params.get('productId') ?? '',
    warehouseId: params.get('warehouseId') ?? '',
    type: params.get('type') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  }
  const page = Number(params.get('page') ?? '1') || 1
  const focus = params.get('focus') ? Number(params.get('focus')) : null

  const products = useProducts()
  const warehouses = useWarehouses()
  const range = businessDayRange(filters.from || undefined, filters.to || undefined)
  const query = useLedger({ productId: filters.productId, warehouseId: filters.warehouseId, type: filters.type, ...range, page, pageSize: 25 })
  const rows = useMemo(() => query.data?.data ?? [], [query.data])
  const focusRef = useRef<HTMLTableRowElement | null>(null)

  useEffect(() => {
    focusRef.current?.scrollIntoView?.({ block: 'center' })
  }, [rows, focus])

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)

    if (value) next.set(key, value)
    else next.delete(key)

    if (key !== 'page') next.delete('page')
    if (key !== 'page' && key !== 'focus') next.delete('focus')
    setParams(next)
  }

  const active = Object.values(filters).some(Boolean)

  return (
    <>
      <PageHeader title="Stock ledger" description="Every stock movement, newest first. Quantities are signed: receipts add, issues subtract. The balance after each movement is recorded with it." />
      <Card flush>
        <div className="filters">
          <div className="field">
            <label htmlFor="product">Product</label>
            <select id="product" className="select" value={filters.productId} onChange={(e) => set('productId', e.target.value)}>
              <option value="">All products</option>
              {(products.data?.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} · {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="warehouse">Warehouse</label>
            <select id="warehouse" className="select" value={filters.warehouseId} onChange={(e) => set('warehouseId', e.target.value)}>
              <option value="">All warehouses</option>
              {(warehouses.data?.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="type">Type</label>
            <select id="type" className="select" value={filters.type} onChange={(e) => set('type', e.target.value)}>
              <option value="">All types</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="from">From</label>
            <input id="from" className="input" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set('from', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="to">To</label>
            <input id="to" className="input" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set('to', e.target.value)} />
          </div>
          {active && (
            <Button variant="ghost" onClick={() => setParams({})}>
              Clear filters
            </Button>
          )}
        </div>
        <DataState query={query} empty={{ when: rows.length === 0, title: active ? 'No movements match these filters' : 'No stock movements yet' }}>
          <div className="table-wrap">
            <table className="table table--dense">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Product</th>
                  <th>Warehouse</th>
                  <th>Type</th>
                  <th className="num">Quantity</th>
                  <th className="num">Balance after</th>
                  <th className="num">Reserved after</th>
                  <th>Reference</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} ref={r.id === focus ? focusRef : undefined} className={r.id === focus ? 'is-flagged' : undefined} aria-current={r.id === focus ? 'true' : undefined}>
                    <td className="faint">{formatDateTime(r.createdAt)}</td>
                    <td>
                      {r.product.name}
                      <div className="table__sub mono">{r.product.sku}</div>
                    </td>
                    <td>{r.warehouse.code}</td>
                    <td><Badge tone={TYPE_TONE[r.type]}>{humanize(r.type)}</Badge></td>
                    <td className="num"><strong>{r.quantity > 0 ? '+' : ''}{formatNumber(r.quantity)}</strong></td>
                    <td className="num">{formatNumber(r.balanceAfter)}</td>
                    <td className="num">{r.reservedAfter === null ? <span className="faint" title="Recorded before reserved quantity was tracked">–</span> : formatNumber(r.reservedAfter)}</td>
                    <td>
                      {r.referenceType ? (
                        <>
                          <span className="mono">{humanize(r.referenceType)}</span>
                          {r.referenceId !== null && <span className="muted"> #{r.referenceId}</span>}
                        </>
                      ) : (
                        <span className="faint">–</span>
                      )}
                      {r.reason && <div className="table__sub" style={{ whiteSpace: 'normal' }}>{r.reason}</div>}
                    </td>
                    <td>{r.createdBy ? r.createdBy.name : <span className="faint" title="Seeded or recorded before actors were tracked">system</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {query.data?.pagination && <Pager page={page} totalPages={query.data.pagination.totalPages} total={query.data.pagination.total} onPage={(p) => set('page', String(p))} />}
        </DataState>
      </Card>
    </>
  )
}
