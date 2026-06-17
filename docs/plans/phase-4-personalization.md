# Phase 4 — Layer 3 Personalization (Supermemory): Implementation Plan

Cross-session founder profile that shapes answer **ordering and emphasis** without ever
becoming the retrieval. Grounded in the current codebase (`docs/spec.md` Phase 4,
`docs/Architecture.md` §5 Layer 3 / §8 Stage 7 / §9.4, `CLAUDE.md` §9.4).

## 0. Decisions locked (interview)

| #    | Decision         | Resolution                                                                                                                                          |
| ---- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| P4-1 | Write/learn path | **Hybrid**: async auto-inference after each answer (low-confidence, out-of-band) + explicit "remember" (high-confidence).                           |
| P4-2 | Read path        | **Both, with rails**: capped always-on standing priorities + capped question-scoped semantic memories; parallel to search; best-effort / fail-open. |
| P4-3 | Intent gating    | **Yes**: inject full profile for ordering-sensitive intents; skip for precise `lookup`.                                                             |
| P4-4 | Surfaces         | **Ask + Today**, built as one reusable hook so Today/briefing (Phase 6/7) and Search later just "connect the bolts".                                |
| P4-5 | Seeding          | **Both**: deterministic dev seed script (CI/acceptance) + in-app "remember" affordance (live demo).                                                 |

## 1. Invariants (non-negotiable)

- **Personalization is presentation, never retrieval.** It reorders/emphasizes already-retrieved
  items. It cannot add facts, cannot create citations, cannot make a thin answer non-thin.
- **`isThin()` stays citation-only.** A non-empty profile must never cause an answer when zero
  items were retrieved. Refusal-when-thin is unchanged.
- **Tenant-first.** Every Supermemory read and write is namespaced by `containerTags: ['user:'+userId]`.
  Mirrors the `user_id`-first rule for Supabase. No call without it ships.
- **Fail-open, never block.** The read runs parallel to `hybridSearch`, has a short timeout, and
  degrades to an empty profile on any error — exactly how `expandGraph` is wrapped in
  `pipeline.ts` today. Personalization can never slow or break an answer.
- **Writes are out-of-band.** Preference learning runs on Trigger.dev after the conversation, not
  on the hot path and never during ingestion (`docs/Architecture.md` §8 note, `CLAUDE.md` Layer 3).
- **Trusted-but-labeled.** The profile is the founder's own data, but it is still rendered as a
  labeled `FOUNDER PROFILE` block and the synthesis prompt forbids inventing preferences not in it.
- **No em dashes** in any UI string or copy.

## 2. Concept model

A Supermemory **memory** is a small standalone statement about the founder:

- _"Triage investor threads before anything else."_ (standing priority)
- _"Only interested in senior eng hires, no juniors."_ (scoped preference)

Two kinds, distinguished by `metadata.kind`:

- **`standing`** — always-on priorities that should influence _every_ ordering-sensitive answer
  regardless of the question. Fetched by tag (deterministic), capped.
- **`scoped`** — preferences that only apply when the question is relevant. Fetched by semantic
  search on the query, capped, relevance-thresholded.

At Stage 7 (assemble), the two are combined into one `FOUNDER PROFILE:` block placed alongside the
existing `RELATIONSHIPS:` block and the numbered `CONTEXT` items.

## 3. New module: `lib/personalization/`

### 3.1 `lib/personalization/supermemory.ts` — the reusable hook

The single seam that Ask, Today/briefing, and (later) Search all call.

