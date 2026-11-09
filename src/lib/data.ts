import safeRegex from 'safe-regex2';
import type { CellValue, ColumnSchema, DataType, QualityReport, Row, ValidationRule } from './types';

export const isNull = (v: unknown): v is null | undefined => v === null || v === undefined || (typeof v === 'string' && ['', 'null', 'undefined', 'nan', 'n/a', 'na'].includes(v.trim().toLowerCase()));
export const cleanNull = (v: unknown): CellValue => isNull(v) ? null : typeof v === 'number' ? (Number.isFinite(v) ? v : null) : typeof v === 'boolean' ? v : String(v);
export const numeric = (v: CellValue): number | null => {
  if (isNull(v) || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
export const columnsOf = (rows: Row[]): string[] => [...new Set(rows.flatMap(row => Object.keys(row)))];
export function uniqueHeaders(headers: unknown[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h, i) => {
    const base = String(h ?? '').trim() || `column_${i + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
}
export function matrixToRows(matrix: unknown[][], hasHeader: boolean): Row[] {
  const width = Math.max(0, ...matrix.map(r => r.length));
  if (!width) return [];
  const headers = uniqueHeaders(hasHeader ? matrix[0] : Array.from({ length: width }, (_, i) => `column_${i + 1}`));
  return matrix.slice(hasHeader ? 1 : 0).filter(r => r.some(v => !isNull(v))).map(r => Object.fromEntries(headers.map((h, i) => [h, cleanNull(r[i])])));
}
export function detectHeader(matrix: unknown[][]): boolean {
  if (matrix.length < 2 || !matrix[0]?.length) return false;
  const first = matrix[0];
  if (!first.every(v => typeof v === 'string' && v.trim().length > 0 && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim()) && !/^(true|false)$/i.test(v.trim()) && !isDateValue(v))) return false;
  if (new Set(first.map(String)).size !== first.length) return false;
  const body = matrix.slice(1, 30);
  let score = 0;
  first.forEach((header, i) => {
    const values = body.map(r => r[i]).filter(v => !isNull(v));
    const structured = values.filter(v => typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && (/^\d{4}-\d{2}-\d{2}/.test(v) || /^(true|false)$/i.test(v) || /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim())))).length;
    if (typeof header === 'string' && /^[\w .$/()-]+$/.test(header) && header.length < 60 && structured > values.length * 0.6) score += 2;
    if (values.length && values.every(v => typeof v !== 'number' && typeof v !== 'boolean') && typeof header === 'string' && header.length < 35 && values.some(v => String(v).length > header.length)) score++;
  });
  return score >= Math.max(2, first.length * 0.65);
}
export function isDateValue(v: CellValue): boolean {
  if (typeof v !== 'string' || !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) return false;
  const normalized = v.replace(/\//g, '-');
  const [year, month, day] = normalized.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && Number.isFinite(Date.parse(normalized));
}
export function inferType(values: CellValue[]): DataType {
  const v = values.filter(x => !isNull(x));
  if (!v.length) return 'String';
  if (v.every(x => typeof x === 'boolean' || (typeof x === 'string' && /^(true|false)$/i.test(x.trim())))) return 'Boolean';
  if (v.every(x => typeof x !== 'boolean' && numeric(x) !== null)) return v.every(x => Number.isSafeInteger(Number(x))) ? 'Integer' : 'Float';
  if (v.every(isDateValue)) return 'Datetime';
  return 'String';
}
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  return sorted[base] + (sorted[Math.min(base + 1, sorted.length - 1)] - sorted[base]) * (pos - base);
}
export function stats(values: number[]) {
  const n = values.length;
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : 0;
  const variance = n ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / n : 0;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75);
  return { mean, median: quantile(sorted, 0.5), std: Math.sqrt(variance), min: sorted[0] ?? 0, max: sorted[n - 1] ?? 0, q1, q3, iqr: q3 - q1 };
}
export function rowKey(row: Row, columns?: string[]): string {
  return JSON.stringify((columns ?? Object.keys(row).sort()).map(k => [k, row[k] ?? null]));
}
export function analyze(rows: Row[], rules: ValidationRule[] = []): { columns: ColumnSchema[]; quality: QualityReport } {
  const names = columnsOf(rows);
  const seen = new Set<string>();
  let duplicates = 0;
  // Keep the source column order stable, even for sparse JSON records.
  for (const row of rows) { const key = rowKey(row, names); if (seen.has(key)) duplicates++; else seen.add(key); }
  const columns: ColumnSchema[] = names.map(name => {
    const values = rows.map(r => r[name] ?? null);
    const present = values.filter(v => !isNull(v));
    const nums = present.map(numeric).filter((v): v is number => v !== null);
    const s = stats(nums);
    const lower = s.q1 - 1.5 * s.iqr, upper = s.q3 + 1.5 * s.iqr;
    const anomalies = nums.length >= 8 && s.iqr > 0 ? nums.filter(v => v < lower || v > upper).length : 0;
    const missing = values.length - present.length;
    return { name, type: inferType(values), missing, missingPercent: rows.length ? missing / rows.length * 100 : 0, unique: new Set(present.map(v => JSON.stringify(v))).size, anomalies, ...(nums.length === present.length && nums.length ? { min: s.min, max: s.max } : {}) };
  });
  const issues: QualityReport['issues'] = [];
  let schemaErrors = 0;
  const addIssue = (row: number, column: string, message: string, rule: string) => {
    schemaErrors++;
    if (issues.length < 100) issues.push({ row: row + 1, column, message, rule });
  };
  for (const rule of rules) {
    if (!names.includes(rule.column)) { if (rule.required !== false) addIssue(0, rule.column, 'Required column is missing.', 'required column'); continue; }
    let pattern: RegExp | null = null;
    if (rule.pattern) { if (rule.pattern.length > 200 || !safeRegex(rule.pattern)) { addIssue(0, rule.column, 'Validation expression is too complex.', 'pattern'); continue; } try { pattern = new RegExp(rule.pattern); } catch { addIssue(0, rule.column, 'Invalid validation expression.', 'pattern'); continue; } }
    const unique = new Set<string>();
    rows.forEach((row, i) => {
      const value = row[rule.column] ?? null;
      if (rule.notNull && isNull(value)) addIssue(i, rule.column, 'Value is required.', 'not null');
      if (rule.unique && !isNull(value)) { const key = JSON.stringify(value); if (unique.has(key)) addIssue(i, rule.column, 'Duplicate key value.', 'unique'); unique.add(key); }
      if (isNull(value)) return;
      if (rule.type && !matchesType(value, rule.type)) addIssue(i, rule.column, `Expected ${rule.type}.`, 'type');
      const n = numeric(value);
      if (rule.min !== undefined && (n === null || n < rule.min)) addIssue(i, rule.column, `Value must be at least ${rule.min}.`, 'minimum');
      if (rule.max !== undefined && (n === null || n > rule.max)) addIssue(i, rule.column, `Value must be at most ${rule.max}.`, 'maximum');
      if (pattern && !pattern.test(String(value))) addIssue(i, rule.column, 'Value does not match the required pattern.', 'pattern');
      if (rule.allowed?.length && !rule.allowed.includes(String(value))) addIssue(i, rule.column, 'Value is not in the allowed set.', 'allowed values');
    });
  }
  const totalCells = rows.length * names.length;
  const missing = columns.reduce((a, c) => a + c.missing, 0);
  const anomalies = columns.reduce((a, c) => a + c.anomalies, 0);
  const missingPercent = totalCells ? missing / totalCells * 100 : 0;
  const penalty = Math.min(40, missingPercent * 1.5) + Math.min(20, (rows.length ? duplicates / rows.length * 100 : 0) * 1.5) + Math.min(20, (rows.length ? anomalies / rows.length * 100 : 0) * 0.5) + Math.min(40, (rows.length ? schemaErrors / rows.length * 100 : schemaErrors ? 100 : 0) * 2);
  return { columns, quality: { score: rows.length ? Math.max(0, Math.round((100 - penalty) * 10) / 10) : 0, missing, missingPercent, duplicates, anomalies, schemaErrors, issues, totalCells } };
}
export function matchesType(value: CellValue, type: DataType): boolean {
  if (isNull(value)) return true;
  if (type === 'Integer') return numeric(value) !== null && Number.isSafeInteger(Number(value));
  if (type === 'Float') return numeric(value) !== null;
  if (type === 'Boolean') return typeof value === 'boolean' || /^(true|false|0|1)$/i.test(String(value));
  if (type === 'Datetime') return isDateValue(value) || (typeof value === 'string' && /^\d{2}[-/]\d{2}[-/]\d{4}$/.test(value) && parseFormattedDate(value, 'DD/MM/YYYY') !== null);
  return typeof value === 'string';
}
export function parseFormattedDate(value: string, format = 'YYYY-MM-DD'): number | null {
  const tokens = ['YYYY', 'MM', 'DD'];
  let pos = 0;
  const parts: Record<string, number> = {};
  for (let i = 0; i < format.length; i++) {
    const token = tokens.find(t => format.startsWith(t, i));
    if (token) { const digits = value.slice(pos, pos + token.length); if (!new RegExp(`^\\d{${token.length}}$`).test(digits)) return null; parts[token] = Number(digits); pos += token.length; i += token.length - 1; }
    else { if (value[pos] !== format[i]) return null; pos++; }
  }
  if (pos !== value.length || !parts.YYYY || !parts.MM || !parts.DD) return null;
  const date = new Date(Date.UTC(parts.YYYY, parts.MM - 1, parts.DD));
  if (date.getUTCFullYear() !== parts.YYYY || date.getUTCMonth() !== parts.MM - 1 || date.getUTCDate() !== parts.DD) return null;
  return date.getTime();
}
export function flattenObject(input: unknown, prefix = '', out: Row = {}, depth = 0): Row {
  if (depth > 12) throw new Error('Nested data exceeds 12 levels. Flatten the source before importing.');
  if (input && typeof input === 'object' && !Array.isArray(input) && !(input instanceof Date)) {
    for (const [key, value] of Object.entries(input)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      const name = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) flattenObject(value, name, out, depth + 1);
      else out[name] = value === null || value === undefined ? null : typeof value === 'object' ? JSON.stringify(value) : cleanNull(value);
    }
  } else out[prefix || 'value'] = Array.isArray(input) ? JSON.stringify(input) : cleanNull(input);
  return out;
}
export function displayValue(value: CellValue): string { return isNull(value) ? '' : String(value); }
export function formatNumber(value: number): string { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value); }
