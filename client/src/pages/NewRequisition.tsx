import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ApiError, post } from '../api/client'
import { useProducts, useSupplierLinks, useSuppliers, useWarehouses } from '../api/queries'
import type { Requisition } from '../api/types'
import { useAuth } from '../auth/auth-context'
import { Banner, Button, Loading } from '../components/ui'
import { formatNumber } from '../lib/format'

interface Line {
  key: number
  productId: number | ''
  quantity: string
  price: string
}

let nextKey = 1
const blank = (): Line => ({ key: nextKey++, productId: '', quantity: '', price: '' })

// PRD F-03: a requisition entered by hand, next to the ones created from AI suggestions.
export function NewRequisition({ onCreated, onCancel }: { onCreated: (r: Requisition) => void; onCancel: () => void }) {
  const { user } = useAuth()
  const suppliers = useSuppliers()
  const links = useSupplierLinks()
  const products = useProducts()
  const warehouses = useWarehouses()

  const [supplierId, setSupplierId] = useState<number | ''>('')
  const [warehouseId, setWarehouseId] = useState<number | ''>('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([blank()])

  const activeSuppliers = (suppliers.data?.data ?? []).filter((s) => s.isActive)
  const allLinks = useMemo(() => links.data?.data ?? [], [links.data])
  const linkFor = (productId: number) => allLinks.find((l) => l.supplierId === supplierId && l.productId === productId)

  // with a supplier chosen only its products are offered; without one, every active product
  const offered = (products.data?.data ?? []).filter((p) => p.isActive && (supplierId === '' || allLinks.some((l) => l.supplierId === supplierId && l.productId === p.id)))
  const chosen = new Set(lines.map((l) => l.productId).filter((id): id is number => id !== ''))

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const pickProduct = (key: number, productId: number | '') => {
    const link = productId === '' ? undefined : linkFor(productId)

    update(key, { productId, ...(link ? { price: link.unitPrice } : {}) })
  }

  const changeSupplier = (id: number | '') => {
    setSupplierId(id)
    // prices and the product list belong to the supplier: start the lines again
    setLines([blank()])
  }

  const create = useMutation({
    mutationFn: async () =>
      (
        await post<Requisition>('/procurement/requisitions', {
          requesterName: user?.name ?? 'Unknown',
          ...(supplierId !== '' && { supplierId }),
          ...(warehouseId !== '' && { destinationWarehouseId: warehouseId }),
          ...(notes.trim() && { notes: notes.trim() }),
          items: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), estimatedUnitPrice: Number(l.price) })),
        })
      ).data,
    onSuccess: onCreated,
  })

  const lineProblem = (l: Line) => {
    if (l.productId === '') return 'Choose a product'
    if (!Number.isInteger(Number(l.quantity)) || Number(l.quantity) <= 0) return 'Quantity must be a whole number above 0'
    if (l.price === '' || !(Number(l.price) >= 0)) return 'Enter the estimated unit price'

    return null
  }

  const problems = lines.map(lineProblem)
  const valid = lines.length > 0 && problems.every((p) => p === null)
  const loading = suppliers.isPending || products.isPending || links.isPending || warehouses.isPending

  if (loading) return <Loading />

  return (
    <div className="stack" role="group" aria-label="New requisition" style={{ padding: 'var(--space-4) var(--space-5)' }}>
      <div>
        <h3>New requisition</h3>
        <p className="muted">A requisition is a request to buy. It starts as a draft; someone submits it, approves it, and only then can it become a purchase order.</p>
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="field">
          <label htmlFor="req-supplier">Supplier (optional)</label>
          <select id="req-supplier" className="select" value={supplierId} onChange={(e) => changeSupplier(e.target.value ? Number(e.target.value) : '')}>
            <option value="">No supplier yet</option>
            {activeSuppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="req-warehouse">Deliver to (optional)</label>
          <select id="req-warehouse" className="select" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Not decided</option>
            {(warehouses.data?.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.code}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor="req-notes">Notes (optional)</label>
          <input id="req-notes" className="input" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <p className="muted">Requested by <strong>{user?.name}</strong>.{supplierId !== '' && ' Only products this supplier sells are listed.'}</p>

      <table className="table table--dense">
        <thead>
          <tr>
            <th>Product</th>
            <th className="num">Quantity</th>
            <th className="num">Estimated unit price</th>
            <th>Note</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, index) => {
            const link = l.productId === '' ? undefined : linkFor(l.productId)
            const belowMoq = link && Number(l.quantity) > 0 && Number(l.quantity) < link.minimumOrderQty

            return (
              <tr key={l.key}>
                <td>
                  <select aria-label={`Product for line ${index + 1}`} className="select" value={l.productId} onChange={(e) => pickProduct(l.key, e.target.value ? Number(e.target.value) : '')}>
                    <option value="">Choose a product…</option>
                    {offered.map((p) => (
                      <option key={p.id} value={p.id} disabled={chosen.has(p.id) && l.productId !== p.id}>
                        {p.sku} · {p.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="num"><input aria-label={`Quantity for line ${index + 1}`} className="input num" style={{ width: 90 }} type="number" min={1} step={1} value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} /></td>
                <td className="num"><input aria-label={`Estimated unit price for line ${index + 1}`} className="input num" style={{ width: 110 }} type="number" min={0} step="0.01" value={l.price} onChange={(e) => update(l.key, { price: e.target.value })} /></td>
                <td className="muted">
                  {link && <span>Supplier price {formatNumber(Number(link.unitPrice), 2)} · minimum order {link.minimumOrderQty}{link.leadTimeDays !== null && ` · ${link.leadTimeDays} days`}</span>}
                  {belowMoq && <div className="field__error">Below the supplier’s minimum order of {link.minimumOrderQty}.</div>}
                </td>
                <td>
                  {lines.length > 1 && (
                    <Button size="sm" variant="ghost" aria-label={`Remove line ${index + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      Remove
                    </Button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div>
        <Button size="sm" onClick={() => setLines((ls) => [...ls, blank()])} disabled={chosen.size >= offered.length}>
          Add a product
        </Button>
      </div>

      {create.isError && (
        <Banner tone="danger">
          {create.error instanceof ApiError ? create.error.message : 'The requisition could not be created.'}
          {create.error instanceof ApiError && create.error.details.map((d) => ` ${d.field ? `${d.field}: ` : ''}${d.message}`).join(';')}
        </Banner>
      )}
      <div className="row">
        <Button variant="primary" busy={create.isPending} disabled={!valid} onClick={() => create.mutate()}>
          Create draft requisition
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
        {!valid && lines.length > 0 && <span className="muted">{problems.find((p) => p !== null)}</span>}
      </div>
    </div>
  )
}