```ts
export interface ProfileBlock {
  block: string // rendered "FOUNDER PROFILE:" text, or '' when empty
  memoryIds: string[] // for observability / trace, not citations
  standingCount: number
  scopedCount: number
}

// READ (hot path). Best-effort, fail-open, intent-gated, bounded.
export async function getProfileBlock(
  userId: string,
  plan: Pick<RetrievalPlan, 'intent' | 'semantic_query'>,
): Promise<ProfileBlock>

// EXPLICIT WRITE (high confidence, standing by default). Used by /api/remember + seed script.
export async function rememberPreference(
  userId: string,
  text: string,
  opts?: { kind?: 'standing' | 'scoped' },
): Promise<void>

// LIST + CORRECT (explicit path). List standing memories for display; delete one after an
// ownership check (memory must carry this user's container tag). Used by GET/DELETE /api/remember.
export async function listStandingPreferences(
  userId: string,
): Promise<Array<{ id: string; text: string }>>
export async function forgetPreference(userId: string, memoryId: string): Promise<void>

// AUTO WRITE (low confidence). Called by the Trigger.dev task, not the hot path.
export async function recordTakeaways(
  userId: string,
  candidates: Array<{ text: string; kind: 'standing' | 'scoped'; confidence: number }>,
): Promise<void>
```

Internal:

- `client()` — lazy Supermemory SDK client built from `SUPERMEMORY_API_KEY`. Throws only if a
  _write_ needs it; reads catch-and-empty.
- `userTag(userId)` → `'user:' + userId`.
- Bounds from env with safe defaults: `SUPERMEMORY_STANDING_LIMIT=5`, `SUPERMEMORY_SCOPED_LIMIT=3`,
  `SUPERMEMORY_SCOPED_MIN_SCORE=0.5`, `SUPERMEMORY_READ_TIMEOUT_MS=800`.

**Timeout helper — pin the exact pattern (one place, copy nowhere else):**

```ts
// lib/personalization/supermemory.ts
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`timeout:${label}:${ms}ms`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(t)) as Promise<T>
}
```

Every Supermemory read goes through `withTimeout(read(), READ_TIMEOUT_MS, '...')`. Do not inline an
ad-hoc `Promise.race` anywhere else; one helper, one behavior, no 3am divergence.

**`getProfileBlock` algorithm**

1. `if (!personalizationEnabled(plan.intent)) return EMPTY` — single gate that also covers the master
   kill switch (3.2).
2. Fire two reads in parallel, each wrapped in `withTimeout(..., READ_TIMEOUT_MS, label)`:
   - **standing**: `memories.list({ containerTags:[tag], metadata:{ kind:'standing' } })`,
     sort by confidence/recency, take `STANDING_LIMIT`.
   - **scoped**: `search.execute({ q: plan.semantic_query, containerTags:[tag] })`,
     drop below `SCOPED_MIN_SCORE`, take `SCOPED_LIMIT`.
     Use `Promise.allSettled` so a slow/failed standing read does not sink a good scoped read (and
     vice versa); each branch independently degrades to `[]`.
3. On timeout or any throw → that branch yields `[]` (fail-open) and logs once; both empty → EMPTY.
4. Render: a short header line + deduped bullet lines (standing first, then scoped). Empty in →
   `block: ''`.

> Build note: confirm the exact `supermemory` SDK surface (`memories.list` / `search.execute`
> shapes, metadata filter support) against the installed version before wiring — verify live,
> do not assume (consistent with the live-verification habit).

### 3.2 `personalizationEnabled(intent)` — intent gate

```ts
const ORDERING_INTENTS = new Set<Intent>([
  'daily_briefing',
  'cross_source',
  'company_summary',
  'investor_summary',
  'followup_detection',
  'blocker_scan',
  'meeting_prep',
])
// One predicate covers BOTH the master kill switch and the per-intent gate, so the two
// can never diverge into separate code paths. 'lookup' is excluded: precise lookups must
// not be reordered by the profile.
export const personalizationEnabled = (i: Intent) =>
  process.env.PERSONALIZATION_ENABLED !== 'false' && ORDERING_INTENTS.has(i)
```

(Default-on: only an explicit `PERSONALIZATION_ENABLED=false` disables it. The write paths check the
same flag before enqueuing/writing.)

## 4. Read-path wiring (Stage 7)

