import { Fragment, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { post } from '../api/client'
import { useModelRuns } from '../api/queries'
import type { ModelRun } from '../api/types'
import { Badge, Banner, Button, Card, DataState, PageHeader } from '../components/ui'
import { formatDateTime, formatNumber } from '../lib/format'

type Metrics = Record<string, unknown>
const num = (value: unknown) => (typeof value === 'number' ? value : undefined)
const at = (obj: unknown, ...path: string[]): unknown => path.reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Metrics)[k] : undefined), obj)

// A few headline figures per model type; the full metrics are one click away.
function headline(run: ModelRun): [string, string][] {
  const m = run.metrics as Metrics

  if (run.modelType === 'FORECAST') {
    const base = num(at(m, 'overall', 'baseline', 'macro_mae'))
    const policy = num(at(m, 'overall', 'policy', 'macro_mae'))

    return [
      ['Baseline error (MAE)', base === undefined ? '–' : formatNumber(base, 2)],
      ['Model in use (MAE)', policy === undefined ? '–' : formatNumber(policy, 2)],
      ['Series evaluated', formatNumber(num(at(m, 'overall', 'policy', 'series')))],
      ['As of', String(m.as_of ?? '–').slice(0, 10)],
    ]
  }

  return [
    ['Movements', formatNumber(num(m.transactions))],
    ['Eligible for the queue', formatNumber(num(m.eligible_transactions))],
    ['Flagged (rules or queue)', formatNumber(num(m.flagged))],
    ['As of', String(m.as_of ?? '–').slice(0, 10)],
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
              {headline(run).map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p className="faint" style={{ marginTop: 12, fontSize: 'var(--text-sm)' }}>
              {run.modelType === 'FORECAST' ? 'Measured on synthetic data over a 14-day holdout.' : 'Labels are never used for training; the rules and the queue are evaluated separately against injected anomalies.'}
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
