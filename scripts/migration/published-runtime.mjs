import assert from 'node:assert/strict';
import { qi } from './snapshot.mjs';

export const runtimeVersion=1;
export const runtimeSql=`
ALTER TABLE public.productos ADD COLUMN precio_compra numeric(10,2);
ALTER TABLE public.movimientos_bodega ADD COLUMN tipo text, ADD COLUMN motivo text, ADD COLUMN venta_id varchar(50);
CREATE TABLE public.app_metadata(key text PRIMARY KEY,value jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE migration_new_tires.runtime_setup(version integer PRIMARY KEY,initial_sequences jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.app_metadata(key,value)
SELECT 'ventas_seq',jsonb_build_object('ultimoFolio',coalesce(max(substring(folio from '^V-([0-9]+)$')::bigint),0)) FROM public.ventas;
WITH original AS (
  SELECT row_data->'value' AS value FROM migration_new_tires.source_rows
  WHERE dataset='new_tires' AND source_table='public.app_metadata' AND row_data->>'key'='sistema_ventas_seq'
), maxima AS (
  SELECT coalesce(max(substring(folio from '^SI-([0-9]+)$')::bigint),0) AS folio,
    coalesce(max(substring(garantia_id from '^GAR-[0-9]{4}-([0-9]+)$')::bigint),0) AS warranty FROM public.ventas
)
INSERT INTO public.app_metadata(key,value)
SELECT 'sistema_ventas_seq',jsonb_build_object(
  'ultimoFolio',greatest((original.value->>'ultimoFolio')::bigint,maxima.folio),
  'ultimoGarantiaId',greatest((original.value->>'ultimoGarantiaId')::bigint,maxima.warranty)) FROM original CROSS JOIN maxima;
INSERT INTO migration_new_tires.runtime_setup(version,initial_sequences)
SELECT 1,jsonb_object_agg(key,value) FROM public.app_metadata;
ALTER TABLE public.llantas ALTER COLUMN stock_por_bodega SET NOT NULL;
ALTER TABLE public.ventas ALTER COLUMN iva_politica SET DEFAULT 'incluido_16';
CREATE FUNCTION migration_new_tires.validate_warehouse_stock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$ DECLARE entry record; total_stock numeric:=0;
BEGIN
  IF NEW.stock_por_bodega IS NULL OR jsonb_typeof(NEW.stock_por_bodega)<>'object' THEN
    RAISE EXCEPTION 'La existencia debe indicar las bodegas reales';
  END IF;
  FOR entry IN SELECT key,value FROM jsonb_each(NEW.stock_por_bodega) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.bodegas WHERE id=entry.key) THEN RAISE EXCEPTION 'Bodega inexistente'; END IF;
    IF jsonb_typeof(entry.value)<>'number' OR (entry.value::text)::numeric<0 OR
       trunc((entry.value::text)::numeric)<>(entry.value::text)::numeric THEN RAISE EXCEPTION 'Existencia por bodega inválida'; END IF;
    total_stock:=total_stock+(entry.value::text)::numeric;
  END LOOP;
  IF NEW.stock IS DISTINCT FROM total_stock THEN RAISE EXCEPTION 'Stock total y existencias por bodega no coinciden'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_new_tires_warehouse_stock BEFORE INSERT OR UPDATE ON public.llantas
FOR EACH ROW EXECUTE FUNCTION migration_new_tires.validate_warehouse_stock();
CREATE FUNCTION migration_new_tires.validate_new_sale_tax() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$ BEGIN
  IF TG_OP='INSERT' AND NEW.iva_politica IS DISTINCT FROM 'incluido_16' THEN
    RAISE EXCEPTION 'Las ventas nuevas requieren la política de IVA incluido';
  END IF;
  IF TG_OP='UPDATE' AND NEW.iva_politica IS DISTINCT FROM OLD.iva_politica THEN
    RAISE EXCEPTION 'No se puede cambiar la política histórica de IVA';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_new_sale_tax BEFORE INSERT OR UPDATE ON public.ventas
FOR EACH ROW EXECUTE FUNCTION migration_new_tires.validate_new_sale_tax();
CREATE FUNCTION migration_new_tires.validate_new_item_origin() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.original_item IS NOT NULL THEN RAISE EXCEPTION 'Las partidas nuevas no pueden simular un original migrado'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_new_item_origin BEFORE INSERT ON public.venta_items
FOR EACH ROW EXECUTE FUNCTION migration_new_tires.validate_new_item_origin();
CREATE FUNCTION migration_new_tires.validate_sale_reconciliation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$ DECLARE sid text; parent record; amount numeric; units integer;
BEGIN
  IF TG_TABLE_NAME='ventas' THEN sid:=NEW.id;
  ELSIF TG_OP='DELETE' THEN sid:=OLD.venta_id;
  ELSE sid:=NEW.venta_id; END IF;
  SELECT total INTO parent FROM public.ventas WHERE id=sid;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT sum(subtotal),count(*) INTO amount,units FROM public.venta_items WHERE venta_id=sid;
  IF units=0 OR amount IS DISTINCT FROM parent.total THEN RAISE EXCEPTION 'El total de venta no coincide con sus partidas'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER reconcile_sale_amounts AFTER INSERT OR UPDATE ON public.ventas
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION migration_new_tires.validate_sale_reconciliation();
CREATE CONSTRAINT TRIGGER reconcile_sale_item_amounts AFTER INSERT OR UPDATE OR DELETE ON public.venta_items
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION migration_new_tires.validate_sale_reconciliation();
ALTER TABLE public.venta_items ADD CONSTRAINT new_sale_item_amounts CHECK (
  original_item IS NOT NULL OR (cantidad>0 AND precio_unitario>=0 AND subtotal=round(precio_unitario*cantidad,2)));
`;

