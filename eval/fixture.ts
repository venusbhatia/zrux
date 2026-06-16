// Synthetic founder fixture for the eval harness (plan §11.1). Stable, known
// tenant; real-looking emails, Linear issues, and calendar events spanning the
// last week so "this week" time filters keep them in range.
//
// Why TypeScript and not fixture-tenant.sql: chunk embeddings are vector(1536)
// and cannot be hand-authored in SQL. Seeding through the real ingestion pipeline
// (ingestItems) produces genuine embeddings and exercises normalize -> chunk ->
// embed -> upsert, so the eval measures the live retrieval path, not a stub.
//
// external_id is the deterministic, stable key (context_item is unique on
// user_id+source+external_id). golden.jsonl references these ids; run.ts maps a
// citation's item_id back to its external_id for recall scoring.

import type { RawItem } from '../lib/connectors/types'

// Invariant (plan §1): never the live demo tenant.
export const FIXTURE_USER_ID = '00000000-0000-0000-0000-000000000001'

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function daysAhead(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d
}

function item(partial: Omit<RawItem, 'raw'> & { raw?: unknown }): RawItem {
  return { raw: { synthetic: true, externalId: partial.externalId }, ...partial }
}

// --- Linear issues (10): 3 blocked, 2 in-progress, 2 done, 3 backlog ---
const linear: RawItem[] = [
  item({
    source: 'linear',
    type: 'issue',
    externalId: 'eval-lin-blocked-payment',
    title: 'Payment webhook not firing',
    author: 'Dev Shah',
    status: 'blocked',
    sourceCreatedAt: daysAgo(6),
    sourceUpdatedAt: daysAgo(1),
    body: 'The Stripe payment webhook is not firing on successful checkout, so paid accounts stay on the free tier. Blocked on Stripe support confirming the endpoint signing secret. This is blocking revenue and the launch.',
  }),
  item({
    source: 'linear',
    type: 'issue',
    externalId: 'eval-lin-blocked-auth',
    title: 'Auth rate limiting causing login failures',
    author: 'Priya Nair',
    status: 'blocked',
    sourceCreatedAt: daysAgo(5),
    sourceUpdatedAt: daysAgo(1),
    body: 'Customers are hitting auth rate limits and cannot log in during peak hours. Blocked on a decision from infra about raising the per-IP limit. Several enterprise users reported repeated login errors.',
  }),
  item({
    source: 'linear',
    type: 'issue',
    externalId: 'eval-lin-blocked-dashboard',
    title: 'Investor dashboard empty state is broken',
    author: 'Dev Shah',
    status: 'blocked',
    sourceCreatedAt: daysAgo(4),
    sourceUpdatedAt: daysAgo(2),
    body: 'The investor dashboard renders a blank screen when there is no data instead of an empty state. Blocked on final design from the founding designer. Needed before the Northwind investor call.',
  }),
  item({
    source: 'linear',
    type: 'issue',
    externalId: 'eval-lin-prog-onboarding',
    title: 'Onboarding stepper implementation',
    author: 'Priya Nair',
    status: 'in_progress',
    sourceCreatedAt: daysAgo(8),
    sourceUpdatedAt: daysAgo(1),
    body: 'Building the multi-step onboarding stepper that connects sources and handles a graceful cold-start over the last ninety days of data. In progress, on track for this sprint.',
  }),
  item({
    source: 'linear',
    type: 'issue',
    externalId: 'eval-lin-prog-search',
    title: 'Semantic search ranking quality',
    author: 'Dev Shah',
    status: 'in_progress',
    sourceCreatedAt: daysAgo(7),
    sourceUpdatedAt: daysAgo(2),
    body: 'Improving hybrid search ranking with a reranker and a retrieval rail. In progress; early results show better top-result relevance across sources.',
  }),
  item({
    source: 'linear',
    type: 'issue',
    externalId: 'eval-lin-done-okr',
    title: 'Q2 OKR retrospective',
    author: 'Priya Nair',
    status: 'done',
    sourceCreatedAt: daysAgo(12),
    sourceUpdatedAt: daysAgo(3),
    body: 'Completed the Q2 OKR retrospective. We hit the activation target and missed the revenue target. Action items captured for Q3 planning.',
  }),
  item({
    source: 'linear',
    type: 'issue',
    externalId: 'eval-lin-done-migration',
    title: 'Postgres partition migration',
    author: 'Dev Shah',
    status: 'done',
    sourceCreatedAt: daysAgo(14),
    sourceUpdatedAt: daysAgo(4),
    body: 'Shipped the hash-partitioned context_chunk migration by user_id. Done and verified in production with no downtime.',
  }),
  item({
    source: 'linear',
    type: 'issue',
    externalId: 'eval-lin-backlog-mobile',
    title: 'Mobile app shell',
    author: 'Priya Nair',
    status: 'backlog',
    sourceCreatedAt: daysAgo(20),
    sourceUpdatedAt: daysAgo(6),
    body: 'Backlog: scaffold a mobile app shell so the founder can ask questions on the go. Not scheduled yet.',
  }),
  item({
    source: 'linear',
    type: 'issue',
    externalId: 'eval-lin-backlog-billing',
    title: 'Usage-based billing',
    author: 'Dev Shah',
    status: 'backlog',
    sourceCreatedAt: daysAgo(18),
    sourceUpdatedAt: daysAgo(6),
    body: 'Backlog: add usage-based billing tiers tied to question volume. Depends on the payment webhook being fixed first.',
  }),
  item({
    source: 'linear',
    type: 'issue',
    externalId: 'eval-lin-backlog-audit',
    title: 'SOC2 audit preparation',
    author: 'Priya Nair',
    status: 'backlog',
    sourceCreatedAt: daysAgo(16),
    sourceUpdatedAt: daysAgo(6),
    body: 'Backlog: prepare for the SOC2 Type II audit. Enterprise prospects keep asking about data residency and deletion guarantees.',
  }),
]

