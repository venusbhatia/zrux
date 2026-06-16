import { describe, it, expect, vi } from 'vitest'

// Importing the registry pulls in every connector, each of which imports
// ./composio (-> @composio/core). Stub it so the registry loads without the SDK.
vi.mock('./composio', () => ({ executeTool: vi.fn() }))

import { connectableSources, isConnectable, getConnector } from './registry'

describe('connector registry', () => {
  it('exposes exactly the five Phase 1+2 connectable sources', () => {
    expect(new Set(connectableSources())).toEqual(
      new Set(['gmail', 'calendar', 'linear', 'slack', 'notion']),
    )
  })

  it('isConnectable narrows registered sources and rejects unregistered ones', () => {
    expect(isConnectable('gmail')).toBe(true)
    expect(isConnectable('github')).toBe(false)
    expect(isConnectable('nope')).toBe(false)
  })

  it('getConnector returns the connector for a registered source', () => {
    expect(getConnector('gmail').source).toBe('gmail')
  })

  it('getConnector throws for a source with no registered connector', () => {
    // github is a valid SourceName but is not in the registry yet.
    expect(() => getConnector('github')).toThrow(/No connector registered/)
  })
})
