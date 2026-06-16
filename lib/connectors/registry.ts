// Source -> Connector registry. Phase 1 ships Gmail, Calendar, Linear; Phase 2
// adds Slack + one of Notion/GitHub/Sentry against the same contract.

import type { Connector, SourceName } from './types'
import { gmailConnector } from './gmail'
import { calendarConnector } from './calendar'
import { linearConnector } from './linear'

const REGISTRY: Partial<Record<SourceName, Connector>> = {
  gmail: gmailConnector,
  calendar: calendarConnector,
  linear: linearConnector,
}

export function getConnector(source: SourceName): Connector {
  const c = REGISTRY[source]
  if (!c) throw new Error(`No connector registered for source: ${source}`)
  return c
}

export function connectableSources(): SourceName[] {
  return Object.keys(REGISTRY) as SourceName[]
}

export function isConnectable(source: string): source is SourceName {
  return source in REGISTRY
}
