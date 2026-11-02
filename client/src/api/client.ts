import axios, { AxiosError, type AxiosRequestConfig } from 'axios'
import { emitApiEvent } from './events'
import type { Envelope } from './types'

const TOKEN_KEY = 'erp.token'

// Session storage: the token disappears when the tab closes and is never written to localStorage.
export const tokenStore = {
  get: () => {
    try {
      return sessionStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set: (token: string) => {
    try {
      sessionStorage.setItem(TOKEN_KEY, token)
    } catch {
      /* private mode: the session just will not survive a reload */
    }
  },
  clear: () => {
    try {
      sessionStorage.removeItem(TOKEN_KEY)
    } catch {
      /* nothing to clear */
    }
  },
}

export class ApiError extends Error {
  status: number
  details: { field?: string; message: string }[]

  constructor(status: number, message: string, details: { field?: string; message: string }[] = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }

  get isForbidden() {
    return this.status === 403
  }

  get isAiUnavailable() {
    return this.status === 503
  }
}

export const http = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL ?? ''}/api/v1`,
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
})

http.interceptors.request.use((config) => {
  const token = tokenStore.get()

  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }

  return config
})

http.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ message?: string; errors?: { field?: string; message: string }[] }>) => {
    const status = error.response?.status ?? 0
    const body = error.response?.data
    const isLogin = error.config?.url?.endsWith('/auth/login')

    if (status === 401 && !isLogin) {
      tokenStore.clear()
      emitApiEvent('unauthorized')
    }

    if (status === 503) {
      emitApiEvent('ai-unavailable')
    }

    const message =
      body?.message ??
      (status === 0 ? 'Cannot reach the server. Check your connection and try again.' : `Request failed (${status})`)

    return Promise.reject(new ApiError(status, message, body?.errors ?? []))
  },
)

// A request that reached an AI route and succeeded clears the "AI unavailable" banner.
const aiOk = (url: string) => {
  if (url.startsWith('/ai/')) emitApiEvent('ai-ok')
}

export const get = async <T>(url: string, params?: Record<string, unknown>): Promise<Envelope<T>> => {
  const clean = params ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null)) : undefined
  const response = await http.get<Envelope<T>>(url, { params: clean })

  aiOk(url)

  return response.data
}

export const post = async <T>(url: string, body: unknown = {}, config?: AxiosRequestConfig): Promise<Envelope<T>> => {
  const response = await http.post<Envelope<T>>(url, body, config)

  aiOk(url)

  return response.data
}
