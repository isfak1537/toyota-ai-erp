import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '../test/server'
import { demoUser, renderApp } from '../test/render'
import { AppRoutes } from '../App'
import { tokenStore } from '../api/client'

const demoStatus = (enabled: boolean) => server.use(mswHttp.get('*/api/v1/auth/demo-status', () => HttpResponse.json({ success: true, data: { enabled } })))

describe('login page (UI-001)', () => {
  beforeEach(() => demoStatus(true))

  it('shows four demo buttons and never a password', async () => {
    renderApp(<AppRoutes />, { route: '/login' })

    for (const name of ['Admin', 'Warehouse manager', 'Procurement officer', 'Viewer']) {
      expect(await screen.findByRole('button', { name: new RegExp(name) })).toBeInTheDocument()
    }

    expect(document.body.textContent).not.toMatch(/password\s*[:=]/i)
    expect(screen.getByText(/Not an official Toyota product/)).toBeInTheDocument()
    expect(screen.getByText(/Synthetic demo data/)).toBeInTheDocument()
  })

  it('clicking a demo button fills the email, shows dots, logs in and opens the app', async () => {
    let body: unknown
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))

    server.use(
      mswHttp.post('*/api/v1/auth/demo-login', async ({ request }) => {
        body = await request.json()
        await gate

        return HttpResponse.json({ success: true, data: { token: 'demo-tok', user: demoUser('WAREHOUSE_MANAGER') } })
      }),
    )
    renderApp(<AppRoutes />, { route: '/login' })

    await userEvent.click(await screen.findByRole('button', { name: /Warehouse manager/ }))

    expect(screen.getByLabelText('Email')).toHaveValue('warehouse@demo.synthetic')
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('Password')).toHaveValue('••••••••••••')
    expect(screen.getByRole('button', { name: /Warehouse manager/ })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: /Viewer/ })).toBeDisabled()

    release()

    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument())
    expect(body).toEqual({ role: 'WAREHOUSE_MANAGER' })
    expect(tokenStore.get()).toBe('demo-tok')
  })

  it('shows a clear error when demo login fails and clears the dots', async () => {
    server.use(mswHttp.post('*/api/v1/auth/demo-login', () => HttpResponse.json({ success: false, message: 'Not found' }, { status: 404 })))
    renderApp(<AppRoutes />, { route: '/login' })

    await userEvent.click(await screen.findByRole('button', { name: /Viewer/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Demo login is not available on this server.')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(tokenStore.get()).toBeNull()
    expect(screen.getByRole('button', { name: /Viewer/ })).toBeEnabled()
  })

  it('hides the whole demo panel when the server reports demo login is disabled', async () => {
    demoStatus(false)
    renderApp(<AppRoutes />, { route: '/login' })

    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Demo accounts')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Warehouse manager/ })).not.toBeInTheDocument()
  })

  it('hides the demo panel when the status call fails', async () => {
    server.use(mswHttp.get('*/api/v1/auth/demo-status', () => HttpResponse.json({ success: false }, { status: 500 })))
    renderApp(<AppRoutes />, { route: '/login' })

    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument()
    expect(screen.queryByText('Demo accounts')).not.toBeInTheDocument()
  })

  it('keeps the button off until both fields are filled', async () => {
    renderApp(<AppRoutes />, { route: '/login' })

    expect(screen.getByRole('button', { name: 'Log in' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Email'), 'a@demo.synthetic')
    expect(screen.getByRole('button', { name: 'Log in' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Password'), 'x')
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled()
  })

  it('logs in and lands where the user was heading', async () => {
    server.use(mswHttp.post('*/api/v1/auth/login', () => HttpResponse.json({ success: true, data: { token: 'tok', user: demoUser('PROCUREMENT_OFFICER') } })))
    renderApp(<AppRoutes />, { route: '/login' })

    await userEvent.type(screen.getByLabelText('Email'), 'procurement@demo.synthetic')
    await userEvent.type(screen.getByLabelText('Password'), 'whatever-pw-123')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))

    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument())
    expect(tokenStore.get()).toBe('tok')
  })

  it('shows the server message for a wrong password and clears the password field', async () => {
    server.use(mswHttp.post('*/api/v1/auth/login', () => HttpResponse.json({ success: false, message: 'Invalid email or password' }, { status: 401 })))
    renderApp(<AppRoutes />, { route: '/login' })

    await userEvent.type(screen.getByLabelText('Email'), 'a@demo.synthetic')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(tokenStore.get()).toBeNull()
  })

  it('says to wait after too many attempts (429)', async () => {
    server.use(mswHttp.post('*/api/v1/auth/login', () => HttpResponse.json({ success: false, message: 'Too many login attempts, try again later' }, { status: 429 })))
    renderApp(<AppRoutes />, { route: '/login' })

    await userEvent.type(screen.getByLabelText('Email'), 'a@demo.synthetic')
    await userEvent.type(screen.getByLabelText('Password'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Wait a few minutes/)
  })

  it('an already logged-in user is sent on to the app', async () => {
    renderApp(<AppRoutes />, { route: '/login', role: 'ADMIN' })

    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument())
  })
})
