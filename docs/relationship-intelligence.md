# Relationship Intelligence (Layer 2)

## Why this is not an LLM "knowledge graph"

The first version of this feature extracted typed triples ("X founded Y") from
email **bodies** with an LLM and drew them as a node-link graph. It was noisy and
unhelpful: it centered "AI Tinkerers" (a newsletter sender) because 6 demo
presenters were listed in one digest, rendered relationship direction backwards,
and surfaced third-party facts the founder had no part in.

Every product that people actually pay for to manage relationships from email —
**Affinity** (10–100 strength score), **Cloze** (six explicit factors),
**Clay/Nat/Dex** ("you're losing touch with…"), **Microsoft Graph**
(`relevanceScore`) — does the opposite: it computes relationship **strength from
interaction metadata**, not LLM facts, and surfaces **ranked answers**, treating
the node-link graph as backend structure rather than the headline UI. This is
grounded in tie-strength research (Granovetter; Gilbert & Karahalios, ~85%
accuracy classifying strong/weak ties), where recency, intensity (frequency) and
intimacy dominate, and "days since last contact" is the single strongest signal.

So we re-founded Layer 2 on interaction metadata.

## The strength model (`lib/graph/strength.ts`)

Per contact, computed deterministically (no LLM, no hallucination) from the
founder's ingested Gmail + Calendar:

- **recency** — `exp(-daysSinceLast / 30)` (the 30-day e-fold also used by
  `hybrid_search`, so the graph and retrieval planes age signal consistently).
- **frequency** — recency-weighted interaction count `Σ exp(-Δdays/30)`, saturating.
- **reciprocity** — `1 − 2·|outbound/total − ½|` (1 = balanced, 0 = one-way).
- **responsiveness** — share of threads with a reply in both directions.
- **privacy (intimacy)** — 1:1 threads weighted over mass-CC blasts.
- **longevity** — first→last span.

Two-way **engagement** (reciprocity + responsiveness) **gates** presence
(recency + frequency + privacy + longevity), so a frequent one-way stream (a
newsletter) scores **low** on purpose: `score = presence · (0.15 + 0.85·engagement)`,
mapped to 0–100. The factor breakdown is always retained and shown in the UI —
never a black-box number (Cloze's key lesson).

## Surfaces (the actual value)

`deriveSurfaces()` produces three ranked, actionable lists, which the
`/relationships` page leads with (the you-centered orbit graph is supporting):

- **Strongest** — top by score.
- **Losing touch** — a real two-way contact gone dormant (≥21 days).
- **Awaiting reply** — the founder's outbound with no reply since.

## Ingestion changes for two-way signal (`lib/connectors/gmail.ts`)

Strength needs the founder's **outbound** mail and CC. The connector now captures
`cc` and runs a dedicated `in:sent` pass (sent history is usually older than the
inbox window), so reciprocity/responsiveness are computable. The founder's own
node is a canonical **self-entity** (`FOUNDER_EMAIL` / `FOUNDER_NAME`,
`metadata.is_self`; see `lib/graph/self.ts`) that the graph always centers and
labels "You".

## Honest data ceiling

Relationship intelligence is only as good as the interaction data. A real founder
inbox of two-way correspondence makes this shine; a brand-new test inbox of
inbound newsletters does not. On the live demo tenant the model correctly
surfaces the investors (Sequoia, Lightspeed) and teammates from a calendar
meeting at the top and buries every newsletter at ~13 — but if an inbox has no
real two-way mail, the surfaces honestly show "you're current with everyone"
rather than fabricating relationships.

## Config

- `FOUNDER_EMAIL` — the founder's address; anchors the self-entity and message
  direction. Falls back gracefully (SENT label) if unset.
- `FOUNDER_NAME` — display name for the "You" node (default "You").

## Future work

- **Typed enrichment, demoted.** The LLM typed-edge extraction (gated to
  high-signal, non-promotional mail by the earlier trust fix) can return as a
  small, ego-grounded "tools & services you use" layer — re-extracted with
  founder identity so only relationships the founder participates in survive.
- **Warm-intro / shortest-path** to a target becomes valuable once the contact
  graph spans more than one tenant's mailbox.
