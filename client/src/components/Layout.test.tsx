import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '../test/server'
import { renderApp } from '../test/render'
import { AppRoutes } from '../App'
import { get } from '../api/client'
import { tokenStore } from '../api/client'

describe('app shell', () => {
  it('sends an anonymous visitor to the login page and remembers nothing', async () => {
    renderApp(<AppRoutes />, { route: '/ledger' })

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
  })

  it('shows the user, their role label and the synthetic-data footer', async () => {
    renderApp(<AppRoutes />, { role: 'WAREHOUSE_MANAGER' })

    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByText('Demo WAREHOUSE_MANAGER')).toBeInTheDocument()
    expect(within(nav).getByText('Warehouse manager')).toBeInTheDocument()
    expect(screen.getByText(/Not an official Toyota product/)).toBeInTheDocument()
    expect(screen.getByText(/nothing is real company data/)).toBeInTheDocument()
  })

  it('puts the assistant launcher in the menu, not floating over the page content', async () => {
    renderApp(<AppRoutes />, { role: 'VIEWER' })

    const nav = await screen.findByRole('navigation', { name: 'Main' })
    const launcher = within(nav).getByRole('button', { name: /Ask the assistant/ })

    expect(screen.getAllByRole('button', { name: /Ask the assistant/ })).toHaveLength(1)
    expect(launcher.closest('main')).toBeNull()
    expect(document.querySelector('.assistant-fab')).toBeNull()
  })

  it('logging out returns to the login page and clears the token', async () => {
    renderApp(<AppRoutes />, { role: 'ADMIN' })

    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }))

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(tokenStore.get()).toBeNull()
  })

  it('shows a page for an unknown address', async () => {
    renderApp(<AppRoutes />, { route: '/nowhere', role: 'ADMIN' })

    expect(await screen.findByText('Page not found')).toBeInTheDocument()
  })

  it('a request that loses the session sends the user back to login (401)', async () => {
    renderApp(<AppRoutes />, { role: 'ADMIN' })
    await screen.findByRole('navigation', { name: 'Main' })
    server.use(mswHttp.get('*/api/v1/anything', () => HttpResponse.json({ success: false, message: 'Invalid or expired token' }, { status: 401 })))

    await get('/anything').catch(() => undefined)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument())
  })

  it('a 503 from an AI route shows the banner, and the next AI success removes it', async () => {
    renderApp(<AppRoutes />, { role: 'ADMIN' })
    await screen.findByRole('navigation', { name: 'Main' })
    server.use(
      mswHttp.get('*/api/v1/ai/forecast/1', () => HttpResponse.json({ success: false, message: 'AI service is unavailable' }, { status: 503 })),
      mswHttp.get('*/api/v1/ai/models', () => HttpResponse.json({ success: true, data: [] })),
    )

    await get('/ai/forecast/1').catch(() => undefined)
    expect(await screen.findByText(/The AI service is not responding/)).toBeInTheDocument()
    expect(screen.getByText(/Inventory, procurement and the\s+ledger are not affected/)).toBeInTheDocument()

    await get('/ai/models')
    await waitFor(() => expect(screen.queryByText(/The AI service is not responding/)).not.toBeInTheDocument())
  })
})

describe('accessibility basics', () => {
  it('has a skip link, a main landmark and a title per page', async () => {
    renderApp(<AppRoutes />, { role: 'ADMIN' })

    expect(await screen.findByRole('link', { name: 'Skip to the content' })).toHaveAttribute('href', '#content')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'content')
    await waitFor(() => expect(document.title).toBe('Inventory · AI ERP (synthetic demo)'))
  })
})
