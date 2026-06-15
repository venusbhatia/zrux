# CLAUDE.md  zrux Founder AI Assistant

This is the single source of truth for every Claude Code session on this project.
Read it fully before touching any file. These are standing orders, not suggestions.

---

## What we are building

**zrux** is a personal AI assistant for a startup founder.
It ingests context from multiple sources, stores it centrally, and answers grounded questions like:
- What should I focus on today?
- What should I know before my next meeting?
- Which tasks are blocked?
- Summarize investor activity this week.
- What follow-ups am I missing?

This is a **context engine**, not a live-API chatbot. The read path never calls source APIs at answer time. It reads pre-ingested, stored context. Ingestion is background and async. Serving is fast and synchronous.

This is a 48-hour take-home assignment for 8090 / Traces. Real integrations, no mock data.

---

## The architecture in one sentence

Ingestion plane reads sources on a schedule and writes to Postgres. Answer plane reads Postgres and calls an LLM to synthesize a grounded, cited response. The two planes share only the database.

---

## Tech stack (single-valued, all decided)

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Full-stack, streaming, Vercel deploy |
| Package manager | pnpm | Faster, consistent |
| LLM gateway | OpenRouter (claude-sonnet-4-6 primary) | Provided API key, fallback-able |
| LLM SDK | Vercel AI SDK | Streaming, provider-agnostic, clean DX |
| Integrations | Composio | Managed OAuth across all sources |
| Database | Supabase (Postgres + pgvector 0.8.x) | Vector + relational + RLS in one place |
| Connection pooler | Supavisor (transaction mode) | Prevents connection exhaustion |
| Cache | Redis via Upstash (serverless, free tier) | Semantic cache + circuit breaker state |
| Ingestion jobs | Trigger.dev v3 | Long-running, retriable, per-step observability |
| Embeddings | OpenAI text-embedding-3-large, 1536 dims | Best quality, Matryoshka truncation |
| Reranker | Cohere Rerank 3.5 | Post-RRF cross-encoder, real quality uplift |
| Speech to text | Deepgram Nova-3 (batch + streaming) | Diarized transcripts for voice memos and meetings |
| Observability | Langfuse | Trace every LLM + retrieval call |
| Deployment | Vercel | Zero config, streaming support |
| Dev tooling | GStack + GBrain (local machine only, not in repo) | Garry Tan workflow, separate brain for this project |

---

## Data sources (real integrations, no mock data)

Priority order for the 48-hour build:

1. **Gmail** (via Composio + Google OAuth)
2. **Google Calendar** (same OAuth app as Gmail, one consent screen)
3. **Linear** (API token, fastest to set up)
4. **Slack** (OAuth)
5. **Notion** (OAuth)
6. **GitHub** (OAuth)
7. **Sentry** (API token)
8. **Voice memos / raw audio** (Deepgram Nova-3 batch)

Minimum for submission: Gmail + Calendar (they count as two sources, one OAuth setup).

---

## Three memory layers (all in the current build, not future work)

**Layer 1 : Context Engine** (Supabase + pgvector)
The graded part. Cross-source RAG, point-in-time questions. Hand-built.

**Layer 2 : Relationship Graph** (Supabase entity + edge tables)
Typed graph: people, companies, projects. Relations: invested_in, introduced_by, works_with, decided.
Built in our own Supabase, NOT a GBrain dependency.

**Layer 3 : Personalization** (Supermemory)
Cross-session founder profile and preferences. Updated after conversations, not during ingestion.

---

## Database schema (non-negotiable, do not deviate)

### context_item

```sql
create table context_item (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  source            text not null,         -- 'gmail' | 'linear' | 'slack' | 'sentry' | 'voice_memo' | ...
  type              text not null,         -- 'email' | 'issue' | 'message' | 'error' | 'meeting' | 'voice_memo' | ...
  external_id       text not null,
  title             text,
  author            text,
  url               text,
  source_created_at timestamptz not null,
  source_updated_at timestamptz not null,
  status            text,
  metadata          jsonb default '{}',    -- includes meeting participants
  summary           text,                  -- doc-level summary for two-tier index
  summary_embedding vector(1536),
  raw               jsonb,                 -- episodic ground truth, re-processable
  is_deleted        boolean default false,
  created_at        timestamptz default now(),
  unique (user_id, source, external_id)
);
```

