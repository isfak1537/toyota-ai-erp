import { describe, expect, it, vi } from 'vitest'
import { http as mswHttp, HttpResponse } from 'msw'
import { server } from '../test/server'
import { ApiError, get, post, tokenStore } from './client'
import { onApiEvent } from './events'

describe('api client', () => {
  it('sends the session token as a bearer header and returns the envelope', async () => {
    let auth: string | null = null
    server.use(
      mswHttp.get('*/api/v1/things', ({ request }) => {
        auth = request.headers.get('authorization')

        return HttpResponse.json({ success: true, data: [1, 2], pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 } })
      }),
    )
    tokenStore.set('abc')

    const body = await get<number[]>('/things')

    expect(auth).toBe('Bearer abc')
    expect(body.data).toEqual([1, 2])
    expect(body.pagination?.total).toBe(2)
  })

  it('sends no Authorization header without a token and drops empty query values', async () => {
    let seen: { auth: string | null; search: string } = { auth: 'x', search: '' }
    server.use(
      mswHttp.get('*/api/v1/things', ({ request }) => {
        seen = { auth: request.headers.get('authorization'), search: new URL(request.url).search }

        return HttpResponse.json({ success: true, data: [] })
      }),
    )

    await get('/things', { status: '', page: 2, q: undefined, none: null })

    expect(seen).toEqual({ auth: null, search: '?page=2' })
  })

  it('turns an error response into an ApiError with the server message and field details', async () => {
    server.use(
      mswHttp.post('*/api/v1/things', () =>
        HttpResponse.json({ success: false, message: 'Validation failed', errors: [{ field: 'name', message: 'Required' }] }, { status: 400 }),
      ),
    )

    const error = await post('/things', {}).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 400, message: 'Validation failed', details: [{ field: 'name', message: 'Required' }] })
  })

  it('on 401 it clears the token and announces the end of the session, except for a failed login', async () => {
    server.use(
      mswHttp.get('*/api/v1/secret', () => HttpResponse.json({ success: false, message: 'Invalid or expired token' }, { status: 401 })),
      mswHttp.post('*/api/v1/auth/login', () => HttpResponse.json({ success: false, message: 'Invalid email or password' }, { status: 401 })),
    )
    const listener = vi.fn()
    const off = onApiEvent('unauthorized', listener)
    tokenStore.set('abc')

    await get('/secret').catch(() => undefined)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(tokenStore.get()).toBeNull()

    tokenStore.set('abc')
    await post('/auth/login', { email: 'a@b.c', password: 'x' }).catch(() => undefined)
    expect(listener).toHaveBeenCalledTimes(1) // a wrong password is not a lost session
    expect(tokenStore.get()).toBe('abc')
    off()
  })

  it('on 503 it announces that an AI service is unavailable, and a later AI success clears it', async () => {
    server.use(
      mswHttp.get('*/api/v1/ai/down', () => HttpResponse.json({ success: false, message: 'AI service is unavailable' }, { status: 503 })),
      mswHttp.get('*/api/v1/ai/up', () => HttpResponse.json({ success: true, data: {} })),
      mswHttp.get('*/api/v1/plain', () => HttpResponse.json({ success: true, data: {} })),
    )
    const down = vi.fn()
    const ok = vi.fn()
    const offDown = onApiEvent('ai-unavailable', down)
    const offOk = onApiEvent('ai-ok', ok)

    const error = await get('/ai/down').catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 503, isAiUnavailable: true, message: 'AI service is unavailable' })
    expect(down).toHaveBeenCalledTimes(1)

    await get('/plain')
    expect(ok).not.toHaveBeenCalled() // only AI routes clear it

    await get('/ai/up')
    expect(ok).toHaveBeenCalledTimes(1)
    offDown()
    offOk()
  })

  it('reports an unreachable server in plain words', async () => {
    server.use(mswHttp.get('*/api/v1/net', () => HttpResponse.error()))

    await expect(get('/net')).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/Cannot reach the server/) })
  })

  it('marks 403 as forbidden', async () => {
    server.use(mswHttp.get('*/api/v1/nope', () => HttpResponse.json({ success: false, message: 'You do not have permission' }, { status: 403 })))

    await expect(get('/nope')).rejects.toMatchObject({ isForbidden: true })
  })
})

describe('token store', () => {
  it('keeps the token in sessionStorage only', () => {
    tokenStore.set('abc')

    expect(sessionStorage.getItem('erp.token')).toBe('abc')
    expect(localStorage.getItem('erp.token')).toBeNull()
    tokenStore.clear()
    expect(tokenStore.get()).toBeNull()
  })
})
