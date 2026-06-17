// One-time data fix: populate context_item.url for already-ingested Slack rows.
// Older Slack ingestion stored url=null; the connector now builds an app_redirect
// permalink from the team id on each message. This backfills existing rows from
// raw.team + metadata.channelId + the ts embedded in external_id (channelId:ts).
// Run: set -a; . ./.env.local; set +a; pnpm exec tsx scripts/backfill-slack-urls.ts
import ws from 'ws'
// Node 20 has no global WebSocket; supabase-js constructs a realtime client eagerly.
// We only do HTTP (PostgREST) calls here, but the constructor needs the global set.
;(globalThis as { WebSocket?: unknown }).WebSocket ??= ws
import { createServiceClient } from '../lib/db/supabase'
import { slackPermalink } from '../lib/connectors/slack'

const PAGE = 500

async function main() {
  const db = createServiceClient()
  let updated = 0
  let skipped = 0
  // Keyset pagination by id: updated rows leave the `url is null` set, so an
  // offset cursor would skip rows; an id cursor stays stable and steps past the
  // skipped (still-null) rows without looping.
  let afterId = ''

  for (;;) {
    const { data, error } = await db
      .from('context_item')
      .select('id, external_id, metadata, raw')
      .eq('source', 'slack')
      .is('url', null)
      .gt('id', afterId)
      .order('id', { ascending: true })
      .limit(PAGE)
    if (error) throw new Error(`select slack rows: ${error.message}`)
    const rows = data ?? []
    if (rows.length === 0) break
    afterId = String(rows[rows.length - 1]!.id)

    for (const row of rows) {
      const metadata = (row.metadata ?? {}) as { channelId?: string; team?: string }
      const raw = (row.raw ?? {}) as { team?: string }
      const team = raw.team ?? metadata.team
      // external_id is `${channelId}:${ts}`; prefer metadata.channelId, fall back to the prefix.
      const [prefixChannel, ts] = String(row.external_id ?? '').split(':')
      const channelId = metadata.channelId ?? prefixChannel
      const url = slackPermalink(team, channelId, ts)
      if (!url) {
        skipped++
        continue
      }
      const { error: upErr } = await db.from('context_item').update({ url }).eq('id', row.id)
      if (upErr) throw new Error(`update ${row.id}: ${upErr.message}`)
      updated++
    }

    if (rows.length < PAGE) break
  }

  console.log(`Slack url backfill: updated ${updated}, skipped ${skipped} (no team/channel)`)
}

main().catch((err) => {
  console.error('Slack url backfill: FAIL')
  console.error(err.message)
  process.exit(1)
})
