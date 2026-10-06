import { context, propagation, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureTraceContext, withConsumerSpan, withProducerSpan } from '../src/trace-context';

describe('trace context propagation through messages', () => {
  const exporter = new InMemorySpanExporter();

  beforeAll(() => {
    const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    trace.setGlobalTracerProvider(provider);
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  });

  afterAll(() => {
    trace.disable();
    propagation.disable();
    context.disable();
  });

  it('is a no-op outside of a span', () => {
    expect(captureTraceContext()).toBeNull();
  });

  it('links request → outbox → publish → consume into one trace', async () => {
    const tracer = trace.getTracer('test');
    let stored: Record<string, string> | null = null;
    await tracer.startActiveSpan('POST /v1/orders', async (span) => {
      stored = captureTraceContext();
      span.end();
    });
    expect(stored).toHaveProperty('traceparent');

    let headers: Record<string, string> = {};
    await withProducerSpan(stored, 'orders.order.created.v1 publish', {}, async (injected) => {
      headers = injected;
    });
    await withConsumerSpan(headers, 'orders.order.created.v1 process', {}, async () => {
      expect(captureTraceContext()?.traceparent).toBeDefined();
    });

    const spans = exporter.getFinishedSpans();
    const traceIds = new Set(spans.map((span) => span.spanContext().traceId));
    expect(spans.map((span) => span.name)).toEqual(['POST /v1/orders', 'orders.order.created.v1 publish', 'orders.order.created.v1 process']);
    expect(traceIds.size).toBe(1);
    const [request, publish, consume] = spans;
    expect(publish?.parentSpanContext?.spanId).toBe(request?.spanContext().spanId);
    expect(consume?.parentSpanContext?.spanId).toBe(publish?.spanContext().spanId);
  });
});
