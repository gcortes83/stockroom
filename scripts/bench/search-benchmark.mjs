import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const ROWS = Number(process.env.BENCH_ROWS ?? 10_000);
const CONNECTIONS = Number(process.env.BENCH_CONNECTIONS ?? 50);
const DURATION = Number(process.env.BENCH_DURATION ?? 30);
const ROUNDS = Number(process.env.BENCH_ROUNDS ?? 3);
const TARGET_P95_MS = 300;
const REPORT = process.env.BENCH_REPORT ?? 'docs/benchmarks/search.md';
const SKIP_IMPORT = process.argv.includes('--skip-import');

const CATEGORIES = [
  'Accessories', 'Beauty', 'Books', 'Clothing', 'Electronics', 'Food & Beverage', 'Footwear', 'Games', 'Gifts',
  'Health', 'Home & Office', 'Kitchen', 'Outdoors', 'Pets', 'Sports', 'Stationery', 'Tools', 'Misc',
];
const ADJECTIVES = ['Compact', 'Premium', 'Classic', 'Portable', 'Wireless', 'Organic', 'Ergonomic', 'Rugged', 'Smart', 'Vintage', 'Bamboo', 'Waterproof'];
const MATERIALS = ['Walnut', 'Steel', 'Cotton', 'Ceramic', 'Leather', 'Glass', 'Aluminum', 'Wool', 'Silicone', 'Oak'];
const NOUNS = ['Lamp', 'Bottle', 'Backpack', 'Speaker', 'Mug', 'Notebook', 'Blanket', 'Charger', 'Planter', 'Tray', 'Headphones', 'Jacket', 'Kettle', 'Mat', 'Organizer'];
const WORDS = ['durable', 'lightweight', 'handmade', 'eco-friendly', 'minimal', 'adjustable', 'stackable', 'gift-ready', 'travel', 'everyday'];

function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateCsv(rows) {
  const random = prng(20261005);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const lines = ['name,sku,description,category,price,stock,weight_kg'];
  for (let index = 1; index <= rows; index++) {
    const name = `${pick(ADJECTIVES)} ${pick(MATERIALS)} ${pick(NOUNS)}`;
    const sku = `BEN-${String(index).padStart(5, '0')}`;
    const description = `"${pick(WORDS)}, ${pick(WORDS)} and ${pick(WORDS)} ${name.toLowerCase()}"`;
    const cents = 100 + Math.floor(random() * 99_900);
    const price = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
    const stock = random() < 0.1 ? 0 : Math.floor(random() * 500);
    const weight = (0.05 + random() * 20).toFixed(3);
    lines.push([name, sku, description, `"${pick(CATEGORIES)}"`, price, stock, weight].join(','));
  }
  return lines.join('\n') + '\n';
}

async function importCatalog() {
  const csv = generateCsv(ROWS);
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), `benchmark-${ROWS}.csv`);
  const started = performance.now();
  const response = await fetch(`${BASE}/api/v1/imports`, { method: 'POST', body: form });
  const job = await response.json();
  if (response.status !== 201) throw new Error(`Import failed: ${response.status} ${JSON.stringify(job)}`);
  const { created, updated, unchanged, rejected } = job.totals;
  if (rejected !== 0 || created + updated + unchanged !== ROWS) throw new Error(`Unexpected import totals ${JSON.stringify(job.totals)}`);
  return { totals: job.totals, seconds: (performance.now() - started) / 1000, bytes: Buffer.byteLength(csv) };
}

const QUERIES = [
  { shape: 'keyword', path: '/api/v1/products?q=walnut%20lamp' },
  { shape: 'typo', path: '/api/v1/products?q=wirless%20speakr' },
  { shape: 'sku prefix', path: '/api/v1/products?q=BEN-012' },
  { shape: 'category + sort', path: '/api/v1/products?category=electronics&sort=price_asc' },
  { shape: 'price range + in stock', path: '/api/v1/products?minPriceCents=1000&maxPriceCents=5000&inStock=true' },
  { shape: 'keyword + category + stock', path: '/api/v1/products?q=steel&category=kitchen&inStock=true' },
];

