# Phase 5 Trade-offs

Running log of the trade-offs, shortcuts, and deliberate scope cuts made while
building Phase 5 (hardening: semantic cache, circuit breaker, Cohere rerank,
retrieval rail, full Langfuse spans, eval harness). Each entry: what was decided,
the alternative not taken, and why. Companion to `trade-offs.md` (whole-system),
`spec.md` Phase 5, and the plan in `docs/plans/phase-5-hardening.md`.

---

## Semantic cache: O(n) linear scan, not vector ANN

- **Decision:** The cache stores each entry's question embedding in Redis and, on
  lookup, `SMEMBERS` the per-user index, `MGET`s the entries, and computes cosine
  similarity in app code (`lib/cache/semantic-cache.ts`).
- **Alternative:** Upstash Vector (native ANN) keyed per tenant.
- **Why:** For a single-founder demo (<100 cached entries/user) the linear scan is
  microseconds and needs no extra service. ANN is the scale lever; it is the noted
  production path. The index is capped at 200 entries/user so a noisy tenant can
  never make the scan unbounded.

## Cache key: per-entry TTL + a Redis Set index, lazily pruned

- **Decision:** `sc:entry:{user}:{uuid}` holds each `{embedding, answer}` with its
  own `EX` TTL; `sc:idx:{user}` is a Set of live uuids with a rolling TTL. Expired
  entries leave stale uuids in the index, pruned lazily when `MGET` returns null.
- **Alternative:** A single hash per user, or a sorted set with score = insert time.
- **Why:** Per-entry TTL is the behavior we actually want (each answer expires
  90 minutes after it was written, P5-2). Lazy prune avoids a background sweeper.

## Cache reuses the raw-question embedding, which shifts the search vector

- **Decision:** Stage 0 embeds the **raw question** for the cache check, then passes
  that same vector into `retrieve()` as `precomputedEmbedding` (one embed call total).
- **Alternative:** Embed the raw question for the cache and separately embed
  `plan.semantic_query` for hybrid search (two embed calls).
- **Why:** One embedding call per answer is the cost win and keeps cache/search
  consistent. The cost: search now runs on the raw-question vector instead of the
  cleaned `semantic_query` vector. In practice they are near-identical for retrieval,
  and the keyword channel still uses `plan.keyword_terms`. Re-embedding the semantic
  query is the quality-max alternative if a measurable recall drop ever shows up.

## Circuit breaker: global per-app, not per-model

- **Decision:** One Redis key `cb:gateway` protects the whole OpenRouter gateway.
- **Alternative:** Separate keys (`cb:gateway:primary`, `cb:gateway:fallback`).
- **Why:** Both models hit the same provider; a provider outage trips them together.
  Per-model breakers are the production-hardened path (a flaky primary trips
  independently of a healthy fallback), deferred for velocity.

## Breaker error classification: 5xx + network only (401 does NOT trip)

- **Decision:** Only HTTP 5xx and network/timeout errors count toward the breaker;
  4xx (including 401) and 429 pass through untouched (P5-8).
- **Alternative:** Trip on any failure.
- **Why:** 4xx/429 are caller/quota problems, not gateway outages; tripping on them
  would punish the whole app for a bad key or a rate limit. **Demo note:** because of
  this, a _bad API key_ (401) will not trip the breaker. To demo graceful degradation,
  point `OPENROUTER_BASE_URL` at an unreachable host (network error → trips) rather
  than corrupting the key.

## Streaming synthesis: pre-flight breaker check, not in-stream fallback

- **Decision:** `plan.ts` (non-streaming `generateObject`) uses the full
  `callWithFallback` (breaker + retry + fallback model). Streaming synthesis cannot,
  because `streamText` surfaces errors as the stream drains, not at call time. So the
  route pre-checks the breaker with `assertGatewayUp()` (throws `GatewayDownError`
  when OPEN → degrade), and the stream reports its own outcome back to the breaker via
  `noteGatewaySuccess` / `noteGatewayFailure`.
- **Alternative:** Wrap `streamText` in the breaker + mid-stream fallback to the
  secondary model.
