// Tiny event hub so the HTTP client can tell the UI about things that are not tied to one request:
// the session ended (401) or an AI route is unavailable (503).
type Listener = () => void

const listeners: Record<'unauthorized' | 'ai-unavailable' | 'ai-ok', Set<Listener>> = {
  unauthorized: new Set(),
  'ai-unavailable': new Set(),
  'ai-ok': new Set(),
}

type ApiEvent = keyof typeof listeners

export const onApiEvent = (event: ApiEvent, listener: Listener) => {
  listeners[event].add(listener)

  return () => {
    listeners[event].delete(listener)
  }
}

export const emitApiEvent = (event: ApiEvent) => {
  listeners[event].forEach((listener) => listener())
}