export async function installRuntime(client){
  assert.equal((await client.query("SELECT to_regclass('public.app_metadata')::text AS relation")).rows[0].relation,null,'RUNTIME_ALREADY_INSTALLED_OR_METADATA_NEEDS_REVIEW');
  assert.equal((await client.query(`SELECT count(*)::integer AS n FROM migration_new_tires.source_rows
    WHERE dataset='new_tires' AND source_table='public.app_metadata' AND row_data->>'key'='sistema_ventas_seq'`)).rows[0].n,1,'ORIGINAL_SALES_SEQUENCE_REQUIRED');
  await client.query(runtimeSql);
  const sequences=(await client.query('SELECT key,value FROM public.app_metadata ORDER BY key')).rows;
  assert.equal(sequences.length,2,'OPERATIONAL_SEQUENCES_MISSING');
  return sequences;
}

export async function verifyRuntime(client){
  const result=(await client.query('SELECT version,initial_sequences FROM migration_new_tires.runtime_setup')).rows;
  assert.equal(result.length,1,'RUNTIME_VERSION_MISSING');assert.equal(result[0].version,runtimeVersion,'RUNTIME_VERSION_MISMATCH');
  const rows=(await client.query('SELECT key,value FROM public.app_metadata ORDER BY key')).rows;
  const metadata=Object.fromEntries(rows.map(row=>[row.key,row.value]));
  assert.ok(Number.isSafeInteger(metadata.ventas_seq?.ultimoFolio),'INVALID_GENERAL_SEQUENCE');
  assert.ok(Number.isSafeInteger(metadata.sistema_ventas_seq?.ultimoFolio)&&Number.isSafeInteger(metadata.sistema_ventas_seq?.ultimoGarantiaId),'INVALID_SYSTEM_SEQUENCE');
  for(const [key,values]of Object.entries(result[0].initial_sequences))for(const [field,value]of Object.entries(values))assert.ok(metadata[key][field]>=value,'SEQUENCE_REWOUND');
  const maxima=(await client.query(`SELECT coalesce(max(substring(folio from '^V-([0-9]+)$')::bigint),0)::text AS general,
    coalesce(max(substring(folio from '^SI-([0-9]+)$')::bigint),0)::text AS sistema,
    coalesce(max(substring(garantia_id from '^GAR-[0-9]{4}-([0-9]+)$')::bigint),0)::text AS garantia FROM public.ventas`)).rows[0];
  assert.ok(BigInt(metadata.ventas_seq.ultimoFolio)>=BigInt(maxima.general),'GENERAL_SEQUENCE_BEHIND');
  assert.ok(BigInt(metadata.sistema_ventas_seq.ultimoFolio)>=BigInt(maxima.sistema),'SYSTEM_SEQUENCE_BEHIND');
  assert.ok(BigInt(metadata.sistema_ventas_seq.ultimoGarantiaId)>=BigInt(maxima.garantia),'WARRANTY_SEQUENCE_BEHIND');
  const triggers=(await client.query(`SELECT tgname,tgenabled FROM pg_trigger WHERE tgname IN
    ('validate_new_tires_warehouse_stock','validate_new_sale_tax','validate_new_item_origin','reconcile_sale_amounts','reconcile_sale_item_amounts')`)).rows;
  assert.equal(triggers.length,5,'RUNTIME_GUARDS_MISSING');assert.ok(triggers.every(t=>t.tgenabled==='O'),'RUNTIME_GUARD_DISABLED');
  return {version:runtimeVersion,sequences:rows,enabledGuards:triggers.length};
}

