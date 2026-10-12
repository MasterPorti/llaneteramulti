/** Merge rehearsal for a verified restored database only. No production mode.
 * node scripts/migration/published-merge-rehearsal.mjs --env <restore.env>
 *   [--snapshot <target-snapshot.json>] [--manifest <manifest.json>]
 * The temporary database is deliberately retained for application verification.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';
import ts from 'typescript';
import { qi, rowsHash, sha256 } from './snapshot.mjs';
import { temporaryDatabasePattern, extensionsSql, insertMappedTable, compareMappedTable,
  readOriginalColumns, verifyPublishedUnchanged, freezeArchive } from './published-merge-model.mjs';

const root = fileURLToPath(new URL('../../',import.meta.url));
const privateRoot = path.join(root,'.migration-backups');
const auditRoot = path.join(privateRoot,'auditoria-tres-bases-2026-10-12T01-47-51.726Z-eb23eaac');
const initialMigrationRoot=path.join(privateRoot,'new-tires-2026-10-11T23-21-25.623Z-cc8f344f');

function privatePath(input) {
  const result=path.resolve(input);
  assert.ok(result.startsWith(path.resolve(privateRoot)+path.sep),'PRIVATE_PROJECT_PATH_REQUIRED');
  return result;
}

export async function readVerifiedInputs(snapshotFile,manifestFile) {
  const snapshotPath=privatePath(snapshotFile), manifestPath=privatePath(manifestFile);
  const manifestBytes=await fs.readFile(manifestPath);
  const manifest=JSON.parse(manifestBytes);
  const targetEntry=manifest.snapshots.find(s=>s.label==='target');
  const publishedEntry=manifest.snapshots.find(s=>s.label==='published');
  assert.ok(targetEntry&&publishedEntry,'BOTH_SNAPSHOT_MANIFESTS_REQUIRED');
  assert.equal(path.basename(snapshotPath),targetEntry.file,'WRONG_TARGET_SNAPSHOT_FILE');
  const sourceBytes=await fs.readFile(snapshotPath);
  const publishedBytes=await fs.readFile(privatePath(path.join(path.dirname(manifestPath),publishedEntry.file)));
  assert.equal(sha256(sourceBytes),targetEntry.sha256,'TARGET_SNAPSHOT_HASH_MISMATCH');
  assert.equal(sha256(publishedBytes),publishedEntry.sha256,'PUBLISHED_SNAPSHOT_HASH_MISMATCH');
  const source=JSON.parse(sourceBytes), published=JSON.parse(publishedBytes);
  assert.equal(source.label,'target'); assert.equal(published.label,'published');
  assert.equal(source.identity.database,'llaneteramulti_new_tires','UNEXPECTED_SOURCE_DATABASE');
  for(const [snapshot,entry] of [[source,targetEntry],[published,publishedEntry]]) {
    assert.deepEqual(Object.keys(snapshot.tables).sort(),Object.keys(entry.rowHashes).sort(),'TABLE_MANIFEST_MISMATCH');
    for(const [table,rows] of Object.entries(snapshot.tables)) assert.equal(rowsHash(rows),entry.rowHashes[table],`ROW_HASH_MISMATCH_${table}`);
  }
  const sourceCounts={'public.llantas':134,'public.ventas':465,'public.movimientos_bodega':489,
    'migration_context.llantas':2,'migration_control.sale_iva_adjustments':465,'public.migration_imported_sales':465};
  for(const [table,count] of Object.entries(sourceCounts)) assert.equal(source.tables[table]?.length,count,`SOURCE_COUNT_CHANGED_${table}`);
  for(const table of ['public.productos','public.servicios','public.producto_imagenes','public.ventas_productos']) {
    assert.equal(source.tables[table]?.length,0,`UNSUPPORTED_NONEMPTY_SOURCE_${table}`);
  }
  for(const [table,count] of Object.entries({'public.ventas':2,'public.venta_items':2,'public.servicios':16,'public.productos':1,'public.llantas':0,'public.movimientos_bodega':0,'public.bodegas':0})) {
    assert.equal(published.tables[table]?.length,count,`PUBLISHED_EXPECTATION_CHANGED_${table}`);
  }
  const items=source.tables['public.ventas'].flatMap(raw=>JSON.parse(raw).items);
  assert.equal(items.length,599,'SOURCE_ITEM_COUNT_CHANGED');
  assert.ok(items.every(item=>item.llantaId&&item.llantaSnapshot&&!item.tipo&&!item.productoId),'REVIEW_UNEXPECTED_ITEM_SHAPE');
  const sourceSales=source.tables['public.ventas'].map(JSON.parse);
  assert.equal(new Set(sourceSales.map(row=>row.id)).size,465,'DUPLICATE_SOURCE_ID');
  assert.equal(new Set(sourceSales.map(row=>row.folio)).size,465,'DUPLICATE_SOURCE_FOLIO');
  for(const table of ['ventas','llantas','movimientos_bodega']) {
    const originalIds=new Set(published.tables['public.'+table].map(raw=>JSON.parse(raw).id));
    assert.ok(source.tables['public.'+table].every(raw=>!originalIds.has(JSON.parse(raw).id)),`ID_COLLISION_${table}`);
  }
  const existingFolios=new Set(published.tables['public.ventas'].map(raw=>JSON.parse(raw).folio));
  assert.ok(sourceSales.every(s=>!existingFolios.has(s.folio)),'FOLIO_COLLISION');
  const configManifestBytes=await fs.readFile(path.join(initialMigrationRoot,'manifest.json'));
  const configManifest=JSON.parse(configManifestBytes);
  const configBytes=await fs.readFile(path.join(initialMigrationRoot,'source-files','lib','config-sistema.ts'));
  assert.equal(sha256(configBytes),configManifest.sourceFiles['lib/config-sistema.ts'],'WAREHOUSE_CONFIG_HASH_MISMATCH');
  const tree=ts.createSourceFile('config-sistema.ts',configBytes.toString('utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  let initializer;
  const visit=node=>{if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==='SISTEMA_BODEGAS'){
    assert.ok(!initializer,'DUPLICATE_WAREHOUSE_CONFIG');initializer=node.initializer;
  }ts.forEachChild(node,visit);};visit(tree);
  assert.ok(initializer&&ts.isArrayLiteralExpression(initializer),'STATIC_WAREHOUSE_ARRAY_REQUIRED');
  const warehouses=initializer.elements.map(node=>{
    assert.ok(ts.isObjectLiteralExpression(node),'STATIC_WAREHOUSE_OBJECT_REQUIRED');const row={};
    for(const prop of node.properties){
      assert.ok(ts.isPropertyAssignment(prop)&&ts.isIdentifier(prop.name)&&ts.isStringLiteral(prop.initializer),'STATIC_WAREHOUSE_STRING_REQUIRED');
      assert.ok(!Object.hasOwn(row,prop.name.text),'DUPLICATE_WAREHOUSE_FIELD');row[prop.name.text]=prop.initializer.text;
    }
    assert.deepEqual(Object.keys(row).sort(),['id','nombre','tipo','ubicacion']);return row;
  });
  assert.deepEqual(warehouses.map(w=>w.id),Array.from({length:8},(_,i)=>'bodega-'+(i+1)),'WAREHOUSE_IDS_CHANGED');
  const documents=[['new_tires',sourceBytes],['published_before',publishedBytes],['input_manifest',manifestBytes],
    ['warehouse_config',configBytes],['warehouse_config_manifest',configManifestBytes]];
  return {source,published,sourceBytes,publishedBytes,manifestBytes,targetEntry,publishedEntry,warehouses,documents};
}

export async function storeArchive(client,input,batchId) {
  for(const [label,bytes] of input.documents) {
    await client.query('INSERT INTO migration_new_tires.snapshots(label,sha256,document_text) VALUES($1,$2,$3)',[label,sha256(bytes),bytes.toString('utf8')]);
  }
  for(let index=0;index<input.warehouses.length;index++){
    const raw=JSON.stringify(input.warehouses[index]);
    await client.query(`INSERT INTO migration_new_tires.source_rows(dataset,source_table,row_ordinal,row_text,row_data,sha256)
      VALUES('warehouse_config','config.SISTEMA_BODEGAS',$1,$2::text,$2::text::jsonb,$3)`,[index+1,raw,sha256(Buffer.from(raw))]);
  }
  for(const [dataset,snapshot] of [['new_tires',input.source],['published_before',input.published]]) {
    for(const [table,rows] of Object.entries(snapshot.tables)) {
      const batch=rows.map((raw,index)=>({dataset,source_table:table,row_ordinal:index+1,row_text:raw,sha256:sha256(Buffer.from(raw))}));
      if(!batch.length)continue;
      await client.query(`INSERT INTO migration_new_tires.source_rows(dataset,source_table,row_ordinal,row_text,row_data,sha256)
        SELECT dataset,source_table,row_ordinal,row_text,row_text::jsonb,sha256 FROM jsonb_to_recordset($1::jsonb)
        AS x(dataset text,source_table text,row_ordinal integer,row_text text,sha256 text)`,[JSON.stringify(batch)]);
    }
  }
  await client.query('INSERT INTO migration_new_tires.batch(id,source_snapshot_sha256,published_snapshot_sha256,mapping_version) VALUES($1,$2,$3,1)',
    [batchId,input.targetEntry.sha256,input.publishedEntry.sha256]);
}

export async function verifyArchive(client,input) {
  for(const [dataset,snapshot] of [['new_tires',input.source],['published_before',input.published]]) {
    for(const [table,rows] of Object.entries(snapshot.tables)) {
      const archived=(await client.query(`SELECT row_text,sha256,row_data IS NOT DISTINCT FROM row_text::jsonb AS data_matches
        FROM migration_new_tires.source_rows WHERE dataset=$1 AND source_table=$2 ORDER BY row_ordinal`,[dataset,table])).rows;
      assert.deepEqual(archived.map(r=>r.row_text),rows,`RAW_ARCHIVE_MISMATCH_${dataset}_${table}`);
      assert.ok(archived.every(r=>r.data_matches&&r.sha256===sha256(Buffer.from(r.row_text))),'ARCHIVE_CHECKSUM_MISMATCH');
    }
  }
  for(const [label,bytes] of input.documents) {
    const archived=(await client.query('SELECT document_text,sha256 FROM migration_new_tires.snapshots WHERE label=$1',[label])).rows[0];
    assert.equal(archived.document_text,bytes.toString('utf8'),'SNAPSHOT_TEXT_CHANGED');
    assert.equal(archived.sha256,sha256(bytes),'SNAPSHOT_HASH_CHANGED');
  }
}

export async function validateBusinessState(client) {
  assert.equal((await client.query('SELECT count(*)::integer AS count FROM public.bodegas')).rows[0].count,8,'WAREHOUSE_CATALOG_MISSING');
  const totals=(await client.query(`SELECT count(*)::integer AS all_tires,count(*) FILTER(WHERE activo)::integer AS active_tires,
    sum(stock)::integer AS all_stock,sum(stock) FILTER(WHERE activo)::integer AS active_stock,
    sum(stock) FILTER(WHERE NOT activo)::integer AS inactive_stock FROM public.llantas`)).rows[0];
  assert.deepEqual(totals,{all_tires:134,active_tires:104,all_stock:614,active_stock:185,inactive_stock:429},'STOCK_OR_STATUS_CHANGED');
  const badStock=(await client.query(`SELECT count(*)::integer AS count FROM public.llantas
    WHERE stock IS DISTINCT FROM (SELECT sum(value::numeric)::integer FROM jsonb_each_text(stock_por_bodega))`)).rows[0].count;
  assert.equal(badStock,0,'WAREHOUSE_STOCK_TOTAL_MISMATCH');
  const stock=(await client.query(`SELECT s.key AS warehouse,sum(s.value::numeric)::integer AS quantity
    FROM public.llantas l CROSS JOIN LATERAL jsonb_each_text(l.stock_por_bodega) s WHERE activo GROUP BY s.key ORDER BY s.key`)).rows;
  assert.deepEqual(Object.fromEntries(stock.map(r=>[r.warehouse,r.quantity])),{'bodega-1':49,'bodega-2':86,'bodega-3':0,'bodega-4':0,'bodega-5':0,'bodega-6':50,'bodega-7':0,'bodega-8':0});
  const sales=(await client.query(`SELECT count(*)::integer AS sales,count(*) FILTER(WHERE cancelada)::integer AS cancelled,
    count(*) FILTER(WHERE iva_politica='incluido_16')::integer AS included_iva_sales,
    count(*) FILTER(WHERE iva_politica IS NULL AND iva=0)::integer AS preserved_zero_iva_sales FROM public.ventas`)).rows[0];
  assert.deepEqual(sales,{sales:467,cancelled:15,included_iva_sales:465,preserved_zero_iva_sales:2},'SALES_COUNTS_OR_TAX_POLICY_CHANGED');
  const itemState=(await client.query(`SELECT count(*)::integer AS items,
    count(*) FILTER(WHERE original_item IS NOT NULL)::integer AS migrated_items,
    count(*) FILTER(WHERE original_item IS NOT NULL AND codigo_auxiliar IS NOT NULL)::integer AS preserved_auxiliary_codes,
    count(*) FILTER(WHERE original_item IS NOT NULL AND costo_unitario IS NOT NULL AND costo_subtotal IS NOT NULL)::integer AS preserved_item_costs
    FROM public.venta_items`)).rows[0];
  assert.deepEqual(itemState,{items:601,migrated_items:599,preserved_auxiliary_codes:599,preserved_item_costs:96},'ITEM_FIELDS_LOST');
  const orphanItems=(await client.query(`SELECT count(*)::integer AS count FROM public.venta_items i
    LEFT JOIN public.ventas v ON v.id=i.venta_id
    LEFT JOIN public.llantas l ON l.id=i.llanta_id
    LEFT JOIN migration_new_tires.context_tires c ON c.id=i.llanta_id
    LEFT JOIN public.servicios s ON s.id=i.servicio_id
    WHERE v.id IS NULL OR (i.llanta_id IS NOT NULL AND l.id IS NULL AND c.id IS NULL)
      OR (i.servicio_id IS NOT NULL AND s.id IS NULL)`)).rows[0].count;
  assert.equal(orphanItems,0,'UNRESOLVED_ITEM_REFERENCE');
  const mixed=(await client.query('SELECT count(*)::integer AS items,count(DISTINCT sale_id)::integer AS sales FROM migration_new_tires.item_context')).rows[0];
  assert.deepEqual(mixed,{items:2,sales:2},'MIXED_SALE_CONTEXT_LOST');
  assert.equal((await client.query('SELECT count(*)::integer AS count FROM public.llantas l JOIN migration_new_tires.context_tires c USING(id)')).rows[0].count,0,'CONTEXT_BECAME_OPERATIONAL');
  const mismatch=(await client.query(`SELECT count(*)::integer AS count FROM public.ventas v
    WHERE subtotal+iva<>total OR total IS DISTINCT FROM (SELECT sum(subtotal) FROM public.venta_items i WHERE i.venta_id=v.id)`)).rows[0].count;
  assert.equal(mismatch,0,'SALE_TOTALS_DO_NOT_RECONCILE');
  const movementCount=(await client.query('SELECT count(*)::integer AS count FROM public.movimientos_bodega')).rows[0].count;
  assert.equal(movementCount,489,'MOVEMENTS_LOST');
  return {totals,warehouseStock:stock,sales,itemState,mixed,movementCount,orphanItems};
}

async function verifyProtections(client,input) {
  const historicalId=JSON.parse(input.source.tables['public.ventas'][0]).id;
  const publishedId=JSON.parse(input.published.tables['public.ventas'][0]).id;
  let checks=0;
  const rollbackTest=async(action)=>{
    await client.query('SAVEPOINT verify_protection');
    try{await action();checks++;}finally{await client.query('ROLLBACK TO SAVEPOINT verify_protection');await client.query('RELEASE SAVEPOINT verify_protection');}
  };
  await rollbackTest(async()=>{
    const before=(await client.query('SELECT cancelada FROM public.ventas WHERE id=$1',[publishedId])).rows[0];
    const updated=(await client.query('UPDATE public.ventas SET cancelada=NOT cancelada WHERE id=$1 RETURNING cancelada',[publishedId])).rows[0];
    assert.equal(updated.cancelada,!before.cancelada,'HISTORICAL_GUARD_BLOCKS_UNRELATED_SALES');
  });
  await rollbackTest(()=>assert.rejects(()=>client.query('UPDATE public.ventas SET total=total WHERE id=$1',[historicalId]),error=>error.code==='P0001'));
  await rollbackTest(()=>assert.rejects(()=>client.query('UPDATE public.venta_items SET subtotal=subtotal WHERE venta_id=$1',[historicalId]),error=>error.code==='P0001'));
  await rollbackTest(()=>assert.rejects(()=>client.query('DELETE FROM migration_new_tires.source_rows WHERE row_ordinal=1'),error=>error.code==='P0001'));
  await rollbackTest(()=>assert.rejects(()=>client.query(`INSERT INTO public.ventas(id,folio,cliente_nombre,subtotal,iva,total,metodo_pago,fecha_venta,iva_politica)
    VALUES('rehearsal-constraint','REHEARSAL-CHECK','Prueba temporal',116,0,116,'efectivo',now(),'incluido_16')`),error=>error.code==='23514'&&error.constraint==='new_tires_included_iva'));
  await rollbackTest(async()=>{
    await client.query(`INSERT INTO public.ventas(id,folio,cliente_nombre,subtotal,iva,total,metodo_pago,fecha_venta,iva_politica)
      VALUES('rehearsal-new-sale','REHEARSAL-NEW','Prueba temporal',100,16,116,'efectivo',now(),'incluido_16')`);
    const updated=(await client.query("UPDATE public.ventas SET cancelada=true WHERE id='rehearsal-new-sale' RETURNING cancelada")).rows[0];
    assert.equal(updated.cancelada,true,'GUARD_DISCARDS_NEW_SALE_UPDATE');
  });
  return {checks,allTestWritesRolledBack:true};
}

export async function runRehearsal({envFile,snapshotFile=path.join(auditRoot,'target-snapshot.json'),manifestFile=path.join(auditRoot,'manifest.json')}) {
  const input=await readVerifiedInputs(snapshotFile,manifestFile);
  const envPath=privatePath(envFile), env=dotenv.parse(await fs.readFile(envPath));
  assert.ok(env.DATABASE_URL,'TEMPORARY_DATABASE_URL_REQUIRED');
  const url=new URL(env.DATABASE_URL), expected=decodeURIComponent(url.pathname.slice(1));
  assert.match(expected,temporaryDatabasePattern,'ONLY_RESTORED_TEMPORARY_DATABASE_ALLOWED');
  if(env.LLANTERA_EXPECTED_DATABASE)assert.equal(env.LLANTERA_EXPECTED_DATABASE,expected,'EXPECTED_DATABASE_MISMATCH');
  assert.ok(!url.searchParams.has('database')&&!url.searchParams.has('dbname')&&!url.searchParams.has('options'),'AMBIGUOUS_DATABASE_URL');
  const registry=JSON.parse(await fs.readFile(path.join(path.dirname(envPath),'temporary-database.json')));
  const restoration=JSON.parse(await fs.readFile(path.join(path.dirname(envPath),'restoration-verification.json')));
  assert.equal(registry.database,expected,'TEMPORARY_REGISTRY_DATABASE_MISMATCH');
  assert.equal(registry.doNotUseForProduction,true,'TEMPORARY_REGISTRY_REQUIRED');
  assert.ok(/^\d+$/.test(registry.oid)&&registry.owner,'TEMPORARY_IDENTITY_REQUIRED');
  assert.equal(restoration.verified,true,'RESTORATION_NOT_VERIFIED');
  assert.equal(restoration.restoredDatabase,expected,'RESTORATION_DATABASE_MISMATCH');
  assert.deepEqual(restoration.temporaryIdentity,{oid:registry.oid,owner:registry.owner},'RESTORATION_IDENTITY_MISMATCH');
  assert.ok(restoration.fullNativeArchive&&restoration.rowsIdentical&&restoration.schemaEquivalent&&restoration.sequencesIdentical,'FULL_RESTORATION_PROOF_REQUIRED');
  const batchId=randomUUID(), reportDir=privatePath(path.join(path.dirname(envPath),'merge-rehearsal-'+batchId));
  await fs.mkdir(reportDir,{recursive:false});
  for(const [label,bytes]of input.documents) {
    const filename=label==='warehouse_config'?'warehouse-config.ts':label+'.json';
    const output=path.join(reportDir,filename);await fs.writeFile(output,bytes,{flag:'wx'});
    assert.equal(sha256(await fs.readFile(output)),sha256(bytes),'PRIVATE_BACKUP_COPY_FAILED');
  }
  const client=new pg.Client({connectionString:url.toString(),
    ssl:env.DB_REQUIRE_SSL==='true'?{rejectUnauthorized:env.DB_SSL_REJECT_UNAUTHORIZED!=='false'}:undefined,
    connectionTimeoutMillis:15000,statement_timeout:120000,
    options:'-c timezone=UTC',application_name:'llantera-published-merge-rehearsal-only'});
  let committed=false,commitAttempted=false,stage='connect',report;
  try {
    await client.connect();
    const identity=(await client.query(`SELECT current_database() AS name,d.oid::text AS oid,r.rolname AS owner,
      r.rolname=current_user AS owned FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname=current_database()`)).rows[0];
    assert.equal(identity.name,expected,'ACTUAL_DATABASE_MISMATCH'); assert.equal(identity.owned,true,'TEMPORARY_DATABASE_NOT_OWNED');
    assert.equal(identity.oid,registry.oid,'TEMPORARY_DATABASE_OID_CHANGED');assert.equal(identity.owner,registry.owner,'TEMPORARY_DATABASE_OWNER_CHANGED');
    assert.match(identity.name,temporaryDatabasePattern,'ACTUAL_DATABASE_NOT_TEMPORARY');
    stage='verify_restored_published_snapshot';
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query("SET LOCAL lock_timeout='15s'");
    await client.query('LOCK TABLE '+Object.keys(input.published.tables).sort().map(name=>'public.'+qi(name.slice(7))).join(',')+' IN ACCESS EXCLUSIVE MODE');
    assert.equal((await client.query("SELECT count(*)::integer AS count FROM pg_namespace WHERE nspname='migration_new_tires'")).rows[0].count,0,'REHEARSAL_ALREADY_APPLIED');
    for(const [name,original] of Object.entries(input.published.tables)) {
      const table=name.slice(7), columns=input.published.metadata.columns.filter(c=>c.schema==='public'&&c.table_name===table).map(c=>c.name);
      assert.equal(rowsHash(await readOriginalColumns(client,table,columns)),rowsHash(original),`RESTORED_PUBLISHED_ROWS_MISMATCH_${table}`);
    }
    const sequenceBefore=(await client.query('SELECT last_value::text,is_called FROM public.venta_items_id_seq')).rows[0];
    stage='add_preserving_columns_and_archive';
    await client.query(extensionsSql); await storeArchive(client,input,batchId);
    stage='insert_new_tires_and_sales';
    const inserted={};
    for(const table of ['bodegas','llantas','ventas','venta_items','movimientos_bodega'])inserted[table]=await insertMappedTable(client,table);
    assert.deepEqual(inserted,{bodegas:8,llantas:134,ventas:465,venta_items:599,movimientos_bodega:489},'INSERT_COUNTS_MISMATCH');
    await client.query(`INSERT INTO migration_new_tires.context_tires(id,original_row)
      SELECT row_data->>'id',row_data FROM migration_new_tires.source_rows WHERE dataset='new_tires' AND source_table='migration_context.llantas';
      INSERT INTO migration_new_tires.imported_sales(sale_id,source_batch_id)
      SELECT row_data->>'sale_id',row_data->>'batch_id' FROM migration_new_tires.source_rows WHERE dataset='new_tires' AND source_table='public.migration_imported_sales';
      INSERT INTO migration_new_tires.item_context(venta_item_id,sale_id,item_order,context_tire_id)
      SELECT i.id,i.venta_id,i.orden,c.id FROM public.venta_items i JOIN migration_new_tires.context_tires c ON c.id=i.llanta_id WHERE i.original_item IS NOT NULL;`);
    stage='verify_all_fields_archives_and_existing_rows';
    const mappings={};for(const table of Object.keys(inserted))mappings[table]=await compareMappedTable(client,table);
    await verifyArchive(client,input);
    const published=await verifyPublishedUnchanged(client,input.published);
    const business=await validateBusinessState(client);
    const sequenceAfter=(await client.query('SELECT last_value::text,is_called FROM public.venta_items_id_seq')).rows[0];
    const maximumId=(await client.query('SELECT max(id)::text AS id FROM public.venta_items')).rows[0].id;
    assert.ok(BigInt(sequenceAfter.last_value)>=BigInt(maximumId),'ITEM_SEQUENCE_BEHIND_DATA');
    assert.ok(BigInt(sequenceAfter.last_value)>=BigInt(sequenceBefore.last_value),'ITEM_SEQUENCE_REWOUND');
    stage='protect_archives_and_migrated_history';await freezeArchive(client);
    const protections=await verifyProtections(client,input);
    await verifyPublishedUnchanged(client,input.published);
    report={batchId,database:expected,rehearsalOnly:true,sourceOrPublishedDatabaseConnected:false,
      sourceSnapshotSha256:input.targetEntry.sha256,publishedSnapshotSha256:input.publishedEntry.sha256,
      inserted,mappings,published,business,sequenceBefore,sequenceAfter,protections,
      originalSnapshotsAndRowsArchivedExactly:true,preIvaRecordsAndContextRetained:true,
      existingPublishedIvaChanged:false,temporaryDatabaseRetained:true};
    report.receptionDateProjection="fecha_recepcion = timezone('America/Mexico_City',fecha_recepcion_original)::date; fecha_recepcion_original y el archivo conservan el instante completo";
    report.warehouseConfigSha256=sha256(input.documents.find(([label])=>label==='warehouse_config')[1]);
    await fs.writeFile(path.join(reportDir,'verified-before-commit.json'),JSON.stringify(report,null,2),{flag:'wx'});
    stage='commit';commitAttempted=true;await client.query('COMMIT');committed=true;
    stage='postcommit_readonly_verification';
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only,'on','POSTCOMMIT_NOT_READONLY');
    for(const table of Object.keys(inserted))await compareMappedTable(client,table);
    await verifyArchive(client,input);await verifyPublishedUnchanged(client,input.published);await validateBusinessState(client);
    const guards=(await client.query(`SELECT n.nspname AS schema,c.relname AS relation,t.tgname,t.tgenabled
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE NOT t.tgisinternal AND (n.nspname='migration_new_tires' OR t.tgname IN ('protect_new_tires_sales','protect_new_tires_items'))
      ORDER BY n.nspname,c.relname,t.tgname`)).rows;
    assert.equal(guards.length,14,'EXPECTED_IMMUTABILITY_GUARDS_MISSING');
    assert.ok(guards.every(g=>g.tgenabled==='O'),'IMMUTABILITY_GUARD_DISABLED');
    await client.query('ROLLBACK');
    report.postCommit={verified:true,readOnly:true,mappedFieldsMatch:true,publishedRowsUnchanged:true,archivesExact:true,enabledGuards:guards.length};
    await fs.writeFile(path.join(reportDir,'verified-after-commit.json'),JSON.stringify({...report.postCommit,verifiedAt:new Date().toISOString()},null,2),{flag:'wx'});
    await fs.writeFile(path.join(reportDir,'complete.json'),JSON.stringify({...report,committedAt:new Date().toISOString()},null,2),{flag:'wx'});
    return {...report,reportDir};
  } catch(error) {
    if(!commitAttempted)await client.query('ROLLBACK').catch(()=>{});
    const outcome={stage,committed,commitAttempted,commitOutcome:committed?'confirmed':commitAttempted?'unknown':'not_committed',
      code:error.code??(String(error.message).match(/[A-Z][A-Z_]{5,}/)?.[0])??error.name,reportDir,database:expected};
    await fs.writeFile(path.join(reportDir,'failure.json'),JSON.stringify(outcome,null,2),{flag:'wx'}).catch(()=>{});
    error.safeRehearsalFailure=outcome;throw error;
  } finally {await client.end().catch(()=>{});}
}

async function main(){
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i+=2){assert.ok(['--env','--snapshot','--manifest'].includes(args[i])&&args[i+1],'EXPECTED_NAMED_ARGUMENTS');assert.ok(!options[args[i]],'DUPLICATE_ARGUMENT');options[args[i]]=args[i+1];}
  assert.ok(options['--env'],'EXPLICIT_TEMPORARY_ENV_REQUIRED');
  const result=await runRehearsal({envFile:options['--env'],snapshotFile:options['--snapshot'],manifestFile:options['--manifest']});
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{console.error(JSON.stringify({rehearsalFailure:error.safeRehearsalFailure??{code:error.code??(String(error.message).match(/[A-Z][A-Z_]{5,}/)?.[0])??error.name}}));process.exitCode=1;});
}