### context_chunk (hash-partitioned by user_id from day one)

```sql
create table context_chunk (
  id                uuid not null default gen_random_uuid(),
  item_id           uuid not null,
  user_id           uuid not null,
  source            text not null,
  source_created_at timestamptz not null,
  source_updated_at timestamptz not null,
  content           text not null,         -- provenance line + gloss + body
  embedding         vector(1536),
  fts               tsvector generated always as (to_tsvector('english', content)) stored,
  primary key (user_id, id)
) partition by hash (user_id);

create table context_chunk_p0 partition of context_chunk for values with (modulus 8, remainder 0);
create table context_chunk_p1 partition of context_chunk for values with (modulus 8, remainder 1);
-- ... p2 through p7

create index on context_chunk using hnsw (embedding vector_cosine_ops);
create index on context_chunk using gin (fts);
create index on context_chunk (user_id, source, source_updated_at desc);
create index on context_item  using hnsw (summary_embedding vector_cosine_ops);
```

### entity + edge (Layer 2 relationship graph)

```sql
create table entity (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  type       text not null,    -- 'person' | 'company' | 'project'
  name       text not null,
  email      text,             -- canonical key, unique per user when present
  domain     text,
  aliases    text[] default '{}',
  metadata   jsonb default '{}',
  created_at timestamptz default now(),
  unique (user_id, email) where email is not null
);

create extension if not exists pg_trgm;
create index on entity using gin (name gin_trgm_ops);

create table edge (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  from_id      uuid not null references entity(id),
  to_id        uuid not null references entity(id),
  relation     text not null,  -- 'invested_in' | 'works_with' | 'introduced_by' | 'decided' | ...
  confidence   float default 1.0,
  source_item  uuid references context_item(id),
  occurred_at  timestamptz,
  created_at   timestamptz default now()
);
```

---

## The Connector contract (all sources implement this)

```typescript
interface Connector {
  source: SourceName;
  load(ctx: SyncContext): AsyncIterable<RawItem>;               // full bulk, first run
  poll(ctx: SyncContext, since: Date): AsyncIterable<RawItem>;  // incremental by cursor
  slim(ctx: SyncContext): AsyncIterable<ExternalId>;            // ids only, deletion detection
  handleEvent?(payload: unknown): AsyncIterable<RawItem>;       // optional webhook
}
```

Composio supplies the OAuth and underlying fetch inside load/poll/slim.
The contract is ours. Nango is the documented swap at the same seam.

---

## Ingestion pipeline (Trigger.dev, never in an API route)

Steps in order:

1. Trigger: scheduled poll, load on first connect, or webhook event
2. Fetch via connector. Persist raw payload to `context_item.raw` (episodic layer)
3. If audio with no transcript: run Deepgram Nova-3 batch with `diarize=true`
4. Normalize to `context_item` with both `source_created_at` and `source_updated_at`
5. Chunk if long (meetings: chunk by speaker turn). Generate doc summary for long docs
6. Contextual enrich: deterministic provenance line + optional LLM gloss (skip for structured items)
7. Embed via text-embedding-3-large
8. Upsert `context_item` + `context_chunk`
9. Triple extraction (gated: email, calendar, Notion, Linear, meetings ONLY. Skip Slack, Sentry)
10. Resolve extracted entities (email key first, pg_trgm fuzzy name fallback). Upsert entity + edge
11. Slim pass (periodic): flip `is_deleted` on vanished external_ids

---

## Entity resolution rules (non-negotiable)

1. Email is the canonical key. Match on email first, always.
2. No email: fuzzy match on normalized name within same type + user_id using pg_trgm. Conservative threshold.
3. Companies: match on normalized name + domain.
4. Diarized speakers: resolve against meeting participant list (from linked calendar event), not the raw Speaker N label.
5. ALWAYS prefer a missed merge over a wrong merge. Unresolvable = new provisional entity.
6. Periodic merge pass: re-examine entities that gained an email or a high-similarity neighbor.

---

## Retrieval pipeline (the answer path)

