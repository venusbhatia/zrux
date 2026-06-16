import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the AI SDK extraction call and the Supermemory write surface so the test
// exercises the pure filter -> dedup -> record logic in runLearn.
const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  hasNearDuplicate: vi.fn(),
  recordTakeaways: vi.fn(),
}))

vi.mock('ai', () => ({ generateObject: mocks.generateObject }))
vi.mock('../lib/llm/gateway', () => ({
  chatModel: () => ({}),
  FALLBACK_MODEL: 'anthropic/claude-haiku-4-5',
  withRetry: (fn: () => unknown) => fn(),
}))
vi.mock('../lib/observability/langfuse', () => ({
  aiTelemetry: () => ({ isEnabled: false }),
  initTracing: () => {},
  flushTracing: async () => {},
  tracingEnabled: false,
}))
vi.mock('../lib/personalization/supermemory', () => ({
  hasNearDuplicate: mocks.hasNearDuplicate,
  recordTakeaways: mocks.recordTakeaways,
}))

import { runLearn } from './personalize'

const PAYLOAD = { userId: 'u1', question: 'what should I focus on?', answer: 'investors first' }

function candidates(...cs: Array<{ text: string; kind: string; confidence: number }>) {
  mocks.generateObject.mockResolvedValue({ object: { candidates: cs } })
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.AUTO_MIN_CONFIDENCE
  mocks.hasNearDuplicate.mockResolvedValue(false)
  mocks.recordTakeaways.mockResolvedValue(undefined)
})

describe('runLearn', () => {
  it('drops candidates below the confidence floor', async () => {
    candidates(
      { text: 'triage investors first', kind: 'standing', confidence: 0.9 },
      { text: 'maybe like terse answers', kind: 'standing', confidence: 0.3 },
    )
    const out = await runLearn(PAYLOAD)
    expect(out.recorded).toBe(1)
    expect(mocks.recordTakeaways).toHaveBeenCalledWith('u1', [
      { text: 'triage investors first', kind: 'standing', confidence: 0.9 },
    ])
  })

  it('skips a candidate that is a near-duplicate of an existing memory', async () => {
    candidates(
      { text: 'triage investors first', kind: 'standing', confidence: 0.9 },
      { text: 'prefer terse answers', kind: 'standing', confidence: 0.9 },
    )
    mocks.hasNearDuplicate.mockImplementation(async (_u: string, text: string) =>
      text.includes('terse'),
    )
    const out = await runLearn(PAYLOAD)
    expect(out.recorded).toBe(1)
    expect(mocks.recordTakeaways).toHaveBeenCalledWith('u1', [
      { text: 'triage investors first', kind: 'standing', confidence: 0.9 },
    ])
  })

  it('records nothing (and does not call the writer) when no candidate survives', async () => {
    candidates({ text: 'one-off note', kind: 'scoped', confidence: 0.2 })
    const out = await runLearn(PAYLOAD)
    expect(out.recorded).toBe(0)
    expect(mocks.recordTakeaways).not.toHaveBeenCalled()
  })

  it('honours a custom AUTO_MIN_CONFIDENCE floor', async () => {
    process.env.AUTO_MIN_CONFIDENCE = '0.95'
    candidates({ text: 'triage investors first', kind: 'standing', confidence: 0.9 })
    const out = await runLearn(PAYLOAD)
    expect(out.recorded).toBe(0)
  })
})
