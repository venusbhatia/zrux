# Phase 4 (Layer 3 Personalization) - Tradeoffs and difficulties

Notes captured while building, for the 15-minute walkthrough. These are the
decisions that were not obvious from the plan and the friction hit on the way.

## Difficulties hit during the build

### 1. The Supermemory SDK surface did not match the plan's assumptions

The plan was written against an assumed API (`memories.list({ metadata })`,
`search.execute` on a `memories` resource). The installed `supermemory@4.24.12`
is actually structured as:

- write: `documents.add({ content, containerTag, metadata, customId })`
- list: `documents.list({ containerTags, filters, includeContent })` -> `{ memories: [...] }`
- delete: `documents.delete(id)`
- search: `search.execute({ q, containerTag, documentThreshold })` -> `{ results: [...] }`

I verified every signature against `node_modules/supermemory/resources/*.d.ts`
before wiring (the live-verification habit), rather than coding to the plan and
discovering the mismatch at runtime. The module's public contract
(`getProfileBlock`, `rememberPreference`, etc.) is unchanged; only the internals
bind to the real SDK. This is exactly why the plan put Supermemory behind a single
module seam: the swap was isolated to one file.

### 2. Container tags cannot contain a colon

The plan specified the tenant tag as `user:<id>`. The SDK documents the
container-tag charset as alphanumeric plus `-`, `_`, `.` only, so a colon would be
rejected by the API. Changed the tag to `user_<id>`. The invariant (tenant-first,
every read/write namespaced) is unchanged; only the separator moved. A unit test
now asserts the tag contains no colon so this cannot silently regress.

### 3. `documents.list` has no per-field metadata convenience; filters are nested

Filtering standing memories by `metadata.kind = 'standing'` goes through the
generic `filters: { AND: [{ key, value, filterType: 'metadata' }] }` shape, not a
simple `metadata` object. Confidence/recency sorting is done client-side after the
fetch because the list endpoint sorts by `createdAt`/`updatedAt` only, not by a
metadata number. At the cap sizes here (<= 50 fetched, top 5 kept) that is free.

### 4. Async indexing means a freshly written preference is not instantly readable

Supermemory processes an added document through a pipeline
(`queued -> extracting -> ... -> done`). A preference added via `/api/remember` or
the seed script may not appear in `search.execute` (and may lack `content` in
`documents.list`) for a short window until indexing completes. For the demo this
is usually sub-second, but it means the round-trip acceptance test should allow a
brief settle, and the list path filters out memories whose `content` has not
materialized yet. Noted so the walkthrough does not race it.

### 5. Module-level env consts vs. testability

`AUTO_MIN_CONFIDENCE` was first read into a module-level `const`, which bakes the
value at import and makes a "respects a custom floor" unit test impossible (the env
set in the test runs after import). Moved that read inside `runLearn`. The
read-path bounds (`SUPERMEMORY_*_LIMIT`) stay module-level because nothing needs to
vary them per-call; only the value a test must override moved.

### 6. Test infra gaps surfaced, not assumed away

- vitest's `include` did not cover `trigger/**`, so the learner test would have
  silently never run. Added `trigger/**/*.test.ts`.
- vitest had no `@` path alias, so App Router route handlers (which import via
  `@/lib/...`) could not be unit-tested. Added a `resolve.alias` mirroring tsconfig.
  Both are the kind of "green but actually not running" trap worth calling out.

## Live verification findings (only surfaced against the real service)

A `scripts/verify-personalization.ts` end-to-end run against the real Supermemory
service (14 checks, now all green) caught four things unit tests with a mocked SDK
could never have:

1. **`search.execute` silently ignores the singular `containerTag`.** Scoping a
   search on `containerTag` (singular) returned zero results; only `containerTags`
   (array) actually filters. The singular form is accepted by the types, so this
   was a clean compile that would have made scoped retrieval and the auto-learn
   near-duplicate guard never work in production. Both call sites now use the array.

2. **800ms read timeout was too tight for real latency.** Measured live: a cold
   Supermemory request is ~2s and the scoped search spikes near 1s (Cloudflare +
   auth/org lookups). At 800ms the read timed out on legitimate data and fail-open
   silently emptied the profile, so the feature would have looked broken in the
   demo. Raised the default to 2500ms (still bounded, still fail-open).

3. **The server-side metadata filter on `documents.list` lags under churn.**
   Filtering standing memories with `filters: kind=standing` intermittently returned
   zero while a plain container-tag list returned the row immediately and search
   found it. Switched `readStanding` to list by tag and filter `kind` CLIENT-SIDE,
   removing the dependency on that index entirely (the cap makes the extra rows
   free). This was the single highest-value fix: without it the standing profile was
   flaky exactly when it mattered.

4. **You cannot delete a memory mid-processing (HTTP 409).** Deleting a preference
   right after adding it ("still processing") 409s, and processing can take 15s+
   under load. Blocking the DELETE that long is wrong, so `forgetPreference` retries
   briefly then raises `StillProcessingError`, which the route maps to a clean 409
   "try again in a moment" rather than a 19s hang and a 502. Deleting a preference
   from a prior session (fully processed) succeeds instantly, which is the common
   case.

