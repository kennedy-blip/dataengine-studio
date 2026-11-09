import { describe, expect, it } from 'vitest';
import { analyze, detectHeader, flattenObject, inferType, isDateValue, matchesType, matrixToRows, parseFormattedDate, quantile, rowKey, stats, uniqueHeaders } from '@/lib/data';
import { createSampleDatasets } from '@/lib/sample';

describe('structural normalization', () => {
  it('infers all five scalar types without coercing mixed columns', () => {
    expect(inferType([1, 2, null])).toBe('Integer');
    expect(inferType([1, 2.5])).toBe('Float');
    expect(inferType(['1', '2.5'])).toBe('Float');
    expect(inferType(['true', false])).toBe('Boolean');
    expect(inferType(['2026-01-01', '2026-02-01'])).toBe('Datetime');
    expect(inferType(['a', 1])).toBe('String');
    expect(inferType([null, 'NA'])).toBe('String');
  });
  it('rejects impossible dates and accepts real leap days', () => {
    expect(isDateValue('2024-02-29')).toBe(true);
    expect(isDateValue('2025-02-29')).toBe(false);
    expect(isDateValue('2026-13-01')).toBe(false);
    expect(isDateValue('12345')).toBe(false);
    expect(parseFormattedDate('31/12/2026', 'DD/MM/YYYY')).toBe(Date.UTC(2026, 11, 31));
    expect(parseFormattedDate('2026-02-30')).toBeNull();
    expect(parseFormattedDate('2026-01-01extra')).toBeNull();
  });
  it('detects headers but retains numeric first rows', () => {
    expect(detectHeader([['name', 'age'], ['Ada', 31], ['Grace', 42]])).toBe(true);
    expect(detectHeader([[1, 2], [3, 4]])).toBe(false);
    expect(matrixToRows([[1, 2], [3, 4]], false)).toEqual([{ column_1: 1, column_2: 2 }, { column_1: 3, column_2: 4 }]);
  });
  it('makes duplicate and blank headers unique and preserves sparse rows', () => {
    expect(uniqueHeaders(['name', 'name', '', 'name'])).toEqual(['name', 'name_2', 'column_3', 'name_3']);
    expect(matrixToRows([['a', 'b'], [1], [2, 3]], true)).toEqual([{ a: 1, b: null }, { a: 2, b: 3 }]);
  });
  it('flattens nested JSON without prototype pollution', () => {
    expect(flattenObject({ user: { name: 'Ada' }, tags: ['a', 'b'], '__proto__': { polluted: true } })).toEqual({ 'user.name': 'Ada', tags: '["a","b"]' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('strictly validates types', () => {
    expect(matchesType('1.5', 'Integer')).toBe(false);
    expect(matchesType('1.5', 'Float')).toBe(true);
    expect(matchesType('yes', 'Boolean')).toBe(false);
    expect(matchesType('true', 'Boolean')).toBe(true);
    expect(matchesType(123, 'String')).toBe(false);
    expect(matchesType(null, 'Integer')).toBe(true);
  });
});
describe('quality and statistics', () => {
  it('computes population statistics and interpolated quantiles', () => {
    expect(quantile([1, 2, 3, 4], .5)).toBe(2.5);
    const s = stats([1, 2, 3, 4, 100]);
    expect(s.mean).toBe(22); expect(s.median).toBe(3); expect(s.q1).toBe(2); expect(s.q3).toBe(4); expect(s.std).toBeCloseTo(39.0128);
  });
  it('reports missing cells, exact duplicates, anomalies, and schema errors', () => {
    const rows = [{ id: 1, v: 10 }, { id: 1, v: null }, { id: 1, v: 10 }, ...Array.from({ length: 10 }, (_, i) => ({ id: i + 3, v: i })), { id: 99, v: 1000 }];
    const report = analyze(rows, [{ column: 'id', type: 'Integer', unique: true }, { column: 'missing', required: true }, { column: 'v', notNull: true, max: 100 }]);
    expect(report.quality.missing).toBe(1); expect(report.quality.duplicates).toBe(1); expect(report.quality.anomalies).toBeGreaterThan(0); expect(report.quality.schemaErrors).toBeGreaterThan(3); expect(report.quality.score).toBeLessThan(100);
  });
  it('does not require a column when existence is explicitly optional', () => { expect(analyze([{ a: 1 }], [{ column: 'b', required: false, type: 'Integer' }]).quality.schemaErrors).toBe(0); });
  it('rejects unsafe validation regex', () => { expect(analyze([{ a: 'aaaa' }], [{ column: 'a', pattern: '(a+)+$' }]).quality.schemaErrors).toBe(1); });
  it('distinguishes string and numeric keys for exact deduplication', () => { expect(rowKey({ a: 1 })).not.toBe(rowKey({ a: '1' })); });
  it('creates deterministic, explicitly synthetic sample sources', () => {
    const a = createSampleDatasets(), b = createSampleDatasets();
    expect(a[0].rows).toEqual(b[0].rows); expect(a[0].rows).toHaveLength(1248); expect(a[0].demo).toBe(true); expect(a[1].rows).toHaveLength(180); expect(a[2].rows).toHaveLength(8);
    expect(analyze(a[0].rows).quality.missing).toBeGreaterThan(0);
  });
});