const NETWORK = process.env.BENCH_NETWORK ?? 'stockroom_default';
const LOAD_FROM_HOST = process.argv.includes('--load-from-host');

function run(duration) {
  const env = {
    BASE_URL: LOAD_FROM_HOST ? BASE : 'http://web',
    BENCH_CONNECTIONS: String(CONNECTIONS),
    BENCH_PATHS: JSON.stringify(QUERIES.map((query) => query.path)),
  };
  const output = LOAD_FROM_HOST
    ? execFileSync('node', ['scripts/bench/load.mjs', String(duration)], { encoding: 'utf8', env: { ...process.env, ...env } })
    : execFileSync(
        'docker',
        [
          'run', '--rm', '--network', NETWORK, '-v', `${process.cwd()}:/repo`, '-w', '/repo',
          ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
          'node:24-alpine', 'node', 'scripts/bench/load.mjs', String(duration),
        ],
        { encoding: 'utf8', maxBuffer: 1024 * 1024 },
      );
  return JSON.parse(output.trim().split('\n').at(-1));
}

const SELECT = `SELECT p.id, p.name, c.slug, count(*) OVER () AS total_items
  FROM products p JOIN categories c ON c.id = p.category_id`;
const TEXT = (q) => {
  const quote = (value) => `'${value.replace(/'/g, "''")}'`;
  const raw = quote(q);
  const tokens = [...new Set(q.toLowerCase().split(/\s+/).filter((token) => token.length >= 2))].slice(0, 6);
  const tsq = (value) => `(websearch_to_tsquery('simple', ${value}) || websearch_to_tsquery('english', ${value}))`;
  const phraseFuzzy = tokens.length < 2 ? ` OR ${raw} <% p.name` : '';
  const phrase = `(p.search_vector @@ ${tsq(raw)}${phraseFuzzy} OR p.sku ILIKE ${raw} || '%' OR p.name ILIKE '%' || ${raw} || '%')`;
  const tokenConditions = tokens.map((token) => {
    const value = quote(token);
    return `(p.search_vector @@ ${tsq(value)} OR ${value} <% p.name OR p.name ILIKE '%' || ${value} || '%' OR p.sku ILIKE ${value} || '%')`;
  });
  const combined = tokenConditions.length > 1 ? ` OR (${tokenConditions.join(' AND ')})` : '';
  return {
    where: `(${phrase}${combined})`,
    order: `ts_rank_cd(p.search_vector, ${tsq(raw)}) * 2 + word_similarity(${raw}, p.name)${tokens.map((token) => ` + word_similarity(${quote(token)}, p.name)`).join('')} DESC`,
  };
};
const PLANS = [
  { shape: 'keyword', where: [TEXT('walnut lamp').where], order: TEXT('walnut lamp').order },
  { shape: 'typo', where: [TEXT('wirless speakr').where], order: TEXT('wirless speakr').order },
  { shape: 'sku prefix', where: [TEXT('BEN-012').where], order: TEXT('BEN-012').order },
  { shape: 'category + sort', where: ["c.slug = ANY(ARRAY['electronics'])"], order: 'p.price_cents ASC' },
  { shape: 'price range + in stock', where: ['p.price_cents >= 1000', 'p.price_cents <= 5000', 'p.stock - p.reserved > 0'], order: 'p.created_at DESC' },
  { shape: 'keyword + category + stock', where: [TEXT('steel').where, "c.slug = ANY(ARRAY['kitchen'])", 'p.stock - p.reserved > 0'], order: TEXT('steel').order },
];

function explain(plan) {
  const sql = `EXPLAIN (ANALYZE, BUFFERS) ${SELECT} WHERE p.deleted_at IS NULL AND ${plan.where.join(' AND ')} ORDER BY ${plan.order}, p.id LIMIT 20`;
  const output = execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'catalog_db', '-X', '-A', '-t', '-c', `SET pg_trgm.word_similarity_threshold = 0.5; ${sql}`], {
    encoding: 'utf8',
  });
  const seqScan = /Seq Scan on products/.test(output);
  const indexes = [...new Set([...output.matchAll(/(?:Index|Bitmap Index) Scan (?:using|on) (\w+)/g)].map((match) => match[1]))];
  const execution = Number(/Execution Time: ([\d.]+) ms/.exec(output)?.[1] ?? Number.NaN);
  return { shape: plan.shape, seqScan, indexes, execution, output: output.trim() };
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const imported = SKIP_IMPORT ? null : await importCatalog();
const catalogSize = (await (await fetch(`${BASE}/api/v1/products?pageSize=1`)).json()).page.totalItems;
process.stdout.write(`Catalog size: ${catalogSize} products\n`);
execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'catalog_db', '-X', '-q', '-c', 'ANALYZE products; ANALYZE categories;']);