- **Why:** Mid-stream model swap means buffering or restarting a partially-sent
  response — fragile and out of scope for 48 hours. The pre-flight check covers the
  demoable case (breaker already OPEN from prior failures → clean degradation), and
  stream failures still feed the breaker so it trips for subsequent requests. The
  known gap: a synthesis call that fails _mid-stream_ on the first failure delivers a
  broken stream to that one client before the breaker trips.

## Graceful degradation degrades with already-retrieved context

- **Decision:** The route assembles context once. If `assertGatewayUp()` throws
  before synthesis, it returns that same context with the banner (HTTP 200,
  `x-zrux-degraded: true`). It does **not** re-run `retrieve()` (which the original
  plan sketch did).
- **Alternative:** Catch `GatewayDownError` at the top and re-run retrieval inside
  the catch (plan §9 sketch).
- **Why:** Re-running `retrieve()` re-calls `planQuery` (a gateway call) which, with
  a global breaker already OPEN, throws again → the degradation itself fails. Reusing
  the context we already have is correct and avoids the double work. When the gateway
  is down _before_ any context exists (plan call fails), there is nothing to show, so
  the route returns a clean 503.

## Retrieval rail: RELATIVE floor, not the absolute 0.1 from P5-15

- **Decision:** The rail keeps chunks scoring `>= (top rerank_score) * 0.3` rather
  than the absolute `< 0.1` cut specified in P5-15. (`lib/retrieval/rail.ts`)
- **Why this changed (found during live verification):** Cohere `rerank-v3.5`
  `relevanceScore` is not calibrated so that a fixed value means "relevant." Short
  structured items (Linear issues, calendar events) routinely rerank below 0.1 even
  when clearly on-topic. The absolute 0.1 floor silently dropped them — on the live
  tenant, "Which tasks are blocked right now?" reranked to scores
  `0.0595 / 0.0464 / 0.0413 / 0.0385` and the rail dropped **all four**, forcing a
  false refusal (`items=0`) even though rerank-off returned a correct answer over the
  4 Linear issues. The synthetic fixture showed the same instability (1–3 of 3 blocked
  items surviving run-to-run).
- **Resolution:** a relative floor adapts to Cohere's per-query scale. At ratio 0.3
  the live case keeps all 4, the fixture keeps the 3 blocked items (top-ranked), and a
  query with one dominant hit (meeting prep, top 0.37) still narrows to the strong
  item. The item cap (rollup `MAX_ITEMS=8`) remains the count backstop.
- **Trade-off:** a genuinely off-topic query whose chunks are all low but comparable
  is no longer floored out by the rail; synthesis (grounded, refuse-when-thin) is the
  backstop that refuses there. Deliberate deviation from P5-15's absolute value.

## Rerank: degrade to no-rerank on any Cohere error

- **Decision:** `rerankCandidates` wraps the Cohere call in try/catch; on any error
  it returns every hit with `rerank_score: 0` (original order, rail no-ops).
- **Alternative:** Surface the error and fail the answer.
- **Why:** Rerank is a quality upgrade, not a correctness requirement (plan §1). A
  Cohere outage or a blown free-trial quota must not take down answers.

## Cohere free trial (1,000 calls/month) is shared and silent

- **Decision:** Accept the shared free-trial limit; auto-disable rerank when the key
  is absent, manual override with `RERANK_ENABLED=false`.
- **Why:** Sufficient for a demo. If the tenant exceeds the quota mid-month, Cohere
  errors → the graceful degrade above kicks in (answers continue without rerank).
  No paid tier provisioned for the take-home.

## Eval fixture: seeded via the ingestion pipeline (TS), not `fixture-tenant.sql`

- **Decision:** The fixture is `eval/fixture.ts` (synthetic founder `RawItem`s with
  deterministic `external_id`s), seeded by `eval/seed.ts` through the real
  `ingestItems` pipeline. `golden.jsonl` references `external_id`; `run.ts` maps a
  citation's `item_id` back to its `external_id` for recall scoring.
- **Alternative:** A hand-written `eval/fixture-tenant.sql` with deterministic item
  UUIDs (plan §11.1).
