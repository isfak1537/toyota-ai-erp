import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '../test/server'
import { demoUser, renderApp } from '../test/render'
import { tokenStore } from '../api/client'
import { emitApiEvent } from '../api/events'
import { useAuth } from './auth-context'

function Probe() {
  const { user, status, login, logout } = useAuth()

  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="user">{user ? `${user.name}/${user.role}` : 'nobody'}</p>
      <button onClick={() => void login('a@demo.synthetic', 'pw').catch(() => undefined)}>login</button>
      <button onClick={logout}>logout</button>
    </div>
  )
}

describe('AuthProvider', () => {
  it('starts anonymous without a token', () => {
    renderApp(<Probe />)

    expect(screen.getByTestId('status')).toHaveTextContent('anonymous')
  })

  it('logs in, keeps the token in sessionStorage and exposes the user', async () => {
    server.use(mswHttp.post('*/api/v1/auth/login', () => HttpResponse.json({ success: true, data: { token: 'tok', user: demoUser('VIEWER') } })))
    renderApp(<Probe />)

    await userEvent.click(screen.getByText('login'))

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Demo VIEWER/VIEWER'))
    expect(tokenStore.get()).toBe('tok')
  })

  it('stays anonymous and stores nothing when the login fails', async () => {
    server.use(mswHttp.post('*/api/v1/auth/login', () => HttpResponse.json({ success: false, message: 'Invalid email or password' }, { status: 401 })))
    renderApp(<Probe />)

    await userEvent.click(screen.getByText('login'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'))
    expect(tokenStore.get()).toBeNull()
  })

  it('restores a session after a reload by asking the server who the token belongs to', async () => {
    renderApp(<Probe />, { role: 'PROCUREMENT_OFFICER' })

    expect(screen.getByTestId('status')).toHaveTextContent('loading')
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('PROCUREMENT_OFFICER'))
  })

  it('drops a stored token the server no longer accepts', async () => {
    tokenStore.set('stale')
    server.use(mswHttp.get('*/api/v1/auth/me', () => HttpResponse.json({ success: false, message: 'Invalid or expired token' }, { status: 401 })))
    renderApp(<Probe />)

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'))
    expect(tokenStore.get()).toBeNull()
  })

  it('logs out on demand and when any request reports the session is over', async () => {
    renderApp(<Probe />, { role: 'ADMIN' })
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    await userEvent.click(screen.getByText('logout'))
    expect(screen.getByTestId('status')).toHaveTextContent('anonymous')
    expect(tokenStore.get()).toBeNull()

    server.use(mswHttp.post('*/api/v1/auth/login', () => HttpResponse.json({ success: true, data: { token: 'tok2', user: demoUser('ADMIN') } })))
    await userEvent.click(screen.getByText('login'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    emitApiEvent('unauthorized')
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'))
  })
})