process.stdout.write('Warm-up (10 s)...\n');
await run(10);
const rounds = [];
for (let round = 1; round <= ROUNDS; round++) {
  const result = await run(DURATION);
  rounds.push(result);
  process.stdout.write(`Round ${round}: p50 ${result.p50} ms · p95 ${result.p95} ms · p99 ${result.p99} ms · ${result.rps} req/s · non-2xx ${result.non2xx}\n`);
}
const plans = PLANS.map(explain);
const p95 = median(rounds.map((round) => round.p95));
const errors = rounds.reduce((sum, round) => sum + round.non2xx, 0);
const textShapesSeq = plans.filter((plan) => ['keyword', 'typo', 'sku prefix', 'keyword + category + stock'].includes(plan.shape) && plan.seqScan);
const passed = p95 < TARGET_P95_MS && errors === 0 && textShapesSeq.length === 0;

const cpu = os.cpus()[0]?.model ?? 'unknown CPU';
const report = `# Search benchmark

Generated by \`node scripts/bench/search-benchmark.mjs\` on ${new Date().toISOString()}.

| | |
|---|---|
| Result | **${passed ? 'PASS' : 'FAIL'}** — median p95 **${p95} ms** (target < ${TARGET_P95_MS} ms), ${errors} non-2xx responses |
| Catalog | ${catalogSize} products${imported ? ` (${ROWS} generated rows imported through \`POST /api/v1/imports\` in ${imported.seconds.toFixed(1)} s, ${(imported.bytes / 1024 / 1024).toFixed(2)} MB)` : ''} |
| Load | autocannon, ${CONNECTIONS} connections, ${ROUNDS} × ${DURATION} s after a 10 s warm-up, through nginx → gateway → catalog, generated ${LOAD_FROM_HOST ? 'from the host' : 'from a container on the compose network (avoids Docker Desktop port-forwarding overhead on macOS)'} |
| Query mix | ${QUERIES.map((query) => `\`${query.path.replace('/api/v1/products', '')}\``).join(', ')} |
| Machine | ${cpu}, ${os.cpus().length} cores, ${(os.totalmem() / 1024 ** 3).toFixed(0)} GB RAM, ${os.platform()} ${os.release()}, Docker Desktop |

## Latency per round

| Round | Requests | Req/s | p50 | p95 | p99 | Non-2xx |
|---|---|---|---|---|---|---|
${rounds.map((round, index) => `| ${index + 1} | ${round.requests} | ${round.rps} | ${round.p50} ms | ${round.p95} ms | ${round.p99} ms | ${round.non2xx} |`).join('\n')}

## Query plans (\`EXPLAIN (ANALYZE, BUFFERS)\`, first page)

| Shape | Indexes used | Seq scan on products | Execution time |
|---|---|---|---|
${plans.map((plan) => `| ${plan.shape} | ${plan.indexes.map((name) => `\`${name}\``).join(', ') || '—'} | ${plan.seqScan ? 'yes' : 'no'} | ${plan.execution} ms |`).join('\n')}

Text-search shapes must not sequentially scan \`products\`; pure filter shapes may when the planner judges it cheaper at this size.

${plans.map((plan) => `<details><summary>${plan.shape}</summary>\n\n\`\`\`\n${plan.output}\n\`\`\`\n\n</details>`).join('\n\n')}
`;
writeFileSync(REPORT, report);
process.stdout.write(`\nMedian p95: ${p95} ms (${passed ? 'PASS' : 'FAIL'}) — report written to ${REPORT}\n`);
process.exit(passed ? 0 : 1);
