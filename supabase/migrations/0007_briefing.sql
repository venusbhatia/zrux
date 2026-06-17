-- 0007_briefing.sql
-- Durable, Redis-independent cache for the precomputed Today briefing. One row
-- per tenant holding the full TodayResponse payload. The staggered Trigger.dev
-- job writes it ahead of the morning; the /api/today route serves it cache-first
-- and falls back to computing inline on any miss, staleness, or error. RLS scoped
-- by user_id; service-role writes (job + route fallback) bypass it.

create table if not exists briefing (
  user_id      uuid primary key,
  payload      jsonb not null,
  item_count   int not null default 0,
  generated_at timestamptz not null default now()
);

alter table briefing enable row level security;
create policy briefing_self on briefing
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
