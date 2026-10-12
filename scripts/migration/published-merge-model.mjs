import assert from 'node:assert/strict';
import { qi, rowsHash } from './snapshot.mjs';

export const temporaryDatabasePattern = /^llantera_restore_[a-f0-9]+$/;
export const archiveSchema = 'migration_new_tires';
const scalar = (name, type = 'text') => `(j->>${JSON.stringify(name).replaceAll('"', "'")})::${type}`;
const nested = (parent, name, type = 'text') => `(j->'${parent}'->>'${name}')::${type}`;
const commonTire = {
  id:scalar('id'), marca:scalar('marca'), modelo:scalar('modelo'), medida:scalar('medida'),
  ancho:scalar('ancho','numeric'), perfil:scalar('perfil','numeric'), rin:scalar('rin','numeric'),
  precio_compra:scalar('precioCompra','numeric'), precio_venta:scalar('precioVenta','numeric'),
  stock:`(SELECT sum(value::numeric)::integer FROM jsonb_each_text(j->'stockPorBodega'))`,
  proveedor:scalar('proveedor'), fecha_recepcion:`timezone('America/Mexico_City',(j->>'fechaRecepcion')::timestamptz)::date`,
  activo:scalar('activo','boolean'), created_at:scalar('createdAt','timestamptz'), updated_at:scalar('updatedAt','timestamptz'),
  stock_por_bodega:`j->'stockPorBodega'`, fecha_recepcion_original:scalar('fechaRecepcion','timestamptz'),
  precio_mayorista:scalar('precioMayorista','numeric'), tipo_usada:scalar('tipoUsada'), vida:scalar('vida'),
  publicada:scalar('publicada'), dominio:scalar('dominio'),
};
export const mappings = {
  bodegas:{id:scalar('id'),nombre:scalar('nombre'),descripcion:'NULL::text',ubicacion:scalar('ubicacion'),tipo:scalar('tipo')},
  llantas:commonTire,
  ventas:{
    id:scalar('id'), folio:scalar('folio'), cliente_nombre:nested('cliente','nombre'), cliente_telefono:nested('cliente','telefono'),
    subtotal:scalar('subtotal','numeric'), iva:scalar('iva','numeric'), total:scalar('total','numeric'),
    metodo_pago:scalar('metodoPago'), fecha_venta:scalar('fechaVenta','timestamptz'),
    ticket_generado:scalar('ticketGenerado','boolean'), facturada:scalar('facturada','boolean'),
    factura_uuid:nested('factura','uuid'), factura_serie:nested('factura','serie'), factura_folio:nested('factura','folio'),
    factura_fecha_timbrado:nested('factura','fechaTimbrado','timestamptz'), factura_url_pdf:nested('factura','urlPdf'), factura_url_xml:nested('factura','urlXml'),
    garantia_activa:nested('garantia','activa','boolean'), garantia_fecha_inicio:nested('garantia','fechaInicio','date'),
    garantia_fecha_fin:nested('garantia','fechaFin','date'), garantia_dias:nested('garantia','diasGarantia','integer'),
    garantia_condiciones:nested('garantia','condiciones'), garantia_id:nested('garantia','id'),
    cliente_original:`j->'cliente'`, garantia_original:`j->'garantia'`, factura_original:`j->'factura'`,
    cancelada:scalar('cancelada','boolean'), motivo_cancelacion:scalar('motivoCancelacion'),
    created_at:scalar('createdAt','timestamptz'), updated_at:scalar('updatedAt','timestamptz'), dominio:scalar('dominio'),
    iva_politica:`'incluido_16'::text`,
  },
  movimientos_bodega:{
    id:scalar('id'), llanta_id:scalar('llantaId'), bodega_origen:scalar('bodegaOrigen'), bodega_destino:scalar('bodegaDestino'),
    cantidad:scalar('cantidad','integer'), fecha:scalar('fecha','timestamptz'), dominio:scalar('dominio'),
  },
  venta_items:{
    venta_id:'sale_id', tipo:`'producto'::text`, llanta_id:scalar('llantaId'), bodega_id:scalar('bodega'),
    llanta_marca_snapshot:nested('llantaSnapshot','marca'), llanta_modelo_snapshot:nested('llantaSnapshot','modelo'),
    llanta_medida_snapshot:nested('llantaSnapshot','medida'), codigo_auxiliar:nested('llantaSnapshot','codigoAuxiliar'),
    cantidad:scalar('cantidad','integer'), precio_unitario:scalar('precioUnitario','numeric'), subtotal:scalar('subtotal','numeric'),
    costo_unitario:scalar('costoUnitario','numeric'), costo_subtotal:scalar('costoSubtotal','numeric'),
    producto_id:scalar('productoId'), orden:'item_order', original_item:'j',
  },
};

