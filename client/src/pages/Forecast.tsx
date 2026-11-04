import { useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useInventory, useProductForecast } from '../api/queries'
import type { ForecastResult } from '../api/types'
import { AiChip, Banner, Card, DataState, EmptyState, PageHeader } from '../components/ui'
import { formatDate, formatNumber } from '../lib/format'

const COLORS = {
  actual: 'var(--color-chart-actual)',
  baseline: 'var(--color-chart-baseline)',
  ml: 'var(--color-chart-ml)',
  grid: 'var(--color-chart-grid)',
}

const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

interface Point {
  date: string
  actual?: number
  baseline?: number
  ml?: number
}

export default function Forecast() {
  const { id } = useParams()
  const productId = Number(id)
  const [params, setParams] = useSearchParams()
  const warehouseId = params.get('warehouseId') ? Number(params.get('warehouseId')) : undefined

  const forecast = useProductForecast(productId, warehouseId)
  const inventory = useInventory()
  const stocked = (inventory.data?.data ?? []).filter((row) => row.productId === productId)

  const result: ForecastResult | undefined = forecast.data?.data.results[0]
  const product = forecast.data?.data.product

  return (
    <>
      <PageHeader
        title={product ? product.name : 'Forecast'}
        description={
          product ? (
            <>
              <span className="mono">{product.sku}</span> · 90 days of demand, the next 30 days forecast by two models, and how well each did on days it had not seen.
            </>
          ) : undefined
        }
        actions={
          stocked.length > 1 ? (
            <div className="field">
              <label htmlFor="wh">Warehouse</label>
              <select id="wh" className="select" value={warehouseId ?? stocked[0]?.warehouseId} onChange={(e) => setParams({ warehouseId: e.target.value })}>
                {stocked.map((row) => (
                  <option key={row.warehouseId} value={row.warehouseId}>
                    {row.warehouse.code}
                  </option>
                ))}
              </select>
            </div>
          ) : undefined
        }
      />
      <p>
        <Link to="/">← Back to inventory</Link>
      </p>

      <DataState query={forecast} empty={{ when: !result, title: 'No stock record for this product', text: 'A forecast needs a stock record and demand history.' }}>
        {result && <ForecastBody result={result} modelVersion={forecast.data?.data.modelVersion ?? null} asOf={forecast.data?.data.asOf ?? null} />}
      </DataState>
    </>
  )
}

