import { describe, it, expect } from 'vitest'
import { chooseMeeting, nameFromEmail, type MeetingCandidate } from './meeting-prep'

const m = (id: string, startMs: number, emails: string[] = ['x@y.com']): MeetingCandidate => ({
  item_id: id,
  title: id,
  startMs,
  emails,
})

describe('chooseMeeting', () => {
  it('prefers the soonest upcoming meeting', () => {
    const chosen = chooseMeeting([m('past', 500), m('soon', 1500), m('later', 3000)], 1000)
    expect(chosen?.item_id).toBe('soon')
  })
  it('falls back to the most recent past meeting when none are upcoming', () => {
    const chosen = chooseMeeting([m('old', 1000), m('recent', 4000)], 5000)
    expect(chosen?.item_id).toBe('recent')
  })
  it('returns null when there are no candidates', () => {
    expect(chooseMeeting([], 1000)).toBeNull()
  })
})

describe('nameFromEmail', () => {
  it('title-cases a dotted local part', () => {
    expect(nameFromEmail('sarah.chen@lsvp.com')).toBe('Sarah Chen')
  })
  it('handles single-token locals', () => {
    expect(nameFromEmail('anika@anikarao.vc')).toBe('Anika')
  })
})
