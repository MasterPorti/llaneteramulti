-- Install on the normalized Multi database, never on the central inventory.
-- Existing tire copies and historical documents remain unchanged.
BEGIN;
CREATE TABLE IF NOT EXISTS public.shared_stock_operations (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200 AND id=btrim(id)),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='array'),
  status text NOT NULL CHECK (status IN ('intent','reserved','local_committed','committed','release_pending','released')),
  reservation jsonb CHECK (reservation IS NULL OR jsonb_typeof(reservation)='object'),
  sale_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS shared_stock_operations_sale_id_unique
  ON public.shared_stock_operations(sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS shared_stock_operations_pending
  ON public.shared_stock_operations(updated_at,id) WHERE status IN ('intent','reserved','local_committed','release_pending');

-- The previous local tire inventory becomes historical, including for old
-- application instances still running during deployment. Central stock is the
-- only writable inventory; this guard must never depend on an app flag.
CREATE OR REPLACE FUNCTION public.reject_local_tire_writes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'El inventario de llantas se administra en la base central; la copia local es histórica'
    USING ERRCODE='55000';
END $$;
DROP TRIGGER IF EXISTS shared_inventory_local_readonly ON public.llantas;
CREATE TRIGGER shared_inventory_local_readonly BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.llantas
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_local_tire_writes();
ALTER TABLE public.llantas ENABLE ALWAYS TRIGGER shared_inventory_local_readonly;

ALTER TABLE public.venta_items ADD COLUMN IF NOT EXISTS shared_stock_operation_id text;
DO $$
DECLARE c record; tire_column smallint;
BEGIN
  SELECT attnum INTO STRICT tire_column FROM pg_catalog.pg_attribute
    WHERE attrelid='public.venta_items'::regclass AND attname='llanta_id' AND NOT attisdropped;
  -- Replace only the single-column tire FK. Services, catalog products and
  -- parent sale FKs remain intact, as do all imported-document protections.
  FOR c IN SELECT conname,conkey FROM pg_catalog.pg_constraint
    WHERE conrelid='public.venta_items'::regclass AND confrelid='public.llantas'::regclass AND contype='f'
  LOOP
    IF c.conkey<>ARRAY[tire_column] THEN RAISE EXCEPTION 'Unexpected composite tire foreign key: %',c.conname; END IF;
    EXECUTE pg_catalog.format('ALTER TABLE public.venta_items DROP CONSTRAINT %I',c.conname);
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.venta_items'::regclass AND conname='venta_items_shared_stock_operation_fkey') THEN
    ALTER TABLE public.venta_items ADD CONSTRAINT venta_items_shared_stock_operation_fkey
      FOREIGN KEY(shared_stock_operation_id) REFERENCES public.shared_stock_operations(id);
  END IF;
END $$;

-- Preserve the existing anti-forgery rule and bind each new tire item to a
-- durable reservation. Historical rows are not rewritten or revalidated.
CREATE OR REPLACE FUNCTION migration_new_tires.validate_new_item_origin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op public.shared_stock_operations%ROWTYPE; snapshot jsonb;
BEGIN
  IF NEW.original_item IS NOT NULL THEN
    RAISE EXCEPTION 'Las partidas nuevas no pueden simular un original migrado';
  END IF;
  IF NEW.tipo='producto' THEN
    SELECT * INTO op FROM public.shared_stock_operations WHERE id=NEW.shared_stock_operation_id;
    IF NOT FOUND OR op.status NOT IN ('reserved','local_committed') OR op.sale_id IS DISTINCT FROM NEW.venta_id THEN
      RAISE EXCEPTION 'La partida de llanta requiere una reserva central vinculada a esta venta';
    END IF;
    snapshot := op.reservation->'snapshots'->NEW.llanta_id;
    IF op.reservation->>'operationId' IS DISTINCT FROM op.id
       OR op.reservation->>'status' NOT IN ('reserved','committed')
       OR snapshot->>'id' IS DISTINCT FROM NEW.llanta_id
       OR snapshot->>'dominio' IS DISTINCT FROM 'sistema'
       OR upper(regexp_replace(btrim(snapshot->>'proveedor'),'[[:space:]]+',' ','g')) IS DISTINCT FROM 'COMERCIALIZADORA DE NEW TIRES'
       OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(op.payload) e WHERE e->>'id'=NEW.llanta_id AND e->>'bodega'=NEW.bodega_id) THEN
      RAISE EXCEPTION 'La reserva central no respalda esta llanta y bodega';
    END IF;
  ELSIF NEW.shared_stock_operation_id IS NOT NULL THEN
    RAISE EXCEPTION 'Solo las llantas pueden usar una reserva de inventario central';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.verify_shared_stock_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op public.shared_stock_operations%ROWTYPE; expected jsonb; actual jsonb; operation_id text;
