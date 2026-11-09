import type { Role } from '../api/types'
import { can, type Capability } from './permissions'

interface NavItem {
  to: string
  label: string
  icon: string
  section: 'Operations' | 'AI' | 'Administration'
  needs?: Capability
}

// One list drives the sidebar and what the role may open.
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Inventory', icon: '▦', section: 'Operations' },
  { to: '/procurement', label: 'Procurement', icon: '⇄', section: 'Operations' },
  { to: '/ledger', label: 'Stock ledger', icon: '☰', section: 'Operations' },
  { to: '/suggestions', label: 'AI suggestions', icon: '✦', section: 'AI' },
  { to: '/anomalies', label: 'Anomalies', icon: '◬', section: 'AI' },
  { to: '/admin/models', label: 'AI models', icon: '◈', section: 'Administration', needs: 'retrainModels' },
  { to: '/admin/audit', label: 'AI audit log', icon: '≡', section: 'Administration', needs: 'viewAuditLog' },
]

export const navFor = (role: Role | undefined) => NAV_ITEMS.filter((item) => !item.needs || can(role, item.needs))
