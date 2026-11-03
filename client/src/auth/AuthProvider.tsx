import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { get, post, tokenStore } from '../api/client'
import { onApiEvent } from '../api/events'
import type { User } from '../api/types'
import { AuthContext, type AuthValue } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthValue['status']>(tokenStore.get() ? 'loading' : 'anonymous')

  const logout = useCallback(() => {
    tokenStore.clear()
    setUser(null)
    setStatus('anonymous')
    queryClient.clear() // nothing from the last user stays in memory
  }, [queryClient])

  // restore a session after a reload: the token is checked against the server, never trusted blindly
  useEffect(() => {
    if (!tokenStore.get()) return

    let cancelled = false

    get<User>('/auth/me')
      .then((body) => {
        if (!cancelled) {
          setUser(body.data)
          setStatus('authenticated')
        }
      })
      .catch(() => {
        if (!cancelled) logout()
      })

    return () => {
      cancelled = true
    }
  }, [logout])

  useEffect(() => onApiEvent('unauthorized', logout), [logout])

  const login = useCallback(
    async (email: string, password: string) => {
      const body = await post<{ token: string; user: User }>('/auth/login', { email, password })

      tokenStore.set(body.data.token)
      queryClient.clear()
      setUser(body.data.user)
      setStatus('authenticated')
    },
    [queryClient],
  )

  const value = useMemo<AuthValue>(() => ({ user, status, login, logout }), [user, status, login, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