Stage 0: Semantic cache check (Redis, per-tenant, near-hit on embedding bucket). Cache hit = skip everything.
Stage 1: Query understanding. One LLM call. Output: semantic_query, keyword_terms, sources, after/before, type, status, entities, intent, time_basis (updated/created), recency_weight.
Stage 2: Hybrid retrieval. `hybrid_search()` Postgres function: dense CTE + keyword CTE, filtered by user_id + metadata, fused by RRF, post-RRF time-decay by recency_weight. This is EXACT KNN over the filtered per-tenant set, not an HNSW scan. HNSW only matters at scale.
Stage 3: Graph expansion. Resolve named entities from question, pull connected entities + items.
Stage 4: Rerank. Cohere Rerank 3.5 over ~50-100 candidates.
Stage 5: Chunk-to-item rollup. Dedupe to parent item_id, keep best-scoring chunk. Prevents one Notion doc crowding out other sources.
Stage 6: Retrieval rail. Drop semantically distant chunks. Cap item count.
Stage 7: Assemble. Rolled-up items + graph relationships + Supermemory profile.
Stage 8: Synthesis. Read-only model. Grounded, cited, refuses to guess. On success, write to semantic cache. On gateway failure: return cited context with "summary temporarily unavailable" (graceful degradation).

---

## hybrid_search function (critical, do not simplify)

```sql
create or replace function hybrid_search(
  p_user_id        uuid,
  p_query_embedding vector(1536),
  p_query_text     text,
  p_sources        text[]   default null,
  p_after          timestamptz default null,
  p_time_basis     text     default 'updated',   -- 'updated' | 'created'
  p_recency_weight float    default 0.0,
  p_limit          int      default 60
) returns table (chunk_id uuid, item_id uuid, content text, score float)
language sql stable as $$
  with filtered as (
    select *,
           case when p_time_basis = 'created'
                then source_created_at else source_updated_at end as ts
    from context_chunk
    where user_id = p_user_id
      and (p_sources is null or source = any(p_sources))
      and (p_after is null or
           (case when p_time_basis = 'created'
                 then source_created_at else source_updated_at end) >= p_after)
  ),
  vec as (
    select id, item_id, content, ts,
           row_number() over (order by embedding <=> p_query_embedding) as rnk
    from filtered order by embedding <=> p_query_embedding limit 50
  ),
  kw as (
    select id, item_id, content, ts,
           row_number() over (order by ts_rank_cd(fts, websearch_to_tsquery('english', p_query_text)) desc) as rnk
    from filtered
    where fts @@ websearch_to_tsquery('english', p_query_text) limit 50
  ),
  fused as (
    select coalesce(vec.id, kw.id)           as id,
           coalesce(vec.item_id, kw.item_id) as item_id,
           coalesce(vec.content, kw.content) as content,
           coalesce(vec.ts, kw.ts)           as ts,
           coalesce(1.0/(60+vec.rnk),0) + coalesce(1.0/(60+kw.rnk),0) as rrf
    from vec full outer join kw on vec.id = kw.id
  )
  select id, item_id, content,
         rrf * (1 + p_recency_weight * exp(
           -extract(epoch from (now() - ts)) / (30*86400.0)
         )) as score
  from fused
  order by score desc limit p_limit;
$$;
```

---

## The four prompts (structure these carefully, they are graded)

### 9.1 Contextual enrichment (ingestion, Haiku-class, prompt-cached)
Prepend one sentence of context to each chunk before embedding.
Only run for unstructured/long content. Skip for Linear issues, calendar events (provenance is enough).
Format: `[Source: {source}] [{date}] [{author}]: {gloss}\n\n{body}`

### 9.2 Query understanding (answer path, one structured call)
Output JSON with: semantic_query, keyword_terms, sources[], after, before, type, status, entities[], intent, time_basis, recency_weight.
Intent values: daily_briefing | meeting_prep | followup_detection | blocker_scan | investor_summary | company_summary | cross_source | lookup.
Recency weight: 0.3 for daily_briefing/company_summary. 0 for lookup.
Time basis: updated for "what's happening". created for "what was decided in Q1".

