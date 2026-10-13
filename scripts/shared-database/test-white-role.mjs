// Rehearse the reviewed production grants using a disposable LOCAL role only.
// Usage: node scripts/shared-database/test-white-role.mjs --connection PRIVATE_JSON --black BLACK_WORKTREE
// No production URL or source/unified database is accepted. Credentials stay in
// a private OS temporary directory and are removed after all workers complete.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argument = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const connectionFile = argument('--connection'), black = argument('--black');
assert.ok(connectionFile && black, 'Explicit private connection and black worktree are required.');
const connection = JSON.parse(fs.readFileSync(connectionFile, 'utf8'));
assert.equal(connection.host, '127.0.0.1'); assert.equal(Number(connection.port), 55439); assert.equal(connection.ssl, false);
const database = 'llantas_shared_tests';
const require = createRequire(path.resolve(here, '../../package.json'));
const { Client } = require('pg');
const owner = new Client({ ...connection, database, application_name: 'isolated_white_role_rehearsal' });
const role = 'shared_test_white_' + randomBytes(5).toString('hex');
const password = randomBytes(32).toString('hex');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-local-role-'));
const privateRoleFile = path.join(directory, 'connection.json');
let restricted, created = false;
async function denied(sql, params = [], expectedCode = '42501') {
  await restricted.query('BEGIN');
  try {
    await assert.rejects(restricted.query(sql, params), error => error.code === expectedCode);
  } finally { await restricted.query('ROLLBACK'); }
}
async function fullIntegration() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(here, 'integration.mjs'), '--connection', connectionFile,
      '--black', black, '--white-connection', privateRoleFile], { stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('Restricted-role application integration failed.')));
  });
}
try {
  await owner.connect();
  const identity = (await owner.query('SELECT current_database() AS database,environment FROM shared_runtime.configuration WHERE singleton IS TRUE')).rows;
  assert.equal(identity.length, 1); assert.equal(identity[0].database, database); assert.equal(identity[0].environment, 'development');
  // Generated identifiers and secret contain only fixed prefixes and hexadecimal.
  await owner.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  created = true;
  // Reproduce the old role ACL captured in the actual black schema dump.
  await owner.query(`GRANT USAGE ON SCHEMA multi_inventory TO ${role}`);
  await owner.query(`GRANT SELECT ON multi_inventory.llantas TO ${role}`);
  await owner.query(`GRANT EXECUTE ON FUNCTION multi_inventory.reserve_stock(text,jsonb),
    multi_inventory.commit_stock(text),multi_inventory.release_stock(text),multi_inventory.get_stock_operation(text) TO ${role}`);
  const sql = fs.readFileSync(path.join(black, 'database/shared/white-role-permissions.sql'), 'utf8')
    .replaceAll('llantera_multi_stock', role);
  await owner.query('BEGIN');
  try { await assert.rejects(owner.query(sql), /not explicitly selected/); }
  finally { await owner.query('ROLLBACK'); }
  await owner.query('BEGIN');
  try {
    await owner.query("SELECT set_config('shared_cutover.approved_white_role',$1,true)", [role]);
    await owner.query(`GRANT UPDATE(total) ON ventas TO ${role}`);
    await assert.rejects(owner.query(sql), /Unexpected privilege can rewrite sale history/);
  } finally { await owner.query('ROLLBACK'); }
  await owner.query('BEGIN');
  try {
    await owner.query("SELECT set_config('shared_cutover.approved_white_role',$1,true)", [role]);
    await owner.query(sql); await owner.query('COMMIT');
  } catch (error) { await owner.query('ROLLBACK'); throw error; }
  const roleConnection = { ...connection, database, user: role, password };
  fs.writeFileSync(privateRoleFile, JSON.stringify(roleConnection), { mode: 0o600 });
  restricted = new Client({ ...roleConnection, application_name: 'isolated_white_role_negative_tests' });
  await restricted.connect();
  assert.equal((await restricted.query('SELECT current_user AS role')).rows[0].role, role);
  const historical = (await restricted.query('SELECT id FROM ventas WHERE imported_read_only=true LIMIT 1')).rows[0];
  assert.ok(historical);
  await denied('UPDATE ventas SET total=total+1 WHERE id=$1', [historical.id]);
  await denied('UPDATE ventas SET imported_read_only=false WHERE id=$1', [historical.id]);
  await denied('UPDATE ventas SET origen_app=origen_app WHERE id=$1', [historical.id]);
  await denied('UPDATE ventas SET cancelada=NOT cancelada WHERE id=$1', [historical.id], 'P0001');
  await denied('UPDATE shared_archive.sale_originals SET document_text=document_text');
  await denied('UPDATE shared_runtime.configuration SET version=version');
  await denied('UPDATE shared_runtime.operations SET status=status');
  await denied('DELETE FROM ventas WHERE false');
  await denied('TRUNCATE shared_archive.sale_originals');
  await denied('CREATE TABLE public.shared_forbidden_fixture(id int)');
  const obsolete = (await restricted.query(`SELECT has_function_privilege(current_user,'multi_inventory.reserve_stock(text,jsonb)','EXECUTE') AS reserve,
    has_function_privilege(current_user,'multi_inventory.commit_stock(text)','EXECUTE') AS commit,
    has_function_privilege(current_user,'multi_inventory.release_stock(text)','EXECUTE') AS release,
    has_function_privilege(current_user,'multi_inventory.get_stock_operation(text)','EXECUTE') AS status`)).rows[0];
  assert.deepEqual(Object.values(obsolete), [false, false, false, false]);
  process.stdout.write('PASS restricted-role grants, protected history, immutable evidence, no DDL/deletion and retired parity functions\n');
  await fullIntegration();
} finally {
  await restricted?.end();
  if (created) {
    // This generated role was only granted privileges in this clone.
    // Remove its local ACL entries before dropping this test-only role.
    await owner.query(`DROP OWNED BY ${role}`);
    await owner.query(`DROP ROLE ${role}`);
  }
  await owner.end();
  fs.rmSync(privateRoleFile, { force: true }); fs.rmdirSync(directory);
}
