// Node < 22 (including the Trigger.dev worker runtime) ships no global WebSocket,
// but @supabase/supabase-js constructs a realtime client eagerly and throws
// without one, even though we never use realtime. Provide `ws` as the global so
// server-only entrypoints (Trigger tasks) can build a Supabase client. Import
// this before anything that calls createServiceClient/createAnonClient. The web
// app's runtime already has a native WebSocket, so this is a no-op there.
import ws from 'ws'

const g = globalThis as { WebSocket?: unknown }
if (typeof g.WebSocket === 'undefined') {
  g.WebSocket = ws
}
