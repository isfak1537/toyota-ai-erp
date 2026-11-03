// Shapes of the ERP API (SRS section 9) as the UI uses them. Written by hand: the API is small.

export type Role = 'ADMIN' | 'WAREHOUSE_MANAGER' | 'PROCUREMENT_OFFICER' | 'VIEWER'

export interface User {
  id: number
  name: string
  email: string
  role: Role
}

export interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

// { success, data, message, errors } plus whatever else an endpoint adds (pagination, eventTypes)
export interface Envelope<T> {
  success: boolean
  data: T
  message?: string
  errors?: { field?: string; message: string }[] | null
  pagination?: Pagination
  [extra: string]: unknown
}

export interface Product {
  id: number
  sku: string
  name: string
  unit: string
  price: string
  reorderLevel: number
  minStock: number
  isActive: boolean
}

export interface Warehouse {
  id: number
  code: string
  name: string
}

export interface InventoryRow {
  id: number
  productId: number
  warehouseId: number
  quantity: number
  reservedQuantity: number
  product: Product
  warehouse: Warehouse
}

export type TransactionType = 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'RESERVATION' | 'RELEASE'

export interface LedgerRow {
  id: number
  productId: number
  warehouseId: number
  type: TransactionType
  quantity: number
  balanceAfter: number
  reservedAfter: number | null
  referenceType: string | null
  referenceId: number | null
  reason: string | null
  createdAt: string
  product: Product
  warehouse: Warehouse
  createdBy: { id: number; name: string; role: Role } | null
}

export interface DaysOfCoverItem {
  sku: string
  name: string
  warehouse: string
  available: number
  forecastUnitsPerDay: number
  daysOfCover: number | null
  lastsBeyondHorizon: boolean
  openOrderUnitsToThisWarehouse: number
  model: string
}

export interface LowStockItem {
  sku: string
  name: string
  warehouse: string
  onHand: number
  reserved: number
  available: number
  reorderLevel: number
}

export interface DaysOfCover {
  forecastAvailable: boolean
  horizonDays?: number
  note?: string
  withoutForecast?: number
  items?: DaysOfCoverItem[]
  message?: string
  fallback?: { total: number; items: LowStockItem[] }
}

export type SuggestionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED'

export interface Suggestion {
  id: number
  runId: string
  productId: number
  warehouseId: number
  supplierId: number
  suggestedQty: number
  forecastDaily: number
  sigma: number
  leadTimeDays: number
  minimumOrderQty: number
  safetyStock: number
  reorderPoint: number
  available: number
  onOrder: number
  onOrderMethod: string
  zValue: number
  reviewDays: number
  forecastModel: string
  modelVersion: string
  explanation: string | null
  explanationSource: string | null
  status: SuggestionStatus
  rejectReason: string | null
  decidedAt: string | null
  requisitionId: number | null
  createdAt: string
  inputs: Record<string, unknown>
  product: { id: number; sku: string; name: string; unit: string }
  warehouse: { id: number; code: string; name: string }
  supplier: { id: number; code: string; name: string }
}

export type Decision = 'ORDERED' | 'NOT_NEEDED' | 'COVERED_BY_ON_ORDER' | 'SKIPPED'

export interface ReviewSeries {
  productId: number
  warehouseId: number
  sku: string
  name: string
  warehouse: string
  staticReorderLevel: number
  available: number
  daysOfCover: number | null
  decision: Decision
  skipCode?: string
  reason: string
  reorderPoint: number | null
  safetyStock: number | null
  dailyMean: number | null
  sigma: number | null
  leadTimeDays: number | null
  onOrder: number | null
  onOrderMethod: string | null
  suggestedQty: number | null
  suggestionId: number | null
}

export interface LatestRun {
  runId: string
  ranAt: string
  modelVersion: string
  asOf: string
  params: { z: number; reviewDays: number }
  counts: Record<string, number>
  series: ReviewSeries[]
}

