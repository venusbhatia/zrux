import { describe, it, expect, vi } from 'vitest'

// synthesize.ts imports observability/langfuse (loads @langfuse/otel at module
// scope, unresolvable under vitest). isThin is pure and never uses it.
vi.mock('../observability/langfuse', () => ({ aiTelemetry: () => ({ isEnabled: false }) }))

import { isThin } from './synthesize'
import type { AssembledContext, Citation } from './types'

const citation: Citation = {
  n: 1,
  item_id: 'i1',
  source: 'gmail',
  type: 'email',
  title: 'Term sheet',
  url: null,
  date: '2026-06-14',
  score: 0.9,
}

describe('isThin', () => {
  it('is thin when there are no citations', () => {
    const ctx: AssembledContext = { block: '[1] some content', citations: [] }
    expect(isThin(ctx)).toBe(true)
  })

  it('is thin when the context block is empty', () => {
    const ctx: AssembledContext = { block: '   ', citations: [citation] }
    expect(isThin(ctx)).toBe(true)
  })

  it('is not thin when both a block and citations are present', () => {
    const ctx: AssembledContext = { block: '[1] some content', citations: [citation] }
    expect(isThin(ctx)).toBe(false)
  })
})
