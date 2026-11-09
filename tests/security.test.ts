import { describe, expect, it, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ApiError, errorResponse, isPublicAddress, publicAddresses, readLimitedJson, requireConfiguredConnection, sameOrigin } from '@/lib/server-security';
const request = (headers: Record<string,string> = {}) => new NextRequest('http://localhost:3000/api/mock', { headers });
describe('connector security', () => {
  it('blocks private, loopback, link-local, metadata, reserved, and mapped addresses', () => {
    for (const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','0.0.0.0','100.64.0.1','224.0.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2001::1','2002:0101:0101::1','2001:db8::1']) expect(isPublicAddress(ip), ip).toBe(false);
    for (const ip of ['8.8.8.8','1.1.1.1','2001:4860:4860::8888']) expect(isPublicAddress(ip), ip).toBe(true);
  });
  it('rejects local hostnames before DNS', async () => { await expect(publicAddresses('localhost')).rejects.toThrow(); await expect(publicAddresses('service.internal')).rejects.toThrow(); await expect(publicAddresses('127.0.0.1')).rejects.toThrow(); });
  it('rejects cross-site browser requests', () => { expect(() => sameOrigin(request({ 'sec-fetch-site': 'cross-site' }))).toThrow('Cross-site'); expect(() => sameOrigin(request({ origin: 'https://evil.example', host: 'localhost:3000' }))).toThrow('origin'); expect(() => sameOrigin(request({ origin: 'http://localhost:3000', host: 'localhost:3000' }))).not.toThrow(); });
  it('enforces actual streamed body limits and JSON content type', async () => { const r = new NextRequest('http://localhost:3000/api/mock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '123456789' }); await expect(readLimitedJson(r, 4)).rejects.toThrow('exceeds'); await expect(readLimitedJson(request({ 'content-type': 'text/plain' }))).rejects.toThrow('Content-Type'); });
  it('never exposes raw driver errors', async () => { const response = errorResponse(new Error('postgresql://secret:password@host')); expect(JSON.stringify(await response.json())).not.toContain('secret'); expect(response.status).toBe(502); });
  afterEach(() => { delete process.env.DATAENGINE_POSTGRES_URL; });
  it('requires an owner-configured database connection', () => { expect(() => requireConfiguredConnection('postgresql')).toThrow('not configured'); process.env.DATAENGINE_POSTGRES_URL = 'postgresql://user:secret@db.example.com/database'; expect(requireConfiguredConnection('postgresql')).toContain('secret'); expect(() => requireConfiguredConnection('postgresql', 'postgresql://other')).toThrow('explicitly configured'); expect(new ApiError('x', 403).status).toBe(403); });
});
