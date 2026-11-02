import type { ReactNode } from 'react'
import { ErrorState } from '../components/ui'
import { can, type Capability } from '../lib/permissions'
import { useAuth } from './auth-context'

// Hides a whole page from roles that may not use it. The API refuses them anyway; this only avoids
// showing a page that could never load.
export function RequireCapability({ capability, children }: { capability: Capability; children: ReactNode }) {
  const { user } = useAuth()

  if (!can(user?.role, capability)) {
    return <ErrorState error={Object.assign(new Error('Not allowed'), { status: 403 })} />
  }

  return <>{children}</>
}
