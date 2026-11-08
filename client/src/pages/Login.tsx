import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { ApiError, get } from '../api/client'
import type { Role } from '../api/types'
import { useAuth } from '../auth/auth-context'
import { Logo } from '../components/Logo'
import { Banner, Button, Card } from '../components/ui'
import { Footer } from '../components/Layout'

// One button per seeded demo user. The server signs the session in (POST /auth/demo-login); no password is stored or sent here.
const DEMO_ACCOUNTS: { role: Role; label: string; email: string; note: string }[] = [
  { role: 'ADMIN', label: 'Admin', email: 'admin@demo.synthetic', note: 'everything, models, audit log' },
  { role: 'WAREHOUSE_MANAGER', label: 'Warehouse manager', email: 'warehouse@demo.synthetic', note: 'stock, receipts, anomaly review' },
  { role: 'PROCUREMENT_OFFICER', label: 'Procurement officer', email: 'procurement@demo.synthetic', note: 'runs replenishment, approves suggestions' },
  { role: 'VIEWER', label: 'Viewer', email: 'viewer@demo.synthetic', note: 'read-only' },
]

// Shown in the password field while a demo login runs: dots only, it is not a real password and is never sent.
const DEMO_PASSWORD_DOTS = '••••••••••••'

export default function Login() {
  const { status, login, demoLogin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [demoEnabled, setDemoEnabled] = useState(false)
  const [demoBusy, setDemoBusy] = useState<Role | null>(null)

  // The panel stays hidden unless the server says demo login is on (and when the status call fails).
  useEffect(() => {
    let cancelled = false

    get<{ enabled: boolean }>('/auth/demo-status')
      .then((body) => {
        if (!cancelled) setDemoEnabled(body.data.enabled === true)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  if (status === 'authenticated') return <Navigate to={from} replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusy(true)

    try {
      await login(email.trim(), password)
      navigate(from, { replace: true })
    } catch (e) {
      setPassword('')
      setError(e instanceof ApiError ? (e.status === 429 ? 'Too many attempts. Wait a few minutes and try again.' : e.message) : 'Could not log in.')
    } finally {
      setBusy(false)
    }
  }

  const demo = async (account: (typeof DEMO_ACCOUNTS)[number]) => {
    setError(null)
    setEmail(account.email)
    setPassword(DEMO_PASSWORD_DOTS)
    setDemoBusy(account.role)

    try {
      await demoLogin(account.role)
      navigate(from, { replace: true })
    } catch (e) {
      setPassword('')
      setError(e instanceof ApiError ? (e.status === 404 ? 'Demo login is not available on this server.' : e.status === 429 ? 'Too many attempts. Wait a few minutes and try again.' : e.message) : 'Could not log in.')
    } finally {
      setDemoBusy(null)
    }
  }

  return (
    <div>
      <div className="login">
        <section className="login__hero" aria-label="About this system">
          <Logo size={48} />
          <h1>Inventory and procurement with a human in the loop</h1>
          <p>
            An AI-assisted ERP for an auto-parts business. Models forecast demand and suggest what to order; people approve every purchase. Numbers come from code, and the language model only
            explains them.
          </p>
          <ul>
            <li>Demand forecasts with a stated error</li>
            <li>Replenishment suggestions with every input shown</li>
            <li>Anomaly review, kept apart from confirmed rule hits</li>
          </ul>
        </section>
        <section className="login__panel">
          <div className="login__card stack">
            <Card title="Log in" subtitle={demoEnabled ? 'Use a demo account below, or type your own credentials.' : 'Use a demo account. Ask the project owner for its password.'}>
              <form className="stack" onSubmit={(e) => void submit(e)} noValidate>
                {error && <Banner tone="danger">{error}</Banner>}
                <div className="field">
                  <label htmlFor="email">Email</label>
                  <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div className="field">
                  <label htmlFor="password">Password</label>
                  <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                <Button type="submit" variant="primary" busy={busy} disabled={!email || !password || demoBusy !== null}>
                  Log in
                </Button>
              </form>
            </Card>
            {demoEnabled && (
              <Card title="Demo accounts" subtitle="Click a role to sign in as that demo user. Synthetic data only.">
                <div className="stack login__demo" style={{ gap: 8, marginTop: 0 }}>
                  {DEMO_ACCOUNTS.map((account) => (
                    <Button key={account.role} className="btn--sm" busy={demoBusy === account.role} disabled={demoBusy !== null || busy} onClick={() => void demo(account)}>
                      <span style={{ flex: 1, textAlign: 'left' }}>
                        <strong>{account.label}</strong>
                        <span className="muted"> · {account.email}</span>
                        <br />
                        <span className="faint">{account.note}</span>
                      </span>
                    </Button>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </section>
      </div>
      <Footer />
    </div>
  )
}
