-- Durable request outcomes on the single canonical database. The sale, stock,
-- receipt, folio and committed outcome are written in the same transaction.
CREATE TABLE IF NOT EXISTS shared_runtime.operations (
  id text PRIMARY KEY,
  request_hash text NOT NULL,
  application text NOT NULL CHECK (application IN ('blanca','negra')),
  status text NOT NULL CHECK (status IN ('committed','released')),
  sale_kind text CHECK (sale_kind IN ('ventas','ventas_productos')),
  sale_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='committed' AND sale_kind IS NOT NULL AND sale_id IS NOT NULL)
      OR (status='released' AND sale_kind IS NULL AND sale_id IS NULL))
);
