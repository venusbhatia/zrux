// Langfuse tracing setup (Vercel AI SDK + OpenTelemetry).
//
// Coexistence with Sentry: Sentry already owns the GLOBAL OpenTelemetry tracer
// provider. Rather than fight over it, we register our own isolated provider via
// setLangfuseTracerProvider() and hand getLangfuseTracer() explicitly to every AI
// SDK call (experimental_telemetry.tracer). Sentry keeps the global provider and
// its AsyncLocalStorage context manager; Langfuse gets the LLM spans. No clobber.
//
// Tracing is opt-in: a no-op until both Langfuse keys are present, so local dev
// and CI without credentials run completely untouched.

import { LangfuseSpanProcessor } from '@langfuse/otel'
import {
  getLangfuseTracer,
  setLangfuseTracerProvider,
  startActiveObservation,
} from '@langfuse/tracing'
import {
  NodeTracerProvider,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-node'
import type { AttributeValue } from '@opentelemetry/api'
import type { TelemetrySettings } from 'ai'

export const tracingEnabled =
  Boolean(process.env.LANGFUSE_PUBLIC_KEY) && Boolean(process.env.LANGFUSE_SECRET_KEY)

// Langfuse Cloud's free tier bills EVERY observation (span/generation/event), not
// just LLM calls, against a 50k-units/month ceiling. The ingestion plane is the
// volume driver: a single 90-day backfill embeds + enriches + extracts thousands
// of items, each its own observation, and can drain the whole month in one run.
// So we split tracing by plane (mirrors the ingestion-plane/answer-plane split):
//
//   answer plane  - low volume, high value (the graded path). Always traced.
//   ingestion plane - high volume, low value. Off by default; flip on for a
//                     controlled demo run with LANGFUSE_TRACE_INGESTION=true.
//
// Embeddings are never traced anywhere: deterministic, highest-cardinality, zero
// diagnostic value. LANGFUSE_SAMPLE_RATE is a global belt-and-suspenders sampler
// (0..1, default 1) applied at the trace root, so subsampling keeps traces whole.
export const traceIngestion = tracingEnabled && process.env.LANGFUSE_TRACE_INGESTION === 'true'

function sampleRate(): number {
  const raw = Number(process.env.LANGFUSE_SAMPLE_RATE)
  if (!Number.isFinite(raw)) return 1
  return Math.min(1, Math.max(0, raw))
}

// Defense in depth: redact obvious secrets from any string that flows into a span
// before it leaves the process. Prompts and completions are the signal we want to
// keep, so this only strips token-shaped substrings, not content.
const SECRET_RE =
  /(sk-[A-Za-z0-9-]{16,}|Bearer\s+[A-Za-z0-9._-]{8,}|pk-lf-[A-Za-z0-9-]+|sk-lf-[A-Za-z0-9-]+)/g

function mask({ data }: { data: unknown }): unknown {
  if (typeof data === 'string') return data.replace(SECRET_RE, '[redacted]')
  return data
}

let processor: LangfuseSpanProcessor | undefined

// Build the isolated provider once. Safe to call from multiple entrypoints
// (Next.js instrumentation hook, Trigger.dev task) - subsequent calls no-op.
export function initTracing(): void {
  if (!tracingEnabled || processor) return
  processor = new LangfuseSpanProcessor({
    environment: process.env.NODE_ENV,
    mask,
  })
  const provider = new NodeTracerProvider({
    // ParentBasedSampler so a sampling decision at the trace root propagates to
    // every child span - we never want half a trace. Default rate 1 = unchanged.
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(sampleRate()) }),
    spanProcessors: [processor],
  })
  // Deliberately NOT provider.register() - that would replace the global tracer
  // provider Sentry installed. setLangfuseTracerProvider keeps it isolated.
  setLangfuseTracerProvider(provider)
}

// Force-export buffered spans. Call after a (possibly streamed) response finishes
// or at the end of a background job, before the process can be frozen/killed.
export async function flushTracing(): Promise<void> {
  if (processor) await processor.forceFlush()
}

// experimental_telemetry block for an AI SDK call. Passing the tracer explicitly
// routes the span to the isolated Langfuse provider; descriptive functionId names
// the observation in the UI.
export function aiTelemetry(
  functionId: string,
  metadata?: Record<string, AttributeValue>,
): TelemetrySettings {
  if (!tracingEnabled) return { isEnabled: false }
  return {
    isEnabled: true,
    functionId,
    tracer: getLangfuseTracer(),
    ...(metadata ? { metadata } : {}),
  }
}

// Ingestion-plane telemetry. Same shape as aiTelemetry but gated on
// traceIngestion, so the high-volume enrich/extract generations emit nothing
// against the 50k-unit budget unless LANGFUSE_TRACE_INGESTION=true is set for a
// deliberate, scoped ingestion-tracing run.
export function ingestTelemetry(
  functionId: string,
  metadata?: Record<string, AttributeValue>,
): TelemetrySettings {
  if (!traceIngestion) return { isEnabled: false }
  return aiTelemetry(functionId, metadata)
}

// Wrap a non-AI stage (cache check, hybrid search, rerank, rollup) in a Langfuse
// child span so the answer trace shows the full waterfall, not just the AI SDK
// generations. A no-op (runs fn untouched) when tracing is disabled.
//
// The initial metadata is recorded as the span input; the optional return of
// `outputOf` becomes the span output (e.g. hit counts), which keeps the call site
// readable. On any throw the span is marked ERROR and the error is re-thrown.
export async function traceStage<T>(
  functionId: string,
  metadata: Record<string, unknown>,
  fn: () => Promise<T>,
  outputOf?: (result: T) => Record<string, unknown>,
): Promise<T> {
  if (!tracingEnabled) return fn()
  return startActiveObservation(
    functionId,
    async (span) => {
      span.update({ input: metadata })
      try {
        const result = await fn()
        if (outputOf) span.update({ output: outputOf(result) })
        return result
      } catch (err) {
        span.update({ level: 'ERROR', statusMessage: String(err) })
        throw err
      }
    },
    { endOnExit: true },
  )
}
