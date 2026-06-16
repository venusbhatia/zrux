-- 0004_source_connection.sql
-- Tracks each tenant's connected source accounts (the Composio connected-account
-- handle). One row per (user, source). The scheduled poller iterates the active
-- rows; the OAuth callback flips status to 'active' and kicks the first load.

create table source_connection (
  user_id              uuid not null,
  source               text not null,
  connected_account_id text not null,
  status               text not null default 'initiated',  -- 'initiated' | 'active' | 'error'
  metadata             jsonb default '{}',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (user_id, source)
);

create index source_connection_active_idx
  on source_connection (status) where status = 'active';

alter table source_connection enable row level security;
create policy source_connection_tenant_isolation on source_connection
  using (user_id = auth.uid()) with check (user_id = auth.uid());
