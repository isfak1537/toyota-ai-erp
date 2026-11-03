import { describe, expect, it } from 'vitest'
import type { Role } from '../api/types'
import { can, type Capability } from './permissions'

const ROLES: Role[] = ['ADMIN', 'WAREHOUSE_MANAGER', 'PROCUREMENT_OFFICER', 'VIEWER']
const allowed = (capability: Capability) => ROLES.filter((role) => can(role, capability))

describe('permissions mirror the API role matrix (SRS section 9)', () => {
  it.each([
    ['runReplenishment', ['ADMIN', 'PROCUREMENT_OFFICER']],
    ['decideSuggestion', ['ADMIN', 'PROCUREMENT_OFFICER']],
    ['procurementWrite', ['ADMIN', 'PROCUREMENT_OFFICER']],
    ['receiveGoods', ['ADMIN', 'WAREHOUSE_MANAGER', 'PROCUREMENT_OFFICER']],
    ['overrideReceiptWarehouse', ['ADMIN', 'WAREHOUSE_MANAGER']],
    ['syncAnomalies', ['ADMIN', 'WAREHOUSE_MANAGER']],
    ['reviewAnomaly', ['ADMIN', 'WAREHOUSE_MANAGER']],
    ['retrainModels', ['ADMIN']],
    ['viewAuditLog', ['ADMIN']],
  ] as [Capability, Role[]][])('%s', (capability, roles) => {
    expect(allowed(capability)).toEqual(roles)
  })

  it('a viewer can do nothing that writes, and an unknown user can do nothing at all', () => {
    expect(ROLES.filter((r) => r === 'VIEWER').flatMap((role) => (['runReplenishment', 'decideSuggestion', 'receiveGoods', 'reviewAnomaly', 'retrainModels'] as Capability[]).filter((c) => can(role, c)))).toEqual([])
    expect(can(undefined, 'receiveGoods')).toBe(false)
  })
})
