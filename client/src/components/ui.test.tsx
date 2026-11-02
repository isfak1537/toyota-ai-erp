import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { AiNote, Badge, Button, DataState, ErrorState, KpiCard, Pager, Tabs } from './ui'

describe('shared components', () => {
  it('Button shows a busy state and cannot be clicked while busy', async () => {
    const onClick = vi.fn()
    render(<Button busy onClick={onClick}>Run</Button>)

    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Run' })).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('DataState shows loading, then the error with a retry, then the empty state, then the content', async () => {
    const refetch = vi.fn()
    const { rerender } = render(<DataState query={{ isPending: true, isError: false, error: null, refetch }}>content</DataState>)
    expect(screen.getByRole('status')).toHaveTextContent('Loading')

    rerender(<DataState query={{ isPending: false, isError: true, error: new Error('Server exploded'), refetch }}>content</DataState>)
    expect(screen.getByRole('alert')).toHaveTextContent('Server exploded')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()

    rerender(<DataState query={{ isPending: false, isError: false, error: null, refetch }} empty={{ when: true, title: 'Nothing here', text: 'Add something' }}>content</DataState>)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
    expect(screen.queryByText('content')).not.toBeInTheDocument()

    rerender(<DataState query={{ isPending: false, isError: false, error: null, refetch }} empty={{ when: false, title: 'x' }}>content</DataState>)
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('ErrorState explains a 403 instead of offering a retry', () => {
    render(<ErrorState error={Object.assign(new Error('forbidden'), { status: 403 })} onRetry={() => undefined} />)

    expect(screen.getByText('You do not have access to this')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('Tabs mark the selected tab and call back on change', async () => {
    const onChange = vi.fn()
    render(<Tabs label="Anomalies" active="rule" onChange={onChange} tabs={[{ id: 'rule', label: 'Confirmed rule hits', count: 22 }, { id: 'queue', label: 'Weekly review queue', count: 50 }]} />)

    expect(screen.getByRole('tab', { name: /Confirmed rule hits/ })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: /Weekly review queue/ }))
    expect(onChange).toHaveBeenCalledWith('queue')
  })

  it('Pager disables the ends and pages through', async () => {
    const onPage = vi.fn()
    render(<Pager page={1} totalPages={3} total={52} onPage={onPage} />)

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onPage).toHaveBeenCalledWith(2)
  })

  it('AiNote labels who wrote the text, or says it is unavailable (NFR-013)', () => {
    const { rerender } = render(<AiNote text="Order 80 units." source="LLM:groq:openai/gpt-oss-120b" />)
    expect(screen.getByText('Order 80 units.')).toBeInTheDocument()
    expect(screen.getByText('groq · openai/gpt-oss-120b')).toBeInTheDocument()

    rerender(<AiNote text={null} source={null} />)
    expect(screen.getByText('Explanation unavailable')).toBeInTheDocument()
  })

  it('KpiCard renders a link when given a target', () => {
    render(<MemoryRouter><KpiCard label="Low stock" value={3} hint="items" to="/low" /></MemoryRouter>)

    expect(screen.getByRole('link', { name: /Low stock/ })).toHaveAttribute('href', '/low')
    expect(<Badge>x</Badge>).toBeTruthy()
  })
})
