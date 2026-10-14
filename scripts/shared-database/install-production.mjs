import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { applyInstallation, verify } from './install-core.mjs';
import { readPackage, readConnection, databaseIdentity, assertIdentity, assertNoOtherClients, assertExistingRoles,
  lockTables, verifySource, guard, GuardError, migrationLock } from './production-guards.mjs';

const options = (configuration, readOnly) => ({ ...configuration, connectionTimeoutMillis: 15000,
  statement_timeout: 120000, application_name: 'shared-production-reviewed-cutover',
  options: `-c timezone=UTC -c search_path=public -c default_transaction_read_only=${readOnly ? 'on' : 'off'}` });
const resultSummary = bundle => ({ planSha256: bundle.installation.digest, packageSha256: bundle.packageSha256,
  batch: bundle.installation.batch, counts: bundle.installation.plan.summary.counts,
  productionInstanceId: bundle.readiness?.productionInstanceId, database: 'postgres', environment: 'production' });
const cutoverSteps = { databaseIdentity, assertIdentity, assertNoOtherClients, assertExistingRoles, lockTables, verifySource, applyInstallation, verify };
const monitoredClients = new WeakMap();
export function monitorClient(client) {
  if (monitoredClients.has(client)) return monitoredClients.get(client);
  let failure;
  const failed = () => { failure ??= new GuardError('DATABASE_SESSION_FAILED_BEFORE_CONFIRMED_COMMIT_USE_STATUS'); };
  // pg emits errors on idle connections outside a query promise. Keep this
  // listener for the client's entire lifetime, including asynchronous end().
  client.on?.('error', failed);
  const monitor = { failed, assertHealthy() { if (failure) throw failure; } };
  monitoredClients.set(client, monitor);
  return monitor;
}
export function keepTransactionsAlive(clients, timers = { schedule: setInterval, cancel: clearInterval }) {
  let stopped = false;
  const pending = new Set();
  const entries = clients.map(client => ({ client, monitor: monitorClient(client), pending: false }));
  const tick = () => {
    if (stopped) return;
    for (const entry of entries) {
      if (entry.pending) continue;
      entry.pending = true;
      // pg serializes queries on each connection. At most one heartbeat per
      // client may wait behind a long statement; it never reads/writes data.
      const request = Promise.resolve().then(() => {
        entry.monitor.assertHealthy();
        return entry.client.query('SELECT 1 AS cutover_keepalive');
      }).catch(entry.monitor.failed).finally(() => { entry.pending = false; pending.delete(request); });
      pending.add(request);
    }
  };
  const timer = timers.schedule(tick, 30_000);
  timer?.unref?.();
  return {
    assertHealthy() { for (const entry of entries) entry.monitor.assertHealthy(); },
    async stop() { stopped = true; timers.cancel(timer); await Promise.allSettled([...pending]); },
  };
}
export function confirmExecution(bundle, confirmation) {
  guard(confirmation.planSha256 === bundle.installation.digest, 'EXACT_PLAN_SHA256_CONFIRMATION_REQUIRED');
  guard(confirmation.packageSha256 === bundle.packageSha256, 'EXACT_PACKAGE_SHA256_CONFIRMATION_REQUIRED');
}
async function begin(client, readOnly) {
  await client.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout='180s'");
  // The keepalive prevents idle expiry while the other source is busy, while
  // PostgreSQL still bounds the entire transaction even if the process stalls.
  await client.query("SET LOCAL transaction_timeout='15min'");
}
export async function commitOnce(client) {
  try { await client.query('COMMIT'); }
  catch { throw new GuardError('COMMIT_OUTCOME_UNKNOWN_USE_STATUS_DO_NOT_REEXECUTE'); }
}

/** All connections are provided explicitly; this function never reads env files.
 * Tests may supply isolated clients. The CLI always validates fixed endpoints.
 * White is READ ONLY throughout, including the final drift recheck.
 */
