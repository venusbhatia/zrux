# docs/SETUP.md - wiring credentials before Phase 1

Fill `.env.local` (already created, gitignored) and run the steps below. Keys are
grouped by what they unblock, so you can verify the spine before wiring every
source.

## Tier 1 - minimum to run migrations + the retrieval/answer spine

These unblock: schema in Postgres, embeddings, and grounded answers.

| Variable                        | Where to get it                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project -> Settings -> API -> Project URL                                                              |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase -> Settings -> API -> anon public key                                                                  |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase -> Settings -> API -> service_role key (secret)                                                        |
| `DATABASE_URL`                  | Supabase -> Settings -> Database -> Connection string -> URI (use the Supavisor transaction-mode pooler string) |
| `OPENAI_API_KEY`                | platform.openai.com (embeddings: text-embedding-3-large)                                                        |
| `OPENROUTER_API_KEY`            | openrouter.ai (LLM gateway, claude-sonnet-4-6)                                                                  |

### Apply the schema

```bash
# one-time: link the local project to your Supabase project (needs the project ref + db password)
pnpm exec supabase link --project-ref <your-project-ref>

# push all three migrations
pnpm exec supabase db push

# regenerate typed client from the live schema (replaces the hand-written stub)
pnpm db:types
```

Sanity check the acceptance gates from docs/spec.md Phase 0:

```bash
# hybrid_search returns empty without error (use the SQL editor or psql on DATABASE_URL):
#   select * from hybrid_search('00000000-0000-0000-0000-000000000000'::uuid,
#     (select array_agg(0)::vector(1536) from generate_series(1,1536)), 'test');
```

## Tier 2 - to ingest real data (Phase 1 connectors)

| Variable                                   | Unblocks                                                    |
| ------------------------------------------ | ----------------------------------------------------------- |
| `COMPOSIO_API_KEY`                         | managed OAuth + fetch for Gmail / Calendar / Linear / Slack |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | NextAuth Google sign-in (D3)                                |
| `NEXTAUTH_SECRET`                          | `openssl rand -base64 32`                                   |
| `TRIGGER_SECRET_KEY`, `TRIGGER_PROJECT_ID` | Trigger.dev ingestion jobs (never in an API route)          |

## Tier 3 - quality + resilience (Phase 5)

`COHERE_API_KEY` (rerank), `UPSTASH_REDIS_REST_URL` / `_TOKEN` (semantic cache +
circuit breaker), `DEEPGRAM_API_KEY` (audio), `SUPERMEMORY_API_KEY` (Layer 3),
`LANGFUSE_*` (tracing).

## Note on Composio OAuth for reviewers

Confirm Composio brokers Google consent through its own verified app (open risk
in docs/spec.md §4). If not, add reviewers as OAuth test users and note it in the
README.
