import { createContext, useContext } from 'react'
import type { Role, User } from '../api/types'

export interface AuthValue {
  user: User | null
  status: 'loading' | 'authenticated' | 'anonymous'
  login: (email: string, password: string) => Promise<void>
  demoLogin: (role: Role) => Promise<void>
  logout: () => void
}

export const AuthContext = createContext<AuthValue | null>(null)

export const useAuth = (): AuthValue => {
  const value = useContext(AuthContext)

  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>')
  }

  return value
}