export interface AnomalyFlag {
  id: number
  inventoryTransactionId: number
  score: number
  reason: string
  source: 'MODEL' | 'RULE' | 'BOTH'
  ruleCodes: string[]
  queueRank: number | null
  period: string | null
  topFeatures: { feature: string; text?: string; value: number; typical: number; contribution: number }[] | null
  modelVersion: string | null
  explanation: string | null
  explanationSource: string | null
  status: 'OPEN' | 'REVIEWED'
  reviewedAt: string | null
  reviewNote: string | null
  reviewedBy: { id: number; name: string } | null
  transaction: {
    id: number
    type: TransactionType
    quantity: number
    balanceAfter: number
    createdAt: string
    product: { id: number; sku: string; name: string }
    warehouse: { id: number; code: string; name: string }
  }
}

export interface ModelRun {
  id: number
  modelType: 'FORECAST' | 'ANOMALY'
  version: string
  metrics: Record<string, unknown>
  trainedAt: string
  isActive: boolean
}

export interface AuditEntry {
  id: number
  eventType: string
  actorUserId: number | null
  actor: { id: number; name: string; role: Role } | null
  payload: Record<string, unknown>
  createdAt: string
}

export interface ForecastPoint {
  date: string
  mean: number
  baseline: number
  ml: number | null
  sigma: number
}

export interface ForecastResult {
  productId: number
  warehouseId: number
  status: 'OK' | 'NO_HISTORY'
  message?: string
  modelVersion?: string
  selectedModel?: 'ML' | 'BASELINE'
  dailyMean?: number
  sigma?: number
  baselineWindow?: number
  metrics?: { holdoutDays: number; maeBaseline: number | null; maeMl: number | null }
  inputs?: { historyDays: number; lastActualDate: string }
  notes?: string[]
  history?: { date: string; demand: number }[]
  forecast?: ForecastPoint[]
}

export interface ProductForecast {
  product: { id: number; sku: string; name: string }
  modelVersion: string | null
  asOf: string | null
  horizonDays: number
  results: ForecastResult[]
}

export interface AssistantAnswer {
  answer: string | null
  unavailable: boolean
  toolCalls: { name: string; arguments: Record<string, unknown> }[]
  source: string | null
}

export type RequisitionStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
export type PurchaseOrderStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED'

export interface Requisition {
  id: number
  requisitionNumber: string
  requesterName: string
  supplierId: number | null
  supplier: { id: number; code: string; name: string } | null
  destinationWarehouseId: number | null
  destinationWarehouse: Warehouse | null
  status: RequisitionStatus
  notes: string | null
  sourceType: string | null
  sourceId: number | null
  createdAt: string
  items: { id: number; productId: number; quantity: number; estimatedUnitPrice: string; product: { id: number; sku: string; name: string } }[]
  purchaseOrders: { id: number; poNumber: string; status: PurchaseOrderStatus }[]
}

export interface PurchaseOrder {
  id: number
  poNumber: string
  status: PurchaseOrderStatus
  supplierId: number
  supplier: { id: number; code: string; name: string }
  requisitionId: number | null
  requisition: { id: number; requisitionNumber: string } | null
  destinationWarehouseId: number | null
  destinationWarehouse: Warehouse | null
  subtotal: string
  taxAmount: string
  totalAmount: string
  createdAt: string
  expectedDate: string | null
  items: { id: number; productId: number; quantity: number; receivedQuantity: number; unitPrice: string; lineTotal: string; product: { id: number; sku: string; name: string } }[]
  goodsReceipts: { id: number; receiptNumber: string }[]
}

export interface GoodsReceipt {
  id: number
  receiptNumber: string
  purchaseOrderId: number
  warehouseId: number
  status: 'RECEIVED' | 'CANCELLED'
  receiptDate: string
  createdAt: string
  purchaseOrder: { id: number; poNumber: string; supplier: { id: number; code: string; name: string } }
  warehouse: Warehouse
  items: { id: number; quantity: number; product: { id: number; sku: string; name: string } }[]
}
