-- 0002_hybrid_search.sql
-- Hybrid retrieval: dense (pgvector) + keyword (tsvector) CTEs, pre-filtered by
-- tenant/source/time, fused by Reciprocal Rank Fusion, then nudged by a
-- post-fusion recency weight. Verbatim from Architecture.md §6.4 / CLAUDE.md.
--
-- Index note: because `filtered` is referenced twice it is materialized, so
-- `vec` does EXACT KNN over the filtered per-tenant set, not an HNSW scan. This
-- is deliberate and correct at per-tenant scale. HNSW matters at 10M+ vectors.

create or replace function hybrid_search(
  p_user_id         uuid,
  p_query_embedding vector(1536),
  p_query_text      text,
  p_sources         text[]      default null,
  p_after           timestamptz default null,
  p_time_basis      text        default 'updated',   -- 'updated' (last activity) | 'created'
  p_recency_weight  float       default 0.0,         -- 0 = pure relevance; 0.3 = favor recent
  p_limit           int         default 60
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
           coalesce(1.0/(60 + vec.rnk), 0) + coalesce(1.0/(60 + kw.rnk), 0) as rrf
    from vec full outer join kw on vec.id = kw.id
  )
  select id, item_id, content,
         rrf * (1 + p_recency_weight * exp(
           -extract(epoch from (now() - ts)) / (30 * 86400.0)
         )) as score
  from fused
  order by score desc limit p_limit;
$$;
