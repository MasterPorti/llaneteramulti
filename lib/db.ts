import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';
type SharedDatabaseEnvironment = 'development' | 'production';
interface SharedDatabaseSettings {
  url: string;
  database: string;
  environment: SharedDatabaseEnvironment;
  instanceId: string;
}

declare global {
  var _sharedCanonicalPg: { pool: Pool; settings: SharedDatabaseSettings } | undefined;
}

/** Validate local intent before creating a pool. Never infer development from a database name. */
function sharedSettings(): SharedDatabaseSettings {
  if (process.env.CENTRAL_INVENTORY_DATABASE_URL !== undefined) {
    throw new Error('El modo unificado no admite CENTRAL_INVENTORY_DATABASE_URL; usa únicamente la base compartida.');
  }
  const environment = process.env.SHARED_DATABASE_ENVIRONMENT;
  if (environment !== 'development' && environment !== 'production') {
    throw new Error('Falta una SHARED_DATABASE_ENVIRONMENT válida (development o production).');
  }
  if (environment === 'production' && process.env.NODE_ENV !== 'production') {
    throw new Error('El entorno de desarrollo no puede conectarse a la base compartida de producción.');
  }
  const instanceId = process.env.SHARED_DATABASE_ID;
  if (!instanceId || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(instanceId)) {
    throw new Error('Falta una SHARED_DATABASE_ID válida para identificar la instancia compartida.');
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL para la base compartida.');
  let database: string;
  try {
    const parsed = new URL(url);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) throw new Error();
    database = decodeURIComponent(parsed.pathname.slice(1));
    if (!database || database.includes('/')) throw new Error();
  } catch {
    // URL parser errors may include the connection string. Do not propagate them.
    throw new Error('DATABASE_URL no es una conexión PostgreSQL válida con una base explícita.');
  }
  return { url, database, environment, instanceId: instanceId.toLowerCase() };
}

async function getSharedClient(): Promise<PoolClient> {
  const settings = sharedSettings();
  const previous = global._sharedCanonicalPg;
  if (!previous || Object.keys(settings).some((key) =>
    previous.settings[key as keyof SharedDatabaseSettings] !== settings[key as keyof SharedDatabaseSettings])) {
    global._sharedCanonicalPg = {
      settings,
      pool: new Pool({
        connectionString: settings.url,
        application_name: 'shared_canonical_application',
        options: '-c timezone=America/Mexico_City -c search_path=public',
        ssl: process.env.DB_REQUIRE_SSL === 'true'
          ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined,
      }),
    };
    if (previous) void previous.pool.end();
  }
  const client = await global._sharedCanonicalPg!.pool.connect();
  try {
    // These are the only statements allowed before identity verification. They do not initialize schema.
    const identity = await client.query<{ database: string; configuration: string | null }>(
      "SELECT current_database() AS database,to_regclass('shared_runtime.configuration')::text AS configuration");
    if (identity.rows.length !== 1 || identity.rows[0].database !== settings.database || !identity.rows[0].configuration) {
      throw new Error('La base conectada no tiene la identidad y configuración compartida esperadas.');
    }
    const result = await client.query<{ version: number; environment: string; instance_id: string }>(
      'SELECT version,environment,instance_id::text AS instance_id FROM shared_runtime.configuration WHERE singleton IS TRUE');
    const actual = result.rows[0];
    if (result.rows.length !== 1 || actual.version !== 1 || actual.environment !== settings.environment ||
      actual.instance_id !== settings.instanceId) {
      throw new Error('La versión, entorno o instancia de la base compartida no coincide con la configuración autorizada.');
    }
    if (actual.environment === 'production' && process.env.NODE_ENV !== 'production') {
      throw new Error('El entorno de desarrollo no puede operar la base compartida de producción.');
    }
    return client;
  } catch (error) {
    client.release(true);
    throw error;
  }
}

// Only application reads convert NUMERIC to numbers and timestamps to strings.
// The migration preserves the native PostgreSQL values independently.
types.setTypeParser(1700, (value) => Number(value));
types.setTypeParser(1082, (value) => value);
types.setTypeParser(1114, (value) => value.replace(' ', 'T'));
types.setTypeParser(1184, (value) => new Date(value).toISOString());

declare global {
  var _llanteraPg: { pool: Pool; url: string; expected: string; applicationId: string } | undefined;
}

function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL: llaneteramulti requiere su base PostgreSQL configurada.');
  const database = decodeURIComponent(new URL(url).pathname.slice(1));
  const expected = process.env.LLANTERA_EXPECTED_DATABASE;
  if (!expected) throw new Error('Falta LLANTERA_EXPECTED_DATABASE para proteger la base de origen.');
  if (database !== expected) throw new Error('DATABASE_URL no apunta a la base confirmada para llaneteramulti.');
  const applicationId = process.env.LLANTERA_APPLICATION_ID;
  // 52 ASCII bytes: PostgreSQL must not truncate the application_name marker.
  if (!applicationId || !/^llm:[a-f0-9]{48}$/.test(applicationId)) {
    throw new Error('Falta una LLANTERA_APPLICATION_ID válida para identificar la versión revisada de la aplicación.');
  }
  if (!global._llanteraPg || global._llanteraPg.url !== url || global._llanteraPg.expected !== expected || global._llanteraPg.applicationId !== applicationId) {
    const previous = global._llanteraPg;
    global._llanteraPg = {
      url, expected, applicationId,
      pool: new Pool({
        connectionString: url,
        application_name: applicationId,
        options: '-c timezone=America/Mexico_City -c search_path=public',
        ssl: process.env.DB_REQUIRE_SSL === 'true' ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined,
      }),
    };
    if (previous) void previous.pool.end();
  }
  return global._llanteraPg.pool;
}

async function getClient(): Promise<PoolClient> {
  if (process.env.SHARED_DATABASE_MODE === 'true') return getSharedClient();
  const client = await getPool().connect();
  try {
    const result = await client.query<{ database: string; runtime: string | null; application_id: string }>(
      "SELECT current_database() AS database,to_regclass('migration_new_tires.runtime_setup')::text AS runtime,current_setting('application_name') AS application_id");
    if (result.rows[0].database !== process.env.LLANTERA_EXPECTED_DATABASE) throw new Error('La conexión no corresponde a la base de llaneteramulti.');
    if (result.rows[0].application_id !== process.env.LLANTERA_APPLICATION_ID) throw new Error('La sesión PostgreSQL no identifica la versión revisada de la aplicación.');
    // A matching database name is insufficient: the source and published server
    // can both call their database postgres. No adapter may write before setup.
    if (!result.rows[0].runtime) throw new Error('La base conectada todavía no tiene instalada la migración y su esquema operativo verificado.');
    const runtime = await client.query<{ version: number }>('SELECT version FROM migration_new_tires.runtime_setup');
    if (runtime.rows.length !== 1 || runtime.rows[0].version !== 1) throw new Error('La versión del esquema operativo no es compatible con esta aplicación.');
    return client;
  } catch (error) { client.release(); throw error; }
}

export const db = {
  getClient,
  async query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) {
    const client = await getClient();
    try { return await client.query<T>(sql, params); }
    finally { client.release(); }
  },
};

export async function transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getClient();
  let discardConnection = false;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // Keep the original failure if a broken connection also rejects ROLLBACK.
    try { await client.query('ROLLBACK'); } catch { discardConnection = true; }
    throw error;
  }
  finally { client.release(discardConnection); }
}
