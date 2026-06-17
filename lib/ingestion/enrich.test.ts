import { describe, it, expect, vi } from 'vitest'

// enrich.ts imports observability/langfuse (loads @langfuse/otel at module scope,
// unresolvable under vitest). The pure helpers under test never use it.
vi.mock('../observability/langfuse', () => ({ aiTelemetry: () => ({ isEnabled: false }) }))

import { isStructured, provenanceLine } from './enrich'

describe('isStructured', () => {
  it('treats short structured items as self-describing (no gloss needed)', () => {
    expect(isStructured('linear', 'issue')).toBe(true)
    expect(isStructured('calendar', 'meeting')).toBe(true)
    expect(isStructured('sentry', 'error')).toBe(true)
    expect(isStructured('github', 'issue')).toBe(true)
  })

  it('treats long/unstructured content as not structured (eligible for a gloss)', () => {
    expect(isStructured('gmail', 'email')).toBe(false)
    expect(isStructured('notion', 'doc')).toBe(false)
  })
})

describe('provenanceLine', () => {
  it('slices the date to YYYY-MM-DD and includes the author bracket when present', () => {
    expect(
      provenanceLine({ source: 'gmail', author: 'sarah@x.com' }, '2026-06-14T10:00:00.000Z'),
    ).toBe('[Source: gmail] [2026-06-14] [sarah@x.com]')
  })

  it('omits the author bracket when there is no author', () => {
    expect(
      provenanceLine({ source: 'notion', author: undefined }, '2026-06-14T10:00:00.000Z'),
    ).toBe('[Source: notion] [2026-06-14]')
  })
})
