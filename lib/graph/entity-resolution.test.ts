import { describe, it, expect } from 'vitest'
import { normalizeName } from './entity-resolution'

describe('normalizeName', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeName('  Sarah   Chen  ')).toBe('Sarah Chen')
    expect(normalizeName('Northwind\tVentures')).toBe('Northwind Ventures')
  })

  it('preserves display casing (matching is case-insensitive at the SQL layer)', () => {
    expect(normalizeName('ACME Corp')).toBe('ACME Corp')
  })
})