### 9.3 Triple extraction (ingestion, gated to high-signal sources only)
Output JSON array of {subject, relation, object, confidence}.
High-signal sources: email, calendar, Notion, Linear, meetings.
Diarized speakers pass through entity resolution before becoming edge rows.

### 9.4 Answer synthesis (answer path, read-only model)
Strict grounding: answer from context only. Cite every claim with [Source, date].
Refuse to guess if context is thin. Say so explicitly.
The model holds zero side-effecting tools. Read-only is the primary injection defense.
Format: short confident prose, then source citations. No bullet soup.

---

## Security and injection defense

Primary defense: the answer-time model is READ-ONLY. No side-effecting tools. A successful injection can only alter the answer text, not act on anything.
Secondary: data/instruction separation in the synthesis prompt. Retrieved content is data, not instructions.
Tertiary: retrieval rail drops distant chunks and caps item count.
Pattern scanning: defense-in-depth only. Do not rely on it. Trivially bypassed by paraphrase.

---

## Resilience (all free-tier or pure code, built into the take-home)

- Redis semantic cache (Upstash free tier): embed query, per-tenant near-hit, TTL cache. Skip the whole pipeline on a hit.
- Circuit breaker + fallback chain: retry with backoff, fallback model string on repeated failure, circuit trips open after N failures. State in Redis.
- Graceful degradation: if synthesis is unavailable, return cited retrieved context with a banner. Do not fully fail.
- Briefing stagger: randomize proactive brief timing per tenant across a window. Run through Trigger.dev bounded concurrency queue, never a synchronous fan-out.
- Supavisor: just use the pooler connection string. Zero added infra.
- Partitioning: context_chunk is hash-partitioned by user_id from the first migration. Zero cost at this scale, designed in.

---

## Code conventions (follow exactly)

- TypeScript everywhere. Strict mode on.
- pnpm only. Never npm or yarn.
- No semicolons. Prettier default config.
- Named exports only. No default exports except Next.js pages.
- Async/await only. No .then() chains.
- All Supabase queries scoped by user_id first. RLS as a second layer, not the first.
- Environment variables: all in .env.local, all prefixed consistently (SUPABASE_, OPENROUTER_, COMPOSIO_, etc). Never hardcode.
- Error handling: wrap API calls in try/catch. Log with context (user_id, source, external_id). Never swallow silently.
- Migrations: numbered SQL files in /supabase/migrations/. Run with supabase db push.
- Tests: at minimum, one test per retrieval stage and one per connector. Use vitest.

---

## Git workflow (follow this every session, no exceptions)

This is a 48-hour build on a deadline. The GitHub repo is the submission artifact. Treat every meaningful working state as worth preserving.

**Branch naming:**
```
feature/context-engine
feature/gmail-connector
feature/retrieval-pipeline
feature/answer-api
feature/landing-page
fix/entity-resolution-merge
fix/hybrid-search-empty-results
```

**When to create a new branch and push:**
- After any feature that compiles and does something real, even partially
- After fixing a bug that was blocking progress
- After every migration that runs without errors
- After any prompt that produces noticeably better output
- Before starting something risky or experimental (branch off, try it, merge if it works)
- At minimum every 2 hours regardless of how complete the work feels

**The push habit. After every good enough update, run:**
```bash
git add -A
git commit -m "feat: [what it does in one line]"
git push origin [branch-name]
```

**Commit message format:**
```
feat: add hybrid_search function with RRF and recency weighting
fix: entity resolution now canonicalizes on email before name fuzzy match
chore: add Deepgram transcription step to ingestion pipeline
test: add retrieval stage unit tests for plan and rerank
```

**Never commit:**
- .env.local or any file with real credentials
- node_modules
- .next build output
- Any file with a hardcoded API key, even in a comment

**Why this matters for the submission:**
The Traces link shows your AI-assisted dev process. A rich commit history on GitHub shows the reviewer that you built incrementally and thoughtfully, not in one panic push at hour 47. Both artifacts are graded. Keep both clean and active throughout the build.

