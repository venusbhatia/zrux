import { describe, it, expect, vi } from 'vitest'

// The module under test transitively imports lib/observability/langfuse, which
// loads @langfuse/otel at module scope - unresolvable under the vitest node env.
// Stub it (the pure fns under test never use it) so the suite can load.
vi.mock('../observability/langfuse', () => ({ aiTelemetry: () => ({ isEnabled: false }) }))

import { shouldExtract, isNamedEntity, isBulkPromotional } from './triple-extraction'

describe('shouldExtract (triple-extraction gating)', () => {
  it('runs for high-signal sources', () => {
    expect(shouldExtract('gmail', 'email')).toBe(true)
    expect(shouldExtract('calendar', 'meeting')).toBe(true)
    expect(shouldExtract('notion', 'doc')).toBe(true)
    expect(shouldExtract('linear', 'issue')).toBe(true)
  })

  it('runs for meetings regardless of source (diarized audio)', () => {
    expect(shouldExtract('drive', 'meeting')).toBe(true)
  })

  it('NEVER runs for Slack chatter or Sentry errors (CLAUDE.md gate)', () => {
    expect(shouldExtract('slack', 'message')).toBe(false)
    expect(shouldExtract('sentry', 'error')).toBe(false)
    expect(shouldExtract('github', 'pr')).toBe(false)
  })
})

describe('isBulkPromotional (broadcast-mail gate)', () => {
  it('flags Gmail promotions / social / forums categories', () => {
    expect(
      isBulkPromotional('Maeve <info@email.borrowell.com>', {
        labelIds: ['CATEGORY_PROMOTIONS', 'INBOX'],
      }),
    ).toBe(true)
    expect(isBulkPromotional('LinkedIn <x@linkedin.com>', { labelIds: ['CATEGORY_SOCIAL'] })).toBe(
      true,
    )
    expect(isBulkPromotional(undefined, { labelIds: ['CATEGORY_FORUMS'] })).toBe(true)
  })

  it('does NOT gate CATEGORY_UPDATES on the label alone (prompt judges that gray zone)', () => {
    expect(
      isBulkPromotional('Marc Klingen <marc@x.com>', { labelIds: ['CATEGORY_UPDATES', 'INBOX'] }),
    ).toBe(false)
  })

  it('flags automated / no-reply / newsletter senders as a backstop', () => {
    expect(isBulkPromotional('Google <no-reply@accounts.google.com>', {})).toBe(true)
    expect(isBulkPromotional('App <notifications@app.io>', {})).toBe(true)
    expect(isBulkPromotional('News <hi@email.acme.com>', {})).toBe(true)
  })

  it('does NOT flag genuine personal correspondence', () => {
    expect(
      isBulkPromotional('Sarah Chen <sarah@northwind.vc>', {
        labelIds: ['CATEGORY_PERSONAL', 'INBOX'],
      }),
    ).toBe(false)
    expect(isBulkPromotional('Dhravya Shah <dhravya@team.supermemory.ai>', {})).toBe(false)
    expect(isBulkPromotional(undefined, undefined)).toBe(false)
  })
})

describe('isNamedEntity (graph-node hygiene)', () => {
  it('accepts real names', () => {
    expect(isNamedEntity('Sarah Chen')).toBe(true)
    expect(isNamedEntity('Northwind Ventures')).toBe(true)
    expect(isNamedEntity('Atlas')).toBe(true)
  })

  it('rejects placeholders and generic roles', () => {
    for (const junk of ['<UNKNOWN>', 'the team', 'us', 'someone', 'N/A', 'none', 'X']) {
      expect(isNamedEntity(junk)).toBe(false)
    }
  })
})
