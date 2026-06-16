-- 0006_entity_resolution.sql
-- Fuzzy entity name matching for Layer 2 resolution. Email is the canonical key
-- (handled by the unique index in 0001); this covers the no-email case: match a
-- mentioned name against existing entities of the same type via pg_trgm
-- similarity, conservatively, so "Sarah" / "Sarah Chen" converge without merging
-- unrelated people. Scoped by user_id first (standing order), RLS second.

create or replace function match_entity(
  p_user_id   uuid,
  p_type      text,
  p_name      text,
  p_threshold real default 0.45
) returns table (id uuid, name text, email text, sim real)
language sql stable as $$
  -- Case-insensitive trigram similarity so "Sarah Chen" / "sarah chen" converge.
  -- At per-tenant entity scale a seq scan is fine; the gin(name) index still
  -- serves exact-name lookups elsewhere.
  select id, name, email, similarity(lower(name), lower(p_name)) as sim
  from entity
  where user_id = p_user_id
    and type = p_type
    and similarity(lower(name), lower(p_name)) >= p_threshold
  order by sim desc, (email is not null) desc
  limit 1
$$;

-- Read-only finder for retrieval graph-expansion: resolve a name mentioned in a
-- question to candidate entities across ALL types (the question rarely says
-- whether "Sarah" is a person or a project). Looser threshold than resolution
-- because this only enriches an answer, it never merges graph nodes.
create or replace function find_entities(
  p_user_id   uuid,
  p_name      text,
  p_threshold real default 0.4,
  p_limit     int  default 3
) returns table (id uuid, name text, type text, sim real)
language sql stable as $$
  select id, name, type, similarity(lower(name), lower(p_name)) as sim
  from entity
  where user_id = p_user_id
    and similarity(lower(name), lower(p_name)) >= p_threshold
  order by sim desc
  limit p_limit
$$;
