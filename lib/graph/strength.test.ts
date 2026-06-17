import { describe, it, expect } from 'vitest'
import {
  scoreContact,
  aggregateContacts,
  deriveSurfaces,
  normalizeEmail,
  parseEmails,
  type Interaction,
  type RankedContact,
} from './strength'

const NOW = new Date('2026-06-17T00:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

function inbound(n: number, opts: Partial<Interaction> = {}): Interaction {
  return { ts: daysAgo(n), direction: 'inbound', ccCount: 0, threadId: `t${n}`, ...opts }
}
function outbound(n: number, opts: Partial<Interaction> = {}): Interaction {
  return { ts: daysAgo(n), direction: 'outbound', ccCount: 0, threadId: `t${n}`, ...opts }
}

describe('scoreContact', () => {
  it('scores a frequent ONE-WAY newsletter LOW (no reciprocity gate)', () => {
    // 20 recent inbound-only messages, never replied to.
    const news = Array.from({ length: 20 }, (_, i) => inbound(i, { threadId: `n${i}` }))
    const { score, factors } = scoreContact(news, NOW)
    expect(factors.reciprocity).toBe(0)
    expect(factors.responsiveness).toBe(0)
    expect(score).toBeLessThan(20) // frequent + recent but one-way => weak
  })

  it('scores a balanced two-way 1:1 correspondent HIGH', () => {
    // 6 threads, each with an inbound + an outbound (a real back-and-forth).
    const conv: Interaction[] = []
    for (let i = 0; i < 6; i++) {
      conv.push(inbound(i * 2 + 1, { threadId: `c${i}` }))
      conv.push(outbound(i * 2, { threadId: `c${i}` }))
    }
    const { score, factors } = scoreContact(conv, NOW)
    expect(factors.reciprocity).toBeGreaterThan(0.9)
    expect(factors.responsiveness).toBeGreaterThan(0.5)
    expect(score).toBeGreaterThan(50)
    expect(score).toBeGreaterThan(scoreContact([inbound(0)], NOW).score)
  })

  it('a two-way contact beats a one-way one at equal volume/recency', () => {
    const oneWay = Array.from({ length: 8 }, (_, i) => inbound(i, { threadId: `o${i}` }))
    const twoWay = Array.from({ length: 8 }, (_, i) =>
      i % 2
        ? outbound(i, { threadId: `w${Math.floor(i / 2)}` })
        : inbound(i, { threadId: `w${Math.floor(i / 2)}` }),
    )
    expect(scoreContact(twoWay, NOW).score).toBeGreaterThan(scoreContact(oneWay, NOW).score)
  })

  it('recency decays: a dormant relationship scores below a fresh one', () => {
    const fresh = [inbound(1), outbound(2), inbound(3)]
    const dormant = [inbound(120), outbound(121), inbound(122)]
    expect(scoreContact(fresh, NOW).score).toBeGreaterThan(scoreContact(dormant, NOW).score)
    expect(scoreContact(dormant, NOW).factors.dormancyDays).toBeGreaterThan(100)
  })

  it('penalizes mass-CC (low privacy) vs 1:1', () => {
    const oneOnOne = [inbound(1, { ccCount: 0 }), outbound(2, { ccCount: 0 })]
    const massCc = [inbound(1, { ccCount: 40 }), outbound(2, { ccCount: 40 })]
    expect(scoreContact(oneOnOne, NOW).factors.privacy).toBeGreaterThan(
      scoreContact(massCc, NOW).factors.privacy,
    )
  })
})

describe('aggregateContacts (direction from metadata)', () => {
  const identity = { email: 'me@founder.com', name: 'Me' }

  it('classifies inbound by sender and outbound by SENT label / founder sender', () => {
    const rows = [
      {
        source: 'gmail',
        type: 'email',
        author: 'Alice <alice@x.com>',
        url: 'u1',
        title: 'hi',
        metadata: { to: 'me@founder.com', threadId: 'T1', labelIds: ['INBOX'] },
        source_created_at: daysAgo(2).toISOString(),
      },
      {
        source: 'gmail',
        type: 'email',
        author: 'Me <me@founder.com>',
        url: 'u2',
        title: 're: hi',
        metadata: { to: 'Alice <alice@x.com>', threadId: 'T1', labelIds: ['SENT'] },
        source_created_at: daysAgo(1).toISOString(),
      },
    ]
    const contacts = aggregateContacts(rows as never, identity)
    expect([...contacts.keys()]).toEqual(['alice@x.com'])
    const alice = contacts.get('alice@x.com')!
    expect(alice.name).toBe('Alice')
    expect(alice.interactions.map((i) => i.direction).sort()).toEqual(['inbound', 'outbound'])
    expect(alice.lastUrl).toBe('u2') // most recent interaction's source link
  })

  it('never creates a contact for the founder themselves', () => {
    const rows = [
      {
        source: 'gmail',
        type: 'email',
        author: 'Me <me@founder.com>',
        url: 'u',
        title: 'note to self',
        metadata: { to: 'me@founder.com', threadId: 'S', labelIds: ['SENT'] },
        source_created_at: daysAgo(1).toISOString(),
      },
    ]
    expect(aggregateContacts(rows as never, identity).size).toBe(0)
  })
})

describe('deriveSurfaces', () => {
  it('separates strongest, losing-touch, and awaiting-reply', () => {
    const strong: RankedContact = {
      score: 70,
      email: 'a@x.com',
      name: 'A',
      lastUrl: null,
      lastTitle: null,
      factors: {
        inbound: 5,
        outbound: 5,
        meetings: 0,
        dormancyDays: 3,
        responsiveness: 1,
      } as never,
    }
    const dormant: RankedContact = {
      score: 30,
      email: 'b@x.com',
      name: 'B',
      lastUrl: null,
      lastTitle: null,
      factors: {
        inbound: 4,
        outbound: 4,
        meetings: 0,
        dormancyDays: 60,
        responsiveness: 1,
      } as never,
    }
    const waiting: RankedContact = {
      score: 10,
      email: 'c@x.com',
      name: 'C',
      lastUrl: null,
      lastTitle: null,
      factors: {
        inbound: 0,
        outbound: 2,
        meetings: 0,
        dormancyDays: 5,
        responsiveness: 0,
        lastOutboundTs: daysAgo(5).getTime(),
        lastInboundTs: 0,
      } as never,
    }
    const s = deriveSurfaces([strong, dormant, waiting])
    expect(s.strongest.map((c) => c.email)).toContain('a@x.com')
    expect(s.losingTouch.map((c) => c.email)).toEqual(['b@x.com'])
    expect(s.awaitingReply.map((c) => c.email)).toEqual(['c@x.com'])
  })
})

describe('email parsing', () => {
  it('normalizes and splits headers', () => {
    expect(normalizeEmail('Venus <Venus@Gmail.com>')).toBe('venus@gmail.com')
    expect(normalizeEmail('not an email')).toBeNull()
    expect(parseEmails('a@x.com, Bob <b@y.com>')).toEqual(['a@x.com', 'b@y.com'])
  })
})
