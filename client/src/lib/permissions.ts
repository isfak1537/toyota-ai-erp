import type { Role } from '../api/types'

// What each role may do in the UI. It only decides what is shown: the API enforces the same matrix
// (SRS section 9) and answers 403 to anything else.
const ALLOWED: Record<string, Role[]> = {
  runReplenishment: ['ADMIN', 'PROCUREMENT_OFFICER'],
  decideSuggestion: ['ADMIN', 'PROCUREMENT_OFFICER'],
  procurementWrite: ['ADMIN', 'PROCUREMENT_OFFICER'],
  receiveGoods: ['ADMIN', 'WAREHOUSE_MANAGER', 'PROCUREMENT_OFFICER'],
  overrideReceiptWarehouse: ['ADMIN', 'WAREHOUSE_MANAGER'],
  syncAnomalies: ['ADMIN', 'WAREHOUSE_MANAGER'],
  reviewAnomaly: ['ADMIN', 'WAREHOUSE_MANAGER'],
  retrainModels: ['ADMIN'],
  viewAuditLog: ['ADMIN'],
}

export type Capability = keyof typeof ALLOWED

export const can = (role: Role | undefined, capability: Capability): boolean =>
  role !== undefined && ALLOWED[capability]?.includes(role) === true

export const roleLabel: Record<Role, string> = {
  ADMIN: 'Administrator',
  WAREHOUSE_MANAGER: 'Warehouse manager',
  PROCUREMENT_OFFICER: 'Procurement officer',
  VIEWER: 'Viewer',
}
