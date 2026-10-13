import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildMergePlan, sha256, stable } from './merge-plan.mjs';

export const identifier = value => '"' + value.replaceAll('"', '""') + '"';
export const qualified = value => value.split('.').map(identifier).join('.');
const valueForPg = value => value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

export async function loadInstallation(snapshotDirectory, blackWorkspace, whiteWorkspace) {
  const black = JSON.parse(await fs.readFile(path.join(snapshotDirectory, 'negra-rows.json')));
  const white = JSON.parse(await fs.readFile(path.join(snapshotDirectory, 'blanca-rows.json')));
  const plan = buildMergePlan(black, white);
  for (const label of ['negra', 'blanca']) for (const name of ['schema.json', 'native-schema.sql']) {
    const raw = await fs.readFile(path.join(snapshotDirectory, label + '-' + name), 'utf8');
    plan.originalRows.push({ source_label: label, table_name: '__' + name, row_index: 0, raw_text: raw, sha256: sha256(raw) });
  }
  plan.summary.archivedRows = plan.originalRows.length;
  const document = JSON.stringify(plan), digest = sha256(document), batch = 'shared-v1-' + digest.slice(0, 24);
  const sql = {
    schema: await fs.readFile(path.join(blackWorkspace, 'database/shared/schema.sql'), 'utf8'),
    folios: await fs.readFile(path.join(blackWorkspace, 'database/shared/folios.sql'), 'utf8'),
    operations: await fs.readFile(path.join(whiteWorkspace, 'database/shared/operations.sql'), 'utf8'),
  };
  return { black, white, plan, document, digest, batch, sql };
}
export async function insertRows(client, table, rows) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  for (let start = 0; start < rows.length; start += 100) {
    const params = [];
    const tuples = rows.slice(start, start + 100).map(row => '(' + columns.map(col => {
      assert.ok(Object.hasOwn(row, col), 'Incomplete archive row');
      params.push(valueForPg(row[col])); return '$' + params.length;
    }).join(',') + ')');
    await client.query(`INSERT INTO ${qualified(table)} (${columns.map(identifier).join(',')}) VALUES ${tuples.join(',')}`, params);
  }
}
export async function tableRows(client, table) {
  return (await client.query(`SELECT row_to_json(t)::text AS raw FROM ${qualified(table)} t`)).rows.map(row => row.raw).sort();
}
function verifyExactRows(actual, expected, columns, message) {
  const key = row => JSON.stringify(columns.map(column => row[column]));
  const expectedRows = new Map(expected.map(row => [key(row), row]));
  assert.equal(expectedRows.size, expected.length, message + ': duplicate expected identity');
  assert.equal(actual.length, expectedRows.size, message + ': row count');
  const observed = new Set();
  for (const row of actual) {
    assert.ok(!observed.has(key(row)), message + ': duplicate actual identity'); observed.add(key(row));
    assert.ok(expectedRows.has(key(row)), message + ': unexpected identity');
    assert.ok(same(row, expectedRows.get(key(row))), message + ': content changed');
  }
}
export async function verify(client, plan) {
  for (const [table, expected] of Object.entries(plan.tables)) {
    const key = table === 'public.app_metadata' ? 'key' : 'id';
    const rows = (await tableRows(client, table)).map(raw => JSON.parse(raw));
    const actual = new Map(rows.map(row => [row[key], row]));
    assert.equal(actual.size, rows.length, 'Duplicate target identity: ' + table);
    assert.equal(actual.size, expected.length, 'Wrong target count: ' + table);
    for (const row of expected) {
      const found = actual.get(row[key]); assert.ok(found, 'Missing target identity');
      for (const [column, value] of Object.entries(row)) assert.ok(same(found[column], value), 'Target value changed: ' + table + '.' + column);
    }
  }
  const archive = (await client.query('SELECT source_label,table_name,row_index,raw_text,sha256 FROM shared_archive.original_rows ORDER BY source_label,table_name,row_index')).rows;
  verifyExactRows(archive, plan.originalRows, ['source_label', 'table_name', 'row_index'], 'Original archive');
  for (const row of archive) assert.equal(sha256(row.raw_text), row.sha256, 'Archive contents damaged');
  const scopes = (await client.query('SELECT sale_kind,sale_id,item_index,provider,provider_key,evidence FROM shared_runtime.sale_item_scope')).rows;
  verifyExactRows(scopes, plan.scopes, ['sale_kind', 'sale_id', 'item_index'], 'Historical scope');
  const originals = (await client.query('SELECT sale_kind,sale_id,source_label,document_text,sha256 FROM shared_archive.sale_originals')).rows;
  verifyExactRows(originals, plan.saleOriginals, ['sale_kind', 'sale_id', 'source_label'], 'Original sale documents');
  for (const row of originals) assert.equal(sha256(row.document_text), row.sha256, 'Original document contents damaged');
  const entities = (await client.query('SELECT source_label,source_table,source_id,target_table,target_id,decision FROM shared_archive.entity_map')).rows;
  verifyExactRows(entities, plan.entityMap, ['source_label', 'source_table', 'source_id'], 'Entity mapping');
  // PostgreSQL can emit a Date for timestamptz through callers' parsers; JSON
  // text retains all original microseconds for this migration proof.
  const operations = (await tableRows(client, 'shared_runtime.operations')).map(raw => JSON.parse(raw));
  verifyExactRows(operations, plan.operations, ['id'], 'Recoverable operations');
  return { counts: plan.summary.counts, archivedRows: archive.length, scopeRows: scopes.length,
    saleOriginals: originals.length, entityMappings: entities.length, operations: operations.length };
}

/** Caller owns identity checks, source locks, preflight, BEGIN and COMMIT. */
export async function applyInstallation(client, { black, plan, sql }) {
  await client.query(sql.schema); await client.query(sql.folios); await client.query(sql.operations);
  await insertRows(client, 'shared_archive.original_rows', plan.originalRows);
  await insertRows(client, 'shared_archive.sale_originals', plan.saleOriginals);
  await insertRows(client, 'shared_archive.entity_map', plan.entityMap);
  for (const [table, desired] of Object.entries(plan.tables)) {
    const key = table === 'public.app_metadata' ? 'key' : 'id';
    const existing = new Map((black[table] || []).map(raw => { const row = JSON.parse(raw); return [row[key], row]; }));
    for (const row of desired) {
      const previous = existing.get(row[key]);
      if (!previous) { await insertRows(client, table, [row]); continue; }
      const changes = Object.keys(row).filter(column => column !== key && !same(previous[column], row[column]));
      if (!changes.length) continue;
      await client.query(`UPDATE ${qualified(table)} SET ${changes.map((column, index) => identifier(column) + '=$' + (index + 1)).join(',')} WHERE ${identifier(key)}=$${changes.length + 1}`,
        [...changes.map(column => valueForPg(row[column])), row[key]]);
    }
  }
  const existingScope = new Set((await client.query('SELECT sale_kind,sale_id,item_index FROM shared_runtime.sale_item_scope')).rows.map(row => `${row.sale_kind}:${row.sale_id}:${row.item_index}`));
  await insertRows(client, 'shared_runtime.sale_item_scope', plan.scopes.filter(row => !existingScope.has(`${row.sale_kind}:${row.sale_id}:${row.item_index}`)));
  await insertRows(client, 'shared_runtime.operations', plan.operations);
}
