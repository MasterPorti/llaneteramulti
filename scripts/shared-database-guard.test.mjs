import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'lib/db.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const instance = '9d80db37-5f45-4e13-8714-0f72d0777021';
const database = 'codex_shared_guard';
const write = 'UPDATE guard_fixture SET value=$1';
const applicationId = 'llm:' + 'a'.repeat(48);

// The actual connection module executes in an isolated VM. Only a fake pg module
// is available: no .env, process environment, network, PostgreSQL or real timers.
function fixture(options = {}) {
  const env = {
    NODE_ENV: 'development', SHARED_DATABASE_MODE: 'true',
    SHARED_DATABASE_ENVIRONMENT: 'development', SHARED_DATABASE_ID: instance,
    DATABASE_URL: 'postgresql://fake_user:fake_password@invalid.test/' + database,
    ...options.env,
  };
  const state = { calls: [], pools: [], released: [], ended: 0, logs: [], timers: [] };
  const configuration = options.configuration ?? [{ version: 1, environment: 'development', instance_id: instance }];
  const query = async (sql, params) => {
    state.calls.push({ sql, params });
    if (sql.includes("to_regclass('shared_runtime.configuration')")) {
      return { rows: [{ database: options.actualDatabase ?? database,
        configuration: options.missingConfiguration ? null : 'shared_runtime.configuration' }] };
    }
    if (sql.startsWith('SELECT version,environment,instance_id')) {
      if (options.configurationError) throw new Error('permission denied for configuration');
      return { rows: configuration };
    }
    if (sql.includes("to_regclass('migration_new_tires.runtime_setup')")) {
      return { rows: [{ database, runtime: 'migration_new_tires.runtime_setup', application_id: applicationId }] };
    }
    if (sql === 'SELECT version FROM migration_new_tires.runtime_setup') return { rows: [{ version: 1 }] };
    return { rows: [], rowCount: 1 };
  };
  class FakePool {
    constructor(config) { state.pools.push(config); }
    async connect() { return { query, release: (discard) => state.released.push(discard) }; }
    query(sql, params) { return query(sql, params); }
    async end() { state.ended++; }
  }
  const compiledModule = { exports: {} };
  const context = {
    module: compiledModule, exports: compiledModule.exports, process: { env }, URL,
    require: (name) => {
      assert.equal(name, 'pg', 'Connection guard must not import another runtime/central client');
      return { Pool: FakePool, types: { setTypeParser() {} } };
    },
    console: { error: (...args) => state.logs.push(args), log: (...args) => state.logs.push(args) },
    setTimeout: (fn) => { state.timers.push(fn); return state.timers.length; },
    clearTimeout() {},
  };
  context.global = context;
  vm.runInNewContext(compiled, context, { filename: path.join(root, 'lib/db.ts') });
  return { db: compiledModule.exports.db, transaction: compiledModule.exports.transaction, env, state, configuration };
}
function assertNoWrites(state) {
  assert.ok(state.calls.every(({ sql }) => /^SELECT\b/.test(sql)), 'Guard transmitted a business statement before verifying identity');
}

test('imports do not create any database pool or load central clients', () => {
  const { state } = fixture();
  assert.equal(state.pools.length, 0); assert.equal(state.calls.length, 0);
});

test('matched development instance permits a query only after both identity reads', async () => {
  const { db, state } = fixture();
  await db.query(write, ['private customer value']);
  assert.equal(state.calls.length, 3);
  assert.match(state.calls[0].sql, /current_database/);
  assert.match(state.calls[1].sql, /shared_runtime.configuration/);
  assert.equal(state.calls[2].sql, write);
  assert.equal(state.released.length, 1); assert.equal(state.logs.length, 0);
});

test('every checkout revalidates the instance even when its pool is reused', async () => {
  const f = fixture();
  const client = await f.db.getClient(); client.release();
  f.configuration[0].instance_id = '00000000-0000-0000-0000-000000000000';
  await assert.rejects(f.db.query(write), /instancia/);
  assert.equal(f.state.pools.length, 1); assert.equal(f.state.calls.length, 4);
  assert.equal(f.state.released.at(-1), true); assertNoWrites(f.state);
});

