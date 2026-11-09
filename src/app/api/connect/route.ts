import type { NextRequest } from 'next/server';
import { request as httpsRequest } from 'node:https';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import { ApiError, assertDatabaseHost, errorResponse, publicAddresses, rateLimit, readLimitedJson, requireConfiguredConnection, requireWorkspaceAccess, sameOrigin } from '@/lib/server-security';
import { flattenObject } from '@/lib/data';
import type { Row, SourceDataset } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const MAX_RESPONSE = 4 * 1024 * 1024;
const MAX_REMOTE_ROWS = 10_000;
const drivers = [{ id: 'postgresql', name: 'PostgreSQL', env: 'DATAENGINE_POSTGRES_URL' }, { id: 'mysql', name: 'MySQL / SQL', env: 'DATAENGINE_MYSQL_URL' }, { id: 'mongodb', name: 'MongoDB', env: 'DATAENGINE_MONGODB_URL' }];
export async function GET() { return Response.json({ connections: drivers.map(d => ({ id: d.id, name: d.name, env: d.env, configured: !!process.env[d.env] })), accessRequired: !!process.env.DATAENGINE_ACCESS_TOKEN, policy: 'Database connectors require an owner-configured connection and DATAENGINE_ACCESS_TOKEN. Credentials are never persisted by the browser.' }, { headers: { 'Cache-Control': 'no-store' } }); }
async function fetchPublic(urlString: string, headers: Record<string, string>, redirects = 0): Promise<{ text: string; contentType: string; url: string; bytes: number }> {
  if (redirects > 3) throw new ApiError('The API redirected too many times.');
  let url: URL; try { url = new URL(urlString); } catch { throw new ApiError('Enter a valid HTTPS API URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && !['443', '8443'].includes(url.port))) throw new ApiError('Use an HTTPS URL on port 443 or 8443, without embedded credentials.');
  if (urlString.length > 4096) throw new ApiError('API URL is too long.');
  const addresses = await publicAddresses(url.hostname);
  const chosen = addresses.find(address => address.family === 4) ?? addresses[0];
  const result = await new Promise<{ status: number; location?: string; text: string; contentType: string; bytes: number }>((resolve, reject) => {
    const req = httpsRequest({ hostname: url.hostname, port: Number(url.port) || 443, path: url.pathname + url.search, method: 'GET', servername: url.hostname, agent: false, family: chosen.family, headers: { Host: url.host, 'User-Agent': 'DataEngine-Studio/1.0', Accept: 'application/json, text/csv, application/xml, text/yaml, text/plain', 'Accept-Encoding': 'identity', ...headers }, lookup: ((_hostname: string, _options: unknown, callback: (error: Error | null, address: string, family: number) => void) => callback(null, chosen.address, chosen.family)) as never }, res => {
      const status = res.statusCode ?? 502;
      if (status >= 300 && status < 400) { res.resume(); resolve({ status, location: res.headers.location, text: '', contentType: '', bytes: 0 }); return; }
      if (status < 200 || status >= 300) { res.resume(); reject(new ApiError(`The API returned HTTP ${status}.`, 502)); return; }
      if (Number(res.headers['content-length'] ?? 0) > MAX_RESPONSE) { res.destroy(); reject(new ApiError('API responses are limited to 4 MB.', 413)); return; }
      const encoding = res.headers['content-encoding'];
      const decoder = encoding === 'gzip' ? createGunzip({ maxOutputLength: MAX_RESPONSE }) : encoding === 'deflate' ? createInflate({ maxOutputLength: MAX_RESPONSE }) : encoding === 'br' ? createBrotliDecompress({ maxOutputLength: MAX_RESPONSE }) : null;
      const stream = decoder ? res.pipe(decoder) : res;
      const chunks: Buffer[] = []; let bytes = 0; let done = false;
      const fail = (error: Error) => { if (done) return; done = true; res.destroy(); decoder?.destroy(); reject(error); };
      stream.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_RESPONSE) fail(new ApiError('API response exceeds the 4 MB limit.', 413)); else chunks.push(chunk); });
      stream.on('error', () => fail(new ApiError('The API response could not be decoded or exceeded the size limit.', 502)));
      res.on('error', () => fail(new ApiError('The API connection was interrupted.', 502)));
      stream.on('end', () => { if (!done) { done = true; resolve({ status, text: Buffer.concat(chunks).toString('utf8'), contentType: String(res.headers['content-type'] ?? ''), bytes }); } });
    });
    req.setTimeout(12_000, () => { req.destroy(); reject(new ApiError('The API timed out after 12 seconds.', 504)); });
    req.on('error', error => reject(error instanceof ApiError ? error : new ApiError('Could not connect to the API. Check its TLS certificate and availability.', 502)));
    req.end();
  });
  if (result.status >= 300 && result.status < 400) { if (!result.location) throw new ApiError('The API redirect is missing a destination.'); const destination = new URL(result.location, url); const nextHeaders = { ...headers }; if (destination.origin !== url.origin) { delete nextHeaders.Authorization; delete nextHeaders.authorization; delete nextHeaders['X-API-Key']; delete nextHeaders['x-api-key']; } return fetchPublic(destination.toString(), nextHeaders, redirects + 1); }
  return { ...result, url: `${url.origin}${url.pathname}` };
}
function normalizeRemoteRows(records: unknown[]): Row[] {
  if (records.length > MAX_REMOTE_ROWS) throw new ApiError('Remote imports are limited to 10,000 rows. Add a limit/filter to the source.');
  return records.map(r => flattenObject(r));
}
async function importRest(input: Record<string, unknown>): Promise<SourceDataset> {
  if (typeof input.url !== 'string') throw new ApiError('Enter the REST API URL.');
  const headers: Record<string, string> = {};
  if (input.headers !== undefined) {
    if (!input.headers || typeof input.headers !== 'object' || Array.isArray(input.headers)) throw new ApiError('Headers must be an object.');
    for (const [key, value] of Object.entries(input.headers)) { if (!['authorization', 'x-api-key'].includes(key.toLowerCase()) || typeof value !== 'string' || value.length > 4096 || /[\r\n]/.test(value)) throw new ApiError('Only Authorization and X-API-Key headers are supported.'); headers[key] = value; }
  }
  const response = await fetchPublic(input.url, headers);
  const { parseDelimited, structuredRows, xmlRows } = await import('@/lib/parsers');
  let rows: Row[], delimiter: string | undefined;
  const path = new URL(response.url).pathname.toLowerCase();
  if (response.contentType.includes('csv') || response.contentType.includes('tab-separated') || path.endsWith('.csv') || path.endsWith('.tsv')) { const parsed = parseDelimited(response.text, { header: 'auto', delimiter: 'auto' }); rows = parsed.rows; delimiter = parsed.delimiter; }
  else if (response.contentType.includes('xml') || path.endsWith('.xml')) rows = xmlRows(response.text);
  else if (response.contentType.includes('yaml') || path.endsWith('.yaml')) { const { parse } = await import('yaml'); rows = structuredRows(parse(response.text, { maxAliasCount: 50 })); }
  else { try { rows = structuredRows(JSON.parse(response.text)); } catch { throw new ApiError('The API did not return JSON, CSV, XML, or YAML. HTML pages cannot be imported as a dataset.'); } }
  rows = normalizeRemoteRows(rows);
  if (!rows.length) throw new ApiError('The API returned no records.');
  const url = new URL(response.url);
  return { id: crypto.randomUUID(), name: `${url.hostname}${url.pathname.split('/').filter(Boolean).slice(-1).map(s => ` / ${s}`).join('')}`, format: 'api', rows, sourceBytes: response.bytes, importedAt: new Date().toISOString(), delimiter, note: `Read-only GET snapshot from ${url.origin}${url.pathname}. Query parameters and credentials are not saved.` };
}
async function validateSql(sql: unknown, database: 'PostgreSQL' | 'MySQL'): Promise<string> {
  if (typeof sql !== 'string' || !sql.trim() || sql.length > 8000) throw new ApiError('Enter one SELECT query (up to 8,000 characters).');
  const query = sql.trim().replace(/;\s*$/, '');
  if (/\b(into|outfile|dumpfile|for\s+update|lock\s+in\s+share)\b/i.test(query)) throw new ApiError('Only read-only SELECT queries without locking or output clauses are allowed.');
  // The dialect parser is authoritative; the lexical check above is an additional guard.
  const { Parser } = await import('node-sql-parser');
  const parser = new Parser();
  try { const ast = parser.astify(query, { database }); const statements = Array.isArray(ast) ? ast : [ast]; if (statements.length !== 1 || statements[0].type !== 'select') throw new Error(); }
  catch { throw new ApiError('Use exactly one read-only SELECT query in the selected SQL dialect.'); }
  return query;
}
async function importDatabase(input: Record<string, unknown>): Promise<SourceDataset> {
  const driver = String(input.driver ?? '');
  const connectionString = requireConfiguredConnection(driver, input.connection);
  await assertDatabaseHost(connectionString);
  const limit = Math.min(MAX_REMOTE_ROWS, Math.max(1, Number(input.limit) || 1000));
  const url = new URL(connectionString);
  let rows: Row[] = [];
  if (driver === 'postgresql') {
    const query = await validateSql(input.query, 'PostgreSQL');
    const { Client } = await import('pg');
    const client = new Client({ connectionString, connectionTimeoutMillis: 8000, statement_timeout: 10000, query_timeout: 10000, ssl: url.searchParams.get('sslmode') === 'disable' ? false : { rejectUnauthorized: true } });
    try { await client.connect(); await client.query('BEGIN READ ONLY'); const result = await client.query({ text: `SELECT * FROM (${query}) AS dataengine_snapshot LIMIT $1`, values: [limit] }); rows = normalizeRemoteRows(result.rows); await client.query('ROLLBACK'); }
    finally { await client.end().catch(() => undefined); }
  } else if (driver === 'mysql') {
    const query = await validateSql(input.query, 'MySQL');
    const mysql = await import('mysql2/promise');
    const connection = await mysql.createConnection({ uri: connectionString, multipleStatements: false, connectTimeout: 8000, ssl: url.searchParams.get('sslmode') === 'disable' ? undefined : { rejectUnauthorized: true } });
    try { await connection.query('START TRANSACTION READ ONLY'); await connection.query('SET SESSION max_execution_time = 10000'); const [result] = await connection.execute(`SELECT * FROM (${query}) AS dataengine_snapshot LIMIT ?`, [limit]); rows = normalizeRemoteRows(Array.isArray(result) ? result as unknown[] : []); await connection.rollback(); }
    finally { await connection.end().catch(() => undefined); }
  } else if (driver === 'mongodb') {
    const collectionName = String(input.collection ?? '');
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,120}$/.test(collectionName) || collectionName.startsWith('system.')) throw new ApiError('Enter a valid, non-system collection name.');
    let filter: Record<string, unknown> = {};
    try { filter = input.filter ? JSON.parse(String(input.filter)) : {}; } catch { throw new ApiError('The MongoDB filter must be valid JSON.'); }
    const inspect = (value: unknown, depth = 0): void => { if (depth > 12) throw new ApiError('MongoDB filter is too deeply nested.'); if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { if (key.startsWith('$') && !['$eq','$ne','$gt','$gte','$lt','$lte','$in','$nin','$and','$or','$nor','$not','$exists'].includes(key)) throw new ApiError('The filter contains a disallowed MongoDB operator.'); inspect(child, depth + 1); } };
    inspect(filter);
    if (!filter || Array.isArray(filter) || typeof filter !== 'object') throw new ApiError('The MongoDB filter must be a JSON object.');
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(connectionString, { maxPoolSize: 1, serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, socketTimeoutMS: 12000, tls: url.searchParams.get('tls') !== 'false' && url.searchParams.get('ssl') !== 'false', serverApi: { version: '1', strict: true, deprecationErrors: true } });
    try { await client.connect(); const databaseName = decodeURIComponent(url.pathname.replace(/^\//, '')); if (!databaseName) throw new ApiError('The configured MongoDB URL must include a database name.'); const result = await client.db(databaseName).collection(collectionName).find(filter).limit(limit).maxTimeMS(10000).toArray(); rows = normalizeRemoteRows(result); }
    finally { await client.close(true).catch(() => undefined); }
  } else throw new ApiError('Unsupported database driver.');
  if (!rows.length) throw new ApiError('The query returned no records.');
  return { id: crypto.randomUUID(), name: `${driver} · ${driver === 'mongodb' ? input.collection : 'query snapshot'}`, format: 'database', rows, sourceBytes: new TextEncoder().encode(JSON.stringify(rows)).byteLength, importedAt: new Date().toISOString(), note: `Read-only ${driver} snapshot. Connection credentials are not included in the saved dataset.` };
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request); rateLimit(request, 'connect', 20);
    const body = await readLimitedJson(request, 32_768);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('Provide a connector configuration object.');
    const input = body as Record<string, unknown>;
    if (input.kind === 'database') { rateLimit(request, 'database-access', 10); requireWorkspaceAccess(request); }
    const dataset = input.kind === 'rest' ? await importRest(input) : input.kind === 'database' ? await importDatabase(input) : null;
    if (!dataset) throw new ApiError('Choose a REST or database connector.');
    const serialized = JSON.stringify({ dataset }); if (Buffer.byteLength(serialized) > 4.4 * 1024 * 1024) throw new ApiError('The normalized snapshot is too large. Reduce the query limit.', 413); return new Response(serialized, { headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' } });
  } catch (error) { return errorResponse(error); }
}
