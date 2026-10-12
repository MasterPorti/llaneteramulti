import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';

// Only application reads convert NUMERIC to numbers and timestamps to strings.
// The migration preserves the native PostgreSQL values independently.
types.setTypeParser(1700, (value) => Number(value));
types.setTypeParser(1082, (value) => value);
types.setTypeParser(1114, (value) => value.replace(' ', 'T'));
types.setTypeParser(1184, (value) => new Date(value).toISOString());

declare global {
  var _llanteraPg: { pool: Pool; url: string; expected: string | undefined } | undefined;
}

function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL: llaneteramulti requiere su base PostgreSQL configurada.');
  const database = decodeURIComponent(new URL(url).pathname.slice(1));
  const expected = process.env.LLANTERA_EXPECTED_DATABASE;
  if (!expected) throw new Error('Falta LLANTERA_EXPECTED_DATABASE para proteger la base de origen.');
  if (database !== expected) throw new Error('DATABASE_URL no apunta a la base confirmada para llaneteramulti.');
  if (!global._llanteraPg || global._llanteraPg.url !== url || global._llanteraPg.expected !== expected) {
    const previous = global._llanteraPg;
    global._llanteraPg = {
      url, expected,
      pool: new Pool({
        connectionString: url,
        options: '-c timezone=America/Mexico_City -c search_path=public',
        ssl: process.env.DB_REQUIRE_SSL === 'true' ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined,
      }),
    };
    if (previous) void previous.pool.end();
  }
  return global._llanteraPg.pool;
}

async function getClient(): Promise<PoolClient> {
  const client = await getPool().connect();
  try {
    const result = await client.query<{ database: string; runtime: string | null }>(
      "SELECT current_database() AS database,to_regclass('migration_new_tires.runtime_setup')::text AS runtime");
    if (result.rows[0].database !== process.env.LLANTERA_EXPECTED_DATABASE) throw new Error('La conexión no corresponde a la base de llaneteramulti.');
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
