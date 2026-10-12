import assert from 'node:assert/strict';
import test from 'node:test';
import { fingerprintRetirementSnapshot, getRetirementDDL, readRetirementSnapshot, retireSource, rollbackSourceRetirement } from './retirement.mjs';

const supplier = 'COMERCIALIZADORA DE NEW TIRES';
const expected = {
  llantas: [
    '{"id":"active","proveedor":"COMERCIALIZADORA DE NEW TIRES","activo":true,"precioCompra":12345678901234567890.12,"stockPorBodega":{"bodega-8":3},"updatedAt":"2026-10-10T15:05:03.123456+00:00"}',
    '{"id":"inactive","proveedor":"Comercializadora de New Tires","activo":false,"precioCompra":0.00,"stockPorBodega":{"bodega-8":0},"updatedAt":"2026-10-09T15:05:03.123456+00:00"}',
  ],
  ventas: ['{"id":"mixed-sale","items":[{"llantaId":"active","cantidad":2},{"llantaId":"another-supplier","cantidad":1}],"cancelada":false,"total":12345678901234567890.12}'],
  movimientos_bodega: ['{"id":"movement","llantaId":"active","fecha":"2026-10-09T15:05:03.123456+00:00"}'],
};
function options(overrides = {}) {
  return {
    batchId: 'new-tires-2026-10-11', supplier, expected,
    targetVerification: {
      verified: true, database: 'llaneteramulti', sourceFingerprint: fingerprintRetirementSnapshot(expected),
      verifiedAt: '2026-10-11T15:00:00.000Z', reportSha256: 'a'.repeat(64),
    },
    ...overrides,
  };
}

function clientMock({ difference, rowCount = 1, database = 'sistemaBodega', batch, schemaVersion, lockError = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.startsWith('LOCK TABLE') && lockError) throw new Error('LOCK TABLE can only be used in transaction blocks');
      if (sql === 'SELECT current_database() AS database') return { rows: [{ database }] };
      if (sql.includes("obj_description(oid, 'pg_namespace')")) return { rows: schemaVersion ? [{ version: schemaVersion }] : [] };
      if (sql.startsWith('SELECT * FROM migration_control.retirement_batches')) return { rows: batch ? [batch] : [] };
      if (sql.startsWith('WITH expected') && difference && sql.includes(`FROM public.${difference} t`)) return { rows: [{ id: 'changed' }] };
      if (sql.startsWith('UPDATE public.llantas l SET activo = false')) return { rows: [], rowCount };
      return { rows: [], rowCount: 1 };
    },
  };
}

test('fingerprint includes all historical fields and is independent of row order', () => {
  const reordered = { ...expected, llantas: [...expected.llantas].reverse() };
  assert.equal(fingerprintRetirementSnapshot(expected), fingerprintRetirementSnapshot(reordered));
  const changed = { ...expected, ventas: [expected.ventas[0].replace('12345678901234567890.12', '12345678901234567890.13')] };
  assert.notEqual(fingerprintRetirementSnapshot(expected), fingerprintRetirementSnapshot(changed));
});

test('rejects parsed rows, duplicate IDs, missing relations and empty selection before touching DB', async () => {
  for (const invalid of [
    { ...expected, llantas: expected.llantas.map(JSON.parse) },
    { ...expected, llantas: [expected.llantas[0], expected.llantas[0]] },
    { ...expected, ventas: ['{"id":"other","items":[{"llantaId":"not-selected"}]}'] },
    { ...expected, movimientos_bodega: ['{"id":"other","llantaId":"not-selected"}'] },
    { ...expected, llantas: [] },
  ]) {
    const client = clientMock();
    await assert.rejects(retireSource(client, options({ expected: invalid })));
    assert.equal(client.calls.length, 0);
  }
});

test('requires destination verification for precisely the selected snapshot', async () => {
  for (const verification of [null, { ...options().targetVerification, verified: false }, { ...options().targetVerification, sourceFingerprint: 'b'.repeat(64) }, { ...options().targetVerification, reportSha256: '' }]) {
    const client = clientMock();
    await assert.rejects(retireSource(client, options({ targetVerification: verification })), /verification/);
    assert.equal(client.calls.length, 0);
  }
});

test('never retires into the same database and requires an externally owned transaction', async () => {
  const sameDatabase = clientMock({ database: 'llaneteramulti' });
  await assert.rejects(retireSource(sameDatabase, options()), /different database/);
  assert.equal(sameDatabase.calls.some(({ sql }) => sql.startsWith('CREATE')), false);
  const autocommit = clientMock({ lockError: true });
  await assert.rejects(retireSource(autocommit, options()), /transaction blocks/);
  assert.equal(autocommit.calls.length, 1);
});

test('aborts if any original tire, full mixed sale or movement changed; no retirement DML occurs', async () => {
  for (const difference of ['llantas', 'ventas', 'movimientos_bodega']) {
    const client = clientMock({ difference });
    await assert.rejects(retireSource(client, options()), /Source changed or snapshot is incomplete/);
    assert.equal(client.calls.some(({ sql }) => /^(INSERT|UPDATE|DELETE) /u.test(sql)), false);
  }
});