export async function validateRuntimeRole(client,role){
  assert.match(role,/^llaneteramulti_[a-z0-9_]+_app$/,'DEDICATED_APPLICATION_ROLE_REQUIRED');
  const found=(await client.query(`SELECT r.oid,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,r.rolcanlogin,
    r.oid=(SELECT datdba FROM pg_database WHERE datname=current_database()) AS owns_database,
    EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS member_of_role,
    EXISTS(SELECT 1 FROM pg_class WHERE relowner=r.oid) AS owns_relation
    FROM pg_roles r WHERE rolname=$1`,[role])).rows[0];
  assert.ok(found&&found.rolcanlogin&&!found.rolsuper&&!found.rolcreatedb&&!found.rolcreaterole&&!found.rolreplication&&!found.rolbypassrls&&!found.owns_database&&!found.member_of_role&&!found.owns_relation,'APPLICATION_ROLE_NOT_LIMITED');
  const dangerous=(await client.query(`SELECT has_schema_privilege($1,'public','CREATE') OR
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
      AND (has_table_privilege($1,c.oid,'DELETE') OR has_table_privilege($1,c.oid,'TRUNCATE'))) AS unsafe`,[role])).rows[0].unsafe;
  assert.equal(dangerous,false,'APPLICATION_ROLE_HAS_DANGEROUS_EXISTING_PRIVILEGES');
  return {role,limited:true};
}

export async function grantRuntimeRole(client,role){
  await validateRuntimeRole(client,role);
  const database=(await client.query('SELECT current_database() AS name')).rows[0].name;
  await client.query(`GRANT CONNECT ON DATABASE ${qi(database)} TO ${qi(role)};
    GRANT USAGE ON SCHEMA public,migration_new_tires TO ${qi(role)};
    GRANT SELECT ON ALL TABLES IN SCHEMA public,migration_new_tires TO ${qi(role)};
    GRANT INSERT,UPDATE ON public.llantas,public.productos,public.servicios,public.ventas TO ${qi(role)};
    GRANT INSERT ON public.venta_items,public.movimientos_bodega TO ${qi(role)};
    GRANT UPDATE ON public.app_metadata TO ${qi(role)};
    GRANT USAGE,SELECT ON SEQUENCE public.venta_items_id_seq TO ${qi(role)};`);
  const dangerous=(await client.query(`SELECT has_schema_privilege($1,'public','CREATE') OR has_schema_privilege($1,'migration_new_tires','CREATE') OR
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='migration_new_tires' AND c.relkind='r'
      AND (has_table_privilege($1,c.oid,'INSERT') OR has_table_privilege($1,c.oid,'UPDATE') OR has_table_privilege($1,c.oid,'DELETE') OR has_table_privilege($1,c.oid,'TRUNCATE'))) AS unsafe`,[role])).rows[0].unsafe;
  assert.equal(dangerous,false,'APPLICATION_ROLE_HAS_DANGEROUS_INHERITED_PRIVILEGES');
  return {role,limited:true,canAlterArchive:false};
}

export async function installWriteGate(client,{appRole,applicationSha256}){
  assert.match(appRole,/^llaneteramulti_[a-z0-9_]+_app$/,'DEDICATED_APPLICATION_ROLE_REQUIRED');
  assert.match(applicationSha256,/^[a-f0-9]{64}$/,'VERIFIED_APPLICATION_ARTIFACT_REQUIRED');
  await client.query(`CREATE TABLE migration_new_tires.operation_state(
    singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),status text NOT NULL CHECK(status IN ('blocked','active')),
    app_role text NOT NULL,application_sha256 text NOT NULL,activated_at timestamptz);
    CREATE FUNCTION migration_new_tires.enforce_writer_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
    SET search_path=pg_catalog AS $$ DECLARE gate record; BEGIN
      SELECT * INTO gate FROM migration_new_tires.operation_state WHERE singleton;
      IF gate.status IS DISTINCT FROM 'active' OR session_user IS DISTINCT FROM gate.app_role THEN
        RAISE EXCEPTION 'La escritura requiere la aplicación migrada y activada';
      END IF;
      RETURN NULL;
    END $$;`);
  await client.query("INSERT INTO migration_new_tires.operation_state(singleton,status,app_role,application_sha256) VALUES(true,'blocked',$1,$2)",[appRole,applicationSha256]);
  for(const table of ['llantas','productos','servicios','ventas','venta_items','movimientos_bodega','bodegas','app_metadata']){
    await client.query(`CREATE TRIGGER enforce_published_writer BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.${qi(table)}
      FOR EACH STATEMENT EXECUTE FUNCTION migration_new_tires.enforce_writer_gate()`);
  }
}

export async function verifyWriteGate(client,{appRole,applicationSha256,expectedStatus='blocked'}){
  const state=(await client.query('SELECT status,app_role,application_sha256 FROM migration_new_tires.operation_state WHERE singleton')).rows[0];
  assert.deepEqual(state,{status:expectedStatus,app_role:appRole,application_sha256:applicationSha256},'WRITER_GATE_STATE_MISMATCH');
  const count=(await client.query("SELECT count(*)::integer AS n FROM pg_trigger WHERE tgname='enforce_published_writer' AND tgenabled='O'")).rows[0].n;
  assert.equal(count,8,'WRITER_GATE_TRIGGERS_MISSING');return{status:state.status,restrictedRole:appRole,enabledGuards:count};
}
