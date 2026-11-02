import { Navigate, Outlet, useLocation } from 'react-router'
import { Loading } from '../components/ui'
import { useAuth } from './auth-context'

// Everything except /login needs a session. The location is remembered so login returns there.
export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <Loading label="Checking your session…" />
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />

  return <Outlet />
}
