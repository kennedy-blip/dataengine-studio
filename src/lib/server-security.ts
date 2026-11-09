import { lookup } from 'node:dns/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import type { NextRequest } from 'next/server';

export class ApiError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site') throw new ApiError('Cross-site requests are not allowed.', 403);
  if (origin) {
    let host: string;
    try { host = new URL(origin).host; } catch { throw new ApiError('Invalid request origin.', 403); }
    const hosts = [request.headers.get('host'), request.headers.get('x-forwarded-host')?.split(',')[0]?.trim(), request.nextUrl.host];
    if (!hosts.includes(host)) throw new ApiError('Request origin does not match this workspace.', 403);
  }
}
const rateBuckets = new Map<string, { count: number; reset: number }>();
export function rateLimit(request: NextRequest, bucket: string, max = 30) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const key = `${bucket}:${ip}`; const now = Date.now();
  if (rateBuckets.size > 10000) for (const [k, v] of rateBuckets) if (v.reset < now) rateBuckets.delete(k);
  let value = rateBuckets.get(key);
  if (!value || value.reset < now) { value = { count: 0, reset: now + 60_000 }; rateBuckets.set(key, value); }
  value.count++;
  if (value.count > max) throw new ApiError('Too many requests. Please wait a minute and try again.', 429);
}
export async function readLimitedJson(request: NextRequest, maxBytes = 2 * 1024 * 1024): Promise<unknown> {
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) throw new ApiError('Request body is too large.', 413);
  if (!request.headers.get('content-type')?.includes('application/json')) throw new ApiError('Content-Type must be application/json.', 415);
  const reader = request.body?.getReader(); if (!reader) throw new ApiError('A JSON request body is required.');
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new ApiError(`Request body exceeds ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`, 413); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError('The request body is not valid JSON.'); }
}
export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    if (parsed.range() !== 'unicast') return false;
    if (parsed.kind() === 'ipv6') {
      const ipv6 = parsed as ipaddr.IPv6;
      if ([['2001::', 32], ['2001:10::', 28], ['2001:20::', 28], ['2002::', 16]].some(([base, bits]) => ipv6.match(ipaddr.IPv6.parse(String(base)), Number(bits)))) return false;
    }
    return true;
  } catch { return false; }
}
export async function publicAddresses(hostname: string): Promise<{ address: string; family: number }[]> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (!host || /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/i.test(host)) throw new ApiError('Local and private network hosts are not allowed.', 403);
  if (ipaddr.isValid(host)) { if (!isPublicAddress(host)) throw new ApiError('Private, loopback, and reserved addresses are not allowed.', 403); return [{ address: ipaddr.process(host).toString(), family: host.includes(':') ? 6 : 4 }]; }
  let addresses: { address: string; family: number }[];
  try { addresses = await lookup(host, { all: true, verbatim: true }); } catch { throw new ApiError('The host could not be resolved.'); }
  if (!addresses.length || addresses.length > 32 || addresses.some(a => !isPublicAddress(a.address))) throw new ApiError('The destination must resolve only to public internet addresses.', 403);
  return addresses;
}
export function requireWorkspaceAccess(request: NextRequest) {
  const expected = process.env.DATAENGINE_ACCESS_TOKEN;
  if (!expected || expected.length < 32) throw new ApiError('Database connectors are disabled until the deployment owner sets DATAENGINE_ACCESS_TOKEN (at least 32 characters).', 503);
  const supplied = request.headers.get('x-dataengine-key') ?? '';
  const a = createHash('sha256').update(expected).digest(), b = createHash('sha256').update(supplied.slice(0, 4096)).digest();
  if (!supplied || !timingSafeEqual(a, b)) throw new ApiError('A valid workspace access token is required for database connectors.', 401);
}
export function requireConfiguredConnection(driver: string, supplied?: unknown): string {
  const keys: Record<string, string> = { postgresql: 'DATAENGINE_POSTGRES_URL', mysql: 'DATAENGINE_MYSQL_URL', mongodb: 'DATAENGINE_MONGODB_URL' };
  const key = keys[driver]; if (!key) throw new ApiError('Choose PostgreSQL, MySQL, or MongoDB.');
  const configured = process.env[key];
  if (!configured) throw new ApiError(`${driver} is not configured. Set ${key} in the deployment environment.`, 503);
  if (supplied) {
    if (typeof supplied !== 'string' || supplied.length > 4096) throw new ApiError('Invalid connection string.');
    const a = createHash('sha256').update(configured).digest(), b = createHash('sha256').update(supplied).digest();
    if (!timingSafeEqual(a, b)) throw new ApiError('Only connections explicitly configured by the deployment owner are accepted. Arbitrary connection strings are blocked.', 403);
  }
  return configured;
}
export async function assertDatabaseHost(connectionString: string) {
  let url: URL; try { url = new URL(connectionString); } catch { throw new ApiError('The configured database connection string is invalid.', 503); }
  if (url.hostname.includes(',')) throw new ApiError('Use a single database host in the configured connection.', 503);
  if (process.env.DATAENGINE_ALLOW_PRIVATE_DATABASES === 'true') return;
  if (url.protocol === 'mongodb+srv:') {
    const { resolveSrv } = await import('node:dns/promises');
    let records: { name: string; port: number }[];
    try { records = await resolveSrv(`_mongodb._tcp.${url.hostname}`); } catch { throw new ApiError('MongoDB SRV records could not be resolved.', 403); }
    if (!records.length || records.length > 20) throw new ApiError('Invalid MongoDB SRV response.', 403);
    for (const record of records) await publicAddresses(record.name);
  } else await publicAddresses(url.hostname);
}
export function errorResponse(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  // Driver errors may contain credentials or SQL values. Never return/log their raw message.
  return Response.json({ error: 'The request could not be completed. Check the connection, query, permissions, and deployment configuration.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
}
