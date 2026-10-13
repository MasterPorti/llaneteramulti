import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import { sha256 } from './merge-plan.mjs';
import { loadInstallation, qualified, tableRows, applyInstallation, verify } from './install-core.mjs';

/** Deliberately limited to the local rehearsal. This is not a production migrator. */
export async function installDevelopment({snapshotDirectory,connectionFile,blackWorkspace,whiteWorkspace}) {
  const conf=JSON.parse(await fs.readFile(connectionFile,'utf8'));
  assert.equal(conf.host,'127.0.0.1');assert.equal(conf.port,55439);assert.equal(conf.user,'llantas_dev_owner');
  const target='llantas_unified_dev';
  const installation=await loadInstallation(snapshotDirectory,blackWorkspace,whiteWorkspace);
  const {black,plan,document,digest,batch}=installation;
  const client=new pg.Client({...conf,database:target,connectionTimeoutMillis:5000,options:'-c timezone=UTC -c application_name=shared_database_development_installer'});
  await client.connect();
  let instanceId;
  let alreadyInstalled=false;
  try {
    const identity=(await client.query('SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port')).rows[0];
    assert.equal(identity.db,target);assert.equal(identity.host,'127.0.0.1');assert.equal(identity.port,55439);
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    const installed=(await client.query("SELECT to_regclass('shared_runtime.configuration')::text AS marker")).rows[0].marker;
    if(installed) {
      const runtime=(await client.query('SELECT * FROM shared_runtime.configuration')).rows;
      assert.equal(runtime.length,1);assert.equal(runtime[0].environment,'development');
      instanceId=runtime[0].instance_id;
      const previous=(await client.query('SELECT manifest_sha256 FROM shared_archive.batches WHERE id=$1',[batch])).rows;
      assert.equal(previous.length,1,'A different plan is already installed; never overwrite it');
      assert.equal(previous[0].manifest_sha256,digest);
      alreadyInstalled=true;
    } else {
      // Every restored source row must still match before any DDL or DML.
      for(const table of Object.keys(black)) await client.query(`LOCK TABLE ${qualified(table)} IN ACCESS EXCLUSIVE MODE`);
      for(const [table,original] of Object.entries(black)) assert.equal(sha256(JSON.stringify(await tableRows(client,table))),sha256(JSON.stringify(original)),'Rehearsal source drift: '+table);
      await applyInstallation(client,installation);
      instanceId=randomUUID();
      await client.query("INSERT INTO shared_runtime.configuration(singleton,version,environment,instance_id) VALUES(true,1,'development',$1)",[instanceId]);
      await client.query('INSERT INTO shared_archive.batches(id,manifest_text,manifest_sha256) VALUES($1,$2,$3)',[batch,document,digest]);
    }
    const proof=await verify(client,plan);
    await client.query('COMMIT');
    const url=new URL('postgresql://127.0.0.1:55439/'+target);url.username=conf.user;url.password=conf.password;
    const env=['DATABASE_URL='+url.toString(),'DB_REQUIRE_SSL=false','SHARED_DATABASE_MODE=true','SHARED_DATABASE_ENVIRONMENT=development','SHARED_DATABASE_ID='+instanceId].join('\n')+'\n';
    for(const workspace of [blackWorkspace,whiteWorkspace]) {
      const file=path.join(workspace,'.env.local');
      try {await fs.writeFile(file,env,{flag:'wx'});} catch(error) {if(error.code!=='EEXIST')throw error;assert.equal(await fs.readFile(file,'utf8'),env,'Existing worktree env differs; do not overwrite');}
    }
    const result={database:target,environment:'development',instanceId,batch,planSha256:digest,alreadyInstalled,...proof,verifiedAt:new Date().toISOString()};
    await fs.writeFile(path.join(snapshotDirectory,'development-union-verification.json'),JSON.stringify(result,null,2));
    return result;
  } catch(error) {await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally {await client.end();}
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [snapshotDirectory,connectionFile,blackWorkspace,whiteWorkspace]=process.argv.slice(2);
  assert.ok(snapshotDirectory&&connectionFile&&blackWorkspace&&whiteWorkspace,'Four explicit paths are required; no environment file is loaded');
  try {console.log(JSON.stringify(await installDevelopment({snapshotDirectory,connectionFile,blackWorkspace,whiteWorkspace}),null,2));}
  catch(error) {
    await fs.writeFile(path.join(snapshotDirectory,'development-install-error.json'),JSON.stringify({message:error.message,stack:error.stack,actual:error.actual,expected:error.expected},null,2));
    console.error(error.message.split('\n')[0]);
    console.error(String(error.stack).split('\n').filter(line=>line.trim().startsWith('at ')).join('\n'));
    process.exitCode=1;
  }
}
