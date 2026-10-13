import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateCaptureConnection,validateCaptureOutput,observeClients,stateEvidence,nativeEnvironment,nativeDump } from './capture.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const local={host:'127.0.0.1',port:55439,database:'llantas_source_negra',user:'test',password:'synthetic',ssl:false};
test('capture only permits explicitly scoped local clones or the pinned production source endpoints',()=>{
  assert.equal(validateCaptureConnection(local,'negra','local-test'),local);
  assert.throws(()=>validateCaptureConnection({...local,database:'llantas_unified_dev'},'negra','local-test'),/SOURCE_CLONE/);
  assert.throws(()=>validateCaptureConnection({...local,host:'72.62.83.230',port:7453,database:'postgres'},'negra','local-test'),/SOURCE_CLONE/);
  assert.throws(()=>validateCaptureConnection({...local,options:'unreviewed'},'negra','local-test'),/CONNECTION_OPTION/);
  assert.throws(()=>validateCaptureConnection(local,'negra','production'),/ENDPOINT/);
  assert.throws(()=>validateCaptureConnection({...local,ssl:{rejectUnauthorized:false}},'negra','local-test'),/TLS/);
});
test('capture refuses writing its data-bearing artifacts outside the ignored backup directory',()=>{
  assert.throws(()=>validateCaptureOutput(root),/PRIVATE_OUTPUT/);
  assert.throws(()=>validateCaptureOutput(`${root}/.migration-backups/../public`),/PRIVATE_OUTPUT/);
  assert.ok(validateCaptureOutput(`${root}/.migration-backups/fresh-test`).endsWith('fresh-test'));
});
test('capture refuses other clients or prepared transactions instead of calling them stopped',async()=>{
  for(const counts of [[1,0],[0,1]]) {
    let index=0;await assert.rejects(observeClients({query:async()=>({rows:[{count:counts[index++]}]})}),/STOPPED|PREPARED/);
  }
  const evidence=await observeClients({query:async()=>({rows:[{count:0}]})});
  assert.equal(evidence.otherClientBackends,0);assert.equal(evidence.preparedTransactions,0);
});
test('full state evidence hashes actual LO pages and sequence states',()=>{
  const before={tables:{'public.example':{count:1,sha256:'recorded'}},sequenceStates:{seq:{last_value:'2',is_called:true}},largeObjects:[{oid:'100',owner:'test',acl:null}],largeObjectData:[{loid:'100',pageno:0,data:'00ff01'}],identity:{},relations:[],schemaObjects:[],databaseGrants:[],roleDependencies:[],databaseSettings:[]};
  const evidence=stateEvidence(before);assert.equal(evidence.largeObjects.bytes,3);assert.equal(evidence.largeObjects.count,1);
  assert.notEqual(evidence.largeObjects.dataSha256,stateEvidence({...before,largeObjectData:[{loid:'100',pageno:0,data:'00ff02'}]}).largeObjects.dataSha256);
  assert.notEqual(evidence.sequenceStatesSha256,stateEvidence({...before,sequenceStates:{seq:{last_value:'2',is_called:false}}}).sequenceStatesSha256);
});
test('native dump uses read-only settings and never silently downgrades TLS verification',()=>{
  const env=nativeEnvironment(local);assert.equal(env.PGSSLMODE,'disable');assert.match(env.PGOPTIONS,/default_transaction_read_only=on/);
  assert.equal(nativeEnvironment({...local,ssl:true}).PGSSLMODE,'verify-full');
});
test('native dump rejects malformed snapshot identifiers before executing a tool',async()=>{
  await assert.rejects(nativeDump('missing-tool',local,'snapshot; invalid','unused'),/EXPORTED_SNAPSHOT/);
});
