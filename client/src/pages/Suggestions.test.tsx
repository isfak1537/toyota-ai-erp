import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '../test/server'
import { envelope, renderApp } from '../test/render'
import { latestRun, suggestion } from '../test/fixtures'
import { AppRoutes } from '../App'
import type { Role } from '../api/types'

const pageOf = (n: number) => ({ pagination: { page: 1, pageSize: 20, total: n, totalPages: 1 } })

const serve = (list = [suggestion()], latest: unknown = latestRun) =>
  server.use(
    mswHttp.get('*/api/v1/ai/suggestions', ({ request }) => {
      const status = new URL(request.url).searchParams.get('status')

      return envelope(list.filter((s) => !status || s.status === status), pageOf(list.length))
    }),
    mswHttp.get('*/api/v1/ai/replenishment/latest', () => envelope(latest)),
  )

const open = async (role: Role = 'PROCUREMENT_OFFICER') => {
  renderApp(<AppRoutes />, { route: '/suggestions', role })
  await userEvent.click(await screen.findByRole('button', { name: 'Review' }))
}

describe('suggestions page (UI-004)', () => {
  it('lists pending suggestions and shows every input behind the number, with the AI label', async () => {
    serve()
    await open()

    expect(screen.getByText('Computed by the replenishment formula from the values on the right, not by the language model.')).toBeInTheDocument()
    const detail = screen.getByText('Why this quantity').closest('div')!.parentElement!
    expect(within(detail).getByText(/3.00 units\/day/)).toBeInTheDocument()
    expect(within(detail).getByText('40.5')).toBeInTheDocument()
    expect(within(detail).getByText(/forecast-20261101-abc/)).toBeInTheDocument()
    expect(screen.getByText(/Stock of 9 is below the reorder point/)).toBeInTheDocument()
    expect(screen.getByText('groq · openai/gpt-oss-120b')).toBeInTheDocument()
  })

  it('shows "explanation unavailable" and lets an officer try again, without hiding the suggestion', async () => {
    serve([suggestion({ explanation: null, explanationSource: null })])
    server.use(mswHttp.post('*/api/v1/ai/suggestions/7/explain', () => envelope({ explanation: null, explanationSource: null })))
    await open()

    expect(screen.getByText('Explanation unavailable')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try to generate an explanation' }))

    expect(await screen.findByText(/The language model did not answer; the suggestion is unaffected/)).toBeInTheDocument()
    expect(screen.getByText('Why this quantity')).toBeInTheDocument()
  })

  it('approval needs a confirmation and reports the draft requisition it created', async () => {
    serve()
    let calls = 0
    server.use(
      mswHttp.post('*/api/v1/ai/suggestions/7/approve', () => {
        calls += 1

        return envelope({ suggestion: suggestion({ status: 'APPROVED' }), requisition: { id: 4, requisitionNumber: 'PR-1001', status: 'DRAFT' }, idempotent: false })
      }),
    )
    await open()

    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    expect(calls).toBe(0) // nothing is sent before the confirmation
    expect(screen.getByRole('group', { name: 'Confirm approval' })).toHaveTextContent(/draft requisition.*60 pcs.*Orient Parts Co/)

    await userEvent.click(screen.getByRole('button', { name: 'Create draft requisition' }))

    expect(await screen.findByText('PR-1001')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue in procurement' })).toHaveAttribute('href', '/procurement')
    expect(calls).toBe(1)
    expect(screen.queryByRole('button', { name: 'Approve…' })).not.toBeInTheDocument()
  })

  it('tells the user when the suggestion had already been approved (idempotent repeat)', async () => {
    serve()
    server.use(mswHttp.post('*/api/v1/ai/suggestions/7/approve', () => envelope({ suggestion: suggestion({ status: 'APPROVED' }), requisition: { id: 4, requisitionNumber: 'PR-1001', status: 'DRAFT' }, idempotent: true })))
    await open()

    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create draft requisition' }))

    expect(await screen.findByText(/Already approved earlier/)).toBeInTheDocument()
  })

  it('a 409 on approval is shown and the list is refreshed', async () => {
    serve()
    server.use(mswHttp.post('*/api/v1/ai/suggestions/7/approve', () => HttpResponse.json({ success: false, message: 'Only PENDING suggestions can be approved (this one is EXPIRED)' }, { status: 409 })))
    await open()

    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create draft requisition' }))

    expect(await screen.findByText(/this one is EXPIRED.*The list has been refreshed/)).toBeInTheDocument()
  })

  it('rejecting needs a reason, which is sent to the API', async () => {
    serve()
    let body: unknown
    server.use(mswHttp.post('*/api/v1/ai/suggestions/7/reject', async ({ request }) => {
      body = await request.json()

      return envelope({ suggestion: suggestion({ status: 'REJECTED', rejectReason: 'Seasonal dip' }), idempotent: false })
    }))
    await open()

    await userEvent.click(screen.getByRole('button', { name: 'Reject…' }))
    expect(screen.getByRole('button', { name: 'Reject suggestion' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText(/Reason for rejecting/), '  Seasonal dip ')
    await userEvent.click(screen.getByRole('button', { name: 'Reject suggestion' }))

    expect(await screen.findByText(/Rejected: Seasonal dip/)).toBeInTheDocument()
    expect(body).toEqual({ reason: 'Seasonal dip' })
  })

  it.each<Role>(['VIEWER', 'WAREHOUSE_MANAGER'])('%s sees the suggestion but no way to run, approve or reject', async (role) => {
    serve()
    renderApp(<AppRoutes />, { route: '/suggestions', role })
    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))

    expect(screen.queryByRole('button', { name: 'Run replenishment' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve…' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject…' })).not.toBeInTheDocument()
    expect(screen.getByText(/Only a procurement officer or administrator can approve or reject/)).toBeInTheDocument()
  })

  it('runs replenishment, reports the counts and refreshes the list', async () => {
    serve([])
    server.use(mswHttp.post('*/api/v1/ai/replenishment/run', () => envelope({ counts: { suggested: 1, notNeeded: 20, coveredByOnOrder: 5, skipped: 1, explained: 1 }, suggestions: [] })))
    renderApp(<AppRoutes />, { route: '/suggestions', role: 'PROCUREMENT_OFFICER' })

    expect(await screen.findByText('No suggestions waiting')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Run replenishment' }))

    expect(await screen.findByText(/Run complete: 1 suggested, 20 not needed, 5 covered by open orders, 1 skipped. 1 explanation/)).toBeInTheDocument()
  })

  it('shows why a run failed, e.g. when the AI service is down', async () => {
    serve([])
    server.use(mswHttp.post('*/api/v1/ai/replenishment/run', () => HttpResponse.json({ success: false, message: 'AI service is unavailable' }, { status: 503 })))
    renderApp(<AppRoutes />, { route: '/suggestions', role: 'ADMIN' })

    await userEvent.click(await screen.findByRole('button', { name: 'Run replenishment' }))

    expect(await screen.findAllByText('AI service is unavailable')).not.toHaveLength(0)
  })

  it('filters by status', async () => {
    serve([suggestion(), suggestion({ id: 8, status: 'APPROVED' })])
    renderApp(<AppRoutes />, { route: '/suggestions', role: 'ADMIN' })
    await screen.findByText('Headlamp Assembly')
    expect(screen.getAllByRole('button', { name: 'Review' })).toHaveLength(1)

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'All')

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Review' })).toHaveLength(2))
  })
})

describe('replenishment review tab', () => {
  const openReview = async (latest: unknown = latestRun) => {
    serve([], latest)
    renderApp(<AppRoutes />, { route: '/suggestions?tab=review', role: 'VIEWER' })
  }

  it('lists every evaluated series with decision, reason and the numbers, orders first', async () => {
    await openReview()

    const rows = await screen.findAllByRole('row')
    expect(rows).toHaveLength(5) // header + 4 series
    expect(rows[1]).toHaveTextContent('Headlamp Assembly')
    expect(rows[1]).toHaveTextContent('Order suggested')
    expect(rows[1]).toHaveTextContent(/at or below the reorder point 40.5; suggesting 60 units/)
    expect(rows[1]).toHaveTextContent('40.5')
    expect(rows[1]).toHaveTextContent('3.0') // days of cover
    expect(rows[1]).toHaveTextContent('60')

    expect(rows[2]).toHaveTextContent('Covered by open orders')
    expect(rows[2]).toHaveTextContent('90Destination') // onOrder with its method
    expect(rows[1]).toHaveTextContent('SYN-ELE-003 · SYN-MAIN') // warehouse sits under the product
    expect(rows[3]).toHaveTextContent('Skipped')
    expect(rows[3]).toHaveTextContent(/no forecast/)
    expect(rows[4]).toHaveTextContent('No order needed')
  })

  it('filters by decision and shows the run it comes from', async () => {
    await openReview()
    await screen.findAllByRole('row')

    await userEvent.selectOptions(screen.getByLabelText('Decision'), 'Skipped (1)')

    expect(screen.getAllByRole('row')).toHaveLength(2)
    expect(screen.getByText(/forecast-20261101-abc/)).toBeInTheDocument()
    expect(screen.getByText(/service level z = 1.65, review 7 days/)).toBeInTheDocument()
  })

  it('has an empty state before the first run', async () => {
    await openReview(null)

    expect(await screen.findByText('No replenishment run yet')).toBeInTheDocument()
  })

  it('the tab count shows how many series were evaluated', async () => {
    await openReview()

    expect(await screen.findByRole('tab', { name: /Replenishment review\s*4/ })).toBeInTheDocument()
  })
})