```
/
  app/                    Next.js App Router pages and API routes
    api/
      answer/route.ts     POST : the read path, streamed
      webhooks/
        [source]/route.ts Event-mode ingestion, HMAC-verified
  lib/
    connectors/           One file per source, all implement Connector interface
    ingestion/            normalize.ts, enrich.ts, embed.ts, extract.ts, resolve.ts
    retrieval/            plan.ts, search.ts, rerank.ts, rollup.ts, assemble.ts
    graph/                entity-resolution.ts, triple-extraction.ts
    llm/                  gateway.ts (OpenRouter + fallback + circuit breaker)
    cache/                semantic-cache.ts (Redis/Upstash)
    db/                   supabase.ts client, types.ts generated types
  supabase/
    migrations/           numbered SQL migration files
  trigger/                Trigger.dev job definitions
  prompts/                .txt or .md files for each of the four prompts
  CLAUDE.md               this file
  ARCHITECTURE.md         full system design reference
  README.md               submission README
```

---

## What NOT to do

- Never call source APIs (Gmail, Linear, etc.) at answer time. All reads are from Postgres.
- Never skip user_id scoping on any query. Every single query has user_id in the WHERE.
- Never run ingestion inside a Next.js API route. It will timeout. Use Trigger.dev.
- Never run triple extraction on Slack messages or Sentry errors. Gated to high-signal only.
- Never use a single occurred_at. Always store both source_created_at and source_updated_at.
- Never assume the HNSW index is being used in hybrid_search. It is exact KNN over the filtered set.
- Never put raw API keys in code. .env.local only.
- Never use em dashes anywhere in the UI or copy. Not one.
- Never use default exports except for Next.js pages.
- Never use mock data. Real integrations only.

---

## Tradeoffs and decisions (know these for the 15-minute walkthrough)

**Composio over Nango:** Composio is tool-calling-first and we are building ingestion-first, so Nango is a cleaner architectural fit. We chose Composio for velocity in 48 hours. The Connector contract abstracts it so Nango is a one-file swap.

**Exact KNN over HNSW in hybrid_search:** Because filtered is referenced twice, Postgres materializes the CTE. The vec CTE does an exact sort over the materialized per-tenant set, not an HNSW index scan. This is deliberate and correct at per-tenant scale. Exact KNN is more accurate. HNSW matters at 10M+ vectors.

**Modular monolith over microservices:** One codebase, one deploy, one language, shared types. The only decomposition that matters (read plane vs ingestion plane) is already done. Microservices would add latency, cost, and ops surface for no benefit at this scale.

**Supermemory as Layer 3 over a hand-rolled founder_profile table:** Supermemory removes a build surface in a 48-hour window. A founder_profile table is the production-hardened alternative and is more consistent with P1 (own the context engine). Known tradeoff, defensible.

**Storage tiering deferred:** raw payloads live as JSONB in Postgres for the take-home. Object-store offload (S3-class, keyed by user_id/source/external_id) is the production lever when Postgres gets heavy. The code path is the same, one flag changes the backend.

**Deepgram for audio:** Voice memos and raw meeting recordings enter via Deepgram Nova-3 batch with diarize=true. Diarized speaker turns become chunk boundaries. Speaker N labels resolve against the linked calendar event's participant list (carries emails, the stable key). This wires audio directly into Layer 2.

---

## Submission checklist

- [ ] GitHub repo (public or shared with reviewer)
- [ ] README with setup instructions, connected sources, and 3+ example questions
- [ ] Traces link (must be recording from the start of the build)
- [ ] At least 3 example questions tested and working
- [ ] Tradeoffs and future improvements notes
- [ ] No API keys or credentials in the repo
- [ ] .env.example with all required variable names (no values)
- [ ] The assistant answers grounded, cited questions from stored context

---

## The three example questions to demo (minimum)

1. What should I focus on today?
2. Summarize investor activity this week.
3. Which tasks are blocked right now?

Bonus (show these if time):
4. What should I know before my next meeting?
5. What follow-ups am I missing?
6. What customer issues are showing up repeatedly?

---

## Reference files in this repo

- `ARCHITECTURE.md` : full system design, schemas, diagrams, prompts, scaling decisions
- `CLAUDE.md` : this file, standing orders for every session
- `README.md` : submission README (write last)
- `index.html` : zrux landing page (landing page only, not the app UI)
