import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { navFor } from '../lib/nav'
import { roleLabel } from '../lib/permissions'
import { AiBanner } from './AiBanner'
import { AssistantPanel } from './AssistantPanel'
import { ErrorBoundary } from './ErrorBoundary'
import { Logo } from './Logo'
import { Button } from './ui'

export function Footer() {
  return (
    <footer className="footer">
      <span>
        <strong>Synthetic demo data.</strong> Every product, supplier and movement shown here is generated; nothing is real company data.
      </span>
      <span>Not an official Toyota product.</span>
      <span className="spacer" />
      <span>Times in Asia/Dhaka (UTC+6).</span>
    </footer>
  )
}

export function Layout() {
  const { user, logout } = useAuth()
  const items = navFor(user?.role)
  const sections = [...new Set(items.map((item) => item.section))]
  const [assistantOpen, setAssistantOpen] = useState(false)
  const location = useLocation()

  return (
    <div className="shell">
      <a href="#content" className="skip-link">Skip to the content</a>
      <nav className="nav" aria-label="Main">
        <div className="nav__brand">
          <Logo size={34} />
          <span>
            AI ERP
            <small>Inventory &amp; procurement</small>
          </span>
        </div>
        {sections.map((section) => (
          <div key={section}>
            <div className="nav__section">{section}</div>
            {items
              .filter((item) => item.section === section)
              .map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === '/'} className="nav__link">
                  <span className="nav__icon" aria-hidden="true">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
          </div>
        ))}
        <div className="nav__user">
          <strong>{user?.name}</strong>
          {user && roleLabel[user.role]}
          <div>
            <Button size="sm" onClick={logout}>
              Log out
            </Button>
          </div>
        </div>
      </nav>
      <div className={`main${assistantOpen ? ' main--assistant-open' : ''}`}>
        <main id="content" className="main__inner" tabIndex={-1}>
          <div className="stack">
            <AiBanner />
            <ErrorBoundary resetKey={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
        <Footer />
      </div>
      {!assistantOpen && (
        <Button className="assistant-fab" variant="ai" onClick={() => setAssistantOpen(true)}>
          ✦ Ask the assistant
        </Button>
      )}
      <AssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} />
    </div>
  )
}
