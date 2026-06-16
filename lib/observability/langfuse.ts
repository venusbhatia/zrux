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
import { getLangfuseTracer, setLangfuseTracerProvider } from '@langfuse/tracing'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import type { AttributeValue } from '@opentelemetry/api'
import type { TelemetrySettings } from 'ai'

export const tracingEnabled =
  Boolean(process.env.LANGFUSE_PUBLIC_KEY) && Boolean(process.env.LANGFUSE_SECRET_KEY)

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
  const provider = new NodeTracerProvider({ spanProcessors: [processor] })
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
