import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '../test/server'
import { demoUser, renderApp } from '../test/render'
import { AppRoutes } from '../App'
import { tokenStore } from '../api/client'

describe('login page (UI-001)', () => {
  it('lists the demo account emails and never a password', () => {
    renderApp(<AppRoutes />, { route: '/login' })

    for (const email of ['admin@demo.synthetic', 'procurement@demo.synthetic', 'warehouse@demo.synthetic', 'viewer@demo.synthetic']) {
      expect(screen.getByText(new RegExp(email))).toBeInTheDocument()
    }

    expect(document.body.textContent).not.toMatch(/password\s*[:=]/i)
    expect(screen.getByText(/Not an official Toyota product/)).toBeInTheDocument()
    expect(screen.getByText(/Synthetic demo data/)).toBeInTheDocument()
  })

  it('selecting a demo account only fills the email', async () => {
    renderApp(<AppRoutes />, { route: '/login' })

    await userEvent.click(screen.getByRole('button', { name: /Warehouse manager/ }))

    expect(screen.getByLabelText('Email')).toHaveValue('warehouse@demo.synthetic')
    expect(screen.getByLabelText('Password')).toHaveValue('')
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
