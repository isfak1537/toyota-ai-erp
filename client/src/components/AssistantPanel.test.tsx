import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '../test/server'
import { envelope, renderApp } from '../test/render'
import { AppRoutes } from '../App'
import type { AssistantAnswer } from '../api/types'

const answer = (over: Partial<AssistantAnswer> = {}): AssistantAnswer => ({ answer: 'SYN-BRK-006 has about 2 days of cover.', unavailable: false, toolCalls: [{ name: 'get_days_of_cover', arguments: {} }], source: 'LLM:groq:openai/gpt-oss-120b', ...over })

// the dashboard sits behind the panel, so its requests need answers too
const dashboard = () =>
  server.use(
    mswHttp.get('*/api/v1/inventory', () => envelope([])),
    mswHttp.get('*/api/v1/ai/days-of-cover', () => envelope({ forecastAvailable: true, items: [] })),
    mswHttp.get('*/api/v1/ai/replenishment/latest', () => envelope(null)),
    mswHttp.get('*/api/v1/ai/suggestions', () => envelope([], { pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } })),
    mswHttp.get('*/api/v1/ai/anomalies', () => envelope([], { pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } })),
  )

const open = async (role: 'VIEWER' | 'ADMIN' = 'VIEWER') => {
  dashboard()
  renderApp(<AppRoutes />, { role })
  await userEvent.click(await screen.findByRole('button', { name: /Ask the assistant/ }))
}

describe('assistant panel (UI-008)', () => {
  it('is closed until asked for, and offers starter questions', async () => {
    dashboard()
    renderApp(<AppRoutes />, { role: 'VIEWER' })

    expect(screen.queryByRole('complementary', { name: 'AI assistant' })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: /Ask the assistant/ }))

    expect(screen.getByRole('complementary', { name: 'AI assistant' })).toBeInTheDocument()
    expect(screen.getByText(/it cannot change anything/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Which products will run out soonest?' })).toBeInTheDocument()
  })

  it('sends the question, shows the answer labelled as AI-written with what it looked at', async () => {
    await open()
    let sent: unknown
    server.use(mswHttp.post('*/api/v1/ai/ask', async ({ request }) => { sent = await request.json(); return envelope(answer()) }))

    await userEvent.type(screen.getByLabelText('Your question'), '  Which products will run out soonest? ')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))

    expect(await screen.findByText('SYN-BRK-006 has about 2 days of cover.')).toBeInTheDocument()
    expect(screen.getByText('AI-written')).toBeInTheDocument()
    expect(screen.getByText(/looked at: days of cover/)).toBeInTheDocument()
    expect(screen.getByText(/groq · openai\/gpt-oss-120b/)).toBeInTheDocument()
    expect(sent).toEqual({ question: 'Which products will run out soonest?' })
    expect(screen.getByLabelText('Your question')).toHaveValue('')
  })

  it('a starter question is sent as it is', async () => {
    await open()
    server.use(mswHttp.post('*/api/v1/ai/ask', () => envelope(answer({ answer: 'Two suggestions are waiting.' }))))

    await userEvent.click(screen.getByRole('button', { name: 'What is waiting for approval?' }))

    expect(await screen.findByText('Two suggestions are waiting.')).toBeInTheDocument()
    expect(screen.getAllByText('What is waiting for approval?').length).toBeGreaterThan(0)
  })

  it('cannot ask an empty question or a second one while the first is running', async () => {
    await open()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    server.use(mswHttp.post('*/api/v1/ai/ask', async () => { await gate; return envelope(answer()) }))

    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Your question'), 'first')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))

    expect(await screen.findByText('Looking it up…')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Your question'), 'second')
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
    release()
    await screen.findByText('SYN-BRK-006 has about 2 days of cover.')
  })

  it('says plainly when the assistant is unavailable, and that nothing else is affected', async () => {
    await open()
    server.use(mswHttp.post('*/api/v1/ai/ask', () => envelope(answer({ answer: null, unavailable: true, toolCalls: [], source: null }))))

    await userEvent.type(screen.getByLabelText('Your question'), 'anything')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))

    expect(await screen.findByText(/not available right now. The rest of the system is not affected/)).toBeInTheDocument()
    expect(screen.queryByText('AI-written')).not.toBeInTheDocument()
  })

  it('shows an error message when the request itself fails', async () => {
    await open()
    server.use(mswHttp.post('*/api/v1/ai/ask', () => HttpResponse.json({ success: false, message: 'question is required' }, { status: 400 })))

    await userEvent.type(screen.getByLabelText('Your question'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))

    expect(await screen.findByText('question is required')).toBeInTheDocument()
  })

  it('closes, and keeps the conversation when reopened', async () => {
    await open()
    server.use(mswHttp.post('*/api/v1/ai/ask', () => envelope(answer())))
    await userEvent.type(screen.getByLabelText('Your question'), 'hello')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await screen.findByText('SYN-BRK-006 has about 2 days of cover.')

    await userEvent.click(screen.getByRole('button', { name: 'Close the assistant' }))
    expect(screen.queryByRole('complementary', { name: 'AI assistant' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Ask the assistant/ }))

    await waitFor(() => expect(screen.getByText('SYN-BRK-006 has about 2 days of cover.')).toBeInTheDocument())
  })
})
