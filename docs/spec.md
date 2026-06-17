# docs/spec.md — zrux Implementation Spec (Sequenced Build Plan)

This is the **execution plan**: what to build, in what order, where each piece lives, and how to know a phase is done. It does not restate the system design.

- **Why we build it / product thesis / tradeoffs** → `docs/Architecture.md`
- **Standing orders / conventions / schemas / prompts** → `CLAUDE.md`
- **What to build next and the bar for "done"** → this file

Read all three before a session. Where this file and the design docs agree, the design docs are the reference. Where this file resolves something the design docs left open, **this file wins** (see the Decisions Ledger).

---

## 0. Decisions Ledger (resolved, binding)

These were decided in the build-kickoff interview and override any looser reading of `CLAUDE.md` / `docs/Architecture.md`.

| #   | Decision                            | Resolution                                                                                                                                                                                                                                              | Consequence                                                                                                                         |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Scope ambition                      | **Attempt the full architecture**                                                                                                                                                                                                                       | Every layer and surface is in scope; sequenced so the spine ships first (see D14 cut order).                                        |
| D2  | Demo data                           | **Purely real accounts, no seeded narrative**                                                                                                                                                                                                           | The mockup "Acme renewal" content is placeholder visuals only. Real answers come from each tenant's own connected data.             |
| D3  | Tenancy + auth                      | **Real multi-tenant, NextAuth login**                                                                                                                                                                                                                   | Every visitor logs in and connects their own accounts. RLS + `user_id` scoping is exercised for real, not theater.                  |
| D4  | How reviewed                        | **Hosted on Vercel; reviewer connects their own accounts**                                                                                                                                                                                              | Onboarding and cold-start are first-class. The app must produce a good answer over a stranger's last-90-days, not a scripted story. |
| D5  | Live sources                        | **Gmail + Calendar, Linear, Slack, and at least one of Notion/GitHub/Sentry**                                                                                                                                                                           | All via Composio managed OAuth (Linear/Sentry may use token). Same `Connector` contract for all.                                    |
| D6  | Keys available                      | **All groups in hand**: Core (OpenRouter, OpenAI, Supabase), Composio, Quality (Cohere, Deepgram, Upstash), Ops (Trigger.dev, Supermemory, Langfuse)                                                                                                    | No piece is forced into a stub for lack of a key. The only limiter is time.                                                         |
| D7  | Initial load window                 | **Last 90 days, all sources**                                                                                                                                                                                                                           | Bounds ingest cost and latency; wide enough for "this quarter" questions. Encoded as `INGEST_LOOKBACK_DAYS=90`.                     |
| D8  | Onboarding                          | **Guided stepper** with live per-source indexing progress; unlock Ask/Today as soon as first items land                                                                                                                                                 | New screens, built in the existing design system.                                                                                   |
| D9  | UI fidelity                         | **Pixel-faithful** recreation of the four mockup screens (Today, Ask, Relationships, Search) + landing; onboarding matches the design system                                                                                                            | Source of truth: `docs/design/project/Zrux App.dc.html` and `Zrux Landing.html`.                                                    |
| D10 | Today briefing generation           | **Precompute + cache per user** (Trigger.dev, staggered, plus after-ingest), served instantly, manual refresh regenerates                                                                                                                               | Implements the §11 thundering-herd mitigation for real.                                                                             |
| D11 | Telegram                            | **Stretch only**                                                                                                                                                                                                                                        | In-app proactive briefing ships for everyone; Telegram per-user link + push is wired only if time remains.                          |
| D12 | Audio ingestion                     | **Google Drive audio files** through Deepgram Nova-3 batch (diarized)                                                                                                                                                                                   | No upload UI. Tap-to-talk voice _question input_ on Ask is an optional stretch; keep the mic affordance in the UI.                  |
| D13 | Eval harness                        | **Lean two-part**: (a) a seeded fixture tenant with golden `question → expected item IDs` for recall@k + citation correctness in CI; (b) an LLM-judge groundedness check that every claim in an answer is cited and supported, runnable over any tenant | High signal, low build cost. Not a full golden-set platform.                                                                        |
| D14 | Sacrifice order under time pressure | **Cut in this order:** 1) Drive-audio ingestion, 2) Telegram, 3) eval harness, 4) Relationships graph polish                                                                                                                                            | **Never** sacrifice: Layer 1 ingest→retrieve→cited-answer, the Ask screen, the Today briefing.                                      |