export const extensionsSql = `
ALTER TABLE public.bodegas ADD COLUMN ubicacion text, ADD COLUMN tipo text;
ALTER TABLE public.llantas
  ALTER COLUMN ancho TYPE numeric, ALTER COLUMN perfil TYPE numeric, ALTER COLUMN rin TYPE numeric,
  ALTER COLUMN medida TYPE varchar(50),
  ADD COLUMN stock_por_bodega jsonb, ADD COLUMN fecha_recepcion_original timestamptz,
  ADD COLUMN precio_mayorista numeric(10,2), ADD COLUMN tipo_usada varchar(50),
  ADD COLUMN vida varchar(50), ADD COLUMN publicada varchar(50), ADD COLUMN dominio varchar(50);
ALTER TABLE public.ventas
  ADD COLUMN garantia_id text, ADD COLUMN garantia_original jsonb,
  ADD COLUMN cliente_original jsonb, ADD COLUMN factura_original jsonb,
  ADD COLUMN dominio varchar(50), ADD COLUMN iva_politica text,
  ADD CONSTRAINT new_tires_included_iva CHECK (iva_politica IS DISTINCT FROM 'incluido_16' OR
    (total>=0 AND subtotal=round(total/1.16,2) AND iva=total-subtotal));
ALTER TABLE public.venta_items
  ADD COLUMN costo_unitario numeric(12,2), ADD COLUMN costo_subtotal numeric(12,2),
  ADD COLUMN codigo_auxiliar text, ADD COLUMN producto_id varchar(50),
  ADD COLUMN orden integer, ADD COLUMN original_item jsonb,
  ADD CONSTRAINT new_tires_item_order UNIQUE (venta_id,orden);
ALTER TABLE public.movimientos_bodega ADD COLUMN dominio varchar(50);
CREATE SCHEMA migration_new_tires;
CREATE TABLE migration_new_tires.snapshots (
  label text PRIMARY KEY, sha256 text NOT NULL, document_text text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE migration_new_tires.source_rows (
  dataset text NOT NULL, source_table text NOT NULL, row_ordinal integer NOT NULL,
  row_text text NOT NULL, row_data jsonb NOT NULL, sha256 text NOT NULL,
  PRIMARY KEY(dataset,source_table,row_ordinal));
CREATE TABLE migration_new_tires.context_tires (
  id varchar(50) PRIMARY KEY, original_row jsonb NOT NULL);
CREATE TABLE migration_new_tires.imported_sales (
  sale_id varchar(50) PRIMARY KEY REFERENCES public.ventas(id), source_batch_id text NOT NULL);
CREATE TABLE migration_new_tires.item_context (
  venta_item_id bigint PRIMARY KEY REFERENCES public.venta_items(id),
  sale_id varchar(50) NOT NULL REFERENCES public.ventas(id),
  item_order integer NOT NULL, context_tire_id varchar(50) NOT NULL REFERENCES migration_new_tires.context_tires(id));
CREATE TABLE migration_new_tires.batch (
  id uuid PRIMARY KEY, source_snapshot_sha256 text NOT NULL, published_snapshot_sha256 text NOT NULL,
  mapping_version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
`;

function relationSource(table) {
  if(table==='bodegas')return `SELECT row_data AS j FROM migration_new_tires.source_rows WHERE dataset='warehouse_config' AND source_table='config.SISTEMA_BODEGAS'`;
  if (table === 'venta_items') return `SELECT row_data->>'id' AS sale_id,e.ordinality::integer AS item_order,e.value AS j
    FROM migration_new_tires.source_rows CROSS JOIN LATERAL jsonb_array_elements(row_data->'items') WITH ORDINALITY AS e(value,ordinality)
    WHERE dataset='new_tires' AND source_table='public.ventas'`;
  return `SELECT row_data AS j FROM migration_new_tires.source_rows
    WHERE dataset='new_tires' AND source_table='public.${table}'`;
}

export async function insertMappedTable(client, table) {
  const mapping = mappings[table]; assert.ok(mapping, 'UNKNOWN_MAPPING');
  const keys = Object.keys(mapping);
  const result = await client.query(`INSERT INTO public.${qi(table)} (${keys.map(qi).join(',')})
    SELECT ${Object.values(mapping).join(',')} FROM (${relationSource(table)}) source
    ${table === 'venta_items' ? 'ORDER BY sale_id,item_order' : ''}`);
  return result.rowCount;
}

export async function compareMappedTable(client, table) {
  const mapping = mappings[table]; assert.ok(mapping, 'UNKNOWN_MAPPING');
  const keys = Object.keys(mapping);
  const expected = keys.map(key => `${mapping[key]} AS ${qi(key)}`).join(',');
  const join = table === 'venta_items' ? 'a.venta_id=e.venta_id AND a.orden=e.orden' : 'a.id=e.id';
  const actualJSON = `jsonb_build_object(${keys.map(key=>`'${key}',a.${qi(key)}`).join(',')})`;
  const result = await client.query(`WITH expected AS (SELECT ${expected} FROM (${relationSource(table)}) source)
    SELECT count(*)::integer AS compared,
      count(*) FILTER (WHERE a.id IS NULL OR ${actualJSON} IS DISTINCT FROM to_jsonb(e))::integer AS mismatches
    FROM expected e LEFT JOIN public.${qi(table)} a ON ${join}`);
  assert.equal(result.rows[0].mismatches,0,`MAPPING_MISMATCH_${table}`);
  return result.rows[0];
}

