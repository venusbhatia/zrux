// Shared empty / zero-data state. Real tenants start with nothing connected, so
// every screen degrades to one of these instead of mock content.

import Link from 'next/link'
import { Icon, type IconName } from '@/components/icons'

export function EmptyState({
  icon = 'layers',
  title,
  body,
  actionHref,
  actionLabel,
}: {
  icon?: IconName
  title: string
  body: string
  actionHref?: string
  actionLabel?: string
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-card bg-white text-muted shadow-flat">
        <Icon name={icon} size={22} />
      </div>
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      <p className="text-sm leading-relaxed text-muted">{body}</p>
      {actionHref && actionLabel && (
        <Link
          href={actionHref}
          className="mt-1 rounded-pill bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-press"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  )
}
