-- 0005_distinct_sources.sql
-- Distinct, non-deleted sources a tenant actually has data in. Used to stratify
-- broad-intent retrieval (search.ts). A SELECT DISTINCT in the database returns
-- only as many rows as there are distinct sources, so it is never subject to the
-- PostgREST max-rows cap (default 1000) that would silently truncate a
-- client-side dedupe of every context_item row and drop a whole source.

create or replace function distinct_sources(p_user_id uuid)
returns table (source text)
language sql stable as $$
  select distinct source
  from context_item
  where user_id = p_user_id
    and is_deleted = false
$$;