export async function readOriginalColumns(client, table, columnNames) {
  assert.ok(columnNames.length, 'ORIGINAL_COLUMNS_REQUIRED');
  const result = await client.query(`SELECT to_jsonb(p)::text AS row_json
    FROM (SELECT ${columnNames.map(qi).join(',')} FROM public.${qi(table)}) p
    ORDER BY to_jsonb(p)::text COLLATE "C"`);
  return result.rows.map(row=>row.row_json);
}

export async function verifyPublishedUnchanged(client, published) {
  const comparisons = {};
  for (const [relation, original] of Object.entries(published.tables)) {
    const table = relation.slice('public.'.length);
    assert.equal(relation,'public.'+table,'UNEXPECTED_PUBLISHED_SCHEMA');
    const columns = published.metadata.columns.filter(c=>c.schema==='public'&&c.table_name===table).map(c=>c.name);
    const ids = original.map(raw=>JSON.parse(raw).id);
    const idSet = new Set(ids.map(String));
    const current = await readOriginalColumns(client,table,columns);
    const originalsNow = current.filter(raw=>idSet.has(String(JSON.parse(raw).id)));
    assert.equal(rowsHash(originalsNow),rowsHash(original),`PUBLISHED_ROWS_CHANGED_${table}`);
    comparisons[table]={originalCount:original.length,preservedCount:originalsNow.length,addedCount:current.length-original.length,originalSha256:rowsHash(original)};
  }
  return comparisons;
}

export const historicalTruncateSql = `
CREATE FUNCTION migration_new_tires.reject_historical_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'El historial de ventas no admite TRUNCATE'; END $$;
CREATE TRIGGER protect_new_tires_sales_truncate BEFORE TRUNCATE ON public.ventas
FOR EACH STATEMENT EXECUTE FUNCTION migration_new_tires.reject_historical_truncate();
CREATE TRIGGER protect_new_tires_items_truncate BEFORE TRUNCATE ON public.venta_items
FOR EACH STATEMENT EXECUTE FUNCTION migration_new_tires.reject_historical_truncate();
`;

export const protectionsSql = `
CREATE FUNCTION migration_new_tires.reject_archive_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Archivo original de migración inmutable'; END $$;
CREATE FUNCTION migration_new_tires.protect_historical_sales() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$ BEGIN
  IF EXISTS(SELECT 1 FROM migration_new_tires.imported_sales WHERE sale_id=OLD.id) THEN
    RAISE EXCEPTION 'Venta histórica migrada de solo lectura';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION migration_new_tires.protect_historical_items() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog AS $$ BEGIN
  IF TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM migration_new_tires.imported_sales WHERE sale_id=OLD.venta_id) THEN
    RAISE EXCEPTION 'Partida histórica migrada de solo lectura';
  END IF;
  IF TG_OP<>'DELETE' AND EXISTS(SELECT 1 FROM migration_new_tires.imported_sales WHERE sale_id=NEW.venta_id) THEN
    RAISE EXCEPTION 'Partida histórica migrada de solo lectura';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_new_tires_sales BEFORE UPDATE OR DELETE ON public.ventas
FOR EACH ROW EXECUTE FUNCTION migration_new_tires.protect_historical_sales();
CREATE TRIGGER protect_new_tires_items BEFORE INSERT OR UPDATE OR DELETE ON public.venta_items
FOR EACH ROW EXECUTE FUNCTION migration_new_tires.protect_historical_items();
${historicalTruncateSql}
REVOKE ALL ON SCHEMA migration_new_tires FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA migration_new_tires FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA migration_new_tires FROM PUBLIC;
`;

export async function freezeArchive(client, additionalTables=[]) {
  await client.query(protectionsSql);
  assert.ok(additionalTables.every(table=>['runtime_setup','supplemental_files','production_manifest'].includes(table)), 'UNKNOWN_ARCHIVE_TABLE');
  for (const table of ['snapshots','source_rows','context_tires','imported_sales','item_context','batch',...additionalTables]) {
    await client.query(`CREATE TRIGGER reject_archive_row_changes BEFORE INSERT OR UPDATE OR DELETE ON migration_new_tires.${qi(table)}
      FOR EACH ROW EXECUTE FUNCTION migration_new_tires.reject_archive_changes();
      CREATE TRIGGER reject_archive_truncate BEFORE TRUNCATE ON migration_new_tires.${qi(table)}
      FOR EACH STATEMENT EXECUTE FUNCTION migration_new_tires.reject_archive_changes()`);
  }
}