for (const [name, options] of [
  ['missing runtime schema/table', { missingConfiguration: true }],
  ['empty configuration', { configuration: [] }],
  ['multiple configuration rows', { configuration: [{ version: 1, environment: 'development', instance_id: instance }, { version: 1, environment: 'development', instance_id: instance }] }],
  ['unsupported runtime version', { configuration: [{ version: 2, environment: 'development', instance_id: instance }] }],
  ['wrong instance', { configuration: [{ version: 1, environment: 'development', instance_id: '00000000-0000-0000-0000-000000000000' }] }],
  ['wrong actual database', { actualDatabase: 'unexpected_database' }],
  ['production marker despite development configuration', { configuration: [{ version: 1, environment: 'production', instance_id: instance }] }],
  ['metadata cannot be read', { configurationError: true }],
]) {
  test('rejects ' + name + ' without forwarding caller SQL or initializing schema', async () => {
    const { db, state } = fixture(options);
    await assert.rejects(db.query(write), /base|versión|instancia|permission denied/);
    assertNoWrites(state); assert.equal(state.released.at(-1), true);
    assert.equal(state.logs.length, 0);
  });
}

for (const [name, env] of [
  ['missing environment', { SHARED_DATABASE_ENVIRONMENT: undefined }],
  ['unknown environment', { SHARED_DATABASE_ENVIRONMENT: 'staging' }],
  ['missing instance ID', { SHARED_DATABASE_ID: undefined }],
  ['malformed instance ID', { SHARED_DATABASE_ID: 'not-a-uuid' }],
  ['missing database URL', { DATABASE_URL: undefined }],
  ['malformed database URL', { DATABASE_URL: 'postgresql://do-not-print:this-private-value@[' }],
  ['non-PostgreSQL URL', { DATABASE_URL: 'https://invalid.test/database' }],
  ['missing explicit database', { DATABASE_URL: 'postgresql://fake_user:fake_password@invalid.test/' }],
  ['central production URL present', { CENTRAL_INVENTORY_DATABASE_URL: 'postgresql://fake@production.invalid/postgres' }],
  ['empty central URL present', { CENTRAL_INVENTORY_DATABASE_URL: '' }],
  ['development process targeting production', { SHARED_DATABASE_ENVIRONMENT: 'production' }],
  ['test process targeting production', { NODE_ENV: 'test', SHARED_DATABASE_ENVIRONMENT: 'production' }],
  ['unset process environment targeting production', { NODE_ENV: undefined, SHARED_DATABASE_ENVIRONMENT: 'production' }],
]) {
  test('rejects ' + name + ' before creating a pool', async () => {
    const { db, state } = fixture({ env });
    await assert.rejects(db.query(write), (error) => {
      assert.ok(!error.message.includes('this-private-value')); return true;
    });
    assert.equal(state.pools.length, 0); assert.equal(state.calls.length, 0); assert.equal(state.logs.length, 0);
  });
}

test('a production build can operate a correctly marked development instance', async () => {
  const { db, state } = fixture({ env: { NODE_ENV: 'production' } });
  const client = await db.getClient(); client.release();
  assert.equal(state.calls.length, 2); assertNoWrites(state);
});

test('production requires both explicit production intent and a matching production marker', async () => {
  const { db, state } = fixture({
    env: { NODE_ENV: 'production', SHARED_DATABASE_ENVIRONMENT: 'production' },
    configuration: [{ version: 1, environment: 'production', instance_id: instance }],
  });
  await db.query(write); assert.equal(state.calls.at(-1).sql, write);
});

test('changing the configured instance creates a fresh pool and does not authorize the old marker', async () => {
  const f = fixture();
  const client = await f.db.getClient(); client.release();
  f.env.SHARED_DATABASE_ID = '00000000-0000-0000-0000-000000000000';
  await assert.rejects(f.db.query(write), /instancia/);
  assert.equal(f.state.pools.length, 2); assert.equal(f.state.ended, 1); assertNoWrites(f.state);
});

test('legacy mode remains opt-out and does not require the shared marker', async () => {
  const { db, state } = fixture({ env: {
    SHARED_DATABASE_MODE: 'false', SHARED_DATABASE_ENVIRONMENT: undefined, SHARED_DATABASE_ID: undefined,
    LLANTERA_EXPECTED_DATABASE: database, LLANTERA_APPLICATION_ID: applicationId,
  } });
  await db.query(write);
  assert.equal(state.calls.at(-1).sql, write);
  assert.ok(state.calls.every(({ sql }) => !sql.includes('shared_runtime')));
});

test('legacy client warnings never retain or print query text or parameters', async () => {
  const { db, state } = fixture({ env: {
    SHARED_DATABASE_MODE: 'false', LLANTERA_EXPECTED_DATABASE: database, LLANTERA_APPLICATION_ID: applicationId,
  } });
  const client = await db.getClient();
  await client.query('SELECT $1 AS highly_private_query', ['highly_private_parameter']);
  for (const fn of state.timers) fn();
  client.release();
  const logs = JSON.stringify(state.logs);
  assert.ok(!logs.includes('highly_private_query')); assert.ok(!logs.includes('highly_private_parameter'));
});
