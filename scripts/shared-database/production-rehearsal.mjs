// Fault injection against NEW loopback-only PostgreSQL clones. This is not a
// production entry point and cannot connect to either production endpoint.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { runCutover } from './install-production.mjs';
import { loadInstallation, applyInstallation, tableRows, qualified, verify } from './install-core.mjs';
import { assertNoOtherClients, lockTables, verifySource, GuardError } from './production-guards.mjs';
import { databaseState } from '../migration/published-backup-restore.mjs';
import { sha256 } from './merge-plan.mjs';

export async function rehearse({ connectionFile, snapshotDirectory, blackWorkspace, whiteWorkspace, reportFile }) {
  const configuration = JSON.parse(await fs.readFile(connectionFile, 'utf8'));
  assert.equal(configuration.host, '127.0.0.1'); assert.equal(configuration.port, 55439); assert.equal(configuration.user, 'llantas_dev_owner');
  const token = randomBytes(5).toString('hex');
  const databases = { negra: 'llantas_cutover_negra_tests_' + token, blanca: 'llantas_cutover_blanca_tests_' + token };
  const localClient = (database, readOnly = false) => new pg.Client({ host: configuration.host, port: configuration.port,
    user: configuration.user, password: configuration.password, database, connectionTimeoutMillis: 5000,
    options: `-c timezone=UTC -c search_path=public -c default_transaction_read_only=${readOnly ? 'on' : 'off'}` });
  const admin = localClient('postgres'); let black, white;
  try {
    await admin.connect();
    for (const [label, database] of Object.entries(databases)) {
      assert.match(database, /^llantas_cutover_(negra|blanca)_tests_[a-f0-9]{10}$/);
      await admin.query(`CREATE DATABASE ${qualified(database)} TEMPLATE ${qualified('llantas_source_' + label)}`);
    }
    black = localClient(databases.negra); white = localClient(databases.blanca, true);
    await black.connect(); await white.connect();
    const installation = await loadInstallation(snapshotDirectory, blackWorkspace, whiteWorkspace);
    const states = { negra: await databaseState(black), blanca: await databaseState(white) };
    const bundle = { installation, states, snapshotDirectory, packageSha256: 'local-rehearsal-only',
      readiness: { productionInstanceId: randomUUID(), identities: {} }, permissionsSql: 'SELECT 1' };
    const steps = {
      // Only endpoint/role checks are replaced: those are separately unit tested
      // and the actual restricted-role payload has its own integration suite.
      databaseIdentity: async () => ({}), assertIdentity: () => {}, assertExistingRoles: async () => {},
      assertNoOtherClients, lockTables, applyInstallation, verify,
      verifySource: (client, config, data, label) => verifySource(client, config, data, label, { native: false }),
    };
    const confirmation = { planSha256: installation.digest, packageSha256: bundle.packageSha256 };
    const call = (data, overrides = {}) => runCutover({ mode: 'execute', bundle: data, black, white, configurations: {}, confirmation }, { ...steps, ...overrides });
    async function unchanged() {
      const marker = (await black.query("SELECT to_regclass('shared_runtime.configuration')::text AS marker")).rows[0].marker;
      assert.equal(marker, null, 'DDL failed to roll back');
      for (const [table, rows] of Object.entries(installation.black)) assert.equal(sha256(JSON.stringify(await tableRows(black, table))), sha256(JSON.stringify(rows)), 'Native source changed after rollback');
    }
    const checks = [];
    const bad = { ...bundle, installation: { ...installation, black: { ...installation.black } } };
    const table = Object.keys(installation.black).find(name => installation.black[name].length > 0);
    bad.installation.black[table] = [...installation.black[table]];
    bad.installation.black[table][0] = JSON.stringify({ mismatchedSnapshot: true });
    await assert.rejects(call(bad), /LIVE_SOURCE_ROWS_CHANGED/); await unchanged();
    checks.push({ name: 'live row comparison rejects drift before DDL', pass: true });

    let completeVerificationReached = false;
    await assert.rejects(call(bundle, { verify: async (client, plan) => {
      await verify(client, plan); completeVerificationReached = true;
      throw new GuardError('INJECTED_POST_ARCHIVE_FAILURE');
    } }), /INJECTED_POST_ARCHIVE_FAILURE/);
    assert(completeVerificationReached); await unchanged();
    checks.push({ name: 'failure after complete real merge and archive verification rolls back all DDL and DML', pass: true });

    await assert.rejects(call(bundle, { verify: async (client, plan) => {
      const proof = await verify(client, plan);
      const lateWriter = localClient(databases.blanca);
      try { await lateWriter.connect(); await lateWriter.query('CREATE TABLE public.cutover_late_drift_fixture(id integer PRIMARY KEY)'); }
      finally { await lateWriter.end(); }
      return proof;
    } }), /LIVE_SOURCE_TABLE_SET_CHANGED/);
    await unchanged();
    checks.push({ name: 'new white source change after target mutation is detected and target rolls back', pass: true });
    const report = { version: 1, localOnly: true, databases, checks, planSha256: installation.digest,
      sourceClonesModified: false, canonicalDevelopmentModified: false, productionConnections: 0,
      retainedEvidence: 'Two new test clones; only an empty drift-fixture table remains in the white test clone.', verifiedAt: new Date().toISOString() };
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return report;
  } finally { await white?.end().catch(() => {}); await black?.end().catch(() => {}); await admin.end().catch(() => {}); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [connectionFile, snapshotDirectory, blackWorkspace, whiteWorkspace, reportFile] = process.argv.slice(2);
  assert(connectionFile && snapshotDirectory && blackWorkspace && whiteWorkspace && reportFile, 'Five explicit file/directory arguments are required');
  try { console.log(JSON.stringify(await rehearse({ connectionFile, snapshotDirectory, blackWorkspace, whiteWorkspace, reportFile }), null, 2)); }
  catch (error) { console.error(error instanceof GuardError ? error.code : 'LOCAL_CUTOVER_REHEARSAL_FAILED'); process.exitCode = 1; }
}
