import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useAnomalies, useDaysOfCover, useInventory, useLatestRun, useSuggestions } from '../api/queries'
import type { DaysOfCoverItem, InventoryRow, ReviewSeries } from '../api/types'
import { TodaySummary } from '../components/TodaySummary'
import { Badge, Banner, Card, DataState, KpiCard, PageHeader } from '../components/ui'
import { DECISION_LABEL, DECISION_TONE } from '../lib/decisions'
import { formatDays, formatNumber } from '../lib/format'

const keyOf = (sku: string, warehouse: string) => `${sku}|${warehouse}`

interface Row {
  row: InventoryRow
  available: number
  low: boolean
  cover: DaysOfCoverItem | undefined
}

function coverTone(days: number | null | undefined): 'danger' | 'warning' | undefined {
  if (days === null || days === undefined) return undefined
  if (days <= 3) return 'danger'
  if (days <= 10) return 'warning'

  return undefined
}

export default function Dashboard() {
  const inventory = useInventory()
  const cover = useDaysOfCover()
  const suggestions = useSuggestions({ status: 'PENDING', pageSize: 1 })
  const anomalies = useAnomalies({ status: 'OPEN', pageSize: 1 })
  const latest = useLatestRun()

  const [search, setSearch] = useState('')
  const [warehouse, setWarehouse] = useState('')
  const [lowOnly, setLowOnly] = useState(false)

  const coverByKey = useMemo(() => {
    const map = new Map<string, DaysOfCoverItem>()

    cover.data?.data.items?.forEach((item) => map.set(keyOf(item.sku, item.warehouse), item))

    return map
  }, [cover.data])

  const rows: Row[] = useMemo(
    () =>
      (inventory.data?.data ?? []).map((row) => {
        const available = row.quantity - row.reservedQuantity

        return { row, available, low: available <= row.product.reorderLevel, cover: coverByKey.get(keyOf(row.product.sku, row.warehouse.code)) }
      }),
    [inventory.data, coverByKey],
  )

  const warehouses = useMemo(() => [...new Set(rows.map((r) => r.row.warehouse.code))].sort(), [rows])
  const lowCount = rows.filter((r) => r.low).length
  const soonest = cover.data?.data.items?.find((item) => item.daysOfCover !== null)
  const forecastDown = cover.data?.data.forecastAvailable === false

  const visible = rows
    .filter((r) => !lowOnly || r.low)
    .filter((r) => !warehouse || r.row.warehouse.code === warehouse)
    .filter((r) => {
      const q = search.trim().toLowerCase()

      return !q || r.row.product.sku.toLowerCase().includes(q) || r.row.product.name.toLowerCase().includes(q)
    })
    .sort((a, b) => Number(b.low) - Number(a.low) || (a.cover?.daysOfCover ?? Infinity) - (b.cover?.daysOfCover ?? Infinity) || a.row.product.sku.localeCompare(b.row.product.sku))

  return (
    <>
      <PageHeader title="Inventory" description="Stock by product and warehouse, with the days it will last at the forecast rate of demand." />

      <div className="grid grid--kpi" aria-label="Key figures">
        <KpiCard label="Low stock" value={inventory.isPending ? '…' : lowCount} hint="at or below the reorder level" tone={lowCount > 0 ? 'warning' : undefined} />
        <KpiCard
          label="Pending suggestions"
          value={suggestions.isPending ? '…' : suggestions.isError ? '–' : (suggestions.data?.pagination?.total ?? 0)}
          hint="waiting for a decision"
          tone="ai"
          to="/suggestions"
        />
        <KpiCard
          label="Open anomalies"
          value={anomalies.isPending ? '…' : anomalies.isError ? '–' : (anomalies.data?.pagination?.total ?? 0)}
          hint="not yet reviewed"
          tone={(anomalies.data?.pagination?.total ?? 0) > 0 ? 'warning' : undefined}
          to="/anomalies"
        />
        <KpiCard
          label="Lowest days of cover"
          value={cover.isPending ? '…' : soonest ? `${formatDays(soonest.daysOfCover)} days` : '–'}
          hint={soonest ? `${soonest.sku} · ${soonest.warehouse}` : forecastDown ? 'forecast unavailable' : 'no forecast yet'}
          tone={coverTone(soonest?.daysOfCover) === 'danger' ? 'danger' : undefined}
        />
      </div>

      {forecastDown && (
        <Banner tone="warning">
          Days of cover need the forecasting service, which is not responding. Stock quantities below are current; the days-of-cover column is empty until it is back.
        </Banner>
      )}

      {!latest.isPending && !latest.isError && (
        <TodaySummary
          run={latest.data?.data ?? undefined}
          pendingSuggestions={suggestions.data?.pagination?.total}
          openAnomalies={anomalies.data?.pagination?.total}
          lowStock={inventory.isPending ? undefined : lowCount}
        />
      )}

      <ReorderComparison latest={latest} />

      <Card title="Stock by product and warehouse" flush>
        <div className="filters">
          <div className="field">
            <label htmlFor="search">Search</label>
            <input id="search" className="input" placeholder="SKU or name" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="warehouse">Warehouse</label>
            <select id="warehouse" className="select" value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
              <option value="">All warehouses</option>
              {warehouses.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <label className="row" style={{ paddingBottom: 8 }}>
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
            Low stock only
          </label>
        </div>
        <DataState query={inventory} empty={{ when: rows.length === 0, title: 'No stock records yet', text: 'Stock appears here after the first goods receipt.' }}>
          {visible.length === 0 ? (
            <div className="state"><h3>No stock matches these filters</h3></div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Warehouse</th>
                    <th className="num">On hand</th>
                    <th className="num">Reserved</th>
                    <th className="num">Available</th>
                    <th className="num">Reorder level</th>
                    <th className="num">Days of cover</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ row, available, low, cover: c }) => (
                    <tr key={row.id} className={low ? 'is-flagged' : undefined}>
                      <td>
                        <Link to={`/products/${row.productId}/forecast?warehouseId=${row.warehouseId}`}>{row.product.name}</Link>
                        <div className="table__sub mono">{row.product.sku}</div>
                      </td>
                      <td>{row.warehouse.code}</td>
                      <td className="num">{formatNumber(row.quantity)}</td>
                      <td className="num">{formatNumber(row.reservedQuantity)}</td>
                      <td className="num"><strong>{formatNumber(available)}</strong></td>
                      <td className="num">{formatNumber(row.product.reorderLevel)}</td>
                      <td className="num">
                        {c ? (
                          <Badge tone={coverTone(c.daysOfCover) ?? 'neutral'} title={`Forecast ${formatNumber(c.forecastUnitsPerDay, 1)} units a day`}>
                            {formatDays(c.daysOfCover)} d
                          </Badge>
                        ) : (
                          <span className="faint">–</span>
                        )}
                      </td>
                      <td>{low ? <Badge tone="warning">Low stock</Badge> : <Badge tone="success">OK</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataState>
      </Card>
    </>
  )
}

function ReorderComparison({ latest }: { latest: ReturnType<typeof useLatestRun> }) {
  const series: ReviewSeries[] = (latest.data?.data?.series ?? []).filter((s) => s.reorderPoint !== null)
  // series with an order suggestion come first, then the largest gaps between the two numbers
  const gap = (s: ReviewSeries) => Math.abs((s.reorderPoint ?? 0) - s.staticReorderLevel)
  const ranked = [...series].sort((a, b) => Number(b.decision === 'ORDERED') - Number(a.decision === 'ORDERED') || gap(b) - gap(a)).slice(0, 8)

  return (
    <Card
      ai
      title="Static reorder level vs AI reorder point"
      subtitle="Two different numbers for “when should we reorder”. They are shown side by side so the difference is visible, not hidden."
      flush
    >
      <DataState query={latest} empty={{ when: !latest.data?.data, title: 'No replenishment run yet', text: 'Run replenishment on the Suggestions page to compute the AI reorder points.', action: <Link to="/suggestions">Open suggestions</Link> }}>
        <div className="card__body">
          <p className="muted">
            The static reorder level is a fixed number stored on the product. The AI reorder point is recomputed from the latest demand forecast (demand over the supplier’s lead time plus a safety
            stock for forecast uncertainty), so it moves when demand moves — and is not limited to what someone typed in.
          </p>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Warehouse</th>
                <th className="num">Available</th>
                <th className="num">Static reorder level</th>
                <th className="num">AI reorder point</th>
                <th className="num">Difference</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((s) => {
                const diff = (s.reorderPoint ?? 0) - s.staticReorderLevel

                return (
                  <tr key={`${s.productId}-${s.warehouseId}`}>
                    <td>
                      {s.name}
                      <div className="table__sub mono">{s.sku}</div>
                    </td>
                    <td>{s.warehouse}</td>
                    <td className="num">{formatNumber(s.available)}</td>
                    <td className="num">{formatNumber(s.staticReorderLevel)}</td>
                    <td className="num"><strong>{formatNumber(s.reorderPoint, 1)}</strong></td>
                    <td className="num">{diff > 0 ? '+' : ''}{formatNumber(diff, 1)}</td>
                    <td>
                      <Badge tone={DECISION_TONE[s.decision]}>{DECISION_LABEL[s.decision]}</Badge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="pager">
          Order suggestions first, then the largest gaps · {series.length} series · latest run {latest.data?.data?.asOf} · model {latest.data?.data?.modelVersion}
        </div>
      </DataState>
    </Card>
  )
}
