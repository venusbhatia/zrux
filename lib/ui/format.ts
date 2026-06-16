// Small display formatters shared across the Phase 6 screens.

export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const then = new Date(iso)
  const ms = now.getTime() - then.getTime()
  if (Number.isNaN(ms)) return ''
  const sec = Math.round(ms / 1000)
  if (sec < 45) return 'now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d`
  const month = Math.round(day / 30)
  if (month < 12) return `${month}mo`
  return `${Math.round(month / 12)}y`
}

export function initials(name: string | null | undefined): string {
  if (!name) return 'Y'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'Y'
  return parts
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

// Derive a readable company hint from an email domain (acme.com -> Acme). Never
// invents a name: returns null when there is nothing to derive from.
export function companyFromEmail(email: string | null | undefined): string | null {
  if (!email || !email.includes('@')) return null
  const domain = email.split('@')[1] ?? ''
  const base = domain.split('.')[0] ?? ''
  if (!base || base === 'gmail' || base === 'outlook' || base === 'icloud' || base === 'yahoo') {
    return null
  }
  return base.charAt(0).toUpperCase() + base.slice(1)
}
