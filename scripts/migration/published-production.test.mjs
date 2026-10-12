import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertFresh,assertIdentity,assertBatchAbsent,commitOnce,probeBatch,privateRoot,readSupplement,readBackup,storeSupplement,verifySupplement,documentHashes,verifyDocumentHashes,toSnapshot } from './published-production-support.mjs';
import { applicationNameForArtifact,validateExistingRuntimeRole } from './published-runtime.mjs';

test('fresh preparation rejects stale and future packages',()=>{
  const now=Date.parse('2026-10-12T10:00:00Z');assertFresh('2026-10-12T09:30:00Z',now);
  for(const t of ['2026-10-12T08:59:59Z','2026-10-12T10:01:00Z','invalid'])assert.throws(()=>assertFresh(t,now),/FRESH_PACKAGE_REQUIRED/);
});
test('identity must match endpoint, cluster, database, OID, and owner',()=>{
  const expected={host:'example.invalid',port:'5432',database:'postgres',oid:'123',owner:'owner',cluster_identifier:'456'};
  assertIdentity({...expected},expected);for(const key of Object.keys(expected))assert.throws(()=>assertIdentity({...expected,[key]:'different'},expected),/EXACT_SERVER_DATABASE_IDENTITY_MISMATCH/);
});
test('application version marker is exact, deterministic and below PostgreSQL 63-byte limit',()=>{
  const hash='ab'.repeat(32),marker=applicationNameForArtifact(hash);assert.equal(marker,'llm:'+hash.slice(0,48));assert.equal(Buffer.byteLength(marker),52);
  assert.throws(()=>applicationNameForArtifact('bad'),/VERIFIED_APPLICATION_ARTIFACT_REQUIRED/);
  assert.notEqual(applicationNameForArtifact('cd'+hash.slice(2)),marker);
});
test('existing admmin is validated without grants, revokes, or role changes',async()=>{
  const queries=[],client={query:async(sql,params)=>{queries.push(sql);assert.deepEqual(params,['admmin']);return{rows:[{rolname:'admmin',rolcanlogin:true,owns_database:true,is_session_user:true,rolsuper:true}]};}};
  const result=await validateExistingRuntimeRole(client,'admmin');assert.equal(result.grantsPerformed,false);assert.equal(result.existingPrivilegesUnchanged,true);
  assert.ok(queries.every(sql=>sql.startsWith('SELECT')));await assert.rejects(()=>validateExistingRuntimeRole(client,'new_role'),/CONFIRMED_EXISTING_APPLICATION_ROLE_REQUIRED/);
});
test('a repeated or unknown migration schema cannot be applied',()=>{
  assertBatchAbsent(false);assert.throws(()=>assertBatchAbsent(true),/MIGRATION_SCHEMA_ALREADY_PRESENT/);
});
test('warehouse configuration and its manifest cannot change together after plan approval',()=>{
  const documents=[['new_tires',Buffer.from('source')],['published_before',Buffer.from('destination')],['warehouse_config',Buffer.from('original warehouse')],['warehouse_config_manifest',Buffer.from('original config hash')]];
  const approved=documentHashes(documents);verifyDocumentHashes(documents,approved);
  const changed=documents.map(([key,bytes])=>[key,key.startsWith('warehouse_')?Buffer.from('changed consistently'):bytes]);
  assert.throws(()=>verifyDocumentHashes(changed,approved),/INPUT_DOCUMENT_CHANGED/);
});
test('fresh snapshots include raw rows, native DDL and every native metadata field',()=>{
  const state={identity:{database:'example'},relations:[{schema:'public',name:'ventas'}],tables:{'public.ventas':{rows:['{"id":"1"}']}},sequenceStates:{seq:{last_value:'7'}},databaseGrants:[{privilege_type:'CONNECT'}],largeObjectData:[]};
  const capture={state,schema:'CREATE TABLE exact_original;',columns:[{name:'id'}]},snapshot=toSnapshot('target',capture);
  assert.equal(snapshot.metadata.nativeSchemaSql,capture.schema);assert.deepEqual(snapshot.tables['public.ventas'],state.tables['public.ventas'].rows);
  for(const key of Object.keys(state).filter(k=>k!=='tables'))assert.deepEqual(snapshot.metadata.nativeMetadata[key],state[key]);
});
for(const serverCommitted of [true,false])test(`ambiguous COMMIT (${serverCommitted?'persisted':'not persisted'}) is not retried; status uses durable marker`,async()=>{
  const queries=[],batchId=randomUUID(),planHash='a'.repeat(64);
  await assert.rejects(()=>commitOnce({query:async sql=>{queries.push(sql);throw new Error('connection lost');}}),error=>{
    assert.deepEqual(error.commitState,{committed:false,commitAttempted:true,commitOutcome:'unknown'});return true;
  });assert.deepEqual(queries,['COMMIT']);
  const reads=[];const client={query:async sql=>{reads.push(sql);if(sql.includes('pg_try_advisory_lock'))return{rows:[{acquired:true}]};
    if(sql.includes('to_regclass'))return{rows:[{present:serverCommitted}]};return{rows:[{batch_id:batchId,plan_sha256:planHash}]};}};
  const result=await probeBatch(client,{batchId,planHash});assert.equal(result.outcome,serverCommitted?'committed':'not_committed');assert.equal(result.retryAllowed,false);
  assert.ok(reads.every(sql=>sql.startsWith('SELECT')));
});
test('status stays unknown while prior transaction holds migration lock',async()=>{
  let queries=0;const result=await probeBatch({query:async()=>{queries++;return{rows:[{acquired:false}]};}},{batchId:'unused',planHash:'unused'});
  assert.equal(result.outcome,'still_in_progress_or_unknown');assert.equal(result.retryAllowed,false);assert.equal(queries,1);
});
test('durable marker of another batch fails closed',async()=>{
  const client={query:async sql=>({rows:sql.includes('pg_try')?[{acquired:true}]:sql.includes('to_regclass')?[{present:true}]:[{batch_id:'other',plan_sha256:'other'}]})};
  await assert.rejects(()=>probeBatch(client,{batchId:'requested',planHash:'requested'}),/DIFFERENT_MIGRATION_BATCH_PRESENT/);
});
test('successful commit is issued exactly once',async()=>{
  const queries=[];const result=await commitOnce({query:async sql=>{queries.push(sql);}});assert.equal(result.committed,true);assert.deepEqual(queries,['COMMIT']);
});
test('verified authentic JSON supplements retain every byte and immutable archive contract',async()=>{
  const supplement=await readSupplement(path.join(privateRoot,'puntodeventa-running-source','supplement-manifest.json'));
  assert.equal(supplement.entries.length,7);const rows=[];
  const client={query:async(sql,values)=>{
    if(sql.startsWith('INSERT')){const[name,content,sha256,bytes,source]=values;rows.push({name,content,sha256,bytes:String(bytes),source});}
    return{rows:sql.startsWith('SELECT')?rows:[]};
  }};await storeSupplement(client,supplement);assert.deepEqual(await verifySupplement(client,supplement),{files:7,allBytesExact:true});
  rows[0].content=Buffer.concat([rows[0].content,Buffer.from(' ')]);await assert.rejects(()=>verifySupplement(client,supplement),/SUPPLEMENT_BYTES_CHANGED/);
});
test('corrupt native backup cannot pass restoration proof',async()=>{
  const directory=path.join(privateRoot,'production-backup-test-'+randomUUID());await fs.mkdir(directory);
  const files=['backup-manifest.json','restoration-verification.json','published.dump'];
  try{
    await fs.writeFile(path.join(directory,files[0]),JSON.stringify({createdAt:new Date().toISOString(),dump:{file:files[2],sha256:'a'.repeat(64)},schema:{},rowSnapshot:{}}));
    await fs.writeFile(path.join(directory,files[1]),JSON.stringify(Object.fromEntries([...['verified','fullNativeArchive','rowsIdentical','schemaEquivalent','ownersAndAclIdentical','sequencesIdentical','largeObjectsIdentical'].map(key=>[key,true]),['backupSha256','a'.repeat(64)]])));
    await fs.writeFile(path.join(directory,files[2]),'corrupt');await assert.rejects(()=>readBackup(directory),/BACKUP_FILE_HASH_MISMATCH/);
  }finally{for(const file of files)await fs.unlink(path.join(directory,file)).catch(()=>{});await fs.rmdir(directory);}
});