---

## 1. Definition of Done (the submission bar)

The build is "submittable" when all of these are true:

1. A reviewer can open the hosted URL, sign in, connect **Gmail + Calendar + one more source**, watch a 90-day ingest complete, and ask the three demo questions getting grounded, cited answers.
2. Every factual sentence in an answer carries a `[n]` citation that resolves to a real retrieved `context_item` from that reviewer's data.
3. When context is thin, the assistant says so and does not invent.
4. No secret is in the repo; `.env.example` lists every variable name with no values.
5. README has setup, the connected-sources list, 3+ tested example questions, and a tradeoffs/future-work section.
6. A Traces link captures the AI-assisted build from the start.

The three demo questions (must work, see `CLAUDE.md`):

1. What should I focus on today?
2. Summarize investor activity this week.
3. Which tasks are blocked right now?

---

## 2. Build Phases

Each phase is **independently shippable**: if the clock stops at the end of any phase, what exists is a coherent working slice, not a half-wired one. Phases roughly map to `docs/Architecture.md §14` but with concrete files and acceptance gates. Cut markers reference D14.

Branch per phase (`feature/<phase-slug>`); commit and push on every green acceptance gate, per the `CLAUDE.md` git workflow.

---

### Phase 0 — Project skeleton & infrastructure (no product yet)

**Goal:** a deployable empty Next.js app wired to Supabase, env-driven, with the DB schema migrated.

**Deliverables**

- `package.json`, `pnpm-lock.yaml`, `tsconfig.json` (strict), Prettier config (no semicolons), Next.js App Router scaffold.
- `.env.example` (already present as `Env.example` — confirm parity with code), `.env.local` (gitignored).
- `lib/db/supabase.ts` — typed Supabase clients (anon + service role, server-only).
- `lib/db/types.ts` — generated types (`supabase gen types`).
- `supabase/migrations/0001_init.sql` — `context_item`, `context_chunk` (8 hash partitions), `entity`, `edge`, all indexes, `pg_trgm`, `pgvector`, RLS policies scoped by `user_id`.
- `supabase/migrations/0002_hybrid_search.sql` — the `hybrid_search()` function verbatim from `docs/Architecture.md §6.4`.
- `supabase/migrations/0003_sync_state.sql` — `sync_state(user_id, source, last_successful_sync_at, cursor)` for incremental polling.

**Acceptance**

- `pnpm dev` boots; `supabase db push` applies all migrations cleanly on a fresh project.
- A throwaway script can `select hybrid_search(...)` and get an empty result without error.
- RLS denies a cross-`user_id` read in a manual test.

**Cut marker:** never. This is the floor.

---

### Phase 1 — Layer 1 spine, end to end (THE core deliverable)

**Goal:** for a single signed-in user, connect Gmail + Calendar + Linear, ingest the last 90 days, and answer the three demo questions with grounded citations in a minimal Ask UI. This alone satisfies the heart of the assignment.

**1a. Auth + tenancy**

- `app/(auth)/*`, NextAuth config (`lib/auth.ts`). Google sign-in. Session carries `user_id`.
- Middleware enforces auth on app routes; `user_id` is read server-side only, never trusted from the client.

**1b. Connector contract + first connectors**

- `lib/connectors/types.ts` — `Connector`, `SyncContext`, `RawItem`, `ExternalId`, `SourceName` (contract from `CLAUDE.md`).
- `lib/connectors/composio.ts` — thin wrapper that supplies OAuth + fetch inside connectors.
- `lib/connectors/gmail.ts`, `calendar.ts`, `linear.ts` — each implements `load` / `poll` / `slim`.
- Connection flow: `app/api/connect/[source]/route.ts` kicks off Composio OAuth; stores the connected-account handle per `user_id`.