test('retirement archives untouched raw data and changes only activo on previously active tires', async () => {
  const client = clientMock();
  const result = await retireSource(client, options());
  assert.deepEqual(result.counts, { llantas: 2, ventas: 1, movimientos_bodega: 1 });
  assert.equal(result.activeRetired, 1);
  assert.equal(result.alreadyRetired, false);
  const tireArchive = client.calls.find(({ sql }) => sql.startsWith('INSERT INTO migration_control.archived_llantas'));
  assert.equal(tireArchive.params[1], `[${expected.llantas.join(',')}]`);
  assert.match(tireArchive.params[1], /12345678901234567890\.12/);
  assert.match(tireArchive.params[1], /123456\+00:00/);
  const saleArchive = client.calls.find(({ sql }) => sql.startsWith('INSERT INTO migration_control.archived_sales'));
  assert.equal(saleArchive.params[1], `[${expected.ventas[0]}]`);
  const sourceWrites = client.calls.filter(({ sql }) => /^(UPDATE|DELETE|INSERT).*public\./su.test(sql));
  assert.equal(sourceWrites.length, 1);
  assert.match(sourceWrites[0].sql, /SET activo = false/u);
  assert.doesNotMatch(sourceWrites[0].sql, /updatedAt|stockPorBodega/u);
  assert.equal(client.calls.some(({ sql }) => /^(COMMIT|ROLLBACK|BEGIN)\b/u.test(sql)), false);
  assert.match(client.calls.at(-1).sql, /status = 'retired'/u);
});

test('unexpected update count cannot mark a batch retired', async () => {
  const client = clientMock({ rowCount: 2 });
  await assert.rejects(retireSource(client, options()), /Unexpected active tire count/);
  assert.equal(client.calls.some(({ sql }) => sql.startsWith('UPDATE migration_control.retirement_batches')), false);
});

test('never takes over an unrelated migration schema', async () => {
  const client = clientMock({ schemaVersion: 'someone-else' });
  await assert.rejects(retireSource(client, options()), /unknown version/);
  assert.equal(client.calls.some(({ sql }) => sql.startsWith('CREATE') || sql.startsWith('DROP')), false);
});

test('repeated completed retirement validates audit and retired source without modifying rows', async () => {
  const client = clientMock({ batch: {
    fingerprint: fingerprintRetirementSnapshot(expected), supplier_normalized: supplier, source_database: 'sistemaBodega', status: 'retired',
    target_verification: options().targetVerification,
  } });
  const result = await retireSource(client, options());
  assert.equal(result.alreadyRetired, true);
  assert.equal(client.calls.filter(({ sql }) => sql.startsWith('WITH expected')).length, 6);
  assert.equal(client.calls.some(({ sql }) => /^(INSERT|UPDATE|DELETE) /u.test(sql)), false);
});

test('versioned guards cover old/new tire IDs, supplier recreation, mixed sales, movements and truncate', () => {
  const sql = getRetirementDDL();
  assert.match(sql, /a\.llanta_id = OLD\.id/u);
  assert.match(sql, /a\.llanta_id = NEW\.id/u);
  assert.match(sql, /supplier_normalized = upper\(regexp_replace\(btrim\(NEW\.proveedor\)/u);
  assert.match(sql, /a\.sale_id = OLD\.id/u);
  assert.match(sql, /a\.sale_id = NEW\.id/u);
  assert.match(sql, /jsonb_array_elements\(old_items \|\| new_items\)/u);
  assert.match(sql, /a\.llanta_id = OLD\."llantaId"/u);
  assert.match(sql, /a\.llanta_id = NEW\."llantaId"/u);
  assert.equal((sql.match(/BEFORE TRUNCATE ON public\./gu) ?? []).length, 3);
  assert.equal((sql.match(/ENABLE ALWAYS TRIGGER migration_retirement_guard/gu) ?? []).length, 3);
  assert.equal((sql.match(/SECURITY DEFINER SET search_path = pg_catalog/gu) ?? []).length, 4);
  assert.doesNotMatch(sql, /current_setting\('.*bypass|DISABLE TRIGGER|session_replication_role/u);
});

test('read helper preserves raw representations and does not change caller transaction', async () => {
  const calls = [];
  const snapshot = await readRetirementSnapshot({ async query(sql, params) {
    calls.push({ sql, params });
    const table = ['ventas', 'movimientos_bodega', 'llantas'].find((name) => sql.includes(`FROM public.${name} t`));
    return { rows: expected[table].map((row_json) => ({ row_json })) };
  } }, '  Comercializadora   de New Tires  ');
  assert.deepEqual(snapshot, expected);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(({ sql, params }) => sql.startsWith('SELECT to_jsonb(t)::text') && params[0] === supplier));
});

test('rollback refuses missing backup, running target or unreconciled destination activity', async () => {
  const base = {
    batchId: 'new-tires-2026-10-11', reason: 'Verified recovery', expected,
    expectedFingerprint: fingerprintRetirementSnapshot(expected), targetQuiesced: true, destinationChangesReconciled: true,
    backupVerified: { sourceFingerprint: fingerprintRetirementSnapshot(expected), reportSha256: 'b'.repeat(64) },
  };
  for (const overrides of [{ targetQuiesced: false }, { destinationChangesReconciled: false }, { backupVerified: null }, { expectedFingerprint: 'c'.repeat(64) }]) {
    const client = clientMock();
    await assert.rejects(rollbackSourceRetirement(client, { ...base, ...overrides }), /Rollback requires/);
    assert.equal(client.calls.length, 0);
  }
  const client = clientMock({ batch: {
    fingerprint: fingerprintRetirementSnapshot(expected), supplier_normalized: supplier, source_database: 'sistemaBodega', status: 'retired',
  } });
  const result = await rollbackSourceRetirement(client, base);
  assert.equal(result.alreadyRestored, false);
  const restore = client.calls.find(({ sql }) => sql.startsWith('UPDATE public.llantas'));
  assert.match(restore.sql, /SET activo = \(a\.original_row->>'activo'\)::boolean/u);
  assert.doesNotMatch(restore.sql, /updatedAt|stockPorBodega/u);
  assert.match(client.calls.at(-1).sql, /status = 'restored'/u);
});
