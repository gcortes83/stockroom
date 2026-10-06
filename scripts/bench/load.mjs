import autocannon from 'autocannon';

const BASE = process.env.BASE_URL ?? 'http://web';
const CONNECTIONS = Number(process.env.BENCH_CONNECTIONS ?? 50);
const DURATION = Number(process.argv[2] ?? process.env.BENCH_DURATION ?? 30);
const PATHS = JSON.parse(process.env.BENCH_PATHS ?? '["/api/v1/products"]');

function percentile(sorted, p) {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

const latencies = [];
let failures = 0;
const instance = autocannon(
  { url: BASE, connections: CONNECTIONS, duration: DURATION, requests: PATHS.map((path) => ({ method: 'GET', path })) },
  (error, result) => {
    if (error) throw error;
    latencies.sort((a, b) => a - b);
    process.stdout.write(
      JSON.stringify({
        requests: result.requests.total,
        rps: result.requests.average,
        non2xx: result.non2xx + failures,
        p50: Math.round(percentile(latencies, 50)),
        p95: Math.round(percentile(latencies, 95)),
        p99: Math.round(percentile(latencies, 99)),
      }),
    );
  },
);
instance.on('response', (_client, statusCode, _bytes, responseTime) => {
  if (statusCode >= 400) failures++;
  latencies.push(responseTime);
});
