import type { NextRequest } from 'next/server';
import { analyze } from '@/lib/data';
import { ApiError, errorResponse, rateLimit, readLimitedJson, sameOrigin } from '@/lib/server-security';
import type { Row } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;
export async function GET() {
  return Response.json({
    name: 'DataEngine Studio · Mock dataset API', method: 'POST', endpoint: '/api/mock',
    body: { dataset: 'customers', data: [{ id: 1, name: 'Example' }], limit: 100, offset: 0, fields: ['id', 'name'] },
    limits: { body_bytes: 2_000_000, rows: 10_000, columns: 200, page_size: 1000 },
    storage: 'Stateless. Submit the cleaned dataset in the request body. Nothing is stored or published.',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request); rateLimit(request, 'mock', 60);
    const body = await readLimitedJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('Provide a JSON object with a data array.');
    const input = body as Record<string, unknown>;
    if (!Array.isArray(input.data) || input.data.length > 10000) throw new ApiError('data must be an array with at most 10,000 rows.');
    const rows: Row[] = input.data.map((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new ApiError(`Row ${index + 1} must be an object.`);
      const entries = Object.entries(row);
      if (entries.length > 200) throw new ApiError('The mock API supports at most 200 columns.');
      for (const [key, value] of entries) { if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new ApiError('Unsafe column name.'); if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new ApiError(`Row ${index + 1}, ${key}: values must be strings, numbers, booleans, or null.`); if (typeof value === 'number' && !Number.isFinite(value)) throw new ApiError('Non-finite numeric values are not supported.'); }
      return Object.fromEntries(entries) as Row;
    });
    const { columns } = analyze(rows);
    const offset = Math.max(0, Math.floor(Number(input.offset) || 0));
    const limit = Math.min(1000, Math.max(1, Math.floor(Number(input.limit) || 100)));
    const fields = input.fields === undefined ? columns.map(c => c.name) : Array.isArray(input.fields) && input.fields.every(f => typeof f === 'string') ? input.fields as string[] : null;
    if (!fields || fields.some(f => !columns.some(c => c.name === f))) throw new ApiError('fields must contain existing column names.');
    if (input.dataset !== undefined && (typeof input.dataset !== 'string' || input.dataset.length > 200)) throw new ApiError('dataset must be a short string.');
    const page = rows.slice(offset, offset + limit).map(row => Object.fromEntries(fields.map(field => [field, row[field] ?? null])));
    return Response.json({ dataset: input.dataset ?? 'processed_dataset', meta: { total_rows: rows.length, returned_rows: page.length, offset, limit, columns: columns.map(c => ({ name: c.name, type: c.type })), has_more: offset + page.length < rows.length }, data: page }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return errorResponse(error); }
}