function ForecastBody({ result, modelVersion, asOf }: { result: ForecastResult; modelVersion: string | null; asOf: string | null }) {
  const data: Point[] = useMemo(() => {
    const points = new Map<string, Point>()

    result.history?.forEach((h) => points.set(h.date, { date: h.date, actual: h.demand }))
    result.forecast?.forEach((f) => points.set(f.date, { ...points.get(f.date), date: f.date, baseline: f.baseline, ml: f.ml ?? undefined }))

    return [...points.values()].sort((a, b) => a.date.localeCompare(b.date))
  }, [result])

  if (result.status !== 'OK' || !result.forecast || !result.metrics) {
    return (
      <EmptyState title="No forecast for this warehouse">
        {result.message ?? 'There is no demand history yet, so no model can forecast it.'}
      </EmptyState>
    )
  }

  const { maeBaseline, maeMl, holdoutDays } = result.metrics
  const better = maeBaseline && maeMl ? (1 - maeMl / maeBaseline) * 100 : null
  const lastActual = result.inputs?.lastActualDate

  return (
    <div className="stack">
      {result.selectedModel === 'BASELINE' && (
        <Banner tone="info">
          This series has fewer than 28 days of history, so the simple moving average is used instead of the machine-learning model (rule AI-003).
        </Banner>
      )}

      <div className="grid grid--two" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
        <Card ai title="Demand history and forecast" subtitle="Units per day. The dashed line is the moving-average baseline; the violet line is the machine-learning model.">
          <figure style={{ margin: 0 }} aria-label="Line chart of daily demand history with baseline and machine-learning forecasts">
            <div style={{ width: '100%', height: 340 }}>
              <ResponsiveContainer>
                <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={COLORS.grid} vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 12, fill: 'var(--color-chart-actual)' }} minTickGap={28} stroke={COLORS.grid} />
                  <YAxis tick={{ fontSize: 12, fill: 'var(--color-chart-actual)' }} stroke={COLORS.grid} width={36} allowDecimals={false} />
                  <Tooltip labelFormatter={(label) => formatDate(String(label))} formatter={(value) => formatNumber(Number(value), 1)} />
                  <Legend verticalAlign="top" height={32} iconType="plainline" />
                  {lastActual && <ReferenceLine x={lastActual} stroke="var(--color-text-faint)" strokeDasharray="2 4" label={{ value: 'forecast starts', position: 'insideTopRight', fontSize: 11, fill: 'var(--color-chart-actual)' }} />}
                  <Line name="Actual demand" dataKey="actual" stroke={COLORS.actual} strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls />
                  <Line name="Baseline (moving average)" dataKey="baseline" stroke={COLORS.baseline} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
                  <Line name="ML model" dataKey="ml" stroke={COLORS.ml} strokeWidth={2.4} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <details style={{ marginTop: 12 }}>
              <summary>Show the forecast as a table</summary>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="num">Baseline</th>
                      <th className="num">ML model</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.forecast.slice(0, 14).map((f) => (
                      <tr key={f.date}>
                        <td>{formatDate(f.date)}</td>
                        <td className="num">{formatNumber(f.baseline, 2)}</td>
                        <td className="num">{f.ml === null ? '–' : formatNumber(f.ml, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </figure>
        </Card>

        <div className="stack">
          <Card title="How accurate is it?" subtitle={`Mean absolute error (units per day) on the last ${holdoutDays} days, which each model had not seen.`}>
            <dl className="facts">
              <dt>Baseline</dt>
              <dd>{maeBaseline === null ? 'n/a' : formatNumber(maeBaseline, 2)}</dd>
              <dt>ML model</dt>
              <dd>{maeMl === null ? 'n/a' : formatNumber(maeMl, 2)}</dd>
              <dt>Used here</dt>
              <dd><AiChip>{result.selectedModel === 'ML' ? 'ML model' : 'Baseline'}</AiChip></dd>
            </dl>
            <p className="muted" style={{ marginTop: 12 }}>
              {better === null
                ? 'No holdout error is available for this series.'
                : better >= 0
                  ? `On this series the ML model was ${formatNumber(better, 1)}% closer than the baseline.`
                  : `On this series the baseline was ${formatNumber(-better, 1)}% closer than the ML model. The model is not always better.`}
            </p>
            <p className="faint" style={{ marginTop: 8, fontSize: 'var(--text-sm)' }}>
              Measured on synthetic data; a single series is a noisy estimate.
            </p>
          </Card>

          <Card title="Inputs" subtitle="What the forecast was built from.">
            <dl className="facts">
              <dt>Expected demand</dt>
              <dd>{formatNumber(result.dailyMean, 2)} units/day</dd>
              <dt>Uncertainty (σ)</dt>
              <dd>{formatNumber(result.sigma, 2)} units/day</dd>
              <dt>History used</dt>
              <dd>{result.inputs?.historyDays} days</dd>
              <dt>Last actual day</dt>
              <dd>{formatDate(result.inputs?.lastActualDate)}</dd>
              <dt>Baseline window</dt>
              <dd>{result.baselineWindow} days</dd>
              <dt>Model version</dt>
              <dd className="mono" style={{ wordBreak: 'break-all' }}>{modelVersion}</dd>
              <dt>Forecast as of</dt>
              <dd>{formatDate(asOf)}</dd>
            </dl>
            {result.notes && result.notes.length > 0 && (
              <ul className="muted" style={{ marginTop: 12, paddingLeft: '1.1em' }}>
                {result.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
