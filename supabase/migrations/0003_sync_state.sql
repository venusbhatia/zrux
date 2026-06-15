-- 0003_sync_state.sql
-- Per-(user, source) incremental sync bookmark. The ingestion pipeline reads
-- `last_successful_sync_at` (and optional opaque `cursor`) to drive poll(since).
-- One row per connected source per tenant.

create table sync_state (
  user_id                 uuid not null,
  source                  text not null,
  last_successful_sync_at timestamptz,
  cursor                  text,           -- opaque per-source pagination/delta cursor
  updated_at              timestamptz not null default now(),
  primary key (user_id, source)
);

create index sync_state_user_idx on sync_state (user_id);

alter table sync_state enable row level security;
create policy sync_state_tenant_isolation on sync_state
  using (user_id = auth.uid()) with check (user_id = auth.uid());
