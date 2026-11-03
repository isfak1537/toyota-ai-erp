import { lazy, Suspense } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { RequireAuth } from './auth/RequireAuth'
import { Layout } from './components/Layout'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
import { Loading } from './components/ui'

// the chart library is only needed on this page, so it is loaded when the page is opened
const Forecast = lazy(() => import('./pages/Forecast'))
import Dashboard from './pages/Dashboard'
import Anomalies from './pages/Anomalies'
import AuditLog from './pages/AuditLog'
import Models from './pages/Models'
import { RequireCapability } from './auth/RequireCapability'
import Ledger from './pages/Ledger'
import Procurement from './pages/Procurement'
import Suggestions from './pages/Suggestions'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // a 4xx will not get better by asking again; only network trouble and server errors are retried
      retry: (count, error) => ((error as { status?: number }).status ?? 0) >= 500 || (error as { status?: number }).status === 0 ? count < 1 : false,
      refetchOnWindowFocus: false,
    },
  },
})

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="products/:id/forecast" element={<Suspense fallback={<Loading />}><Forecast /></Suspense>} />
          <Route path="suggestions" element={<Suggestions />} />
          <Route path="anomalies" element={<Anomalies />} />
          <Route path="procurement" element={<Procurement />} />
          <Route path="ledger" element={<Ledger />} />
          <Route path="admin/models" element={<RequireCapability capability="retrainModels"><Models /></RequireCapability>} />
          <Route path="admin/audit" element={<RequireCapability capability="viewAuditLog"><AuditLog /></RequireCapability>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
