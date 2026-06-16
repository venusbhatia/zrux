import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock auth + the Supermemory surface so the route tests exercise only the HTTP
// glue (validation, status codes, tenant scoping, ownership refusal).
const mocks = vi.hoisted(() => {
  class UnauthorizedError extends Error {}
  class OwnershipError extends Error {}
  return {
    getUserId: vi.fn(),
    rememberPreference: vi.fn(),
    listStandingPreferences: vi.fn(),
    forgetPreference: vi.fn(),
    UnauthorizedError,
    OwnershipError,
  }
})
vi.mock('@/lib/auth/session', () => ({
  getUserId: mocks.getUserId,
  UnauthorizedError: mocks.UnauthorizedError,
}))
vi.mock('@/lib/personalization/supermemory', () => ({
  rememberPreference: mocks.rememberPreference,
  listStandingPreferences: mocks.listStandingPreferences,
  forgetPreference: mocks.forgetPreference,
  OwnershipError: mocks.OwnershipError,
}))

const { UnauthorizedError, OwnershipError } = mocks

import { POST, GET } from './route'
import { DELETE } from './[memoryId]/route'

const USER = 'u-1'

function jsonReq(body: unknown): any {
  return { json: async () => body, headers: new Headers() }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUserId.mockResolvedValue(USER)
})

describe('POST /api/remember', () => {
  it('saves a standing preference and returns 201', async () => {
    mocks.rememberPreference.mockResolvedValue(undefined)
    const res = await POST(jsonReq({ text: 'triage investors first' }))
    expect(res.status).toBe(201)
    expect(mocks.rememberPreference).toHaveBeenCalledWith(USER, 'triage investors first', {
      kind: 'standing',
    })
  })

  it('rejects an empty text with 400', async () => {
    const res = await POST(jsonReq({ text: '   ' }))
    expect(res.status).toBe(400)
    expect(mocks.rememberPreference).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthorized', async () => {
    mocks.getUserId.mockRejectedValue(new UnauthorizedError())
    const res = await POST(jsonReq({ text: 'x' }))
    expect(res.status).toBe(401)
  })
})

describe('GET /api/remember', () => {
  it('lists only the caller standing preferences', async () => {
    mocks.listStandingPreferences.mockResolvedValue([{ id: 'a', text: 'pref a' }])
    const res = await GET(jsonReq({}))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ preferences: [{ id: 'a', text: 'pref a' }] })
    expect(mocks.listStandingPreferences).toHaveBeenCalledWith(USER)
  })
})

describe('DELETE /api/remember/:memoryId', () => {
  it('forgets an owned preference', async () => {
    mocks.forgetPreference.mockResolvedValue(undefined)
    const res = await DELETE(jsonReq({}), { params: Promise.resolve({ memoryId: 'owned' }) })
    expect(res.status).toBe(200)
    expect(mocks.forgetPreference).toHaveBeenCalledWith(USER, 'owned')
  })

  it('refuses a memoryId the caller does not own (404, no leak)', async () => {
    mocks.forgetPreference.mockRejectedValue(new OwnershipError('nope'))
    const res = await DELETE(jsonReq({}), {
      params: Promise.resolve({ memoryId: 'someone-elses' }),
    })
    expect(res.status).toBe(404)
  })
})
