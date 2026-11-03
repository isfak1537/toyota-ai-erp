import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ErrorBoundary } from './ErrorBoundary'

function Bomb({ explode }: { explode: boolean }) {
  if (explode) throw new Error('boom')

  return <p>all good</p>
}

describe('error boundary', () => {
  it('replaces a crashed page with a message instead of a blank screen, and can recover', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    function Harness() {
      const [explode, setExplode] = useState(true)

      return (
        <>
          <button onClick={() => setExplode(false)}>fix it</button>
          <ErrorBoundary>
            <Bomb explode={explode} />
          </ErrorBoundary>
        </>
      )
    }
    render(<Harness />)

    expect(screen.getByRole('alert')).toHaveTextContent('This page ran into a problem')
    expect(screen.getByRole('link', { name: 'Go to inventory' })).toHaveAttribute('href', '/')

    await userEvent.click(screen.getByRole('button', { name: 'fix it' }))
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('all good')).toBeInTheDocument()
  })

  it('clears the error when the user moves to another page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { rerender } = render(<ErrorBoundary resetKey="/a"><Bomb explode /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toBeInTheDocument()

    rerender(<ErrorBoundary resetKey="/b"><Bomb explode={false} /></ErrorBoundary>)

    expect(screen.getByText('all good')).toBeInTheDocument()
  })
})
