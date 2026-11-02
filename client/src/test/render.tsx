import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { AuthProvider } from '../auth/AuthProvider'
import { tokenStore } from '../api/client'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from './server'
import type { Role, User } from '../api/types'

export const makeQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })

export const demoUser = (role: Role = 'ADMIN'): User => ({ id: 1, name: `Demo ${role}`, email: `${role.toLowerCase()}@demo.synthetic`, role })

// Registers /auth/me for a logged-in user and stores a token, like a reloaded session.
export const signIn = (role: Role = 'ADMIN') => {
  tokenStore.set('test-token')
  server.use(mswHttp.get('*/api/v1/auth/me', () => HttpResponse.json({ success: true, data: demoUser(role) })))
}

export const envelope = <T,>(data: T, extra: Record<string, unknown> = {}) => HttpResponse.json({ success: true, data, ...extra })

export function renderApp(ui: ReactElement, { route = '/', role }: { route?: string; role?: Role } = {}) {
  if (role) signIn(role)

  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
