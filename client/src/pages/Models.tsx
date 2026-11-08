import { Fragment, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { post } from '../api/client'
import { useModelRuns } from '../api/queries'
import type { ModelRun } from '../api/types'
import { Badge, Banner, Button, Card, DataState, PageHeader } from '../components/ui'
import { formatDate, formatDateTime, formatNumber } from '../lib/format'

type Metrics = Record<string, unknown>
const num = (value: unknown) => (typeof value === 'number' ? value : undefined)
const at = (obj: unknown, ...path: string[]): unknown => path.reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Metrics)[k] : undefined), obj)

// A few headline figures per model type; the full metrics are one click away. Each has a hint (tooltip) that says exactly what it is.
function headline(run: ModelRun): [string, string, string][] {
  const m = run.metrics as Metrics

  if (run.modelType === 'FORECAST') {
    const base = num(at(m, 'overall', 'baseline', 'macro_mae'))
    const policy = num(at(m, 'overall', 'policy', 'macro_mae'))
    const series = num(at(m, 'overall', 'policy', 'series'))
    const withMl = num(m.policy_ml)
    const baselineOnly = num(m.policy_baseline)
    const days = num(m.holdout_days)
    const window = m.holdout_start && m.holdout_end ? `${formatDate(String(m.holdout_start))} to ${formatDate(String(m.holdout_end))}${days ? ` (${days} days)` : ''}` : '–'
    const mean = 'Mean absolute error of the daily forecast, in units per day, over the holdout window. Every series counts equally, including series with no ML forecast.'

    return [
      ['Baseline error (MAE, units/day)', base === undefined ? '–' : formatNumber(base, 2), `Moving-average baseline. ${mean}`],
      ['Model in use (MAE, units/day)', policy === undefined ? '–' : formatNumber(policy, 2), `The forecast the app uses (ML where a series has enough history, else the baseline). ${mean}`],
      [
        'Series averaged',
        series === undefined ? '–' : withMl !== undefined && baselineOnly ? `${formatNumber(series)} (${formatNumber(withMl)} with ML, ${formatNumber(baselineOnly)} baseline only)` : formatNumber(series),
        'The errors above are averaged over all of these series. ai-service/REPORT.md averages only the series that have an ML forecast, so its figures differ.',
      ],
      ['Holdout window', window, 'The last days of history, kept out of training and used only to score the forecasts.'],
      ['As of', String(m.as_of ?? '–').slice(0, 10), 'The last day of data the model saw.'],
    ]
  }

  return [
    ['Movements', formatNumber(num(m.transactions)), 'Stock movements in the ledger the model was trained on.'],
    ['Eligible for the queue', formatNumber(num(m.eligible_transactions)), 'Movements the anomaly model scores.'],
    ['Flagged (rules or queue)', formatNumber(num(m.flagged)), 'Movements flagged by a rule or by the weekly review queue.'],
    ['As of', String(m.as_of ?? '–').slice(0, 10), 'The last day of data the model saw.'],
  ]
}

export default function Models() {
  const runs = useModelRuns()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [open, setOpen] = useState<number | null>(null)

  const retrain = useMutation({
    mutationFn: async () => (await post<ModelRun[]>('/ai/models/retrain', {})).data,
    onSuccess: () => {
      setConfirming(false)
      void queryClient.invalidateQueries({ queryKey: ['model-runs'] })
    },
  })

  const rows = runs.data?.data ?? []
  const active = rows.filter((r) => r.isActive)

  return (
    <>
      <PageHeader
        title="AI models"
        description="The trained models behind the forecasts and the anomaly queue, and how they did on data they had not seen."
        actions={!confirming && <Button variant="ai" onClick={() => setConfirming(true)}>Retrain models…</Button>}
      />
      {confirming && (
        <Banner tone="warning">
          <div className="stack" role="group" aria-label="Confirm retraining">
            <span>Retraining reads the latest stock history, trains and evaluates new versions, and switches to them only when they are ready. The current models keep serving meanwhile. It takes a few seconds on this data.</span>
            <div className="row">
              <Button variant="ai" busy={retrain.isPending} onClick={() => retrain.mutate()}>Retrain now</Button>
              <Button onClick={() => setConfirming(false)}>Cancel</Button>
            </div>
          </div>
        </Banner>
      )}
      {retrain.isError && <Banner tone="danger">{retrain.error instanceof Error ? retrain.error.message : 'Retraining failed.'}</Banner>}
      {retrain.isSuccess && <Banner tone="ai">Trained {retrain.data.length} model(s): {retrain.data.map((r) => r.version).join(', ')}.</Banner>}

      <div className="grid grid--two">
        {active.map((run) => (
          <Card key={run.id} ai title={run.modelType === 'FORECAST' ? 'Demand forecast model' : 'Anomaly model'} subtitle={<span className="mono">{run.version}</span>}>
            <dl className="facts">
              {headline(run).map(([k, v, hint]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt title={hint}>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p className="faint" style={{ marginTop: 12, fontSize: 'var(--text-sm)' }}>
              {run.modelType === 'FORECAST' ? 'Measured on synthetic data over a 14-day holdout. Errors are means over all series listed above; the evaluation report averages only series with an ML forecast, so its figures differ (see ai-service/REPORT.md).' : 'Labels are never used for training; the rules and the queue are evaluated separately against injected anomalies.'}
            </p>
          </Card>
        ))}
      </div>

      <Card title="All training runs" flush>
        <DataState query={runs} empty={{ when: rows.length === 0, title: 'No model has been trained yet', text: 'Retrain to create the first versions.' }}>
          <div className="table-wrap">
            <table className="table table--dense">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Version</th>
                  <th>Trained</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((run) => (
                  <Fragment key={run.id}>
                    <tr>
                      <td>{run.modelType === 'FORECAST' ? 'Forecast' : 'Anomaly'}</td>
                      <td className="mono">{run.version}</td>
                      <td className="faint">{formatDateTime(run.trainedAt)}</td>
                      <td>{run.isActive ? <Badge tone="success">Active</Badge> : <Badge>Superseded</Badge>}</td>
                      <td><Button size="sm" aria-expanded={open === run.id} onClick={() => setOpen(open === run.id ? null : run.id)}>{open === run.id ? 'Hide metrics' : 'Metrics'}</Button></td>
                    </tr>
                    {open === run.id && (
                      <tr>
                        <td colSpan={5} style={{ background: 'var(--color-surface-muted)' }}>
                          <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto' }}>{JSON.stringify(run.metrics, null, 2)}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </Card>
    </>
  )
}
