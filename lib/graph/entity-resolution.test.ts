import { describe, it, expect, vi, beforeEach } from 'vitest'

// entity-resolution -> triple-extraction -> observability/langfuse loads
// @langfuse/otel at module scope (unresolvable under vitest). Stub it.
vi.mock('../observability/langfuse', () => ({ aiTelemetry: () => ({ isEnabled: false }) }))

// Hoisted holder so the mocked createServiceClient returns the per-test db stub.
const h = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('../db/supabase', () => ({ createServiceClient: () => h.db }))

import { normalizeName, resolveEntity } from './entity-resolution'

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
