import type { Role } from '../api/types'
import { can, type Capability } from './permissions'

export interface NavItem {
  to: string
  label: string
  icon: string
  section: 'Operations' | 'AI' | 'Administration'
  needs?: Capability
}

// One list drives the sidebar and what the role may open.
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Inventory', icon: '▦', section: 'Operations' },
  { to: '/procurement', label: 'Procurement', icon: '⇄', section: 'Operations' },
  { to: '/suggestions', label: 'AI suggestions', icon: '✦', section: 'AI' },
  { to: '/anomalies', label: 'Anomalies', icon: '◬', section: 'AI' },
]

export const navFor = (role: Role | undefined) => NAV_ITEMS.filter((item) => !item.needs || can(role, item.needs))
