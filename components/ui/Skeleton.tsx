// Loading skeletons that echo the geometry of the real cards, so the screens
// don't jump on load.

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-black/[.06] ${className}`} />
}

export function CardSkeleton() {
  return (
    <div className="flex gap-3.5 rounded-card border border-hairline bg-white p-[18px] shadow-card">
      <Skeleton className="h-[38px] w-[38px] flex-none rounded-[11px]" />
      <div className="flex-1 space-y-2.5">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  )
}

export function CardSkeletonList({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  )
}
