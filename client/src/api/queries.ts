import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { get } from './client'
import type {
  AnomalyFlag, AuditEntry, DaysOfCover, GoodsReceipt, InventoryRow, LatestRun, LedgerRow, ModelRun, Product, ProductForecast, PurchaseOrder, Requisition, Suggestion, Warehouse,
} from './types'

// Read queries. Mutations live next to the page that triggers them, so each page shows its own
// pending and error state.

export const useInventory = () =>
  useQuery({ queryKey: ['inventory'], queryFn: () => get<InventoryRow[]>('/inventory', { pageSize: 100 }) })

export const useDaysOfCover = () =>
  useQuery({ queryKey: ['days-of-cover'], queryFn: () => get<DaysOfCover>('/ai/days-of-cover') })

export const useLatestRun = () =>
  useQuery({ queryKey: ['latest-run'], queryFn: () => get<LatestRun | null>('/ai/replenishment/latest') })

export const useSuggestions = (params: { status?: string; page?: number; pageSize?: number }) =>
  useQuery({
    queryKey: ['suggestions', params],
    queryFn: () => get<Suggestion[]>('/ai/suggestions', params),
    placeholderData: keepPreviousData,
  })

export const useAnomalies = (params: { status?: string; kind?: string; page?: number; pageSize?: number }) =>
  useQuery({
    queryKey: ['anomalies', params],
    queryFn: () => get<AnomalyFlag[]>('/ai/anomalies', params),
    placeholderData: keepPreviousData,
  })

export const useProductForecast = (productId: number, warehouseId?: number) =>
  useQuery({
    queryKey: ['forecast', productId, warehouseId ?? null],
    queryFn: () => get<ProductForecast>(`/ai/forecast/${productId}`, { warehouseId }),
    retry: false,
  })

export const useModelRuns = () => useQuery({ queryKey: ['model-runs'], queryFn: () => get<ModelRun[]>('/ai/models', { pageSize: 50 }) })

export const useAuditLog = (params: { eventType?: string; page?: number; pageSize?: number }) =>
  useQuery({
    queryKey: ['audit', params],
    queryFn: () => get<AuditEntry[]>('/ai/audit', params),
    placeholderData: keepPreviousData,
  })

export const useLedger = (params: Record<string, unknown>) =>
  useQuery({
    queryKey: ['ledger', params],
    queryFn: () => get<LedgerRow[]>('/inventory/transactions', params),
    placeholderData: keepPreviousData,
  })

export const useProducts = () => useQuery({ queryKey: ['products'], queryFn: () => get<Product[]>('/products', { limit: 100 }) })

export const useWarehouses = () => useQuery({ queryKey: ['warehouses'], queryFn: () => get<Warehouse[]>('/warehouses', { pageSize: 100 }) })

export const useRequisitions = (page: number) =>
  useQuery({ queryKey: ['requisitions', page], queryFn: () => get<Requisition[]>('/procurement/requisitions', { page, pageSize: 20 }), placeholderData: keepPreviousData })

export const usePurchaseOrders = (page: number) =>
  useQuery({ queryKey: ['purchase-orders', page], queryFn: () => get<PurchaseOrder[]>('/procurement/purchase-orders', { page, pageSize: 20 }), placeholderData: keepPreviousData })

export const useGoodsReceipts = (page: number) =>
  useQuery({ queryKey: ['goods-receipts', page], queryFn: () => get<GoodsReceipt[]>('/procurement/goods-receipts', { page, pageSize: 20 }), placeholderData: keepPreviousData })
