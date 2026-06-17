// Shared types + helpers for the relationships view (page + StrengthGraph +
// ContactDetail). Mirrors the /api/graph response shape.

export interface Factors {
  recency: number
  frequency: number
  reciprocity: number
  responsiveness: number
  privacy: number
  longevity: number
  inbound: number
  outbound: number
  meetings: number
  lastInteraction: string
  firstInteraction: string
  dormancyDays: number
}

export interface Contact {
  email: string
  name: string
  org: string | null
  score: number
  channel: 'meeting' | 'email_2way' | 'email_outbound' | 'email_inbound'
  factors: Factors
  lastUrl: string | null
  lastTitle: string | null
}

// Two-letter initials for an avatar, from a display name or email.
export function initials(name: string): string {
  const parts = name.split(/[\s.@]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}