### 4.1 `lib/retrieval/pipeline.ts`

Add a third best-effort branch to the existing `Promise.all`, mirroring the `expandGraph` wrapper:

```ts
const [{ hits, relaxed, diversify }, graph, profile] = await Promise.all([
  hybridSearch(userId, plan, queryEmbedding),
  expandGraph(userId, plan.entities).catch(/* unchanged: returns empty graph */),
  getProfileBlock(userId, plan).catch((err) => {
    console.error('[retrieval] personalization skipped:', (err as Error).message)
    return EMPTY_PROFILE
  }),
])
const items = await rollupToItems(userId, hits, { diversify })
const context = assembleContext(items, graph.facts, profile)
return {
  plan,
  context,
  relaxed,
  itemCount: items.length,
  graphFactCount: graph.facts.length,
  profile,
}
```

Add `profile: ProfileBlock` to `RetrievalResult` (cheap, useful for headers/trace).

### 4.2 `lib/retrieval/assemble.ts`

`assembleContext(items, graphFacts = [], profile?: ProfileBlock)`. Prepend the profile **first**,
before relationships and context, so the model reads priorities before content:

```
FOUNDER PROFILE (durable preferences; shape ordering/emphasis only, never add facts):
- Triage investor threads before anything else.
- Prefer terse answers.

RELATIONSHIPS (from the graph):
- ...

[1] source=gmail type=email ...
```

Rules: profile adds **no** entries to `citations`; `isThin()` is unchanged (citation-only). When
`profile.block` is empty, output is byte-identical to today.

### 4.3 `lib/retrieval/synthesize.ts` + `prompts/answer-synthesis.md`

Extend `SYNTH_SYSTEM` (keep the file and the prompt doc in sync, per `CLAUDE.md`):

- Add to the receives-list: "an optional FOUNDER PROFILE of durable preferences."
- Add a rule: "Use FOUNDER PROFILE only to order and emphasize what you surface. Never treat it as
  a fact source, never cite it, and never invent preferences not written in it. Every factual claim
  still comes from CONTEXT and must carry its [n] citation."
- Keep "no em dashes", "lead with the answer", refuse-when-thin unchanged.

## 5. Write-path (hybrid: auto + explicit)

### 5.1 Auto (out-of-band) — `trigger/personalize.ts`

A Trigger.dev task `learnPreferencesTask` triggered fire-and-forget from the answer route's
existing `onDone` hook (where tracing already closes). Payload: `{ userId, question, answer }`.
The hot path only enqueues; it never runs the extraction inline.

Task steps:

1. One Haiku-class `generateObject` extraction call (Langfuse-traced via `aiTelemetry`) →
   `{ candidates: [{ text, kind, confidence }] }`. Prompt: "From this Q and the founder's reaction,
   extract only DURABLE preferences/priorities (not one-off facts). Empty array if none."
2. Drop candidates below `AUTO_MIN_CONFIDENCE` (default 0.6).
3. Near-duplicate guard: `search.execute` each candidate against existing memories; skip if a close
   match already exists (avoids profile bloat).
4. `recordTakeaways(userId, survivors)` with `metadata: { provenance:'auto', confidence }`.

**Two distinct dedup concerns — one mechanism each, never both:**

- **Same-answer double-fire (retry race).** Handled at the _trigger boundary_ with Trigger.dev's
  built-in `idempotencyKey` (see 5.3). The task simply cannot run twice for one answer, so step 3's
  near-duplicate search can never race itself. This is the only retry-idempotency mechanism — we do
  **not** also store/check a content hash in Supermemory metadata (the rejected duplicate approach).
- **Cross-conversation duplicates (two different answers yielding the same preference).** Handled by
  step 3's semantic near-duplicate guard. Different concern, different layer; it is not idempotency.

Out-of-band on Trigger.dev keeps answer latency untouched and matches the "written after
conversations" mandate.

### 5.2 Explicit — `app/api/remember/route.ts` + UI (add, list, and **correct**)

