import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'

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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <main className="main__inner">Toyota AI ERP</main>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
