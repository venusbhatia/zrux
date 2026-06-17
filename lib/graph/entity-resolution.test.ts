import { describe, it, expect, vi, beforeEach } from 'vitest'

// entity-resolution -> triple-extraction -> observability/langfuse loads
// @langfuse/otel at module scope (unresolvable under vitest). Stub it.
vi.mock('../observability/langfuse', () => ({ aiTelemetry: () => ({ isEnabled: false }) }))

// Hoisted holder so the mocked createServiceClient returns the per-test db stub.
const h = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('../db/supabase', () => ({ createServiceClient: () => h.db }))

// Triple extraction makes an LLM call; assert it is never reached for gated items
// by throwing if it is.
const genObject = vi.hoisted(() => vi.fn(async () => ({ object: { triples: [] } })))
vi.mock('ai', () => ({ generateObject: genObject }))

import { normalizeName, resolveEntity, extractAndResolve } from './entity-resolution'
import type { RawItem } from '../connectors/types'

function rawItem(over: Partial<RawItem> = {}): RawItem {
  return {
    source: 'gmail',
    type: 'email',
    externalId: 'x1',
    title: 'Hello',
    author: 'Sarah Chen <sarah@northwind.vc>',
    sourceCreatedAt: new Date('2026-01-01T00:00:00Z'),
    sourceUpdatedAt: new Date('2026-01-01T00:00:00Z'),
    metadata: {},
    body: 'body',
    raw: null,
    ...over,
  }
}

describe('normalizeName', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeName('  Sarah   Chen  ')).toBe('Sarah Chen')
    expect(normalizeName('Northwind\tVentures')).toBe('Northwind Ventures')
  })

  it('preserves display casing (matching is case-insensitive at the SQL layer)', () => {
    expect(normalizeName('ACME Corp')).toBe('ACME Corp')
  })
})

// A chainable Supabase stub: every query-builder method returns the same object;
// terminals (maybeSingle/single/rpc) resolve to per-test configured values.
function makeDb(terminals: {
  maybeSingle?: unknown
  single?: unknown
  rpc?: unknown
}): Record<string, ReturnType<typeof vi.fn>> {
  const db: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const m of ['from', 'select', 'eq', 'in', 'update', 'insert', 'upsert', 'order', 'limit']) {
    db[m] = vi.fn(() => db)
  }
  db.maybeSingle = vi.fn(async () => terminals.maybeSingle ?? { data: null })
  db.single = vi.fn(async () => terminals.single ?? { data: null, error: null })
  db.rpc = vi.fn(async () => terminals.rpc ?? { data: [], error: null })
  return db
}

describe('resolveEntity', () => {
  beforeEach(() => {
    h.db = null
  })

  it('canonicalizes on email: returns the existing id and appends the new name as an alias', async () => {
    const db = makeDb({ maybeSingle: { data: { id: 'e1', name: 'Sarah', aliases: [] } } })
    h.db = db

    const id = await resolveEntity('u1', {
      name: 'Sarah Chen',
      type: 'person',
      email: 'sarah@northwind.vc',
    })

    expect(id).toBe('e1')
    expect(db.update).toHaveBeenCalledWith({ aliases: ['Sarah Chen'] })
  })

  it('falls back to a fuzzy name match when there is no email', async () => {
    const db = makeDb({ rpc: { data: [{ id: 'e2' }], error: null } })
    h.db = db

    const id = await resolveEntity('u1', { name: 'Acme', type: 'company' })

    expect(id).toBe('e2')
    expect(db.rpc).toHaveBeenCalledWith('match_entity', expect.objectContaining({ p_name: 'Acme' }))
  })

  it('inserts a new provisional entity when nothing matches', async () => {
    const db = makeDb({
      rpc: { data: [], error: null },
      single: { data: { id: 'e3' }, error: null },
    })
    h.db = db

    const id = await resolveEntity('u1', { name: 'Atlas', type: 'project' })

    expect(id).toBe('e3')
    expect(db.insert).toHaveBeenCalled()
  })

  it('returns null for an empty name (never creates a junk entity)', async () => {
    h.db = makeDb({})
    const id = await resolveEntity('u1', { name: '   ', type: 'person' })
    expect(id).toBeNull()
  })
})

describe('extractAndResolve (broadcast-mail gate)', () => {
  beforeEach(() => {
    h.db = makeDb({})
    genObject.mockClear()
  })

  it('skips promotional mail before any LLM call', async () => {
    const res = await extractAndResolve(
      'u1',
      rawItem({ metadata: { labelIds: ['CATEGORY_PROMOTIONS', 'INBOX'] } }),
      'item1',
    )
    expect(res).toEqual({ edges: 0 })
    expect(genObject).not.toHaveBeenCalled()
  })

  it('skips no-reply / automated senders before any LLM call', async () => {
    const res = await extractAndResolve(
      'u1',
      rawItem({ author: 'Google <no-reply@accounts.google.com>' }),
      'item2',
    )
    expect(res).toEqual({ edges: 0 })
    expect(genObject).not.toHaveBeenCalled()
  })

  it('skips low-signal sources (Slack/Sentry) before any LLM call', async () => {
    const res = await extractAndResolve(
      'u1',
      rawItem({ source: 'slack', type: 'message' }),
      'item3',
    )
    expect(res).toEqual({ edges: 0 })
    expect(genObject).not.toHaveBeenCalled()
  })

  it('proceeds to extraction for genuine personal mail', async () => {
    await extractAndResolve(
      'u1',
      rawItem({ metadata: { labelIds: ['CATEGORY_PERSONAL', 'INBOX'] } }),
      'item4',
    )
    expect(genObject).toHaveBeenCalledTimes(1)
  })
})
