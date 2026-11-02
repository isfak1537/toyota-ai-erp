import { setupServer } from 'msw/node'

// Tests register the handlers they need; any request without one fails the test (onUnhandledRequest: 'error').
export const server = setupServer()
