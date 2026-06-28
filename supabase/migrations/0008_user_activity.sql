-- User activity tracking. Drives the "only fetch while the user is active" gate:
-- the scheduled ingestion plane (poll / slim / briefing) only does work for
-- tenants seen within the active window, and a return after the window kicks an
-- immediate catch-up poll so context is fresh by the time they ask. Idle and
-- never-logged-in tenants cost nothing on Trigger.dev.
--
-- One row per tenant. user_id is the app-derived tenant id (deriveUserId), the
-- same key every other table is scoped by, NOT Supabase's auth.users id.

create table if not exists user_activity (
  user_id        uuid primary key,
  last_active_at timestamptz not null default now(),
  last_login_at  timestamptz,
  updated_at     timestamptz not null default now()
);

-- The crons select active tenants by `last_active_at >= cutoff`; index it so the
-- gate stays cheap as tenants accumulate.
create index if not exists user_activity_last_active_idx
  on user_activity (last_active_at desc);