**1c. Ingestion pipeline (on Trigger.dev from day one — never in an API route)**

- `trigger/ingest.ts` — the durable multi-step job: fetch → persist `raw` → normalize → chunk-if-long → enrich → embed → upsert. Idempotent on `unique(user_id, source, external_id)`.
- `lib/ingestion/normalize.ts`, `chunk.ts`, `enrich.ts` (deterministic provenance line + gated LLM gloss, `CLAUDE.md §9.1`), `embed.ts` (OpenAI `text-embedding-3-large`, 1536 via Matryoshka).
- Trigger: `load` on first connect, scheduled `poll` thereafter, `since` from `sync_state`.

**1d. Retrieval pipeline (the answer path)**

- `lib/retrieval/plan.ts` — query understanding, one `generateObject` call → `RetrievalPlan` (`CLAUDE.md §9.2`).
- `lib/retrieval/search.ts` — calls `hybrid_search()` with the plan's filters, time basis, recency weight.
- `lib/retrieval/rollup.ts` — chunk→item dedupe, keep best chunk per item.
- `lib/retrieval/assemble.ts` — build the cited context block.
- `lib/llm/gateway.ts` — OpenRouter via Vercel AI SDK, primary `anthropic/claude-sonnet-4-6`. (Retry/fallback/circuit-breaker added in Phase 5; stub the interface now.)
- `lib/retrieval/synthesize.ts` — grounded, cited, refuse-when-thin synthesis (`CLAUDE.md §9.4`). Streamed.
- `app/api/answer/route.ts` — POST, streams the answer. Read-only model, no side-effecting tools.

**1e. Minimal Ask UI**

- `app/ask/page.tsx` — question box, streamed answer, inline `[n]` citations that expand to the source item. Not yet pixel-perfect (that is Phase 6).

**Acceptance**

- Fresh user connects Gmail+Calendar+Linear, ingest completes for 90 days, row counts sane.
- "Which tasks are blocked right now?" returns Linear issues with `status: blocked`, each cited.
- "Summarize investor activity this week" returns gmail+calendar items in the window, cited.
- Filter-relax fallback fires and is logged when filters over-narrow.
- Every claim cites a real item; a deliberately out-of-scope question yields an explicit "not enough in your connected tools."

**Cut marker:** never. If only Phase 1 ships, the assignment's core is met.

---

### Phase 2 — Source breadth + sync robustness

**Goal:** add Slack + one of Notion/GitHub/Sentry, plus Slim deletion sync and Event-mode where it is cheap.

**Deliverables**

- `lib/connectors/slack.ts` + `notion.ts` | `github.ts` | `sentry.ts` (pick per D5; build the easiest real one first).
- `app/api/webhooks/[source]/route.ts` — HMAC-verified Event ingestion (Slack first).
- `trigger/slim.ts` — periodic id-only pass; flips `is_deleted`.
- Defensive count assertions in fetch (catch silent under-collection).

**Acceptance**

- A deleted source item flips `is_deleted` on the next slim pass and disappears from answers.
- A Slack webhook event ingests within seconds end to end.
- "What happened across the company this week?" spans 4+ sources, cited.