- **Why:** Chunk embeddings are `vector(1536)` and cannot be authored by hand in SQL.
  Seeding through the pipeline produces **real** embeddings and exercises
  normalize → chunk → embed → upsert, so the eval measures the live retrieval path
  rather than a stub with placeholder vectors. The cost: item UUIDs are not stable
  across reseeds, so golden references the stable `external_id` instead (functionally
  equivalent, and arguably cleaner). `EXTRACT_TRIPLES` is forced off during seeding
  to keep it to embeddings (no graph LLM calls); the recall eval does not score graph.

## Groundedness judge: per-answer, not strictly per-sentence

- **Decision:** `run.ts` makes one `gpt-4o-mini` `generateObject` call per answer that
  returns `{ grounded: boolean, reason }` over the whole CONTEXT+ANSWER.
- **Alternative:** One judge call per sentence (plan §11.3).
- **Why:** Per-answer is far cheaper (20 calls vs. 100+) and robust via structured
  output. The plan itself lists sentence-level granularity as a limitation; per-answer
  is good enough for an advisory gate. Claim-level extraction is the production upgrade.

## Eval edge cases: scored as "thin/refusal handled", not recall

- **Decision:** Golden entries with empty `expected_external_ids` ("What happened in
  2010?", "Tell me about our Chicago office.") are scored on whether retrieval comes
  back thin (→ refusal), reported separately as "edge cases handled".
- **Why:** Recall is undefined for a question with no expected items. The meaningful
  signal there is that the system refuses instead of hallucinating.

## Eval gate: advisory, always exits 0

- **Decision:** `pnpm eval` prints recall@k + groundedness + edge-case handling and
  always exits 0, even on a run error (P5-21).
- **Why:** A 48-hour take-home eval is a quality signal, not a merge blocker. A
  blocking gate would be brittle against model nondeterminism and live-data drift.

## `.env.example` not updated for the optional tuning vars (environment guardrail)

- **Decision:** The five optional tuning vars (`SEMANTIC_CACHE_THRESHOLD`,
  `CACHE_TTL_SECONDS`, `CIRCUIT_BREAKER_THRESHOLD`, `CIRCUIT_BREAKER_WINDOW_MS`,
  `CIRCUIT_BREAKER_COOLDOWN_MS`) are documented here and have safe defaults in code,
  but were not written into `.env.example`.
- **Why:** This session's environment blocks all writes to `.env*` files (a secret-file
  guardrail), including the non-secret `.env.example`. The vars are purely optional
  (every one has a code default per plan §3), so behavior is unaffected. **Action for
  the maintainer:** add the block below under the Upstash section of `.env.example`:
  ```bash
  SEMANTIC_CACHE_THRESHOLD=0.95
  CACHE_TTL_SECONDS=5400
  CIRCUIT_BREAKER_THRESHOLD=5
  CIRCUIT_BREAKER_WINDOW_MS=60000
  CIRCUIT_BREAKER_COOLDOWN_MS=30000
  ```
  (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and `COHERE_API_KEY` are
  already present in `.env.example`. `RERANK_ENABLED` defaults to enabled when the
  Cohere key is set; add it only to force rerank off.)

## Langfuse `traceStage` helper for non-AI stages

- **Decision:** A small `traceStage(functionId, metadata, fn, outputOf?)` wrapper in
  `lib/observability/langfuse.ts` puts cache-check, hybrid-search, cohere-rerank, and
  rollup under child spans of the `answer` trace; AI stages keep `aiTelemetry`.
- **Alternative:** Manual `startActiveObservation` at each call site.
- **Why:** One helper keeps the pipeline readable and consistent, and is a no-op when
  tracing is disabled so local/CI runs are untouched.

## MAX_ITEMS lowered 12 → 8

- **Decision:** `rollupToItems` caps at 8 (was 12).
- **Why:** With the rerank+rail now dropping distant chunks upstream, 8 high-relevance
  items is enough context and keeps the synthesis prompt lean (less bloat, smaller
  injection surface). The cap lives in rollup; the score filter lives in the rail
  (two concerns, two places).
