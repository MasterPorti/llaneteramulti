/** Reviewed production cutover, deliberately separate from the temporary-only rehearsal.
 * prepare --request <private request.json>  (read-only connections)
 * apply|status --plan <plan.json> --approved-plan-sha256 <reviewed SHA256>
 * activate --plan ... --approved-plan-sha256 ... --deployment-proof <reviewed JSON> --app-env <restricted env>
 * No automatic retries, role creation, source DML, synthetic production sales, or automatic activation.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { sha256, qi } from './snapshot.mjs';
import { readVerifiedInputs,storeArchive,verifyArchive,validateBusinessState } from './published-merge-rehearsal.mjs';
import { extensionsSql,insertMappedTable,compareMappedTable,verifyPublishedUnchanged,freezeArchive } from './published-merge-model.mjs';
import { installRuntime,verifyRuntime,validateExistingRuntimeRole,applicationNameForArtifact,installWriteGate,verifyWriteGate } from './published-runtime.mjs';
import { privateRoot,privatePath,json,save,assertFresh,assertIdentity,codeHashes,environment,connect,identity,readBackup,
  captureAndCompare,writeSnapshots,lockStateTables,assertNoOtherClients,readSupplement,storeSupplement,verifySupplement,
  commitOnce,assertBatchAbsent,probeBatch,documentHashes,verifyDocumentHashes,lockKey } from './published-production-support.mjs';

async function cutoverEvidence(file){
  const bytes=await fs.readFile(privatePath(file)),evidence=JSON.parse(bytes);assertFresh(evidence.checkedAt);
  for(const flag of ['reviewed','sourceWritersStopped','destinationWritersStopped'])assert.equal(evidence[flag],true,'WRITER_STOP_EVIDENCE_REQUIRED');
  assert.ok(evidence.source&&evidence.destination,'WRITER_STOP_IDENTITIES_REQUIRED');
  return{sha256:sha256(bytes),evidence};
}
async function artifact(file){const bytes=await fs.readFile(privatePath(file));assert.ok(bytes.length>0,'APPLICATION_ARTIFACT_REQUIRED');return sha256(bytes);}
async function begin(client,readOnly=false){await client.query(`BEGIN ISOLATION LEVEL ${readOnly?'REPEATABLE READ READ ONLY':'READ COMMITTED'}`);await client.query("SET LOCAL lock_timeout='20s'");}
async function close(client){if(client)await client.end().catch(()=>{});}

export async function prepareProduction(requestFile){
  const request=await json(privatePath(requestFile));
  const sourceConnection=await environment(request.sourceEnvFile,'llaneteramulti_new_tires');
  const destinationConnection=await environment(request.destinationEnvFile,'postgres');
  const sourceBackup=await readBackup(request.sourceBackupDirectory),destinationBackup=await readBackup(request.destinationBackupDirectory);
  const supplement=await readSupplement(request.supplementalManifestFile),applicationSha256=await artifact(request.applicationArtifactFile);
  const stop=await cutoverEvidence(request.cutoverEvidenceFile);
  assert.equal(request.appRole,'admmin','CONFIRMED_EXISTING_APPLICATION_ROLE_REQUIRED');
  const batchId=randomUUID(),directory=privatePath(path.join(privateRoot,'published-production-'+batchId));await fs.mkdir(directory,{recursive:false});
  let source,destination;
  try{
    source=await connect(sourceConnection,true);destination=await connect(destinationConnection,true);
    await begin(source,true);await begin(destination,true);
    const sourceIdentity=await identity(source,sourceConnection),destinationIdentity=await identity(destination,destinationConnection);
    assertIdentity(sourceIdentity,stop.evidence.source);assertIdentity(destinationIdentity,stop.evidence.destination);
    assert.notEqual(sourceIdentity.cluster_identifier+sourceIdentity.oid,destinationIdentity.cluster_identifier+destinationIdentity.oid,'SOURCE_AND_DESTINATION_ARE_IDENTICAL');
    await assertNoOtherClients(source);await assertNoOtherClients(destination);
    await validateExistingRuntimeRole(destination,request.appRole);
    assertBatchAbsent((await destination.query("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='migration_new_tires') AS present")).rows[0].present);
    const sourceCapture=await captureAndCompare(source,sourceConnection,sourceBackup),destinationCapture=await captureAndCompare(destination,destinationConnection,destinationBackup);
    await writeSnapshots(directory,sourceCapture,destinationCapture);
    const snapshotFile=path.join(directory,'target-snapshot.json'),manifestFile=path.join(directory,'manifest.json');
    const input=await readVerifiedInputs(snapshotFile,manifestFile);
    const plan={format:2,batchId,createdAt:new Date().toISOString(),sourceEnvFile:sourceConnection.envFile,destinationEnvFile:destinationConnection.envFile,
      sourceIdentity,destinationIdentity,sourceBackupDirectory:sourceBackup.directory,destinationBackupDirectory:destinationBackup.directory,
      sourceBackupFingerprints:sourceBackup.fingerprints,destinationBackupFingerprints:destinationBackup.fingerprints,
      snapshotFile,manifestFile,snapshotManifestSha256:sha256(await fs.readFile(manifestFile)),
      sourceSnapshotSha256:input.targetEntry.sha256,publishedSnapshotSha256:input.publishedEntry.sha256,
      inputDocumentHashes:documentHashes(input.documents),
      supplementalManifestFile:supplement.manifestFile,supplementalManifestSha256:supplement.sha256,
      applicationArtifactFile:privatePath(request.applicationArtifactFile),applicationSha256,appRole:request.appRole,
      rolePolicy:'reuse-existing-owner-with-version-gate',applicationName:applicationNameForArtifact(applicationSha256),
      cutoverEvidenceFile:privatePath(request.cutoverEvidenceFile),cutoverEvidenceSha256:stop.sha256,codeHashes:await codeHashes(),
      sourceMustRemainStopped:true,destinationStartsBlocked:true,sourceDataWillNotBeModified:true};
    await save(path.join(directory,'plan.json'),plan);await source.query('ROLLBACK');await destination.query('ROLLBACK');
    return{prepared:true,batchId,planFile:path.join(directory,'plan.json'),planSha256:sha256(await fs.readFile(path.join(directory,'plan.json'))),
      sourceIdentity,destinationIdentity,expiresInMinutes:60,productionWritesPerformed:false,applicationSha256};
  }finally{await close(source);await close(destination);}
}

export async function readPlan(planFile,approvedHash,{fresh=true}={}){
  const bytes=await fs.readFile(privatePath(planFile));assert.match(approvedHash??'',/^[a-f0-9]{64}$/,'EXPLICIT_REVIEWED_PLAN_HASH_REQUIRED');
  assert.equal(sha256(bytes),approvedHash,'APPROVED_PLAN_HASH_MISMATCH');const plan=JSON.parse(bytes);assert.equal(plan.format,2,'UNKNOWN_PLAN_FORMAT');
  assert.equal(plan.appRole,'admmin','CONFIRMED_EXISTING_APPLICATION_ROLE_REQUIRED');assert.equal(plan.rolePolicy,'reuse-existing-owner-with-version-gate');
  assert.equal(plan.applicationName,applicationNameForArtifact(plan.applicationSha256),'APPLICATION_VERSION_MARKER_MISMATCH');
  assert.equal(plan.sourceDataWillNotBeModified,true);assert.equal(plan.destinationStartsBlocked,true);assert.equal(plan.sourceMustRemainStopped,true);
  if(fresh)assertFresh(plan.createdAt);assert.deepEqual(await codeHashes(),plan.codeHashes,'MIGRATION_CODE_CHANGED_REPREPARE_PACKAGE');
  assert.equal(await artifact(plan.applicationArtifactFile),plan.applicationSha256,'APPLICATION_ARTIFACT_CHANGED');
  assert.equal(sha256(await fs.readFile(privatePath(plan.manifestFile))),plan.snapshotManifestSha256,'SNAPSHOT_MANIFEST_CHANGED');
  const input=await readVerifiedInputs(plan.snapshotFile,plan.manifestFile);
  verifyDocumentHashes(input.documents,plan.inputDocumentHashes);
  assert.equal(input.targetEntry.sha256,plan.sourceSnapshotSha256);assert.equal(input.publishedEntry.sha256,plan.publishedSnapshotSha256);
  const supplement=await readSupplement(plan.supplementalManifestFile);assert.equal(supplement.sha256,plan.supplementalManifestSha256,'SUPPLEMENT_MANIFEST_CHANGED');
  const sourceBackup=await readBackup(plan.sourceBackupDirectory,{fresh}),destinationBackup=await readBackup(plan.destinationBackupDirectory,{fresh});
  assert.deepEqual(sourceBackup.fingerprints,plan.sourceBackupFingerprints,'SOURCE_BACKUP_CHANGED');assert.deepEqual(destinationBackup.fingerprints,plan.destinationBackupFingerprints,'DESTINATION_BACKUP_CHANGED');
  if(fresh){const stop=await cutoverEvidence(plan.cutoverEvidenceFile);assert.equal(stop.sha256,plan.cutoverEvidenceSha256,'STOP_EVIDENCE_CHANGED');assertIdentity(stop.evidence.source,plan.sourceIdentity);assertIdentity(stop.evidence.destination,plan.destinationIdentity);}
  return{plan,planHash:approvedHash,directory:path.dirname(path.resolve(planFile)),input,supplement,sourceBackup,destinationBackup};
}

async function verifyApplied(client,context,{allowActive=false}={}){
  const{plan,planHash,input,supplement}=context;
  const marker=(await client.query('SELECT batch_id::text,plan_sha256,application_sha256 FROM migration_new_tires.production_manifest')).rows;
  assert.deepEqual(marker,[{batch_id:plan.batchId,plan_sha256:planHash,application_sha256:plan.applicationSha256}],'DURABLE_PRODUCTION_MARKER_MISMATCH');
  const originalPlan=(await client.query('SELECT plan_document FROM migration_new_tires.production_manifest')).rows[0].plan_document;
  assert.equal(sha256(originalPlan),planHash,'ORIGINAL_APPROVED_PLAN_CHANGED');
  const batch=(await client.query('SELECT id::text,source_snapshot_sha256,published_snapshot_sha256 FROM migration_new_tires.batch')).rows;
  assert.deepEqual(batch,[{id:plan.batchId,source_snapshot_sha256:plan.sourceSnapshotSha256,published_snapshot_sha256:plan.publishedSnapshotSha256}],'MIGRATION_BATCH_MISMATCH');
  await verifyArchive(client,input);const supplemental=await verifySupplement(client,supplement),runtime=await verifyRuntime(client);
  const actualStatus=(await client.query('SELECT status FROM migration_new_tires.operation_state WHERE singleton')).rows[0]?.status;
  assert.ok(actualStatus==='blocked'||(allowActive&&actualStatus==='active'),'APPLICATION_WRITER_STATUS_INVALID');
  const gate=await verifyWriteGate(client,{appRole:plan.appRole,applicationSha256:plan.applicationSha256,expectedStatus:actualStatus});
  const frozen=(await client.query(`SELECT count(*)::integer AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='migration_new_tires' AND t.tgname IN ('reject_archive_row_changes','reject_archive_truncate') AND t.tgenabled='O'`)).rows[0].n;
  assert.equal(frozen,18,'IMMUTABLE_ARCHIVE_GUARDS_MISSING');
  const historicalGuards=(await client.query("SELECT count(*)::integer AS n FROM pg_trigger WHERE tgname IN ('protect_new_tires_sales','protect_new_tires_items','protect_new_tires_sales_truncate','protect_new_tires_items_truncate') AND tgenabled='O'")).rows[0].n;
  assert.equal(historicalGuards,4,'HISTORICAL_GUARDS_MISSING');
  let business,published;
  if(actualStatus==='blocked'){
    for(const table of ['bodegas','llantas','ventas','venta_items','movimientos_bodega'])await compareMappedTable(client,table);
    business=await validateBusinessState(client);published=await verifyPublishedUnchanged(client,input.published);
  }
  return{batchId:plan.batchId,archivesExact:true,supplemental,runtime,gate,immutableArchiveGuards:frozen,historicalGuards,business,published};
}

export async function applyProduction(planFile,approvedHash){
  const context=await readPlan(planFile,approvedHash),{plan,directory,input,supplement,sourceBackup,destinationBackup}=context;
  const attemptId=randomUUID(),attemptDir=path.join(directory,'apply-'+attemptId);await fs.mkdir(attemptDir,{recursive:false});
  const sourceConnection=await environment(plan.sourceEnvFile,'llaneteramulti_new_tires'),destinationConnection=await environment(plan.destinationEnvFile,'postgres');
  let source,destination,commitAttempted=false,committed=false,stage='connect';
  try{
    source=await connect(sourceConnection,false);destination=await connect(destinationConnection,false);
    assertIdentity(await identity(source,sourceConnection),plan.sourceIdentity);assertIdentity(await identity(destination,destinationConnection),plan.destinationIdentity);
    stage='lock_and_verify_fresh_data';await begin(source);await begin(destination);
    await destination.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[lockKey]);
    await assertNoOtherClients(source);await assertNoOtherClients(destination);
    await validateExistingRuntimeRole(destination,plan.appRole);
    assertBatchAbsent((await destination.query("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='migration_new_tires') AS present")).rows[0].present);
    await lockStateTables(source,sourceBackup.state);await lockStateTables(destination,destinationBackup.state);
    await captureAndCompare(source,sourceConnection,sourceBackup);await captureAndCompare(destination,destinationConnection,destinationBackup);
    // The package matches fresh restored backups and all live tables are locked before any DDL/DML.
    stage='archive_and_append';await destination.query(extensionsSql);await storeArchive(destination,input,plan.batchId);await storeSupplement(destination,supplement);
    await destination.query(`CREATE TABLE migration_new_tires.production_manifest(batch_id uuid PRIMARY KEY,plan_sha256 text NOT NULL,
      application_sha256 text NOT NULL,plan_document bytea NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
    await destination.query('INSERT INTO migration_new_tires.production_manifest(batch_id,plan_sha256,application_sha256,plan_document) VALUES($1,$2,$3,$4)',
      [plan.batchId,approvedHash,plan.applicationSha256,await fs.readFile(planFile)]);
    const inserted={};for(const table of ['bodegas','llantas','ventas','venta_items','movimientos_bodega'])inserted[table]=await insertMappedTable(destination,table);
    assert.deepEqual(inserted,{bodegas:8,llantas:134,ventas:465,venta_items:599,movimientos_bodega:489},'MIGRATION_ROW_COUNTS_MISMATCH');
    await destination.query(`INSERT INTO migration_new_tires.context_tires(id,original_row)
      SELECT row_data->>'id',row_data FROM migration_new_tires.source_rows WHERE dataset='new_tires' AND source_table='migration_context.llantas';
      INSERT INTO migration_new_tires.imported_sales(sale_id,source_batch_id)
      SELECT row_data->>'sale_id',row_data->>'batch_id' FROM migration_new_tires.source_rows WHERE dataset='new_tires' AND source_table='public.migration_imported_sales';
      INSERT INTO migration_new_tires.item_context(venta_item_id,sale_id,item_order,context_tire_id)
      SELECT i.id,i.venta_id,i.orden,c.id FROM public.venta_items i JOIN migration_new_tires.context_tires c ON c.id=i.llanta_id WHERE i.original_item IS NOT NULL;`);
    stage='install_runtime_guards_and_block_old_writers';await installRuntime(destination);
    await freezeArchive(destination,['runtime_setup','supplemental_files','production_manifest']);
    await installWriteGate(destination,{appRole:plan.appRole,applicationSha256:plan.applicationSha256});
    const role=await validateExistingRuntimeRole(destination,plan.appRole);
    stage='verify_before_commit';const verified=await verifyApplied(destination,context);
    const sequence=(await destination.query('SELECT last_value::text,is_called FROM public.venta_items_id_seq')).rows[0];
    const max=(await destination.query('SELECT max(id)::text AS id FROM public.venta_items')).rows[0].id;
    assert.ok(sequence.is_called&&BigInt(sequence.last_value)>=BigInt(max),'ITEM_SEQUENCE_BEHIND');
    // This final source re-read proves that no source row or metadata changed while preparing the target.
    await captureAndCompare(source,sourceConnection,sourceBackup);await assertNoOtherClients(source);await assertNoOtherClients(destination);
    await save(path.join(attemptDir,'verified-before-commit.json'),{verifiedAt:new Date().toISOString(),planHash:approvedHash,inserted,role,sequence,verified});
    stage='commit';commitAttempted=true;await commitOnce(destination);committed=true;
    stage='verify_after_commit';await begin(destination,true);const postCommit=await verifyApplied(destination,context);await destination.query('ROLLBACK');
    await source.query('ROLLBACK');
    const report={committed:true,postCommitVerified:true,batchId:plan.batchId,planHash:approvedHash,attemptDir,
      sourceUnchanged:true,sourceMustRemainStopped:true,destinationWriteStatus:'blocked',applicationActivated:false,inserted,postCommit};
    await save(path.join(attemptDir,'complete.json'),report);return report;
  }catch(error){
    if(!commitAttempted&&destination)await destination.query('ROLLBACK').catch(()=>{});
    if(source)await source.query('ROLLBACK').catch(()=>{});
    const failure={stage,commitAttempted,committed,commitOutcome:committed?'confirmed':commitAttempted?'unknown':'not_committed',
      batchId:plan.batchId,attemptDir,code:String(error.message).match(/[A-Z][A-Z_]{5,}/)?.[0]??error.code??error.name,
      retryAutomatically:false,nextAction:commitAttempted?'Run status with this exact plan; do not apply again.':'Inspect failure and prepare a fresh reviewed package before any retry.'};
    await save(path.join(attemptDir,'failure.json'),failure).catch(()=>{});error.safeFailure=failure;throw error;
  }finally{await close(source);await close(destination);}
}

export async function productionStatus(planFile,approvedHash){
  const context=await readPlan(planFile,approvedHash,{fresh:false}),{plan}=context;
  const connection=await environment(plan.destinationEnvFile,'postgres'),client=await connect(connection,true);
  try{
    assertIdentity(await identity(client,connection),plan.destinationIdentity);
    const status=await probeBatch(client,{batchId:plan.batchId,planHash:approvedHash});
    if(status.outcome!=='committed')return{batchId:plan.batchId,...status,requiredAction:status.outcome==='not_committed'?'Prepare a fresh package; a rolled back attempt may have advanced item sequence values.':'Wait for the prior attempt; do not retry apply.'};
    await begin(client,true);
    const verified=await verifyApplied(client,context,{allowActive:true});await client.query('ROLLBACK');
    return{batchId:plan.batchId,outcome:'committed',retryAllowed:false,verified};
  }finally{await close(client);}
}

export async function activateProduction(planFile,approvedHash,deploymentProofFile,appEnvFile){
  const context=await readPlan(planFile,approvedHash,{fresh:false}),{plan,directory}=context;
  const proof=await json(privatePath(deploymentProofFile));assertFresh(proof.checkedAt);
  for(const flag of ['reviewed','oldWritersStopped','newApplicationReadOnlyChecksPassed','deployedArtifactVerified','deployedEnvironmentVerified'])assert.equal(proof[flag],true,'DEPLOYMENT_VERIFICATION_REQUIRED');
  assert.equal(proof.batchId,plan.batchId);assert.equal(proof.planSha256,approvedHash);assert.equal(proof.applicationSha256,plan.applicationSha256);assert.equal(proof.applicationName,plan.applicationName);assert.equal(proof.appRole,plan.appRole);assertIdentity(proof.databaseIdentity,plan.destinationIdentity);
  const appConnection=await environment(appEnvFile,'postgres');assert.equal(decodeURIComponent(appConnection.url.username),plan.appRole,'WRONG_APPLICATION_LOGIN');
  assert.equal(appConnection.endpoint.host,plan.destinationIdentity.host);assert.equal(appConnection.endpoint.port,plan.destinationIdentity.port);
  assert.equal(appConnection.env.LLANTERA_APPLICATION_ID,plan.applicationName,'DEPLOYED_APPLICATION_MARKER_MISMATCH');
  let app,client,commitAttempted=false,committed=false;
  try{
    app=await connect(appConnection,true,{applicationName:appConnection.env.LLANTERA_APPLICATION_ID});await begin(app,true);
    const actual=(await app.query(`SELECT session_user AS role,current_database() AS database,d.oid::text AS oid,current_setting('application_name') AS application_name FROM pg_database d WHERE datname=current_database()`)).rows[0];
    assert.deepEqual(actual,{role:plan.appRole,database:'postgres',oid:plan.destinationIdentity.oid,application_name:plan.applicationName},'APPLICATION_CONNECTION_IDENTITY_MISMATCH');
    await app.query('SELECT id FROM public.ventas LIMIT 1');await app.query('SELECT name FROM migration_new_tires.supplemental_files LIMIT 1');await app.query('ROLLBACK');await close(app);app=null;
    const connection=await environment(plan.destinationEnvFile,'postgres');client=await connect(connection,false);assertIdentity(await identity(client,connection),plan.destinationIdentity);
    await begin(client);await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[lockKey]);
    const verified=await verifyApplied(client,context);assert.equal(verified.gate.status,'blocked','ALREADY_ACTIVE');
    await client.query("UPDATE migration_new_tires.operation_state SET status='active',activated_at=clock_timestamp() WHERE singleton AND status='blocked'");
    await verifyWriteGate(client,{appRole:plan.appRole,applicationSha256:plan.applicationSha256,expectedStatus:'active'});
    commitAttempted=true;await commitOnce(client);committed=true;
    await begin(client,true);const gate=await verifyWriteGate(client,{appRole:plan.appRole,applicationSha256:plan.applicationSha256,expectedStatus:'active'});await client.query('ROLLBACK');
    const report={activated:true,batchId:plan.batchId,verifiedAt:new Date().toISOString(),gate};await save(path.join(directory,'activation-'+randomUUID()+'.json'),report);return report;
  }catch(error){if(client&&!commitAttempted)await client.query('ROLLBACK').catch(()=>{});error.safeFailure={phase:'activation',commitAttempted,committed,commitOutcome:committed?'confirmed':commitAttempted?'unknown':'not_committed',retryAutomatically:false};throw error;}
  finally{await close(app);await close(client);}
}

async function main(){
  const[mode,...args]=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){assert.ok(['--request','--plan','--approved-plan-sha256','--deployment-proof','--app-env'].includes(args[i])&&args[i+1],'EXPECTED_NAMED_ARGUMENTS');assert.ok(!options[args[i]],'DUPLICATE_ARGUMENT');options[args[i]]=args[i+1];}
  let report;if(mode==='prepare')report=await prepareProduction(options['--request']);
  else if(mode==='apply')report=await applyProduction(options['--plan'],options['--approved-plan-sha256']);
  else if(mode==='status')report=await productionStatus(options['--plan'],options['--approved-plan-sha256']);
  else if(mode==='activate')report=await activateProduction(options['--plan'],options['--approved-plan-sha256'],options['--deployment-proof'],options['--app-env']);
  else throw new Error('EXPECTED_PREPARE_APPLY_STATUS_OR_ACTIVATE');console.log(JSON.stringify(report,null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({failure:error.safeFailure??{code:String(error.message).match(/[A-Z][A-Z_]{5,}/)?.[0]??error.code??error.name}}));process.exitCode=1;});