**Cut marker:** graph polish (D14 #4) is cut before this; source breadth is protected.

---

### Phase 3 — Layer 2 relationship graph

**Goal:** typed entity/edge graph populated during ingestion, used in retrieval and shown on the Relationships screen.

**Deliverables**

- `lib/graph/triple-extraction.ts` — gated to high-signal sources only (email, calendar, Notion, Linear, meetings); `CLAUDE.md §9.3`.
- `lib/graph/entity-resolution.ts` — email-first canonicalization, `pg_trgm` fuzzy name fallback, conservative threshold, prefer-missed-over-wrong-merge; periodic merge pass as a Trigger.dev job.
- Wire extraction + resolution into `trigger/ingest.ts` step 8.
- `lib/retrieval/graph-expand.ts` — resolve named entities from the question, pull connected entities/items (Stage 3).
- `app/api/graph/route.ts` — entities + edges for the current user.

**Acceptance**

- "What follow-ups am I missing?" benefits from graph expansion (people ↔ threads).
- Entity resolution merges `Sarah` / `Sarah Chen` / `sarah@x.com` into one node; a low-similarity pair stays separate.
- No cross-`user_id` leakage in graph queries.

**Cut marker:** D14 #4 — graph _polish_ (the force-directed UI niceties) is the first UI to cut, but extraction/resolution stay because they lift answer quality.

---

### Phase 4 — Layer 3 personalization (Supermemory)

**Goal:** cross-session founder profile shapes answer ordering/emphasis without becoming the retrieval.

**Deliverables**

- `lib/personalization/supermemory.ts` — read profile at assemble time; write session takeaways after conversations (out of band, not during ingest).
- Inject `FOUNDER PROFILE` block into synthesis (`CLAUDE.md §9.4`).

**Acceptance**

- With a seeded preference ("triage investor threads first"), Today/Ask ordering reflects it; with an empty profile, behavior is unchanged.

**Cut marker:** survivable to cut, but cheap; keep unless time is dire.

---

### Phase 5 — Hardening: resilience, cache, observability, eval

**Goal:** the production-grade concerns that a demo hides (`docs/Architecture.md §10–12`).

**Deliverables**

- `lib/cache/semantic-cache.ts` — Upstash; per-tenant near-hit on query embedding; Stage 0 short-circuit; write-through on synthesis success.
- `lib/llm/gateway.ts` — finish retry+backoff+jitter, fallback chain (`anthropic/claude-haiku-4-5`), circuit breaker with state in Redis.
- Graceful degradation: synthesis-down → return cited context with a "summary temporarily unavailable" banner.
- `lib/retrieval/rerank.ts` — Cohere Rerank 3.5 over 50–100 candidates, toggleable.
- `lib/retrieval/rail.ts` — drop semantically distant chunks, cap item count (injection + diversity rail).
- Langfuse tracing on every LLM + retrieval call.
- Eval (D13): `eval/fixture-tenant.sql` (seeded known items), `eval/golden.jsonl` (question → expected item IDs), `eval/run.ts` (recall@k + citation check + LLM-judge groundedness). CI gate is advisory, not blocking.

**Acceptance**

- Repeated question served from cache (trace shows pipeline skipped).
- Forced gateway failure trips the breaker and degrades gracefully, no hard 500.
- Rerank toggle measurably reorders candidates on a known query.
- `pnpm eval` prints recall@k and a groundedness pass-rate over the fixture tenant.

**Cut marker:** D14 #3 — the eval harness is the third thing to cut; cache + breaker + rerank + rail are higher value and stay.

---

### Phase 6 — UI: pixel-faithful app + onboarding + landing

**Goal:** recreate the four mockup screens faithfully and build the onboarding the mockup lacks (D9, D8).

**Source of truth:** `docs/design/project/Zrux App.dc.html` (app, 4 screens) and `Zrux Landing.html` (landing). Match visual output; do not copy the prototype's React-in-a-string internals.

**Deliverables**

- `app/(app)/layout.tsx` — sidebar (logo, nav with Today badge, CONNECTED sources with live dots, founder footer), top bar with ⌘K search.
- `app/today/page.tsx` — briefing cards (icon tile, title, tag, body, source refs). Served from the precomputed cache (D10).
- `app/ask/page.tsx` — pixel-faithful: streamed answer, inline numbered citations, expandable SOURCES list, preset chips, composer with mic affordance.
- `app/relationships/page.tsx` — graph canvas (nodes typed by color: people blue, companies purple, projects green) + detail panel (type, last touch, connected, recent signals). Use a real layout over live entity/edge data.
- `app/search/page.tsx` — hybrid search box ("keyword + semantic"), source filter chips, ranked result cards with match %.
- `app/(marketing)/page.tsx` — landing from `Zrux Landing.html`.
- `app/onboarding/*` — guided stepper: choose sources → Composio OAuth per source → kick off 90-day load → live per-source indexing progress → unlock app when first items land.
- Design tokens: Inter, `#0071e3` accent, `#f5f5f7` bg, `#1d1d1f` text, the radius/shadow system from the mockup. **No em dashes anywhere in UI or copy.**

**Acceptance**

- Side-by-side with the mockup, the four screens match layout, color, spacing, and typography.
- Onboarding takes a brand-new account from sign-in to first answerable state with visible progress.
- Citation numbers in Ask expand to the real underlying item.

**Cut marker:** graph screen polish is D14 #4; the other three screens + onboarding are protected.

---

### Phase 7 — Proactive briefing + Drive audio + Telegram (stretch tail)

**Goal:** the remaining `docs/Architecture.md §13` surfaces, built in D14 reverse-cut order so the riskiest is last.

**Deliverables (build in this order, drop from the bottom if time is short)**

1. **Proactive in-app briefing** — `trigger/briefing.ts`: per-user, staggered with jitter across a morning window, bounded-concurrency queue, precompute + cache (D10). Powers Today instantly.
2. **Drive audio ingestion** — `lib/connectors/drive.ts` picks up audio files; `lib/ingestion/transcribe.ts` runs Deepgram Nova-3 batch `diarize=true`; diarized turns become chunks; speakers resolve against the linked calendar event's participant list (`CLAUDE.md §6.3 rule 4`). _(D14 #1 — first to cut.)_
3. **Telegram** _(D11, D14 #2)_ — per-user link flow + thin bot wrapping `app/api/answer`; pushes the morning briefing. Optional Aura TTS voice note.
4. **Tap-to-talk** _(D12, optional)_ — Deepgram streaming STT feeds a spoken question into Stage 0 unchanged.

**Acceptance**

- The morning briefing precomputes off-peak and Today serves it with no synthesis wait.
- (If built) a Drive audio file becomes a diarized, speaker-attributed, cited meeting item.
- (If built) a Telegram message returns the same grounded answer as the web app.

**Cut marker:** this entire phase is the cut buffer, dropped bottom-up per D14.

---

## 3. Cross-cutting acceptance (applies to every phase)

- **Tenancy:** every Supabase query has `user_id` in the WHERE first; RLS is the second layer. No query without it ships.
- **Secrets:** env only; nothing hardcoded; `.env.example` stays in parity with code.
- **Grounding:** the answer-time model holds zero side-effecting tools. Retrieved content is data, never instructions.
- **Ingestion never in an API route.** Always Trigger.dev.
- **Dual timestamps** on every item; default time basis `source_updated_at`.
- **Conventions:** TypeScript strict, pnpm only, no semicolons, named exports (except Next.js pages), async/await only.
- **No em dashes** in any UI string or copy.

---

## 4. Open risks / watch items

- **Composio OAuth consent for arbitrary reviewers.** Confirm Composio brokers consent through its own verified app so a reviewer's Google connects without our app needing Google verification. If not, add reviewers as OAuth test users and note it in README.
- **Real-inbox cost.** A noisy 90-day Gmail can be thousands of items. Enrichment is gated to unstructured/long bodies and triple-extraction to high-signal sources (the cost levers). Watch the per-item LLM spend; add a per-source cap if it runs hot.
- **Graph layout over live data.** Real entity/edge sets are not the curated 9-node mockup. Use a deterministic force/positioning layout and cap visible nodes so the screen stays readable.
- **Eval over per-tenant data.** Recall@k only runs against the seeded fixture tenant (D13); the live groundedness judge is what covers real reviewer data.

---

## 5. Suggested session order (fast path to a defensible submission)

1. Phase 0 → Phase 1 (the spine; this is the assignment).
2. Phase 6 Today + Ask screens (make the spine demoable and pretty).
3. Phase 2 (breadth) → Phase 3 (graph) → Phase 5 cache+breaker+rerank (quality/resilience).
4. Phase 4 personalization, Phase 6 remaining screens + onboarding + landing.
5. Phase 7 stretch tail, bottom-up, only with time left.

Ship a green, pushed branch at every phase boundary.