// --- Gmail threads (8) ---
const gmail: RawItem[] = [
  item({
    source: 'gmail',
    type: 'email',
    externalId: 'eval-gm-investor-northwind',
    title: 'Northwind Capital seed term sheet',
    author: 'Sarah Chen <sarah@northwind.vc>',
    sourceCreatedAt: daysAgo(2),
    sourceUpdatedAt: daysAgo(1),
    body: 'Sarah Chen at Northwind Capital sent a revised seed term sheet and wants to close the round by end of next week. She needs the updated cap table and the latest revenue numbers before Thursday. This is the most important investor follow-up right now.',
  }),
  item({
    source: 'gmail',
    type: 'email',
    externalId: 'eval-gm-investor-update',
    title: 'May investor update',
    author: 'founder@zrux.app',
    sourceCreatedAt: daysAgo(3),
    sourceUpdatedAt: daysAgo(3),
    body: 'Monthly investor update sent to all angels and Northwind. Highlights: activation up twenty percent, revenue flat, two enterprise pilots in progress. Ask: intros to design hires and enterprise security contacts.',
  }),
  item({
    source: 'gmail',
    type: 'email',
    externalId: 'eval-gm-acme-feedback',
    title: 'Acme Corp product feedback',
    author: 'Maria Lopez <maria@acme.com>',
    sourceCreatedAt: daysAgo(4),
    sourceUpdatedAt: daysAgo(2),
    body: 'Maria from Acme Corp shared product feedback after the pilot. They love cross-source search but want SSO and an audit log before expanding. Asked for a follow-up on data residency. Needs a reply this week.',
  }),
  item({
    source: 'gmail',
    type: 'email',
    externalId: 'eval-gm-team-sync',
    title: 'Weekly team sync notes',
    author: 'Priya Nair <priya@zrux.app>',
    sourceCreatedAt: daysAgo(2),
    sourceUpdatedAt: daysAgo(2),
    body: 'Team sync notes: payment webhook still blocked, onboarding stepper on track, board deck due Monday. Priya owns product section, Dev owns the financial model.',
  }),
  item({
    source: 'gmail',
    type: 'email',
    externalId: 'eval-gm-vendor-contract',
    title: 'Deepgram contract renewal',
    author: 'billing@deepgram.com',
    sourceCreatedAt: daysAgo(5),
    sourceUpdatedAt: daysAgo(3),
    body: 'The Deepgram transcription vendor contract renews at the end of the month with a fifteen percent price increase. Needs a decision on whether to renew or renegotiate. This vendor contract needs attention soon.',
  }),
  item({
    source: 'gmail',
    type: 'email',
    externalId: 'eval-gm-customer-issue',
    title: 'Repeated login errors from customers',
    author: 'support@zrux.app',
    sourceCreatedAt: daysAgo(3),
    sourceUpdatedAt: daysAgo(1),
    body: 'Support is seeing a recurring theme: multiple customers report repeated login errors and being locked out during peak hours. This keeps coming up and is tied to the auth rate limiting issue.',
  }),
  item({
    source: 'gmail',
    type: 'email',
    externalId: 'eval-gm-hiring',
    title: 'Founding designer candidate',
    author: 'recruiting@zrux.app',
    sourceCreatedAt: daysAgo(4),
    sourceUpdatedAt: daysAgo(2),
    body: 'Strong founding designer candidate completed the final interview and is ready for an offer. Hiring update: this unblocks the investor dashboard empty state design.',
  }),
  item({
    source: 'gmail',
    type: 'email',
    externalId: 'eval-gm-board-prep',
    title: 'Board deck draft for review',
    author: 'founder@zrux.app',
    sourceCreatedAt: daysAgo(2),
    sourceUpdatedAt: daysAgo(1),
    body: 'Draft of the Q2 board deck is ready for review. The metrics section needs the latest revenue numbers. Board meeting is in two weeks; please review before then.',
  }),
]

