<div align="center">

# zrux

### The founder brief that reads your work tools before you do.

zrux connects to your email, calendar, issues, docs, and team chat, then turns that scattered context into a focused daily brief, grounded answers, relationship intelligence, and cross-source search.

<br />

[Open zrux](https://zrux.vercel.app) | [How it works](#how-zrux-works) | [Connectors](#connects-to) | [Run locally](#run-locally)

</div>

<br />

## What zrux Does

Founders spend the day switching between inboxes, calendars, issue trackers, docs, and chat threads. zrux pulls those signals into one context engine so you can ask what actually needs attention.

- See a ranked morning brief from connected tools.
- Ask grounded questions with source citations.
- Search across email, Slack, Linear, Notion, Calendar, and more from one place.
- Track relationship strength, reply gaps, and who is drifting out of orbit.
- Save standing preferences so answers are ordered around how you work.

zrux is built around one product rule: the answer path reads stored context. Source APIs are used during ingestion, not while an answer is being written.

<br />

## Product Tour

<p>
  <strong>Landing</strong><br />
  A simple promise: one short brief on what actually needs you.
</p>

<p>
  <img src="docs/assets/landing-hero.png" alt="zrux landing page hero" />
</p>

<table>
  <tr>
    <td width="50%">
      <strong>Today</strong><br />
      A ranked morning brief assembled from connected tools and ordered by urgency and preference.
    </td>
    <td width="50%">
      <strong>Ask</strong><br />
      Grounded answers with inline source badges and expandable cited source cards.
    </td>
  </tr>
  <tr>
    <td><img src="docs/assets/app-today.png" alt="Today briefing screen from the live app" /></td>
    <td><img src="docs/assets/app-ask-zrux.png" alt="Ask screen answering what to get done for Zrux" /></td>
  </tr>
  <tr>
    <td width="50%">
      <strong>Relationships</strong><br />
      Strength-ranked contacts, reply gaps, and a you-centered relationship orbit.
    </td>
    <td width="50%">
      <strong>Ask in another workspace</strong><br />
      The same read path works across a different connected workspace with Linear and Notion citations.
    </td>
  </tr>
  <tr>
    <td><img src="docs/assets/app-relationships.png" alt="Relationships screen from the live app" /></td>
    <td><img src="docs/assets/app-ask-rex.png" alt="Ask screen answering what to do in Rex today" /></td>
  </tr>
</table>

<br />

## Questions It Answers

```text
What should I focus on today?
Which tasks are blocked right now?
What should I know before my next meeting?
Who am I overdue to reply to?
What follow-ups am I missing?
What customer issues are showing up repeatedly?
```

When the connected tools do not contain enough evidence, zrux says that plainly instead of inventing an answer.

<br />

## How zrux Works

zrux has three core loops:

- **Connection loop:** Next.js starts Composio OAuth for each source, stores connection state in Postgres, and queues the first load.
- **Ingestion loop:** Trigger.dev jobs load, poll, and slim connected sources, normalize items, embed chunks, extract high-signal relationships, and keep source state current.
- **Read loop:** API routes retrieve from stored context, enrich with graph and preference memory, rerank, assemble citations, and synthesize grounded answers.

![zrux architecture](docs/assets/architecture.svg)

<details>
<summary>Editable Mermaid data-flow diagram</summary>

```mermaid
flowchart LR
  subgraph Product["Product surfaces"]
    Today["Today"]
    Ask["Ask"]
    Search["Search"]
    Relationships["Relationships"]
    Connections["Connections"]
    Preferences["Preferences"]
  end

  subgraph Connect["Connection plane"]
    ConnectApi["/api/connect/[source]"]
    Composio["Composio OAuth"]
    Callback["/api/oauth/callback"]
    SourceConnection["source_connection"]
  end

  subgraph Sources["Active source connectors"]
    Gmail["Gmail"]
    Calendar["Google Calendar"]
    Linear["Linear"]
    Slack["Slack"]
    Notion["Notion"]
  end

  subgraph Ingest["Ingestion plane - Trigger.dev v4"]
    Load["ingest-source load"]
    Poll["poll-sources every 30 min"]
    Slim["slim-sources every 6 hours"]
    Webhook["real-time Slack messages"]
    Core["normalize, chunk, enrich, embed"]
    GraphBuild["relationship extraction"]
  end

  subgraph Store["Supabase Postgres + pgvector"]
    Items["context_item"]
    Chunks["context_chunk"]
    ConnRows["source_connection"]
    Sync["sync checkpoint"]
    Graph["entity + edge"]
  end

  subgraph Read["Read plane - Next.js API"]
    AnswerApi["/api/answer"]
    TodayApi["/api/today"]
    SearchApi["/api/search"]
    GraphApi["/api/graph"]
    RememberApi["/api/remember"]
    Cache["semantic cache"]
    Planner["query planning + meeting prep"]
    Retrieve["hybrid search + graph expand"]
    Rank["Cohere rerank + retrieval rail"]
    Rollup["rollup + citations"]
    Memory["Supermemory preferences"]
    Synthesis["OpenRouter synthesis"]
  end

  subgraph Observe["Observability"]
    Langfuse["Langfuse"]
    Sentry["Sentry"]
  end

  Product --> AnswerApi
  Product --> TodayApi
  Product --> SearchApi
  Product --> GraphApi
  Product --> RememberApi
  Connections --> ConnectApi
  ConnectApi --> Composio --> Callback --> SourceConnection --> Load
  SourceConnection --> ConnRows
  Sources --> Load
  Sources --> Poll
  Sources --> Slim
  Slack --> Webhook
  Webhook --> Core
  Load --> Core
  Poll --> Core
  Slim --> Sync
  Core --> Items
  Core --> Chunks
  Core --> GraphBuild --> Graph
  AnswerApi --> Cache --> Planner --> Retrieve --> Rank --> Rollup --> Synthesis
  TodayApi --> Planner
  SearchApi --> Retrieve
  GraphApi --> Graph
  RememberApi --> Memory
  Retrieve --> Chunks
  Retrieve --> Graph
  Rollup --> Items
  Planner --> Memory
  Synthesis --> Langfuse
  Read --> Sentry
```

</details>

<br />

## Connects To

| Source | What zrux uses it for |
| --- | --- |
| Gmail | Email threads, senders, follow-ups, and relationship signals. |
| Google Calendar | Meetings, participants, meeting-prep context, and relationship recency. |
| Linear | Issues, ownership, blockers, status, and project work. |
| Slack | Channel messages through load/poll/slim plus near-real-time webhook events. |
| Notion | Pages and docs through markdown ingestion, chunking, and graph-eligible context. |

The connector contract is shared across sources: `load`, `poll`, `slim`, and optional `handleEvent`. GitHub, audio ingestion, and additional tools can be added through that same seam. Sentry is used for application observability in the current product.

<br />

## Product Surfaces

| Surface | What it does |
| --- | --- |
| Today | Generates a cached daily brief from the same retrieval pipeline used by Ask. |
| Ask | Streams grounded answers with citations, source cards, semantic cache hits, and graceful fallback. |
| Search | Runs hybrid keyword plus semantic search across active connected sources. |
| Relationships | Builds strength-ranked contact surfaces from email and calendar interaction metadata. |
| Connections | Starts, reconciles, and disconnects source connections. |
| Preferences | Stores standing priorities that shape answer ordering without adding facts. |

<br />

## Run Locally

```bash
pnpm install
cp .env.example .env.local
pnpm exec supabase link --project-ref <your-project-ref>
pnpm exec supabase db push
pnpm db:types
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) for local development, or use the live product at [zrux.vercel.app](https://zrux.vercel.app).

The full credential guide is in [docs/SETUP.md](docs/SETUP.md). `.env.example` lists the required variable names without real secrets.

<br />

## Stack

| Layer | Choice |
| --- | --- |
| App | Next.js App Router, React, TypeScript |
| Database | Supabase Postgres, pgvector, RLS |
| Ingestion | Trigger.dev v4 |
| Integrations | Composio plus the local connector contract |
| LLM | OpenRouter through the Vercel AI SDK |
| Embeddings | OpenAI `text-embedding-3-large`, 1536 dims |
| Reranking | Cohere Rerank |
| Cache | Upstash Redis semantic cache |
| Personalization | Supermemory |
| Observability | Langfuse traces and Sentry reporting |

<br />

## Repository Map

```text
app/
  api/answer/        streamed answer path
  api/connect/       source connection management
  api/webhooks/      event-mode ingestion webhooks
  (app)/             Today, Ask, Search, Relationships

lib/
  connectors/        Gmail, Calendar, Linear, Slack, Notion
  ingestion/         normalize, chunk, enrich, embed, upsert
  retrieval/         plan, meeting prep, search, graph expand, rerank, rail, rollup, assemble
  graph/             entity resolution, relationship extraction, relationship intelligence
  cache/             Redis semantic cache
  llm/               OpenRouter gateway, retry, fallback, circuit breaker
  personalization/   Supermemory preferences

supabase/
  migrations/        context, graph, source state, hybrid search

trigger/
  ingest, poll, slim, personalization jobs
```
