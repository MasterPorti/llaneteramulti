import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';

type SaleKind = 'ventas' | 'ventas_productos';
type DatabaseEnvironment = 'development' | 'production';
export interface WhiteSalesHistoryResetInput {
  databaseInstanceId: string;
  environment: DatabaseEnvironment;
  resetId: string;
  resetAtUtc: string;
  snapshotId: string;
  excludedIds: Record<SaleKind, string[]>;
}
export interface WhiteSalesHistoryReset extends WhiteSalesHistoryResetInput {
  version: 1;
  application: 'blanca';
  sourceSchema: 'public';
  sourceTables: ['ventas', 'ventas_productos'];
  sha256: string;
}

const ERROR = 'La configuración del reinicio del historial de la aplicación blanca no es válida. Revisa su manifiesto antes de continuar.';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_ENCODED_BYTES = 120_000;
const INPUT_KEYS = ['databaseInstanceId', 'environment', 'resetId', 'resetAtUtc', 'snapshotId', 'excludedIds'];
const MANIFEST_KEYS = ['version', 'application', 'sourceSchema', 'sourceTables', ...INPUT_KEYS, 'sha256'];

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function fail(): never { throw new Error(ERROR); }
function inputBody(value: unknown): Omit<WhiteSalesHistoryReset, 'sha256'> {
  if (!record(value) || !exactKeys(value, INPUT_KEYS)) fail();
  if (typeof value.databaseInstanceId !== 'string' || !UUID.test(value.databaseInstanceId)
    || typeof value.resetId !== 'string' || !UUID.test(value.resetId)
    || (value.environment !== 'development' && value.environment !== 'production')) fail();
  if (typeof value.resetAtUtc !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.resetAtUtc)
    || !Number.isFinite(Date.parse(value.resetAtUtc)) || new Date(value.resetAtUtc).toISOString() !== value.resetAtUtc) fail();
  // The MVCC snapshot is audit evidence. Neither the business date nor a
  // transaction's start time decides which documents belong to this history.
  if (typeof value.snapshotId !== 'string' || value.snapshotId.length > 20_000
    || !/^\d+:\d+:(?:\d+(?:,\d+)*)?$/.test(value.snapshotId)) fail();
  if (!record(value.excludedIds) || !exactKeys(value.excludedIds, ['ventas', 'ventas_productos'])) fail();
  function identities(kind: SaleKind): string[] {
    const ids = (value as Record<string, unknown>).excludedIds as Record<string, unknown>;
    const list = ids[kind];
    if (!Array.isArray(list) || list.length > 10_000
      || list.some(id => typeof id !== 'string' || !id.length || id.length > 512 || /[\u0000-\u001f\u007f]/.test(id))) fail();
    const sorted = [...list as string[]].sort();
    if (new Set(sorted).size !== sorted.length) fail();
    return sorted;
  }
  return {
    version: 1, application: 'blanca', sourceSchema: 'public', sourceTables: ['ventas', 'ventas_productos'],
    databaseInstanceId: value.databaseInstanceId, environment: value.environment as DatabaseEnvironment,
    resetId: value.resetId, resetAtUtc: value.resetAtUtc, snapshotId: value.snapshotId,
    excludedIds: { ventas: identities('ventas'), ventas_productos: identities('ventas_productos') },
  };
}
const digest = (body: Omit<WhiteSalesHistoryReset, 'sha256'>): string => createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');

/** Pure builder for the operator's read-only snapshot capture. No database I/O. */
export function buildWhiteSalesHistoryReset(input: WhiteSalesHistoryResetInput): WhiteSalesHistoryReset {
  const body = inputBody(input);
  return { ...body, sha256: digest(body) };
}
function validatedManifest(value: unknown): WhiteSalesHistoryReset {
  if (!record(value) || !exactKeys(value, MANIFEST_KEYS) || value.version !== 1 || value.application !== 'blanca'
    || value.sourceSchema !== 'public' || !Array.isArray(value.sourceTables) || value.sourceTables.length !== 2
    || value.sourceTables[0] !== 'ventas' || value.sourceTables[1] !== 'ventas_productos'
    || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) fail();
  const input = Object.fromEntries(INPUT_KEYS.map(key => [key, value[key]]));
  const body = inputBody(input);
  if (!timingSafeEqual(Buffer.from(value.sha256, 'hex'), Buffer.from(digest(body), 'hex'))) fail();
  return { ...body, sha256: value.sha256 };
}

/** The one private runtime variable contains the complete, checksummed policy. */
export function serializeWhiteSalesHistoryReset(manifest: WhiteSalesHistoryReset): string {
  const encoded = Buffer.from(JSON.stringify(validatedManifest(manifest)), 'utf8').toString('base64');
  if (encoded.length > MAX_ENCODED_BYTES) fail();
  return encoded;
}
export function parseWhiteSalesHistoryReset(encoded: string, expectedInstanceId: string | undefined,
  expectedEnvironment: string | undefined): WhiteSalesHistoryReset {
  if (typeof encoded !== 'string' || !encoded.length || encoded.length > MAX_ENCODED_BYTES
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail();
  let value: unknown;
  try {
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded) fail();
    const json = bytes.toString('utf8');
    if (!Buffer.from(json, 'utf8').equals(bytes)) fail();
    value = JSON.parse(json);
  } catch { fail(); }
  const manifest = validatedManifest(value);
  if (manifest.databaseInstanceId !== expectedInstanceId?.toLowerCase() || manifest.environment !== expectedEnvironment) fail();
  return manifest;
}
export function whiteSalesHistoryReset(): WhiteSalesHistoryReset | null {
  const encoded = process.env.WHITE_SALES_HISTORY_RESET;
  return encoded === undefined ? null
    : parseWhiteSalesHistoryReset(encoded, process.env.SHARED_DATABASE_ID, process.env.SHARED_DATABASE_ENVIRONMENT);
}

/** Apply to every public history lookup, including direct tickets and warranties.
 * Identity is composite: two modules may legitimately use the same textual ID.
 * Origin excludes all future black sales; the MVCC baseline hides only already
 * committed documents. A later white commit remains visible even if backdated.
 */
export function whiteSalesHistoryPredicate(kind: SaleKind, params: unknown[],
  reset = whiteSalesHistoryReset()): string {
  if (!reset) return 'true';
  params.push(reset.excludedIds[kind]);
  return `(v.origen_app='blanca' AND NOT (v.id=ANY($${params.length}::text[])))`;
}

export function whiteSaleBelongsToCurrentHistory(kind: SaleKind, id: string, origin: string,
  reset = whiteSalesHistoryReset()): boolean {
  return reset === null || (origin === 'blanca' && !reset.excludedIds[kind].includes(id));
}
