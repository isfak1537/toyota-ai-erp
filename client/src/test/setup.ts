import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { cleanup, configure } from '@testing-library/react'
import { server } from './server'

// the first test that opens the lazily loaded chart page also loads the chart library, which can take more than the default 1 s on a cold cache
configure({ asyncUtilTimeout: 5000 })

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  sessionStorage.clear()
})
afterAll(() => server.close())
