-- 0001_init.sql
-- zrux Layer 1 (context engine) + Layer 2 (relationship graph) schema.
-- Mirrors CLAUDE.md "Database schema" and docs/Architecture.md §6.
-- Hash-partitioned context_chunk by user_id from day one (designed in, free at this scale).

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
create extension if not exists vector;      -- pgvector 0.8.x
create extension if not exists pg_trgm;     -- fuzzy name matching for entity resolution
create extension if not exists pgcrypto;    -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- Layer 1: context_item (one normalized record per source item)
-- ----------------------------------------------------------------------------
create table context_item (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  source            text not null,        -- 'gmail' | 'linear' | 'slack' | 'sentry' | 'voice_memo' | ...
  type              text not null,        -- 'email' | 'issue' | 'message' | 'error' | 'meeting' | ...
  external_id       text not null,
  title             text,
  author            text,
  url               text,
  source_created_at timestamptz not null,
  source_updated_at timestamptz not null,
  status            text,
  metadata          jsonb default '{}',
  summary           text,
  summary_embedding vector(1536),
  raw               jsonb,                -- episodic ground truth, re-processable
  is_deleted        boolean default false,
  created_at        timestamptz default now(),
  unique (user_id, source, external_id)   -- every sync is an idempotent upsert
);

create index context_item_user_source_updated_idx
  on context_item (user_id, source, source_updated_at desc);
create index context_item_user_status_idx
  on context_item (user_id, status) where status is not null;
create index context_item_summary_hnsw_idx
  on context_item using hnsw (summary_embedding vector_cosine_ops);

-- ----------------------------------------------------------------------------
-- Layer 1: context_chunk (hash-partitioned by user_id)
-- ----------------------------------------------------------------------------
create table context_chunk (
  id                uuid not null default gen_random_uuid(),
  item_id           uuid not null,
  user_id           uuid not null,
  source            text not null,
  source_created_at timestamptz not null,
  source_updated_at timestamptz not null,
  content           text not null,        -- provenance line + gloss + body
  embedding         vector(1536),
  fts               tsvector generated always as (to_tsvector('english', content)) stored,
  primary key (user_id, id)               -- partition key must sit in the PK
) partition by hash (user_id);

create table context_chunk_p0 partition of context_chunk for values with (modulus 8, remainder 0);
create table context_chunk_p1 partition of context_chunk for values with (modulus 8, remainder 1);
create table context_chunk_p2 partition of context_chunk for values with (modulus 8, remainder 2);
create table context_chunk_p3 partition of context_chunk for values with (modulus 8, remainder 3);
create table context_chunk_p4 partition of context_chunk for values with (modulus 8, remainder 4);
create table context_chunk_p5 partition of context_chunk for values with (modulus 8, remainder 5);
create table context_chunk_p6 partition of context_chunk for values with (modulus 8, remainder 6);
create table context_chunk_p7 partition of context_chunk for values with (modulus 8, remainder 7);

-- Declared on the parent; created on every partition automatically.
create index context_chunk_embedding_hnsw_idx on context_chunk using hnsw (embedding vector_cosine_ops);
create index context_chunk_fts_gin_idx on context_chunk using gin (fts);
create index context_chunk_user_source_updated_idx
  on context_chunk (user_id, source, source_updated_at desc);

-- ----------------------------------------------------------------------------
-- Layer 2: entity (relationship graph nodes)
-- Note: email/domain are first-class here (CLAUDE.md schema). The entity-
-- resolution rules in both docs canonicalize on email first, so the column is
-- required even though docs/Architecture.md §6.2's SQL omits it. See docs/trade-offs.md.
-- ----------------------------------------------------------------------------
create table entity (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  type       text not null,                 -- 'person' | 'company' | 'project'
  name       text not null,
  email      text,                          -- canonical key, unique per user when present
  domain     text,
  aliases    text[] default '{}',
  metadata   jsonb default '{}',
  created_at timestamptz default now()
);

-- Email is the canonical identity when present; names can collide across people.
create unique index entity_user_email_uniq on entity (user_id, email) where email is not null;
-- Fallback uniqueness on (type, name) for the no-email case keeps the graph from
-- fragmenting on exact-name re-extraction.
create unique index entity_user_type_name_uniq on entity (user_id, type, name) where email is null;
create index entity_user_type_idx on entity (user_id, type);
create index entity_name_trgm_idx on entity using gin (name gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- Layer 2: edge (typed, append-only relationships)
-- Uses subject_id/object_id (docs/Architecture.md §6.2) to mirror triple extraction
-- {subject, relation, object} and the recursive-CTE traversal. See docs/trade-offs.md.
-- ----------------------------------------------------------------------------
create table edge (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  subject_id   uuid not null references entity(id) on delete cascade,
  relation     text not null,                -- 'invested_in' | 'works_with' | 'introduced_by' | 'decided' | ...
  object_id    uuid not null references entity(id) on delete cascade,
  confidence   real not null default 1.0,
  source_item  uuid references context_item(id) on delete set null,
  occurred_at  timestamptz,
  created_at   timestamptz default now(),
  unique (user_id, subject_id, relation, object_id, source_item)
);

create index edge_user_subject_idx on edge (user_id, subject_id);
create index edge_user_object_idx on edge (user_id, object_id);

-- ----------------------------------------------------------------------------
-- Row-Level Security (second layer of tenancy; app-level user_id scoping is first)
--
-- Policies match auth.uid() against user_id. Primary enforcement is the
-- service-role client always scoping by user_id in the WHERE (CLAUDE.md). RLS
-- here is defense-in-depth: it denies cross-tenant reads for any request that
-- carries a Supabase JWT (auth.uid()). The service role bypasses RLS by design.
-- ----------------------------------------------------------------------------
alter table context_item enable row level security;
alter table context_chunk enable row level security;
alter table entity enable row level security;
alter table edge enable row level security;

create policy context_item_tenant_isolation on context_item
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy context_chunk_tenant_isolation on context_chunk
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy entity_tenant_isolation on entity
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy edge_tenant_isolation on edge
  using (user_id = auth.uid()) with check (user_id = auth.uid());
