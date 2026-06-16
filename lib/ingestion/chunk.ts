// Chunk-if-long. Structured items (one short record) stay a single chunk; long
// unstructured bodies split on paragraph boundaries into ~1500-char windows with
// a small overlap so retrieval keeps local context. Meeting transcripts chunk by
// speaker turn (Phase 7 audio); until then they fall through to paragraph split.

const MAX_CHARS = 1500
const OVERLAP_CHARS = 150
const SINGLE_CHUNK_CEILING = 1800 // below this, do not split at all

export function chunkText(body: string): string[] {
  const text = body.trim()
  if (text.length === 0) return []
  if (text.length <= SINGLE_CHUNK_CEILING) return [text]

  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const chunks: string[] = []
  let current = ''

  for (const para of paragraphs) {
    if (current.length + para.length + 2 <= MAX_CHARS) {
      current = current ? `${current}\n\n${para}` : para
      continue
    }
    if (current) chunks.push(current)
    if (para.length <= MAX_CHARS) {
      // Carry a small overlap tail from the previous chunk for continuity.
      const tail = current.slice(-OVERLAP_CHARS)
      current = tail ? `${tail}\n\n${para}` : para
    } else {
      // A single oversized paragraph: hard-split into windows.
      for (let i = 0; i < para.length; i += MAX_CHARS - OVERLAP_CHARS) {
        chunks.push(para.slice(i, i + MAX_CHARS))
      }
      current = ''
    }
  }
  if (current) chunks.push(current)
  return chunks
}
