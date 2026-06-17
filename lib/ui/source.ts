// Source + tone presentation maps. Keep the visual language (icon, label, tint)
// consistent across the sidebar, Today cards, Search results, and the graph.

import type { IconName } from '@/components/icons'
import type { TagTone, CardKind } from '@/lib/api/today-schema'

interface Tint {
  bg: string
  color: string
}

const SOURCE_META: Record<string, { label: string; icon: IconName; tint: Tint }> = {
  gmail: { label: 'Gmail', icon: 'mail', tint: { bg: 'rgba(0,113,227,.10)', color: '#0071e3' } },
  calendar: {
    label: 'Calendar',
    icon: 'calendar',
    tint: { bg: 'rgba(0,113,227,.10)', color: '#0071e3' },
  },
  slack: { label: 'Slack', icon: 'slack', tint: { bg: 'rgba(107,63,212,.10)', color: '#6b3fd4' } },
  linear: {
    label: 'Linear',
    icon: 'linear',
    tint: { bg: 'rgba(26,127,55,.10)', color: '#1a7f37' },
  },
  notion: { label: 'Notion', icon: 'notion', tint: { bg: '#f0f0f2', color: '#6e6e73' } },
  github: { label: 'GitHub', icon: 'github', tint: { bg: '#f0f0f2', color: '#6e6e73' } },
  sentry: { label: 'Sentry', icon: 'alert', tint: { bg: 'rgba(227,89,0,.10)', color: '#c2540a' } },
  drive: { label: 'Drive', icon: 'notion', tint: { bg: '#f0f0f2', color: '#6e6e73' } },
  voice_memo: { label: 'Voice', icon: 'mic', tint: { bg: '#f0f0f2', color: '#6e6e73' } },
}

const FALLBACK = {
  label: 'Source',
  icon: 'layers' as IconName,
  tint: { bg: '#f0f0f2', color: '#6e6e73' },
}

export function sourceMeta(source: string) {
  return SOURCE_META[source] ?? FALLBACK
}

export function sourceLabel(source: string): string {
  return sourceMeta(source).label
}

export function sourceIcon(source: string): IconName {
  return sourceMeta(source).icon
}

export function sourceTint(source: string): Tint {
  return sourceMeta(source).tint
}

// Tag pill colors (matches tagStyle() in the mockup).
const TONE: Record<TagTone, Tint> = {
  blue: { bg: 'rgba(0,113,227,.10)', color: '#0071e3' },
  warn: { bg: 'rgba(227,89,0,.10)', color: '#c2540a' },
  calm: { bg: 'rgba(0,0,0,.05)', color: '#6e6e73' },
  green: { bg: 'rgba(26,127,55,.12)', color: '#1a7f37' },
  purple: { bg: 'rgba(107,63,212,.10)', color: '#6b3fd4' },
}

export function toneTint(tone: TagTone): Tint {
  return TONE[tone] ?? TONE.blue
}

// Map a Today card kind to an icon. Source-shaped kinds reuse the source icon.
const KIND_ICON: Record<CardKind, IconName> = {
  email: 'mail',
  calendar: 'calendar',
  slack: 'slack',
  linear: 'linear',
  notion: 'notion',
  github: 'github',
  sentry: 'alert',
  person: 'user',
  company: 'building',
  project: 'layers',
  generic: 'layers',
}

export function kindIcon(kind: CardKind): IconName {
  return KIND_ICON[kind] ?? 'layers'
}

// Entity type -> color/icon for the relationships graph + detail panel.
export function entityColor(type: string): string {
  if (type === 'company') return '#6b3fd4'
  if (type === 'project') return '#1a7f37'
  return '#0071e3' // person / you / default
}

export function entityIcon(type: string): IconName {
  if (type === 'company') return 'building'
  if (type === 'project') return 'layers'
  return 'user'
}
