import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';
import { databaseState } from './published-backup-restore.mjs';
import { qi,rowsHash } from './snapshot.mjs';
import { installRuntime,verifyRuntime } from './published-runtime.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
export async function runtimeRollbackChecks(client){
  let checks=0;const sample=(await client.query('SELECT id FROM public.llantas ORDER BY id LIMIT 1')).rows[0].id;
  const check=async(fn)=>{await client.query('SAVEPOINT runtime_check');try{await fn();checks++;}finally{await client.query('ROLLBACK TO SAVEPOINT runtime_check');await client.query('RELEASE SAVEPOINT runtime_check');}};
  const reject=sql=>assert.rejects(()=>client.query(sql,[sample]),error=>error.code==='P0001');
  await check(()=>reject('UPDATE public.llantas SET stock=stock+1 WHERE id=$1'));
  await check(()=>reject(`UPDATE public.llantas SET stock_por_bodega=jsonb_set(stock_por_bodega,'{bodega-1}','-1') WHERE id=$1`));
  await check(()=>reject(`UPDATE public.llantas SET stock_por_bodega=stock_por_bodega || '{"inexistente":0}'::jsonb WHERE id=$1`));
  const insert=`INSERT INTO public.ventas(id,folio,cliente_nombre,subtotal,iva,total,metodo_pago,fecha_venta,iva_politica)
    VALUES('runtime-temporary-test','RUNTIME-TEMP','Prueba temporal',100,16,116,'efectivo',now(),`;
  await check(()=>assert.rejects(()=>client.query(insert+'NULL)'),error=>error.code==='P0001'));
  await check(async()=>{await client.query(insert+"'incluido_16')");await assert.rejects(()=>client.query('SET CONSTRAINTS ALL IMMEDIATE'),error=>error.code==='P0001');});
  await check(async()=>{
    await client.query(insert+"'incluido_16')");
    await client.query(`INSERT INTO public.venta_items(venta_id,tipo,servicio_nombre,cantidad,precio_unitario,subtotal)
      VALUES('runtime-temporary-test','extra','Prueba temporal',1,116,116)`);
    await client.query("UPDATE public.ventas SET cancelada=true WHERE id='runtime-temporary-test'");await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  });
  const original=(await client.query('SELECT key,value FROM public.app_metadata ORDER BY key')).rows;
  await check(async()=>{await client.query(`UPDATE public.app_metadata SET value=jsonb_set(value,'{ultimoFolio}',to_jsonb((value->>'ultimoFolio')::bigint+1)) WHERE key='ventas_seq'`);});
  assert.deepEqual((await client.query('SELECT key,value FROM public.app_metadata ORDER BY key')).rows,original,'SEQUENCE_ROLLBACK_FAILED');
  await check(async()=>{
    const sale=(await client.query("SELECT id,cancelada FROM public.ventas WHERE iva_politica IS NULL ORDER BY id LIMIT 1")).rows[0];
    const updated=(await client.query('UPDATE public.ventas SET cancelada=NOT cancelada WHERE id=$1 RETURNING cancelada',[sale.id])).rows[0];
    assert.equal(updated.cancelada,!sale.cancelada);await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  });
  return{checks,allSyntheticRowsRolledBack:true};
}

async function main(){
  assert.equal(process.argv[2],'--env','EXPLICIT_TEMPORARY_ENV_REQUIRED');assert.equal(process.argv.length,4,'UNEXPECTED_ARGUMENTS');
  const envPath=path.resolve(process.argv[3]);assert.ok(envPath.startsWith(path.join(root,'.migration-backups')+path.sep),'PRIVATE_TEMPORARY_ENV_REQUIRED');
  const env=dotenv.parse(await fs.readFile(envPath)),url=new URL(env.DATABASE_URL),name=decodeURIComponent(url.pathname.slice(1));
  assert.equal(name,'llantera_restore_7f81aa2aef5adff8e4ec6da1','ONLY_AUTHORIZED_CLONE_ALLOWED');
  const registry=JSON.parse(await fs.readFile(path.join(path.dirname(envPath),'temporary-database.json')));
  assert.equal(registry.database,name);assert.equal(registry.oid,'16831');
  const dir=path.join(path.dirname(envPath),'runtime-setup-'+randomUUID());await fs.mkdir(dir);
  const client=new pg.Client({connectionString:url.toString(),options:'-c timezone=UTC',connectionTimeoutMillis:15000,statement_timeout:120000,
    ssl:env.DB_REQUIRE_SSL==='true'?{rejectUnauthorized:env.DB_SSL_REJECT_UNAUTHORIZED!=='false'}:undefined});
  let committed=false,commitAttempted=false;
  try{
    await client.connect();const identity=(await client.query('SELECT oid::text,pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()')).rows[0];
    assert.deepEqual(identity,{oid:registry.oid,owner:registry.owner},'CLONE_IDENTITY_CHANGED');
    await client.query('BEGIN');
    const before=await databaseState(client);await fs.writeFile(path.join(dir,'baseline.json'),JSON.stringify(before),{flag:'wx'});
    const columns=(await client.query(`SELECT n.nspname AS schema,c.relname AS name,a.attname AS column FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','migration_new_tires') AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`)).rows;
    const sequences=await installRuntime(client);
    const tests=await runtimeRollbackChecks(client);
    for(const [table,state]of Object.entries(before.tables)){
      const [schema,name]=table.split('.');const names=columns.filter(c=>c.schema===schema&&c.name===name).map(c=>qi(c.column));
      const after=(await client.query(`SELECT to_jsonb(t)::text AS row FROM (SELECT ${names.join(',')} FROM ${qi(schema)}.${qi(name)}) t`)).rows.map(r=>r.row);
      assert.equal(rowsHash(after),state.sha256,'BASELINE_ROWS_CHANGED_'+table);
    }
    await client.query(`CREATE TRIGGER immutable_runtime_row BEFORE INSERT OR UPDATE OR DELETE ON migration_new_tires.runtime_setup FOR EACH ROW EXECUTE FUNCTION migration_new_tires.reject_archive_changes();
      CREATE TRIGGER immutable_runtime_truncate BEFORE TRUNCATE ON migration_new_tires.runtime_setup FOR EACH STATEMENT EXECUTE FUNCTION migration_new_tires.reject_archive_changes()`);
    const validation=await verifyRuntime(client);commitAttempted=true;await client.query('COMMIT');committed=true;
    await client.query('BEGIN READ ONLY');await verifyRuntime(client);await client.query('ROLLBACK');
    const report={database:name,oid:registry.oid,committed,sequences,tests,validation,baselinePreserved:true,postCommitReadOnlyVerified:true,globalRolesCreated:false,productionConnected:false,dir};
    await fs.writeFile(path.join(dir,'complete.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report,null,2));
  }catch(error){if(!commitAttempted)await client.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({error:error.code??String(error.message).match(/[A-Z][A-Z_]{5,}/)?.[0]??error.name,committed,commitAttempted,dir}));process.exitCode=1;
  }finally{await client.end().catch(()=>{});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({error:error.code??String(error.message).match(/[A-Z][A-Z_]{5,}/)?.[0]??error.name}));process.exitCode=1;});
