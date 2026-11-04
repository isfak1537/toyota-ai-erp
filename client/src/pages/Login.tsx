import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/auth-context'
import { Logo } from '../components/Logo'
import { Banner, Button, Card } from '../components/ui'
import { Footer } from '../components/Layout'

// The demo accounts exist only in the synthetic demo database. Only their addresses are shown, never a password.
const DEMO_ACCOUNTS = [
  { email: 'admin@demo.synthetic', role: 'Administrator', note: 'everything, models, audit log' },
  { email: 'procurement@demo.synthetic', role: 'Procurement officer', note: 'runs replenishment, approves suggestions' },
  { email: 'warehouse@demo.synthetic', role: 'Warehouse manager', note: 'stock, receipts, anomaly review' },
  { email: 'viewer@demo.synthetic', role: 'Viewer', note: 'read-only' },
]

export default function Login() {
  const { status, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
            <Card title="Log in" subtitle="Use a demo account. Ask the project owner for its password.">
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
                <Button type="submit" variant="primary" busy={busy} disabled={!email || !password}>
                  Log in
                </Button>
              </form>
            </Card>
            <Card title="Demo accounts" subtitle="Select one to fill in the email.">
              <div className="stack login__demo" style={{ gap: 8, marginTop: 0 }}>
                {DEMO_ACCOUNTS.map((account) => (
                  <Button key={account.email} className="btn--sm" onClick={() => setEmail(account.email)}>
                    <span style={{ flex: 1, textAlign: 'left' }}>
                      <strong>{account.role}</strong>
                      <span className="muted"> · {account.email}</span>
                      <br />
                      <span className="faint">{account.note}</span>
                    </span>
                  </Button>
                ))}
              </div>
            </Card>
          </div>
        </section>
      </div>
      <Footer />
    </div>
  )
}
