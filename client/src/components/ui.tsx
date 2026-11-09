import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router'
import { useTitle } from '../lib/useTitle'

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'ai'

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge--${tone}`} title={title}>
      {children}
    </span>
  )
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ai' | 'danger' | 'ghost'
  size?: 'md' | 'sm'
  busy?: boolean
}

export function Button({ variant = 'default', size = 'md', busy = false, children, disabled, className = '', ...rest }: ButtonProps) {
  const classes = ['btn', variant !== 'default' && `btn--${variant}`, size === 'sm' && 'btn--sm', className].filter(Boolean).join(' ')

  return (
    <button type="button" className={classes} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} aria-hidden="true" />}
      {children}
    </button>
  )
}

export function LinkButton({ variant = 'default', size = 'md', ...rest }: LinkProps & { variant?: 'default' | 'primary'; size?: 'md' | 'sm' }) {
  return <Link className={['btn', variant === 'primary' && 'btn--primary', size === 'sm' && 'btn--sm'].filter(Boolean).join(' ')} {...rest} />
}

export function Card({ title, subtitle, actions, children, flush = false, ai = false }: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  flush?: boolean
  ai?: boolean
}) {
  return (
    <section className={`card${ai ? ' card--ai' : ''}`}>
      {(title || actions) && (
        <header className="card__header">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="spacer" />}
          {actions}
        </header>
      )}
      <div className={flush ? 'card__body card__body--flush' : 'card__body'}>{children}</div>
    </section>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  useTitle(title)

  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </div>
  )
}

export function KpiCard({ label, value, hint, tone, to }: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'warning' | 'danger' | 'ai'
  to?: string
}) {
  const body = (
    <>
      <span className="kpi__label">{label}</span>
      <span className="kpi__value">{value}</span>
      {hint && <span className="kpi__hint">{hint}</span>}
    </>
  )
  const className = `card kpi${tone ? ` kpi--${tone}` : ''}`

  return to ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

export function Banner({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'danger' | 'ai'; children: ReactNode }) {
  return (
    <div className={`banner banner--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const status = (error as { status?: number })?.status
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  const forbidden = status === 403

  return (
    <div className="state state--error" role="alert">
      <h3>{forbidden ? 'You do not have access to this' : 'Could not load this'}</h3>
      <p>{forbidden ? 'Your role is not allowed to view or do this. Ask an administrator if you need access.' : message}</p>
      {onRetry && !forbidden && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

// Loading, error and empty handling for one query, so every table behaves the same way (UI-009).
export function DataState({ query, empty, children }: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }
  empty?: { when: boolean; title: string; text?: ReactNode; action?: ReactNode }
  children: ReactNode
}) {
  if (query.isPending) return <Loading />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  if (empty?.when) return <EmptyState title={empty.title} action={empty.action}>{empty.text}</EmptyState>

  return <>{children}</>
}

interface TabDef {
  id: string
  label: string
  count?: number
}

export function Tabs({ tabs, active, onChange, label }: { tabs: TabDef[]; active: string; onChange: (id: string) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={active === tab.id}
          aria-controls={`panel-${tab.id}`}
          className="tab"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && <span className="badge badge--neutral tab__count">{tab.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function TabPanel({ id, active, children }: { id: string; active: string; children: ReactNode }) {
  if (id !== active) return null

  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`}>
      {children}
    </div>
  )
}

export function Pager({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage: (page: number) => void }) {
  return (
    <div className="pager">
      <span>
        {total} {total === 1 ? 'row' : 'rows'}
      </span>
      <span className="spacer" />
      <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span>
        Page {page} of {Math.max(totalPages, 1)}
      </span>
      <Button size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </div>
  )
}

// The mark for anything the AI wrote or derived: violet, with a spark, always with words (never colour alone).
export function AiChip({ children = 'AI', title }: { children?: ReactNode; title?: string }) {
  return (
    <span className="ai-chip" title={title}>
      <span aria-hidden="true">✦</span>
      {children}
    </span>
  )
}

// What an AI output shows next to it (NFR-013): that it is AI-written, by which model.
export function AiNote({ text, source, unavailableText = 'Explanation unavailable' }: { text: string | null; source: string | null; unavailableText?: string }) {
  if (!text) {
    return (
      <div className="ai-note ai-note--empty">
        <div className="ai-note__label">AI explanation</div>
        {unavailableText}
      </div>
    )
  }

  const [, provider, ...model] = (source ?? '').split(':')

  return (
    <div className="ai-note">
      <div className="ai-note__label">
        <AiChip>AI explanation</AiChip>
        {source && <Badge tone="ai" title={source}>{provider}{model.length ? ` · ${model.join(':')}` : ''}</Badge>}
      </div>
      {text}
    </div>
  )
}
