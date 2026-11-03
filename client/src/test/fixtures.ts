import type { DaysOfCover, InventoryRow, LatestRun, ReviewSeries, Suggestion } from '../api/types'

const product = (id: number, sku: string, name: string, reorderLevel: number) => ({ id, sku, name, unit: 'pcs', price: '10.00', reorderLevel, minStock: 0, isActive: true })
const warehouse = { id: 1, code: 'SYN-MAIN', name: 'Main warehouse' }

export const inventoryRows: InventoryRow[] = [
  { id: 1, productId: 1, warehouseId: 1, quantity: 30, reservedQuantity: 4, product: product(1, 'SYN-BRK-006', 'Brake Caliper Rebuild Kit', 25), warehouse },
  { id: 2, productId: 2, warehouseId: 1, quantity: 120, reservedQuantity: 0, product: product(2, 'SYN-ENG-005', 'Timing Belt Kit', 20), warehouse },
  { id: 3, productId: 3, warehouseId: 1, quantity: 9, reservedQuantity: 0, product: product(3, 'SYN-ELE-003', 'Headlamp Assembly', 24), warehouse },
]

export const daysOfCover: DaysOfCover = {
  forecastAvailable: true,
  horizonDays: 30,
  items: [
    { sku: 'SYN-ELE-003', name: 'Headlamp Assembly', warehouse: 'SYN-MAIN', available: 9, forecastUnitsPerDay: 3, daysOfCover: 3, lastsBeyondHorizon: false, openOrderUnitsToThisWarehouse: 0, model: 'ML' },
    { sku: 'SYN-BRK-006', name: 'Brake Caliper Rebuild Kit', warehouse: 'SYN-MAIN', available: 26, forecastUnitsPerDay: 2.6, daysOfCover: 10, lastsBeyondHorizon: false, openOrderUnitsToThisWarehouse: 0, model: 'ML' },
    { sku: 'SYN-ENG-005', name: 'Timing Belt Kit', warehouse: 'SYN-MAIN', available: 120, forecastUnitsPerDay: 1, daysOfCover: null, lastsBeyondHorizon: true, openOrderUnitsToThisWarehouse: 0, model: 'ML' },
  ],
}

const series = (over: Partial<ReviewSeries>): ReviewSeries => ({
  productId: 1, warehouseId: 1, sku: 'SYN-BRK-006', name: 'Brake Caliper Rebuild Kit', warehouse: 'SYN-MAIN', staticReorderLevel: 25, available: 26, daysOfCover: 10,
  decision: 'NOT_NEEDED', reason: 'Available 26 is above the reorder point 20.1.', reorderPoint: 20.1, safetyStock: 6.1, dailyMean: 2.6, sigma: 1.4, leadTimeDays: 7, onOrder: 0, onOrderMethod: 'NONE',
  suggestedQty: null, suggestionId: null, ...over,
})

export const latestRun: LatestRun = {
  runId: 'run-1',
  ranAt: '2026-11-02T10:00:00Z',
  modelVersion: 'forecast-20261101-abc',
  asOf: '2026-11-01',
  params: { z: 1.65, reviewDays: 7 },
  counts: { evaluated: 4, suggested: 1, notNeeded: 1, coveredByOnOrder: 1, skipped: 1 },
  series: [
    series({}),
    series({ productId: 3, sku: 'SYN-ELE-003', name: 'Headlamp Assembly', staticReorderLevel: 24, available: 9, daysOfCover: 3, decision: 'ORDERED', reorderPoint: 40.5, suggestedQty: 60, suggestionId: 7, reason: 'Available 9 is at or below the reorder point 40.5; suggesting 60 units.' }),
    series({ productId: 4, sku: 'SYN-ENG-001', name: 'Oil Filter', staticReorderLevel: 117, available: 111, daysOfCover: 11, decision: 'COVERED_BY_ON_ORDER', reorderPoint: 120, onOrder: 90, onOrderMethod: 'DESTINATION', reason: 'Available 111 is at or below the reorder point 120, but 90 units already on order cover the need.' }),
    series({ productId: 5, sku: 'SYN-NEW-001', name: 'New Part', staticReorderLevel: 5, available: 3, daysOfCover: null, decision: 'SKIPPED', skipCode: 'NO_HISTORY', reason: 'No demand history for this product and warehouse, so there is no forecast.', reorderPoint: null, leadTimeDays: null, onOrder: null, onOrderMethod: null }),
  ],
}

export const suggestion = (over: Partial<Suggestion> = {}): Suggestion => ({
  id: 7, runId: 'run-1', productId: 3, warehouseId: 1, supplierId: 2, suggestedQty: 60, forecastDaily: 3, sigma: 1.2, leadTimeDays: 5, minimumOrderQty: 12, safetyStock: 4.4, reorderPoint: 40.5,
  available: 9, onOrder: 0, onOrderMethod: 'NONE', zValue: 1.65, reviewDays: 7, forecastModel: 'ML', modelVersion: 'forecast-20261101-abc', explanation: 'Stock of 9 is below the reorder point of 40.5, so 60 units are suggested.',
  explanationSource: 'LLM:groq:openai/gpt-oss-120b', status: 'PENDING', rejectReason: null, decidedAt: null, requisitionId: null, createdAt: '2026-11-02T10:00:00Z',
  inputs: { outcome: 'SUGGEST', rawQty: 60, onOrder: { exact: 0, method: 'NONE', rounding: 'floor' } },
  product: { id: 3, sku: 'SYN-ELE-003', name: 'Headlamp Assembly', unit: 'pcs' }, warehouse: { id: 1, code: 'SYN-MAIN', name: 'Main warehouse' }, supplier: { id: 2, code: 'SYN-S2', name: 'Orient Parts Co.' }, ...over,
})
