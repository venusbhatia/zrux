# trade-offs.md - decisions made during the build

Running log of trade-offs taken while implementing `spec.md`. Each entry: what
was decided, why, and what it costs. This complements (does not replace) the
"Tradeoffs and decisions" section of `Architecture.md`, which covers the
*design-time* choices. This file records *build-time* choices, especially where
the spec or the two design docs left something open or in conflict.

---

## Phase 0 - skeleton & infrastructure

### T0.1 - `edge` uses `subject_id`/`object_id`, not `from_id`/`to_id`

**Conflict.** `CLAUDE.md`'s schema defines the edge endpoints as `from_id` /
`to_id`. `Architecture.md` §6.2 (the design reference) defines them as
`subject_id` / `object_id`, and its recursive-CTE traversal example, its indexes,
and the triple-extraction output shape (`{subject, relation, object}`) all use the
subject/object naming.

**Decision.** Use `subject_id` / `object_id`.

**Why.** The spec's tie-breaker rule is "where this file and the design docs
agree, the design docs are the reference." Architecture.md is internally
consistent on subject/object across schema, indexes, and traversal; CLAUDE.md's
`from_id/to_id` appears only in the one schema block. Aligning the column names
with the triple-extraction vocabulary also removes a translation layer in
`lib/graph/triple-extraction.ts`.

**Cost.** Anyone reading only CLAUDE.md's schema block will see different column
names than the migration. Mitigated by this note and a comment in
`0001_init.sql`.

### T0.2 - `entity` keeps first-class `email` and `domain` columns

**Conflict.** `Architecture.md` §6.2's `entity` SQL has only `name` + `aliases`
(unique on `user_id, type, name`) with no `email`/`domain`. But the
entity-resolution rules in *both* docs (Architecture.md §6.3, CLAUDE.md
"Entity resolution rules") say email is the canonical key and companies resolve
on name + domain. CLAUDE.md's schema block does include `email`/`domain`.

**Decision.** Keep `email` and `domain` as columns. Unique on `(user_id, email)
where email is not null`; fall back to unique on `(user_id, type, name) where
email is null` so exact-name re-extraction does not fragment the graph.

**Why.** Resolution rule #1 ("match on email first, always") is impossible
without an email column. Architecture.md's prose mandates the behavior its own
SQL cannot support; CLAUDE.md's schema is the consistent one here, so it wins on
this specific field.

**Cost.** Slightly richer entity table than the bare design SQL. No downside at
this scale.

### T0.3 - RLS uses `auth.uid()` but app-level scoping is the real enforcement

**Context.** Auth is NextAuth (D3), not Supabase GoTrue, so `auth.uid()` is only
populated for requests that carry a Supabase JWT. Server-side reads go through
the service-role client, which bypasses RLS by design.

**Decision.** Enable RLS on every tenant table with `user_id = auth.uid()`
policies, and treat app-level `user_id`-in-the-WHERE on the service client as the
primary defense (per CLAUDE.md: "RLS as a second layer, not the first").

**Why.** Matches the standing order and the spec's cross-cutting tenancy rule.
RLS is genuine defense-in-depth: it denies cross-tenant reads for any anon/JWT
path, and it is the thing that catches a future query that forgets its
`user_id` filter.

**Cost.** The "RLS denies a cross-user_id read" acceptance test must be run via
an anon client holding a Supabase JWT, not via the service client (which is
supposed to bypass it). Documented so the test is written correctly. A future
hardening option is to mint short-lived Supabase JWTs from the NextAuth session
so the anon client can be used for user reads and RLS becomes load-bearing.

### T0.4 - Hand-written `lib/db/types.ts` until the project is linked

**Decision.** Ship a hand-written `Database` type that mirrors
`0001_init.sql`/`0003_sync_state.sql`, regenerated later with `pnpm db:types`
(`supabase gen types typescript --linked`).

**Why.** The typed Supabase client needs a `Database` type to compile now;
generating it requires a live linked project and credentials, which are not
wired in Phase 0. The hand-written shape keeps strict TypeScript green and is
replaced wholesale once a project exists.

**Cost.** The hand-written type can drift from the migrations until regenerated.
Low risk at three tables; regeneration is one command.

**Update (after DB went live).** Both regeneration paths are blocked in this
build environment: `supabase gen types --db-url` spawns a Docker container
(`postgres-meta`) and Docker is not installed; `--linked` needs a successful
`supabase link`, which returns `Unauthorized` (the personal access token in use
lacks management-API scope for this project). The hand-written types remain the
source of truth; they were validated against the live schema by
`scripts/verify-db.ts` (all five tables reachable, `hybrid_search` executes). To
regenerate later: either install Docker, or create a token with project scope and
re-run `pnpm db:types`.

### T0.5 - Scaffolded by hand instead of `create-next-app`

**Decision.** Write `package.json`, `tsconfig.json`, Next config, and the app
shell directly rather than running `create-next-app`.

**Why.** Full control over strict-mode tsconfig, the no-semicolons Prettier
config, named-exports convention, and the exact dependency set, with no
interactive scaffolder and no network round-trip to generate boilerplate we would
immediately rewrite.

**Cost.** We own the config files from the start (intended). `pnpm install` still
needs network; if unavailable the scaffold stands but is not yet runnable.
