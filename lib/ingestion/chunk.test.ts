import { describe, it, expect } from 'vitest'
import { chunkText } from './chunk'

describe('chunkText', () => {
  it('keeps short bodies as a single chunk', () => {
    expect(chunkText('a short note')).toEqual(['a short note'])
  })

  it('returns no chunks for empty/whitespace input', () => {
    expect(chunkText('   \n  ')).toEqual([])
  })

  it('splits long multi-paragraph bodies into multiple chunks', () => {
    const para = 'lorem ipsum dolor sit amet '.repeat(40) // ~1080 chars
    const body = [para, para, para].join('\n\n') // ~3300 chars
    const chunks = chunkText(body)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1600)
  })

  it('hard-splits a single oversized paragraph', () => {
    const huge = 'x'.repeat(5000)
    const chunks = chunkText(huge)
    expect(chunks.length).toBeGreaterThan(2)
  })
})
