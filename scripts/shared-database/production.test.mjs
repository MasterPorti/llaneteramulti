import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConnection, fresh, assertIdentity, assertMaintenance, assertRecordedMoney, assertTransactionSafeSql,
  assertNoOtherClients, verifySource, GuardError } from './production-guards.mjs';
import { runCutover, commitOnce, confirmExecution, main } from './install-production.mjs';
import { verify } from './install-core.mjs';
import { sha256 } from './merge-plan.mjs';

const identity = label => ({ host: '72.62.83.230', port: label === 'negra' ? 7453 : 12458, database: 'postgres',
  databaseOid: '5', owner: 'existing_owner', sessionUser: 'existing_owner', systemIdentifier: label === 'negra' ? '7000000000000000001' : '7000000000000000002' });
const connection = label => ({ host: '72.62.83.230', port: label === 'negra' ? 7453 : 12458, database: 'postgres', user: 'existing_owner', password: 'test-only-placeholder', ssl: false });
function readiness(now) {
  return { version: 1, fiscalMode: 'recorded-per-application', createdAt: now, productionInstanceId: randomUUID(), developmentInstanceIds: [randomUUID()],
    identities: { negra: identity('negra'), blanca: identity('blanca') },
    maintenance: { windowId: randomUUID(), startedAt: now, newConnectionsFenced: true, fenceEvidence: 'Synthetic fixture',
      applications: { negra: { stopped: true, resourceId: 'black-fixture', deployedCommit: 'a'.repeat(40) }, blanca: { stopped: true, resourceId: 'white-fixture', deployedCommit: 'b'.repeat(40) } } } };
}
test('connection is explicit and fixes the original black or white endpoint without inherited PG options', () => {
  assert.deepEqual(validateConnection(connection('negra'), 'negra'), connection('negra'));
  for (const patch of [{ host: '127.0.0.1' }, { port: 12458 }, { database: 'other' }, { password: '' }, { ssl: undefined }, { options: '-c search_path=other' }, { connectionString: 'ignored' }]) {
    assert.throws(() => validateConnection({ ...connection('negra'), ...patch }, 'negra'), GuardError);
  }
  assert.throws(() => validateConnection(connection('negra'), 'blanca'), /ENDPOINT_MISMATCH/);
});
test('fresh stopped-app evidence cannot use yesterday, the future or a production ID copied from development', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  fresh('2026-10-13T11:30:00Z', now);
  for (const value of ['invalid', '2026-10-12T12:00:00Z', '2026-10-13T12:01:00Z']) assert.throws(() => fresh(value, now), /FRESH_/);
  const ready = readiness(new Date(now).toISOString()), manifests = { negra: { createdAt: ready.createdAt }, blanca: { createdAt: ready.createdAt } };
  assertMaintenance(ready, manifests, now);
  for (const mutate of [r => { r.maintenance.newConnectionsFenced = false; }, r => { r.maintenance.applications.blanca.stopped = false; },
    r => { r.productionInstanceId = r.developmentInstanceIds[0]; }, r => { r.fiscalMode = 'overwrite-canonical-tax'; }]) {
    const changed = structuredClone(ready); mutate(changed); assert.throws(() => assertMaintenance(changed, manifests, now), GuardError);
  }
  assert.throws(() => assertMaintenance(ready, { ...manifests, blanca: { createdAt: '2026-10-13T11:59:00Z' } }, now), /BACKUP_MUST_FOLLOW/);
  // Status after a lost COMMIT must remain available even after the cutover window.
  assertMaintenance(ready, manifests, now + 86400000, false);
});
test('pinning includes system_identifier, database OID, owner and session user', () => {
  const expected = identity('negra'); assertIdentity(expected, expected, 'negra');
  for (const field of Object.keys(expected)) assert.throws(() => assertIdentity({ ...expected, [field]: 'changed' }, expected, 'negra'), GuardError);
  assert.throws(() => assertIdentity(expected, { ...expected, systemIdentifier: undefined }, 'negra'), /PINNED_POSTGRES/);
});
test('historical tax keeps each app original and refuses an old plan overwriting black money', () => {
  const black = { id: 'sale', subtotal: 116, iva: 0, total: 116 }, white = { id: 'sale', subtotal: 100, iva: 16, total: 116 };
  const data = { black: { 'public.ventas': [JSON.stringify(black)] }, white: { 'public.ventas': [JSON.stringify(white)] }, plan: {
    tables: { 'public.ventas': [black] }, saleOriginals: [{ source_label: 'blanca', sale_kind: 'ventas', sale_id: 'sale', document_text: JSON.stringify({ sale: white }) }] } };
  assertRecordedMoney(data);
  assert.throws(() => assertRecordedMoney({ ...data, plan: { ...data.plan, tables: { 'public.ventas': [white] } } }), /BLACK_RECORDED_TAX/);
});
test('reviewed SQL cannot introduce a transaction boundary but PL/pgSQL bodies remain valid', async () => {
  assertTransactionSafeSql("DO $body$ BEGIN PERFORM 1; END $body$; -- COMMIT\nSELECT 'ROLLBACK';");
  for (const sql of ['COMMIT;', 'ROLLBACK;', 'BEGIN;', 'START TRANSACTION;', 'CREATE DATABASE test;', 'ALTER SYSTEM SET x=1;', '/* nested /* comment */ */ COMMIT;']) assert.throws(() => assertTransactionSafeSql(sql), /SINGLE_TRANSACTION/);
  const whiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const blackRoot = process.env.SHARED_TEST_BLACK_ROOT
    ? path.resolve(process.env.SHARED_TEST_BLACK_ROOT) : path.resolve(whiteRoot, '../sistemaBodega');
  for (const file of ['schema.sql', 'folios.sql', 'white-role-permissions.sql']) assertTransactionSafeSql(await fs.readFile(path.join(blackRoot, 'database/shared', file), 'utf8'));
});
test('active clients and prepared transactions prevent the cutover, without terminating any connection', async () => {
  for (const [others, prepared] of [[1, 0], [0, 1]]) {
    const sql = [];
    await assert.rejects(assertNoOtherClients({ query: async text => { sql.push(text); return { rows: [{ n: text.includes('pg_stat_activity') ? others : prepared }] }; } }), GuardError);
    assert(sql.every(text => text.startsWith('SELECT')));
  }
});
test('source table and row drift fail before any native schema call or mutation', async () => {
  const original = ['{"id":"source","total":100}'];
  const bundle = { installation: { black: { 'public.ventas': original } }, states: {} };
  const calls = [];
  const client = { query: async sql => { calls.push(sql); return { rows: sql.includes('pg_class') ? [{ name: 'public.ventas' }] : [{ raw: '{"id":"source","total":101}' }] }; } };
  await assert.rejects(verifySource(client, connection('negra'), bundle, 'negra'), /LIVE_SOURCE_ROWS_CHANGED/);
  assert.equal(calls.length, 2); assert(calls.every(sql => sql.startsWith('SELECT')));
});
function cutoverFixture({ drift = false, lateDrift = false, verifyFailure = false, commitFailure = false, marker = false } = {}) {
  const log = []; let durable = false, mutated = false, whiteChecks = 0;
  const client = name => ({ query: async (sql) => {
    log.push(name + ':' + sql);
    if (sql === 'COMMIT') { durable = mutated; if (commitFailure) throw Error('transport'); }
    if (sql === 'ROLLBACK' && name === 'black') mutated = false;
    if (sql.includes('pg_try_advisory')) return { rows: [{ acquired: true }] };
    if (sql.includes('to_regclass')) return { rows: [{ marker: marker ? 'configuration' : null, batches: null }] };
    return { rows: [] };
  } });
  const installation = { digest: 'a'.repeat(64), batch: 'test-batch', document: 'test-only', black: {}, white: {}, plan: { summary: { counts: {} } } };
  const bundle = { installation, packageSha256: 'b'.repeat(64), readiness: readiness(new Date().toISOString()), permissionsSql: '-- permission fixture' };
  const steps = {
    databaseIdentity: async (_, config) => identity(config.port === 7453 ? 'negra' : 'blanca'), assertIdentity,
    assertNoOtherClients: async () => {}, assertExistingRoles: async () => {},
    lockTables: async (client, _, write) => { log.push(write ? 'target-write-lock' : 'source-read-lock'); },
    verifySource: async (_, __, ___, label) => {
      log.push('verified:' + label); if (label === 'blanca') whiteChecks++;
      if ((drift && label === 'negra') || (lateDrift && whiteChecks === 2)) throw new GuardError('LIVE_SOURCE_ROWS_CHANGED');
    },
    applyInstallation: async () => { log.push('DDL-DML'); mutated = true; },
    verify: async () => { if (verifyFailure) throw Error('archive mismatch'); return { archivedRows: 1 }; },
  };
  return { log, bundle, steps, black: client('black'), white: client('white'), get durable() { return durable; }, get mutated() { return mutated; } };
}
async function runFixture(fixture, mode = 'execute') {
  return runCutover({ mode, bundle: fixture.bundle, black: fixture.black, white: fixture.white,
    configurations: { negra: connection('negra'), blanca: connection('blanca') },
    confirmation: { planSha256: fixture.bundle.installation.digest, packageSha256: fixture.bundle.packageSha256 } }, fixture.steps);
}
test('wrong plan or SQL/evidence package hashes prevent BEGIN entirely', async () => {
  const fixture = cutoverFixture();
  assert.throws(() => confirmExecution(fixture.bundle, { planSha256: 'wrong', packageSha256: fixture.bundle.packageSha256 }), /PLAN_SHA/);
  await assert.rejects(runCutover({ mode: 'execute', bundle: fixture.bundle, black: fixture.black, white: fixture.white, configurations: {}, confirmation: {} }, fixture.steps), /PLAN_SHA/);
  assert.deepEqual(fixture.log, []);
});
test('dry online check rolls both sessions back without DDL or COMMIT', async () => {
  const fixture = cutoverFixture(); const result = await runFixture(fixture, 'check');
  assert.equal(result.databaseWrites, false); assert(!fixture.log.includes('DDL-DML'));
  assert(!fixture.log.some(entry => entry.endsWith(':COMMIT')));
  assert(fixture.log.includes('black:ROLLBACK')); assert(fixture.log.includes('white:ROLLBACK'));
});
test('early source drift aborts before mutations or durable data', async () => {
  const fixture = cutoverFixture({ drift: true }); await assert.rejects(runFixture(fixture), /LIVE_SOURCE_ROWS_CHANGED/);
  assert(!fixture.log.includes('DDL-DML')); assert.equal(fixture.durable, false); assert(fixture.log.includes('black:ROLLBACK'));
});
for (const flag of ['lateDrift', 'verifyFailure']) test(`${flag} rolls back all target DDL and DML`, async () => {
  const fixture = cutoverFixture({ [flag]: true }); await assert.rejects(runFixture(fixture));
  assert(fixture.log.includes('DDL-DML')); assert.equal(fixture.mutated, false); assert.equal(fixture.durable, false);
  assert(fixture.log.includes('black:ROLLBACK')); assert(fixture.log.includes('white:ROLLBACK'));
});
test('successful execution verifies both sources before DDL and writes one COMMIT only on black', async () => {
  const fixture = cutoverFixture(); const result = await runFixture(fixture);
  assert.equal(result.committed, true); assert.equal(fixture.durable, true);
  assert(fixture.log.indexOf('DDL-DML') > fixture.log.indexOf('verified:blanca'));
  assert.equal(fixture.log.filter(entry => entry === 'black:COMMIT').length, 1);
  assert(!fixture.log.includes('white:COMMIT')); assert(!fixture.log.includes('black:ROLLBACK'));
  assert(fixture.log.includes('white:ROLLBACK'));
});
test('lost COMMIT acknowledgement is unknown and never retried or compensated', async () => {
  const fixture = cutoverFixture({ commitFailure: true }); await assert.rejects(runFixture(fixture), /COMMIT_OUTCOME_UNKNOWN/);
  assert.equal(fixture.durable, true); assert.equal(fixture.log.filter(entry => entry === 'black:COMMIT').length, 1);
  assert(!fixture.log.includes('black:ROLLBACK')); assert(fixture.log.includes('white:ROLLBACK'));
});
test('an existing marker forbids replay even when the previous deployment plan matches', async () => {
  const fixture = cutoverFixture({ marker: true }); await assert.rejects(runFixture(fixture), /UNION_ALREADY_PRESENT/);
  assert(!fixture.log.includes('DDL-DML'));
});
test('commitOnce reports ambiguous transport without a second statement', async () => {
  const sql = [];
  await assert.rejects(commitOnce({ query: async text => { sql.push(text); throw Error('may contain credentials'); } }), /COMMIT_OUTCOME_UNKNOWN/);
  assert.deepEqual(sql, ['COMMIT']);
});
test('CLI cannot silently discover connection/env files or accept unknown arguments', async () => {
  await assert.rejects(main(['execute']), /EXPLICIT_REQUEST_FILE/);
  await assert.rejects(main(['execute', '--request-file', 'anything', '--env', '.env.local']), /EXPLICIT_UNIQUE_ARGUMENTS/);
});
test('full archive verification rejects missing, relabelled or altered originals, mappings and operations', async () => {
  const original = { sale_kind: 'ventas', sale_id: 's', source_label: 'negra', document_text: '{}', sha256: sha256('{}') };
  const entity = { source_label: 'blanca', source_table: 'public.ventas', source_id: 's', target_table: 'public.ventas', target_id: 's', decision: 'same' };
  const operation = { id: 'o', request_hash: 'h', application: 'blanca', status: 'committed', sale_kind: 'ventas', sale_id: 's', created_at: '2026-10-13T12:00:00.123456Z', updated_at: '2026-10-13T12:00:00.123456Z' };
  const plan = { tables: {}, originalRows: [], scopes: [], saleOriginals: [original], entityMap: [entity], operations: [operation], summary: { counts: {} } };
  const client = edits => ({ query: async sql => ({ rows: sql.includes('FROM shared_archive.sale_originals') ? edits.originals ?? [original]
    : sql.includes('FROM shared_archive.entity_map') ? edits.entities ?? [entity]
      : sql.includes('"shared_runtime"."operations"') ? (edits.operations ?? [operation]).map(row => ({ raw: JSON.stringify(row) })) : [] }) });
  await verify(client({}), plan);
  for (const edits of [{ originals: [] }, { originals: [{ ...original, source_label: 'blanca' }] }, { entities: [{ ...entity, target_id: 'different' }] }, { operations: [{ ...operation, request_hash: 'changed' }] }]) await assert.rejects(verify(client(edits), plan));
});