// --- Calendar events (5) ---
const calendar: RawItem[] = [
  item({
    source: 'calendar',
    type: 'meeting',
    externalId: 'eval-cal-investor-call',
    title: 'Investor call with Sarah Chen (Northwind)',
    author: 'founder@zrux.app',
    sourceCreatedAt: daysAgo(3),
    sourceUpdatedAt: daysAhead(3),
    metadata: { participants: ['Sarah Chen', 'founder@zrux.app', 'Priya Nair'] },
    body: 'Your next meeting is the investor call with Sarah Chen from Northwind Capital, coming up on Monday. Agenda: walk through the revised seed term sheet, the updated cap table, and the latest revenue numbers. Before this meeting you should have the cap table reviewed and the revenue figures ready, since Sarah asked for both. This is the next major meeting on the calendar.',
  }),
  item({
    source: 'calendar',
    type: 'meeting',
    externalId: 'eval-cal-standup',
    title: 'Weekly team standup',
    author: 'founder@zrux.app',
    sourceCreatedAt: daysAgo(7),
    sourceUpdatedAt: daysAhead(1),
    metadata: { participants: ['Dev Shah', 'Priya Nair', 'founder@zrux.app'] },
    body: 'Recurring weekly team standup to review blockers and sprint progress.',
  }),
  item({
    source: 'calendar',
    type: 'meeting',
    externalId: 'eval-cal-acme-demo',
    title: 'Product demo with Acme Corp',
    author: 'founder@zrux.app',
    sourceCreatedAt: daysAgo(4),
    sourceUpdatedAt: daysAhead(5),
    metadata: { participants: ['Maria Lopez', 'founder@zrux.app'] },
    body: 'Upcoming product demo with Acme Corp to show SSO progress and the audit log roadmap. Follow-up from Maria Lopez feedback; be ready to address data residency.',
  }),
  item({
    source: 'calendar',
    type: 'meeting',
    externalId: 'eval-cal-board',
    title: 'Q2 Board meeting',
    author: 'founder@zrux.app',
    sourceCreatedAt: daysAgo(6),
    sourceUpdatedAt: daysAhead(12),
    metadata: { participants: ['Sarah Chen', 'founder@zrux.app', 'board@zrux.app'] },
    body: 'Upcoming Q2 board meeting in about two weeks. Need the board deck reviewed and the metrics section finalized with the latest revenue numbers.',
  }),
  item({
    source: 'calendar',
    type: 'meeting',
    externalId: 'eval-cal-1on1',
    title: '1:1 with Priya',
    author: 'founder@zrux.app',
    sourceCreatedAt: daysAgo(5),
    sourceUpdatedAt: daysAhead(2),
    metadata: { participants: ['Priya Nair', 'founder@zrux.app'] },
    body: 'Weekly 1:1 with Priya to review product priorities and the onboarding stepper.',
  }),
]

export const FIXTURE_GROUPS: { source: string; items: RawItem[] }[] = [
  { source: 'linear', items: linear },
  { source: 'gmail', items: gmail },
  { source: 'calendar', items: calendar },
]