export async function runCutover({ mode, bundle, black, white, configurations, confirmation = {} }, steps = cutoverSteps) {
  const { databaseIdentity, assertIdentity, assertNoOtherClients, assertExistingRoles, lockTables, verifySource, applyInstallation, verify } = steps;
  guard(mode === 'execute' || mode === 'check', 'UNKNOWN_CUTOVER_MODE');
  if (mode === 'execute') confirmExecution(bundle, confirmation);
  monitorClient(black); monitorClient(white);
  let blackOpen = false, whiteOpen = false, commitAttempted = false;
  let keepalive;
  const { installation, readiness } = bundle;
  try {
    await begin(black, mode !== 'execute'); blackOpen = true;
    await begin(white, true); whiteOpen = true;
    keepalive = keepTransactionsAlive([black, white]);
    const acquired = (await black.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired', [migrationLock])).rows[0].acquired;
    guard(acquired, 'ANOTHER_CUTOVER_IS_ACTIVE');
    for (const [label, client] of [['negra', black], ['blanca', white]]) {
      assertIdentity(await databaseIdentity(client, configurations[label]), readiness.identities[label], label);
      await assertNoOtherClients(client);
      const marker = (await client.query("SELECT to_regclass('shared_runtime.configuration')::text AS marker,to_regclass('shared_archive.batches')::text AS batches")).rows[0];
      guard(!marker.marker && !marker.batches, 'UNION_ALREADY_PRESENT_USE_STATUS_NEVER_REAPPLY');
    }
    // SHARE ROW EXCLUSIVE blocks target DML and DDL while allowing the separate
    // native schema reader. PostgreSQL forbids stronger locks in READ ONLY:
    // white uses ACCESS SHARE plus a required external connection fence.
    await lockTables(black, installation.black, mode === 'execute');
    await lockTables(white, installation.white, false);
    await assertExistingRoles(black, readiness);
    await verifySource(black, configurations.negra, bundle, 'negra');
    await verifySource(white, configurations.blanca, bundle, 'blanca');
    await assertNoOtherClients(black); await assertNoOtherClients(white);
    keepalive.assertHealthy();
    if (mode === 'check') return { ...resultSummary(bundle), mode, databaseWrites: false, preflightVerified: true,
      note: 'Point-in-time check only. Execute repeats every check under target write locks.' };

    // No DDL or business DML precedes both complete source verifications.
    await applyInstallation(black, installation);
    keepalive.assertHealthy();
    await black.query("INSERT INTO shared_runtime.configuration(singleton,version,environment,instance_id) VALUES(true,1,'production',$1)", [readiness.productionInstanceId]);
    await black.query("SET LOCAL shared_cutover.approved_white_role='llantera_multi_stock'");
    await black.query("SET LOCAL shared_cutover.apps_stopped='true'");
    await black.query(bundle.permissionsSql);
    await black.query('INSERT INTO shared_archive.batches(id,manifest_text,manifest_sha256) VALUES($1,$2,$3)', [installation.batch, installation.document, installation.digest]);
    const proof = await verify(black, installation.plan);
    await assertExistingRoles(black, readiness, { installed: true });
    // READ COMMITTED sees any source drift after the first check. No source
    // writes, role changes, connection termination or deletions are performed.
    await verifySource(white, configurations.blanca, bundle, 'blanca');
    await assertNoOtherClients(black); await assertNoOtherClients(white);
    // Drain heartbeats before COMMIT. No background query can execute after a
    // commit attempt or obscure whether a transport failure happened at COMMIT.
    await keepalive.stop();
    keepalive.assertHealthy();
    commitAttempted = true;
    await commitOnce(black); blackOpen = false;
    return { ...resultSummary(bundle), mode, committed: true, commitOutcome: 'confirmed', sourceWhiteModified: false, ...proof };
  } finally {
    // An ambiguous COMMIT is never retried. Closing the connection resolves any
    // open transaction; durable status must be read before considering recovery.
    await keepalive?.stop();
    if (blackOpen && !commitAttempted) await black.query('ROLLBACK').catch(() => {});
    if (whiteOpen) await white.query('ROLLBACK').catch(() => {});
  }
}
export async function status({ bundle, black, configuration }) {
  monitorClient(black);
  await begin(black, true);
  try {
    assertIdentity(await databaseIdentity(black, configuration), bundle.readiness.identities.negra, 'negra');
    const acquired = (await black.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired', [migrationLock])).rows[0].acquired;
    if (!acquired) return { ...resultSummary(bundle), outcome: 'still_in_progress_or_unknown', retryAllowed: false };
    const marker = (await black.query("SELECT to_regclass('shared_runtime.configuration')::text AS marker,to_regclass('shared_archive.batches')::text AS batches")).rows[0];
    if (!marker.marker && !marker.batches) return { ...resultSummary(bundle), outcome: 'not_committed', retryAllowed: false };
    guard(marker.marker && marker.batches, 'PARTIAL_OR_UNREVIEWED_RUNTIME_REQUIRES_REVIEW');
    const runtime = (await black.query('SELECT version,environment,instance_id::text AS instance_id FROM shared_runtime.configuration')).rows;
    guard(runtime.length === 1 && runtime[0].version === 1 && runtime[0].environment === 'production' && runtime[0].instance_id === bundle.readiness.productionInstanceId, 'DIFFERENT_RUNTIME_PRESENT');
    const batches = (await black.query('SELECT manifest_sha256 FROM shared_archive.batches WHERE id=$1', [bundle.installation.batch])).rows;
    guard(batches.length === 1 && batches[0].manifest_sha256 === bundle.installation.digest, 'DIFFERENT_OR_MISSING_CUTOVER_BATCH');
    return { ...resultSummary(bundle), outcome: 'committed', retryAllowed: false };
  } finally { await black.query('ROLLBACK').catch(() => {}); }
}
function argumentsFor(argv) {
  const [mode, ...rest] = argv;
  guard(['dry-run', 'check', 'execute', 'status'].includes(mode), 'MODE_MUST_BE_DRY_RUN_CHECK_EXECUTE_OR_STATUS');
  const accepted = ['request-file', 'black-connection-file', 'white-connection-file', 'confirm-plan-sha256', 'confirm-package-sha256', 'report-file'];
  const parsed = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]?.replace(/^--/, '');
    guard(rest[index]?.startsWith('--') && accepted.includes(key) && rest[index + 1] && !Object.hasOwn(parsed, key), 'EXPLICIT_UNIQUE_ARGUMENTS_REQUIRED');
    parsed[key] = rest[index + 1];
  }
  guard(parsed['request-file'], 'EXPLICIT_REQUEST_FILE_REQUIRED');
  return { mode, ...parsed };
}
export async function main(argv = process.argv.slice(2)) {
  const args = argumentsFor(argv);
  const bundle = await readPackage(args['request-file'], { requireReady: args.mode !== 'dry-run', requireFresh: args.mode !== 'status' });
  let result;
  if (args.mode === 'dry-run') result = { ...resultSummary(bundle), mode: args.mode, connected: false, databaseWrites: false,
    blockers: bundle.blockers, readyForOnlinePreflight: bundle.blockers.length === 0 };
  else {
    if (args.mode === 'execute') confirmExecution(bundle, { planSha256: args['confirm-plan-sha256'], packageSha256: args['confirm-package-sha256'] });
    const configurations = { negra: await readConnection(args['black-connection-file'], 'negra') };
    if (args.mode !== 'status') configurations.blanca = await readConnection(args['white-connection-file'], 'blanca');
    const black = new pg.Client(options(configurations.negra, args.mode !== 'execute'));
    monitorClient(black);
    let white;
    try {
      await black.connect();
      if (args.mode === 'status') result = await status({ bundle, black, configuration: configurations.negra });
      else {
        white = new pg.Client(options(configurations.blanca, true)); monitorClient(white); await white.connect();
        result = await runCutover({ mode: args.mode, bundle, black, white, configurations,
          confirmation: { planSha256: args['confirm-plan-sha256'], packageSha256: args['confirm-package-sha256'] } });
      }
    } finally { await white?.end().catch(() => {}); await black.end().catch(() => {}); }
  }
  if (args['report-file']) {
    try { await fs.writeFile(path.resolve(args['report-file']), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
    catch { result.reportWarning = 'RESULT_FILE_NOT_SAVED_DATABASE_OUTCOME_UNCHANGED'; }
  }
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main(), null, 2)); }
  catch (error) {
    // PostgreSQL errors may contain SQL, customer values or connection secrets.
    // Never echo their message/detail/stack, nor assertion actual/expected.
    const code = error instanceof GuardError ? error.code : 'CUTOVER_FAILED_BEFORE_CONFIRMED_SUCCESS_REVIEW_LOCALLY';
    console.error(JSON.stringify({ code, databaseOutcome: code.startsWith('COMMIT_OUTCOME_UNKNOWN') ? 'unknown-use-status' : 'not-reported-as-committed' }));
    process.exitCode = 1;
  }
}
