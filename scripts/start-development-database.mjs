import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import pg from 'pg';
import dotenv from 'dotenv';

// Explicit local helper: never reads production .env or changes a remote server.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const env=dotenv.parse(await fs.readFile(path.join(root,'.env.local')));
assert.equal(env.SHARED_DATABASE_MODE,'true','Only the shared development mode is supported');
assert.equal(env.SHARED_DATABASE_ENVIRONMENT,'development','Production cannot be started by this helper');
assert.ok(env.LLANTAS_DEV_RUNTIME,'LLANTAS_DEV_RUNTIME must identify the prepared local PostgreSQL runtime');
const url=new URL(env.DATABASE_URL);
assert.equal(url.hostname,'127.0.0.1'); assert.equal(url.port,'55439');
assert.equal(url.pathname,'/llantas_unified_dev');
const runtime=path.resolve(env.LLANTAS_DEV_RUNTIME);
assert.equal((await fs.readFile(path.join(runtime,'data/PG_VERSION'),'utf8')).trim(),'17');
assert.equal(process.platform,'win32','This helper starts the prepared Windows runtime only');
const childEnv={...process.env};
for(const key of Object.keys(childEnv)) if(key.startsWith('PG')) delete childEnv[key];
const executable=path.join(runtime,'pgsql/bin/pg_ctl.exe');
async function run(args) {
  const log=await fs.open(path.join(runtime,'development-start.log'),'a');
  try {
    return await new Promise((resolve,reject)=>{
      const child=spawn(executable,args,{windowsHide:true,shell:false,env:childEnv,stdio:['ignore',log.fd,log.fd]});
      child.once('error',()=>reject(new Error('Cannot start the prepared PostgreSQL runtime')));
      child.once('exit',code=>resolve(code));
    });
  } finally {await log.close();}
}
if(await run(['-D',path.join(runtime,'data'),'status'])!==0) {
  assert.equal(await run(['-D',path.join(runtime,'data'),'-l',path.join(runtime,'server.log'),'-o','-p 55439 -h 127.0.0.1 -c max_connections=40 -c shared_buffers=64MB','-w','-t','30','start']),0,'PostgreSQL did not start; inspect the private runtime log');
}
const client=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:5000,options:'-c default_transaction_read_only=on'});
try {
  await client.connect();
  const result=await client.query('SELECT current_database() AS db,environment,instance_id FROM shared_runtime.configuration');
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].db,'llantas_unified_dev');
  assert.equal(result.rows[0].environment,'development');
  assert.equal(result.rows[0].instance_id,env.SHARED_DATABASE_ID);
  console.log('Base local de desarrollo disponible e identidad verificada.');
} catch {
  throw new Error('No se pudo verificar la copia local de desarrollo; no se inicio ninguna aplicacion.');
} finally {await client.end();}