BEGIN
  IF TG_TABLE_NAME='shared_stock_operations' THEN operation_id := NEW.id;
  ELSE operation_id := NEW.shared_stock_operation_id; END IF;
  IF operation_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO op FROM public.shared_stock_operations WHERE id=operation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'La operación central no existe'; END IF;
  IF op.sale_id IS NULL THEN
    IF op.status IN ('local_committed','committed') THEN RAISE EXCEPTION 'La reserva confirmada requiere una venta local'; END IF;
    RETURN NULL;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ventas WHERE id=op.sale_id) THEN
    RAISE EXCEPTION 'La operación central no tiene una venta local';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('id',id,'bodega',bodega,'cantidad',cantidad) ORDER BY id COLLATE "C",bodega COLLATE "C")
    INTO expected FROM (
      SELECT e->>'id' AS id,e->>'bodega' AS bodega,sum((e->>'cantidad')::numeric)::bigint AS cantidad
      FROM jsonb_array_elements(op.payload) e GROUP BY e->>'id',e->>'bodega'
    ) grouped;
  SELECT jsonb_agg(jsonb_build_object('id',id,'bodega',bodega,'cantidad',cantidad) ORDER BY id COLLATE "C",bodega COLLATE "C")
    INTO actual FROM (
      SELECT llanta_id AS id,bodega_id AS bodega,sum(cantidad)::bigint AS cantidad
      FROM public.venta_items WHERE venta_id=op.sale_id AND tipo='producto' AND shared_stock_operation_id=op.id
      GROUP BY llanta_id,bodega_id
    ) grouped;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Las cantidades vendidas no coinciden con la reserva central';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS reconcile_shared_stock_items ON public.venta_items;
CREATE CONSTRAINT TRIGGER reconcile_shared_stock_items AFTER INSERT ON public.venta_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.verify_shared_stock_items();
DROP TRIGGER IF EXISTS reconcile_shared_stock_operation ON public.shared_stock_operations;
CREATE CONSTRAINT TRIGGER reconcile_shared_stock_operation AFTER INSERT OR UPDATE ON public.shared_stock_operations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.verify_shared_stock_items();

CREATE OR REPLACE FUNCTION public.reject_shared_stock_item_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.shared_stock_operation_id IS NOT NULL OR (TG_OP='UPDATE' AND NEW.shared_stock_operation_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Las partidas con stock central son inmutables; cancela la venta para devolver existencias';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS shared_stock_item_immutable ON public.venta_items;
CREATE TRIGGER shared_stock_item_immutable BEFORE UPDATE OR DELETE ON public.venta_items
  FOR EACH ROW EXECUTE FUNCTION public.reject_shared_stock_item_changes();

REVOKE ALL ON public.shared_stock_operations FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_local_tire_writes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_shared_stock_item_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_shared_stock_items() FROM PUBLIC;
REVOKE ALL ON FUNCTION migration_new_tires.validate_new_item_origin() FROM PUBLIC;
COMMIT;
