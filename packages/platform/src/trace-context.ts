import { type Attributes, context, propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';

export type TraceCarrier = Record<string, string>;

const tracer = () => trace.getTracer('@stockroom/platform');

export function captureTraceContext(): TraceCarrier | null {
  const carrier: TraceCarrier = {};
  propagation.inject(context.active(), carrier);
  return Object.keys(carrier).length > 0 ? carrier : null;
}

function toCarrier(headers: Record<string, unknown> | undefined | null): TraceCarrier {
  const carrier: TraceCarrier = {};
  for (const [key, value] of Object.entries(headers ?? {})) if (typeof value === 'string') carrier[key] = value;
  return carrier;
}

async function inSpan<T>(
  name: string,
  kind: SpanKind,
  parentCarrier: Record<string, unknown> | null | undefined,
  attributes: Attributes,
  work: () => Promise<T>,
): Promise<T> {
  const parent = propagation.extract(ROOT_CONTEXT, toCarrier(parentCarrier));
  return tracer().startActiveSpan(name, { kind, attributes }, parent, async (span) => {
    try {
      return await work();
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function withProducerSpan<T>(
  parentCarrier: Record<string, unknown> | null,
  name: string,
  attributes: Attributes,
  work: (headers: TraceCarrier) => Promise<T>,
): Promise<T> {
  return inSpan(name, SpanKind.PRODUCER, parentCarrier, attributes, () => work(captureTraceContext() ?? {}));
}

export function withConsumerSpan<T>(
  headers: Record<string, unknown> | undefined,
  name: string,
  attributes: Attributes,
  work: () => Promise<T>,
): Promise<T> {
  return inSpan(name, SpanKind.CONSUMER, headers, attributes, work);
}
