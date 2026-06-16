// Shared connector helpers. The undercollection guard catches the silent failure
// mode where a paged fetch reports more results than we actually streamed (a
// dropped page, a truncated response, a toolkit field drift). It never throws -
// ingestion is best-effort and self-heals on the next run - but it makes the gap
// loud so it is not mistaken for "the source had nothing" (spec Phase 2).

export function warnOnUndercollection(
  source: string,
  collected: number,
  reportedTotal: number | undefined,
): void {
  if (reportedTotal === undefined || !Number.isFinite(reportedTotal)) return
  if (collected < reportedTotal) {
    console.warn(
      `[connector:${source}] under-collected: streamed ${collected} of ${reportedTotal} ` +
        `reported items. Possible dropped page or response truncation.`,
    )
  }
}