A founder who can add a standing preference will, in the same breath, want to retract one
("actually, stop prioritizing investor threads"). An add-only surface is a real product gap that
surfaces in the walkthrough, so the explicit path is full CRUD-lite from day one:

- `POST /api/remember { text }` → `getUserId(req)` (server-side, same as `/api/answer`) →
  `rememberPreference(userId, text, { kind:'standing' })`. Explicit prefs are standing + confidence 1.
- `GET /api/remember` → list the founder's standing memories (`{ id, text }[]`) for display.
- `DELETE /api/remember/:memoryId` → `getUserId` + ownership check (the memory's `containerTags` must
  contain `user:<id>` before deletion; never delete cross-tenant) → `forgetPreference(userId, memoryId)`,
  a new thin wrapper over `client().memories.delete`.
- UI affordance in `app/ask/page.tsx`: a small "Remember a preference" inline input, plus a compact
  list of current standing preferences each with a "Forget" control wired to the DELETE route. This
  is the correction path; no separate `/api/forget` needed. No em dashes in the copy. Minimal styling
  now; pixel-faithful version lands with the Phase 6 Ask rebuild.
- Add `forgetPreference(userId, memoryId)` to the module surface (§3.1) alongside `rememberPreference`.

### 5.3 Answer-route hook — `app/api/answer/route.ts`

In `buildAnswer`'s `onDone(output)` (already the single place the trace closes), after the trace
flush, fire-and-forget with an idempotency key derived from the answer so a Trigger.dev retry of the
enqueue (or a duplicate request) cannot spawn a second learning run:

```ts
void tasks
  .trigger(
    'learn-preferences',
    { userId, question, answer: output },
    { idempotencyKey: `learn:${userId}:${hash(question + output)}` },
  )
  .catch((e) => console.error('[personalize] enqueue failed', e))
```

Guarded so it can never throw into the stream or block the response. Skipped on the thin/refusal path
and when `PERSONALIZATION_ENABLED === 'false'`.

## 6. Today / briefing readiness (surface 2, "connect the bolts")

The Today briefing (Phase 6 UI / Phase 7 precompute) reuses the _same_ primitives — no new wrapper.
A wrapper around `getProfileBlock` + `assembleContext` would add indirection without adding safety,
so we do not build one. Instead we pin the contract in the plan and let the later phase call the
existing functions directly:

- `trigger/briefing.ts` (Phase 7) builds its plan with `intent: 'daily_briefing'` (ordering-sensitive,
  so the profile fires through the existing gate) and calls `getProfileBlock(userId, plan)` then
  `assembleContext(items, facts, profile)` exactly as the answer path does. Zero personalization-specific
  code to write there.
- The only Phase 4 obligation is that `getProfileBlock` and `assembleContext` stay
  reusable/side-effect-free (they already are). That _is_ the seam; no extra export needed.

No Today UI is built in Phase 4; the personalization primitives it will call already exist after 4b.

## 7. Seeding (both)

- `scripts/seed-preference.ts` — `tsx` script; writes the canonical demo preference
  _"Triage investor threads before anything else in the morning."_ as a `standing` memory for the
  live-verification tenant (`4847c952-...`). Used by the acceptance test and the eval fixture.
  Idempotent (skip if present).
- In-app "remember" affordance (5.2) for the live demo narrative.

## 8. Env & deps

- `pnpm add supermemory` (official SDK; velocity over hand-rolled REST, swap-isolated behind the module).
- `.env.example` / `.env.local`: `SUPERMEMORY_API_KEY` already present (parity confirmed). Add the
  optional tuning vars from §3.1 to `.env.example` with no values, plus `PERSONALIZATION_ENABLED=true`
  master switch (read once in `getProfileBlock`; off → `EMPTY`).

## 9. Observability

