import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { sha256 } from './snapshot.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = path.resolve(root, process.argv[2] || '');
assert.ok(dir.startsWith(path.join(root, '.migration-backups') + path.sep));
const origin = new URL(process.argv[3] || 'http://127.0.0.1:3010');
assert.ok(['127.0.0.1', 'localhost'].includes(origin.hostname), 'Only local test servers are allowed');
const bytes = await fs.readFile(path.join(dir, 'source-backup.json'));
const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
assert.equal(sha256(bytes), manifest.backupSha256);
const backup = JSON.parse(bytes);
const tires = backup.selection.rows.llantas.map((raw) => JSON.parse(raw));
const tireIds = new Set(tires.map((t) => t.id));
const sales = backup.selection.rows.ventas.map((raw) => ({ raw, sale: JSON.parse(raw) }));
const mixed = sales.filter(({ sale }) => sale.items.some((i) => !tireIds.has(i.llantaId)));
const representatives = [...new Map([
  ...mixed, sales.find(({ sale }) => sale.cancelada), sales.find(({ sale }) => !sale.cancelada),
].filter(Boolean).map((entry) => [entry.sale.id, entry])).values()];
const env = dotenv.parse(await fs.readFile(path.join(root, '.env.local')));
assert.equal(env.LLANTERA_EXPECTED_DATABASE, 'llaneteramulti_new_tires');
assert.equal(new URL(env.DATABASE_URL).pathname, '/llaneteramulti_new_tires');
const client = new pg.Client({ connectionString: env.DATABASE_URL,
  ssl: env.DB_REQUIRE_SSL === 'true' ? { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined,
  options: '-c default_transaction_read_only=on -c timezone=UTC', connectionTimeoutMillis: 15000 });
const checks = [];
async function page(route, expected) {
  const response = await fetch(new URL(route, origin), { signal: AbortSignal.timeout(45000) });
  assert.equal(response.status, 200, `Page status: ${route}`);
  const body = await response.text();
  assert.ok(!/Application error: a server-side exception/.test(body), `Server render failed: ${route}`);
  if (expected) assert.ok(expected.test(body), `Missing page content: ${route}`);
  checks.push({ route, status: response.status });
}
try {
  await client.connect();
  await page('/', /Venta de Llantas/);
  for (const route of ['/inventario/inventario', '/inventario/bodegas', '/inventario/bodegas/mover', '/inventario/ventas', '/inventario/ventas/nueva', '/inventario/garantias', '/inventario/historial']) await page(route);
  await page('/inventario/movimientos', /489 movimientos registrados/);
  await page(`/inventario/inventario/${tires.find((t) => t.activo).id}`, /Precio Mayorista/);
  await page(`/inventario/inventario/${tires.find((t) => !t.activo).id}`, /[Ii]nactiv/);
  for (const { sale, raw } of representatives) {
    await page(`/inventario/ventas/${sale.id}`, /Detalle de la Venta/);
    const response = await fetch(new URL(`/api/sistema/ventas/${sale.id}/original`, origin));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const original = await response.text();
    // Cast timestamp offsets back into their PostgreSQL types, without parsing
    // prices or microseconds through JavaScript's Number/Date representations.
    const result = await client.query('SELECT to_jsonb(jsonb_populate_record(NULL::public.ventas,$1::jsonb))::text AS raw', [original]);
    assert.ok(result.rows[0].raw === raw, 'Original download differs from source row');
  }
  const report = { batchId: backup.batchId, verified: true, verifiedAt: new Date().toISOString(), checks,
    exactOriginalSalesChecked: representatives.length, mixedSalesChecked: mixed.length, databaseWrites: false };
  await fs.writeFile(path.join(dir, `http-verification-${Date.now()}.json`), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ verified: true, pages: checks.length, exactOriginalSalesChecked: representatives.length, mixedSalesChecked: mixed.length, databaseWrites: false }));
} finally { await client.end(); }