The recurring lesson: this whole module talks to an external, eventually-consistent,
async-processing service over a Cloudflare edge. Three of the four bugs were latency
or consistency behaviors that a mocked test cannot model. The live script is kept in
`scripts/` as an acceptance harness; run it on a quiet account (rapid repeated runs
saturate the free-tier processing queue and make fresh writes lag the read window,
which is a test-harness artifact, not a product bug).

> Note: full `/api/answer` end-to-end was initially blocked because an unrelated,
> pre-existing DB function (`public.distinct_sources`, migration `0005`, used by
> `lib/retrieval/search.ts` at Stage 2) had drifted out of the connected Supabase
> instance (`hybrid_search` from `0002` was present, `0005` was not). Applying the
> existing migration to the remote DB resolved it. The full answer-path round-trip
> then verified live on the demo tenant: no preference leads with the payments
> webhook; adding "triage investor threads first" makes the answer lead with the
> Northwind investor thread (`personalization.standing = 1`, citations intact);
> deleting it reverts to webhook-first; a precise `lookup` carries no profile.
>
> One prompt change came out of that live test: the FOUNDER PROFILE rule in
> `SYNTH_SYSTEM` was too soft ("use it only to order and emphasize"), so the model
> kept leading with its own urgency judgment (a production outage) even with an
> explicit "investors first, ahead of engineering issues" preference. Tightened to
> "lead with the items that match the stated ordering preference, even when others
> seem more urgent", which made the reorder actually visible while leaving grounding
> and citation rules unchanged.

## Design tradeoffs (deliberate)

### Presentation, never retrieval

Personalization only reorders/emphasizes already-retrieved items. It adds no
citations, and `isThin()` stays citation-only, so a non-empty profile can never
turn a zero-item (thin) context into an answer. The profile rides inside the
assembled CONTEXT block as a labeled `FOUNDER PROFILE` section that the synthesis
prompt is explicitly forbidden from treating as a fact source. Verified by a test
that a profile + zero items still refuses.

### Fail-open, parallel, bounded

The read runs as a third branch of the existing `Promise.all` alongside search and
graph expansion, wrapped in `.catch -> EMPTY_PROFILE`, with each Supermemory call
behind a single `withTimeout` helper (default 800ms) and `Promise.allSettled` so a
slow standing read cannot sink a good scoped read. Personalization can never slow
or break an answer. This mirrors how `expandGraph` is already wrapped.

### Two dedup concerns, one mechanism each (no content-hash in metadata)

- Same-answer double-fire (a Trigger.dev retry of the enqueue) is handled purely by
  the `idempotencyKey` at the trigger boundary. The task cannot run twice for one
  answer, so the near-duplicate search can never race itself.
- Cross-conversation duplicates (two different answers yielding the same preference)
  are handled by a semantic near-duplicate search before writing.
  These are different layers; conflating them into a stored content hash was the
  rejected approach and would have added state for no benefit.

### Explicit path is CRUD-lite, not add-only

A founder who can add a standing preference will immediately want to retract one.
`/api/remember` is POST (add) + GET (list) + DELETE `:memoryId` (correct), with an
ownership check: `forgetPreference` refuses any id not in the caller's
tenant-scoped list, and the route returns 404 (not 403) so it never reveals that an
id exists for another tenant.

### No Today wrapper (the seam, now consumed by the Today briefing)

The Today briefing reuses `getProfileBlock` + `assembleContext` directly with an
`intent: 'daily_briefing'` plan; a wrapper would add indirection without adding
safety. After main shipped the Today page + `GET /api/today`, that route was wired
to personalization with no new personalization-specific code: it already calls
`retrieve()`, which runs `getProfileBlock` and folds the FOUNDER PROFILE into the
CONTEXT block for the daily_briefing intent. Two small additions made it land:
the `TODAY_SYSTEM` prompt now carries the same "lead with the items matching the
stated ordering preference" rule as answer synthesis, and the response surfaces
`personalization: { standing, scoped }` on the payload (NOT the `x-zrux-meta`
header, because a precomputed/cached briefing is rendered from the record, not a
live fetch with header access). Verified live on the demo tenant: with "triage
investor threads first" the briefing leads with the investor cards (Sarah Chen,
Northwind) and reports `standing: 1`; removing it reverts and reports `0`. A route
unit test pins the provenance passthrough on both the full and thin paths.

### Out-of-band learning, never on the hot path

Preference learning runs on Trigger.dev, enqueued fire-and-forget from the answer
route's `onFinish` and skipped on the thin/refusal path. Answer latency is
untouched. The learner uses a Haiku-class extraction with a conservative confidence
floor (default 0.6), matching the "updated after conversations, not during
ingestion" mandate.

## Known limitations / future work

- Supermemory remains a managed-service dependency (Layer 3). A hand-rolled
  `founder_profile` table is the production-hardened alternative and is more
  consistent with owning the context engine; deferred for 48-hour velocity, as the
  module seam keeps it a one-file swap.
- Observability: the read is intended to carry a Langfuse span (latency, standing/
  scoped counts, timed-out?). Counts are surfaced to the Ask UI via `x-zrux-meta`
  today; a dedicated span around `getProfileBlock` is a small follow-up. Note the
  header channel does not reach a precomputed Today briefing (it renders cached
  rows, not a live fetch), so Phase 6 must carry personalization provenance on the
  briefing payload, not the header.
- The near-duplicate threshold (0.85) and scoped min-score (0.5) are untuned
  defaults; they want a small eval pass against real preferences before relying on
  the auto-learn path in production.