- Langfuse span around `getProfileBlock` (latency, standingCount, scopedCount, timed-out?).
- The extraction call in `trigger/personalize.ts` traced via `aiTelemetry('learn-preferences')`,
  reusing the isolated-tracer pattern already in `lib/observability/langfuse.ts`.
- Surface `profile.standingCount/scopedCount` in the `x-zrux-meta` header for the Ask UI. This works
  for Ask because it reads the header before draining the stream (see `app/ask/page.tsx`).
- **Caveat for Today (Phase 6):** a precomputed/streamed briefing will not reliably read response
  headers — the Today page renders cached briefing rows, not a live fetch with header access. So
  personalization provenance for Today must travel **with the briefing payload itself** (a field on
  the cached briefing record), or via a separate lightweight status call, **not** the `x-zrux-meta`
  header. Note this now so Phase 6 does not assume the header is available there.

## 10. Tests (vitest)

- `lib/personalization/supermemory.test.ts` (mock SDK):
  - every read/write carries the `user:<id>` container tag (tenant isolation),
  - `lookup` intent → `getProfileBlock` returns EMPTY (gate),
  - bounding caps standing at 5 / scoped at 3, scoped below min-score dropped,
  - SDK throw / timeout → EMPTY (fail-open), never rejects.
- `lib/retrieval/assemble.test.ts` (extend): profile renders before relationships+context; empty
  profile → output unchanged; profile adds no citations and does not affect `isThin`.
- `trigger/personalize.test.ts`: extraction parsing, confidence filter, near-duplicate skip.
- `app/api/remember` route tests: DELETE refuses a `memoryId` lacking the caller's container tag
  (ownership), GET lists only the caller's standing memories, `forgetPreference` removes it.

## 11. Acceptance (spec Phase 4 + invariants)

1. **Seeded preference reorders.** With the seeded "investors first" memory, _"What should I focus
   on today?"_ surfaces investor items first; deleting the memory restores prior ordering.
2. **Empty profile = unchanged.** A tenant with no memories gets byte-identical assembly/answers.
3. **Lookup unaffected.** A precise `lookup` question carries no profile (gate verified in trace).
4. **Fail-open.** Supermemory unreachable → answers still return, profile empty, no 5xx, one log line.
5. **No invented facts.** Profile never adds a citation; a thin context still refuses despite a
   non-empty profile.
6. **Round-trip.** "Remember: triage investor threads first" via UI then a fresh briefing reflects it;
   auto-inference writes a `provenance:auto` memory after a relevant conversation.
7. **Correction.** A founder deletes a standing preference via the Forget control; the next ordering
   sensitive answer no longer reflects it. Deleting another tenant's `memoryId` is refused (ownership
   check). A retried learning task does not create a duplicate (idempotencyKey verified).

## 12. Sub-phases (each independently shippable; branch + push per `CLAUDE.md`)

- **4a — Module + env + deps.** `supermemory.ts` skeleton, `ProfileBlock` type, intent gate, env vars,
  SDK install. Green: unit tests for gate + tenant tag + fail-open pass; no behavior change to answers.
- **4b — Read path.** Wire `getProfileBlock` into `pipeline.ts`, `assemble.ts`, `synthesize.ts` +
  prompt doc. Green: acceptance 1–5 with the seed script.
- **4c — Write path.** `trigger/personalize.ts` (with Trigger.dev `idempotencyKey`), `/api/remember`
  (POST add / GET list / DELETE :memoryId correct), answer-route enqueue, Ask UI affordance with the
  add + Forget controls. Green: acceptance 6 + 7 (correction round-trip).
- **4d — Today seam + seed + docs.** `assembleBriefingContext` export, `scripts/seed-preference.ts`,
  README/trade-off note. Green: briefing seam consumes the hook in a unit test; seed script idempotent.

Cut marker (spec D14): Phase 4 is "survivable to cut, but cheap; keep unless time is dire." If
cutting, drop in reverse sub-phase order (4d → 4c → 4b), leaving the read path last since it carries
the visible ordering uplift.
