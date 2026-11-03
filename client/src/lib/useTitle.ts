import { useEffect } from 'react'

const APP = 'AI ERP (synthetic demo)'

// One title per page, so browser history and screen readers can tell pages apart.
export function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · ${APP}`
  }, [title])
}
