import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import safeRegex from 'safe-regex2';
import { analyze, columnsOf, isNull, matchesType, numeric, parseFormattedDate, quantile, rowKey, stats, uniqueHeaders } from './data';
import { compileFormula } from './formula';
import { MAX_ROWS, type CellValue, type OperationParams, type OperationResult, type OperationType, type PipelineStep, type ProcessedDataset, type Row, type SourceDataset, type ValidationRule } from './types';

function column(rows: Row[], p: OperationParams): string {
  const names = columnsOf(rows);
  if (!p.column || !names.includes(p.column)) throw new Error('Select an existing column.');
  return p.column;
}
function columns(rows: Row[], values: string[] | undefined, fallback: 'all' | 'none' = 'none'): string[] {
  const names = columnsOf(rows);
  if (!values?.length) { if (fallback === 'all') return names; throw new Error('Select at least one column.'); }
  if (values.some(c => !names.includes(c))) throw new Error('A selected column no longer exists. Update this step.');
  return [...new Set(values)];
}
function finite(value: unknown, fallback: number, min: number, max: number): number {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Enter a number between ${min} and ${max}.`);
  return n;
}
function outputName(rows: Row[], name: string | undefined, fallback: string): string {
  const n = (name || fallback).trim();
  if (!n || n.length > 100 || ['__proto__', 'constructor', 'prototype'].includes(n)) throw new Error('Choose a valid output column name (1–100 characters).');
  if (columnsOf(rows).includes(n)) throw new Error(`Column “${n}” already exists. Choose a different output name.`);
  return n;
}
function expression(pattern: string, flags = 'g'): RegExp {
  if (!pattern || pattern.length > 200 || !safeRegex(pattern)) throw new Error('Use a simpler, bounded regular expression (at most 200 characters).');
  try { return new RegExp(pattern, flags); } catch { throw new Error('The regular expression is invalid.'); }
}
function aggregate(values: CellValue[], op = 'sum'): CellValue {
  const present = values.filter(v => !isNull(v));
  if (op === 'count') return present.length;
  if (op === 'first') return present[0] ?? null;
  if (op === 'last') return present[present.length - 1] ?? null;
  if (op === 'mode') { const counts = new Map<string, { value: CellValue; count: number }>(); present.forEach(v => { const k = JSON.stringify(v); counts.set(k, { value: v, count: (counts.get(k)?.count ?? 0) + 1 }); }); return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.value ?? null; }
  const nums = present.map(numeric).filter((v): v is number => v !== null);
  if (nums.length !== present.length) throw new Error('Statistical operations require numeric columns. Cast the column or choose count/mode.');
  if (!nums.length) return null;
  if (op === 'mean') return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (op === 'median') return quantile([...nums].sort((a, b) => a - b), 0.5);
  if (op === 'min') return nums.reduce((a, b) => Math.min(a, b), Infinity);
  if (op === 'max') return nums.reduce((a, b) => Math.max(a, b), -Infinity);
  if (op === 'sum') return nums.reduce((a, b) => a + b, 0);
  throw new Error('Choose a supported aggregation.');
}
function limitRows(count: number) { if (count > MAX_ROWS) throw new Error(`This operation would exceed the ${MAX_ROWS.toLocaleString()} row workspace limit. Filter the inputs or use more selective join keys.`); }
function buckets(rows: Row[], keys: string[]): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  rows.forEach((row, i) => { const key = rowKey(row, keys); const list = groups.get(key); if (list) list.push(i); else groups.set(key, [i]); });
  return groups;
}
function boundedDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) { next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, next[j]); }
    if (best > max) return max + 1;
    prev = next;
  }
  return prev[b.length];
}
function fuzzyDeduplicate(rows: Row[], keys: string[], threshold: number): Row[] {
  if (rows.length > 10_000) throw new Error('Fuzzy matching supports up to 10,000 rows. Filter or exact-deduplicate the dataset first.');
  const normalized = rows.map(r => keys.map(k => String(r[k] ?? '')).join(' ').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 160));
  const prefix = new Map<string, number[]>(), suffix = new Map<string, number[]>();
  const accepted: number[] = [], kept: number[] = [];
  normalized.forEach((key, i) => {
    if (!key) { accepted.push(i); return; }
    const candidates = new Set([...(prefix.get(key.slice(0, 2)) ?? []), ...(suffix.get(key.slice(-2)) ?? [])]);
    let duplicate = false;
    for (const j of candidates) {
      const other = normalized[j];
      const distance = Math.ceil(Math.max(key.length, other.length) * (1 - threshold));
      if (boundedDistance(key, other, distance) <= distance) { duplicate = true; break; }
    }
    if (!duplicate) {
      accepted.push(i); kept.push(i);
      for (const [map, k] of [[prefix, key.slice(0, 2)], [suffix, key.slice(-2)]] as const) { const list = map.get(k); if (list) list.push(i); else map.set(k, [i]); }
    }
  });
  return accepted.map(i => rows[i]);
}
const positive = new Set(['good', 'great', 'excellent', 'love', 'happy', 'helpful', 'reliable', 'perfect', 'outstanding', 'recommend', 'useful', 'easy', 'responsive', 'amazing', 'fast', 'wonderful', 'satisfied']);
const negative = new Set(['bad', 'poor', 'terrible', 'hate', 'unhappy', 'slow', 'broken', 'difficult', 'confusing', 'delay', 'disappointed', 'awful', 'worst', 'expensive', 'frustrating', 'failed', 'failure', 'bug']);
export function sentiment(text: string): number {
  const words = text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
  let score = 0, count = 0;
  words.forEach((word, i) => {
    let value = positive.has(word) ? 1 : negative.has(word) ? -1 : 0;
    if (!value) return;
    const window = words.slice(Math.max(0, i - 3), i);
    if (window.some(w => ['not', 'never', 'no', "isn't", "wasn't", "don't", "doesn't", 'hardly'].includes(w))) value *= -0.8;
    if (window.some(w => ['very', 'extremely', 'highly'].includes(w))) value *= 1.3;
    score += value; count++;
  });
  return count ? Math.round(Math.max(-1, Math.min(1, score / Math.sqrt(count))) * 1000) / 1000 : 0;
}
export function summarize(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(s => s.trim()).filter(Boolean) ?? [];
  if (!sentences.length) return '';
  const frequency = new Map<string, number>();
  const words = text.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  const stop = new Set(['this', 'that', 'with', 'from', 'have', 'were', 'been', 'their', 'there', 'about', 'would', 'could', 'should', 'very', 'some', 'others']);
  words.forEach(w => { if (!stop.has(w)) frequency.set(w, (frequency.get(w) ?? 0) + 1); });
  const ranked = sentences.map((sentence, index) => ({ sentence, index, score: (sentence.toLowerCase().match(/[a-z]{4,}/g) ?? []).reduce((sum, w) => sum + (frequency.get(w) ?? 0), 0) / Math.sqrt(sentence.split(/\s+/).length) + (index === 0 ? 0.5 : 0) }));
  const result = ranked.sort((a, b) => b.score - a.score).slice(0, 2).sort((a, b) => a.index - b.index).map(s => s.sentence).join(' ');
  return result.length > 320 ? result.slice(0, 317).replace(/\s+\S*$/, '') + '…' : result;
}
function entities(text: string): string {
  const found = new Map<string, string>();
  for (const match of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) found.set(`EMAIL: ${match[0]}`, 'email');
  for (const match of text.matchAll(/(?:[$€£]\s?\d[\d,.]*(?:\s?(?:million|billion|thousand))?|\b\d{4}-\d{2}-\d{2}\b)/gi)) found.set(match[0], /^\d/.test(match[0]) ? 'DATE' : 'MONEY');
  for (const match of text.matchAll(/\b(?:[A-Z][a-z]+\s+){1,3}(?:Inc|Ltd|Limited|Corp|Corporation|Company|Group|Technologies|Labs)\b\.?/g)) found.set(match[0].trim(), 'ORG');
  for (const match of text.matchAll(/\b(?:Nairobi|London|New York|Paris|Berlin|Tokyo|Mumbai|Sydney|Lagos|Toronto|Kenya|India|Canada|Germany|Australia|Nigeria|United States|United Kingdom)\b/g)) found.set(match[0], 'LOCATION');
  return JSON.stringify([...found].map(([text, label]) => ({ text, label })));
}
function categorize(text: string): string {
  const categories: [string, RegExp][] = [['Billing & payments', /\b(bill|billing|payment|invoice|charge|refund|price|pricing|subscription)\b/i], ['Technical support', /\b(bug|error|crash|broken|failed|technical|login|password|setup|install)\b/i], ['Customer experience', /\b(service|support|helpful|response|experience|onboarding|team|waiting)\b/i], ['Product feedback', /\b(feature|dashboard|product|interface|workflow|documentation|design)\b/i], ['Sales & growth', /\b(sales|growth|upgrade|enterprise|demo|trial|revenue)\b/i]];
  return categories.find(([, re]) => re.test(text))?.[0] ?? 'General';
}

export function applyOperation(input: Row[], type: OperationType, p: OperationParams, sources: Map<string, SourceDataset>): OperationResult {
  let rows = input;
  let message = '';
  const before = input.length;
  switch (type) {
    case 'missing': {
      const cols = columns(rows, p.columns, 'all');
      const mode = p.mode ?? 'drop-rows';
      if (mode === 'drop-rows') rows = rows.filter(r => modeAny(r, cols, p.threshold === 1));
      else if (mode === 'drop-columns') { const cutoff = finite(p.threshold, 50, 0, 100) / 100; const keep = cols.filter(c => { if (!rows.length) return true; const missing = rows.filter(r => isNull(r[c])).length / rows.length; return cutoff === 0 ? missing === 0 : missing < cutoff; }); const all = columnsOf(rows); rows = rows.map(r => Object.fromEntries([...keep, ...all.filter(c => !cols.includes(c))].map(c => [c, r[c] ?? null]))); }
      else if (mode === 'ffill' || mode === 'bfill') { const order = mode === 'ffill' ? rows.map((_, i) => i) : rows.map((_, i) => rows.length - 1 - i); const last: Row = {}; rows = Array.from({ length: rows.length }, () => ({})); order.forEach(i => { rows[i] = { ...input[i] }; cols.forEach(c => { if (!isNull(input[i][c])) last[c] = input[i][c]; else if (c in last) rows[i][c] = last[c]; }); }); }
      else {
        const fills = new Map<string, CellValue>();
        cols.forEach(c => { const values = rows.map(r => r[c] ?? null); fills.set(c, mode === 'constant' ? p.value ?? '' : aggregate(values, mode)); });
        rows = rows.map(r => { const next = { ...r }; cols.forEach(c => { if (isNull(next[c])) next[c] = fills.get(c) ?? null; }); return next; });
      }
      message = `Missing values: ${mode} on ${cols.length} column${cols.length === 1 ? '' : 's'}.`; break;
    }
    case 'deduplicate': {
      if (p.mode === 'fuzzy') rows = fuzzyDeduplicate(rows, columns(rows, p.columns, 'all'), finite(p.threshold, 0.9, 0.5, 1));
      else { const keys = p.columns?.length ? columns(rows, p.columns) : undefined; const seen = new Set<string>(); rows = rows.filter(r => { const key = rowKey(r, keys); if (seen.has(key)) return false; seen.add(key); return true; }); }
      message = `Removed ${before - rows.length} ${p.mode === 'fuzzy' ? 'fuzzy ' : ''}duplicate rows.`; break;
    }
    case 'normalize': {
      const cols = columns(rows, p.columns, 'all'); const mode = p.mode ?? 'trim';
      const re = mode === 'regex' ? expression(p.pattern ?? '', 'g') : null;
      rows = rows.map(r => { const next = { ...r }; cols.forEach(c => {
        if (isNull(r[c])) return;
        let value = String(r[c]);
        if (mode === 'trim') value = value.trim().replace(/\s+/g, ' ');
        if (mode === 'upper') value = value.toUpperCase();
        if (mode === 'lower') value = value.toLowerCase();
        if (mode === 'title') value = value.toLowerCase().replace(/(^|\s)\S/g, s => s.toUpperCase());
        if (mode === 'html') value = value.replace(/<[^>]*>/g, '');
        if (mode === 'special') value = value.replace(/[^\p{L}\p{N}\s.@+\-]/gu, '');
        if (re) value = value.replace(re, p.replacement ?? '');
        if (mode === 'email') { value = value.trim().replace(/^mailto:/i, '').trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) value = ''; }
        if (mode === 'phone') { const phone = parsePhoneNumberFromString(value, (p.countryCode as CountryCode) || undefined); value = phone?.isValid() ? phone.number.toString() : ''; }
        next[c] = value || null;
      }); return next; });
      message = `Applied ${mode} normalization to ${cols.length} columns.`; break;
    }
    case 'cast': {
      const c = column(rows, p), type = p.dataType ?? 'String';
      let errors = 0;
      rows = rows.map(r => {
        const v = r[c] ?? null; if (isNull(v)) return { ...r, [c]: null };
        let result: CellValue = null;
        if (type === 'Integer' || type === 'Float') {
          let source = String(v).trim();
          if (p.mode === 'currency') {
            if (!/^[($€£¥₹\s]*[-+]?\s*[\d,]+(?:\.\d+)?[)\s]*$/.test(source)) source = 'invalid';
            else { const negative = /^\(.*\)$/.test(source); source = source.replace(/[^0-9.\-+]/g, ''); if (negative) source = `-${source}`; }
          }
          const n = numeric(source);
          if (n !== null && (type !== 'Integer' || Number.isSafeInteger(n))) result = n;
        } else if (type === 'Boolean') { if (/^(true|1|yes)$/i.test(String(v))) result = true; else if (/^(false|0|no)$/i.test(String(v))) result = false; }
        else if (type === 'Datetime') {
          const custom = p.dateFormat && p.dateFormat !== 'ISO / auto' ? parseFormattedDate(String(v), p.dateFormat) : null;
          const time = custom ?? (matchesType(v, 'Datetime') ? Date.parse(String(v).replace(/\//g, '-')) : NaN);
          if (Number.isFinite(time)) result = new Date(time).toISOString().slice(0, 10);
        } else result = String(v);
        if (result === null) errors++;
        return { ...r, [c]: result };
      });
      message = `Cast ${c} to ${type}${errors ? `; ${errors} incompatible values set to null` : ''}.`; break;
    }
    case 'pivot': {
      const pivot = p.pivotColumn && columnsOf(rows).includes(p.pivotColumn) ? p.pivotColumn : '';
      const value = p.valueColumn && columnsOf(rows).includes(p.valueColumn) ? p.valueColumn : '';
      if (!pivot || !value) throw new Error('Select a pivot column and a value column.');
      const index = columns(rows, p.index, 'none');
      if (index.includes(pivot) || index.includes(value)) throw new Error('Index columns must differ from pivot and value columns.');
      const pivots = [...new Set(rows.map(r => String(r[pivot] ?? 'null')))];
      if (pivots.length > 200) throw new Error('Pivot supports up to 200 distinct categories. Filter the pivot column first.');
      const groups = buckets(rows, index);
      rows = [...groups.values()].map(indices => { const out: Row = Object.fromEntries(index.map(c => [c, rows[indices[0]][c] ?? null])); pivots.forEach(category => { const name = `${value}_${category}`; if (index.includes(name)) throw new Error('Pivot creates a conflicting column name. Rename the index column.'); out[name] = aggregate(indices.filter(i => String(rows[i][pivot] ?? 'null') === category).map(i => rows[i][value] ?? null), p.agg); }); return out; });
      message = `Pivoted ${pivot} into ${pivots.length} value columns.`; break;
    }
    case 'melt': {
      const index = p.index ?? [];
      const all = columnsOf(rows);
      if (index.some(c => !all.includes(c))) throw new Error('An identifier column no longer exists.');
      const values = p.columns?.length ? columns(rows, p.columns) : all.filter(c => !index.includes(c));
      if (index.includes('variable') || index.includes('value')) throw new Error('Rename identifier columns named variable or value before unpivoting.');
      if (!values.length) throw new Error('Select at least one value column to unpivot.');
      limitRows(rows.length * values.length);
      rows = rows.flatMap(r => values.map(c => ({ ...Object.fromEntries(index.map(k => [k, r[k] ?? null])), variable: c, value: r[c] ?? null })));
      message = `Unpivoted ${values.length} columns into variable/value pairs.`; break;
    }
    case 'split': {
      const c = column(rows, p), count = Math.floor(finite(p.parts, 2, 2, 20));
      if (!p.delimiter) throw new Error('Enter a split delimiter.');
      const names = p.newNames?.length ? p.newNames : Array.from({ length: count }, (_, i) => `${c}_${i + 1}`);
      if (names.length !== count || new Set(names).size !== count) throw new Error(`Provide ${count} distinct output column names.`);
      const existing = columnsOf(rows);
      names.forEach(n => outputName(rows, n, n));
      rows = rows.map(r => { const parts = String(r[c] ?? '').split(p.delimiter!).map(s => s.trim()); return { ...r, ...Object.fromEntries(names.map((n, i) => [n, parts[i] || null])) }; });
      if (!existing.length) rows = [];
      message = `Split ${c} into ${names.join(', ')}.`; break;
    }
    case 'outliers': {
      const c = column(rows, p); const values = rows.map(r => numeric(r[c])).filter((v): v is number => v !== null); const s = stats(values);
      const multiplier = finite(p.multiplier, p.mode === 'iqr' ? 1.5 : 3, 0.1, 10);
      const low = p.mode === 'iqr' ? s.q1 - multiplier * s.iqr : s.mean - multiplier * s.std;
      const high = p.mode === 'iqr' ? s.q3 + multiplier * s.iqr : s.mean + multiplier * s.std;
      const outlier = (v: CellValue) => { const n = numeric(v); return n !== null && (p.mode === 'iqr' ? s.iqr > 0 : s.std > 0) && (n < low || n > high); };
      if (p.action === 'cap') rows = rows.map(r => outlier(r[c]) ? { ...r, [c]: Math.max(low, Math.min(high, numeric(r[c])!)) } : r);
      else rows = rows.filter(r => !outlier(r[c]));
      message = `${p.action === 'cap' ? 'Capped' : 'Filtered'} outliers in ${c} using ${p.mode?.toUpperCase() ?? 'IQR'} (bounds ${low.toFixed(2)}–${high.toFixed(2)}).`; break;
    }
    case 'feature': {
      const c = column(rows, p), feature = p.feature ?? 'text-length';
      const name = outputName(rows, p.output, `${c}_${feature.replace('-', '_')}`);
      const values = rows.map(r => numeric(r[c])).filter((v): v is number => v !== null);
      const s = stats(values), min = s.min, max = s.max, bins = Math.floor(finite(p.bins, 4, 2, 100));
      rows = rows.map(r => {
        const v = r[c] ?? null; let out: CellValue = null;
        if (!isNull(v)) {
          if (feature === 'text-length') out = String(v).length;
          else if (feature === 'bin') { const n = numeric(v); if (n !== null) { const index = max === min ? 0 : Math.min(bins - 1, Math.floor((n - min) / (max - min) * bins)); const width = (max - min) / bins; out = `${(min + index * width).toFixed(2)}–${(min + (index + 1) * width).toFixed(2)}`; } }
          else { const date = new Date(String(v)); if (Number.isFinite(date.getTime())) { if (feature === 'year') out = date.getUTCFullYear(); if (feature === 'quarter') out = `Q${Math.floor(date.getUTCMonth() / 3) + 1}`; if (feature === 'month') out = date.getUTCMonth() + 1; if (feature === 'day-of-week') out = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][date.getUTCDay()]; } }
        }
        return { ...r, [name]: out };
      });
      message = `Created ${name} from ${c}.`; break;
    }
    case 'group': {
      const groups = columns(rows, p.groups, 'all'), measures = p.measures ?? [];
      if (!measures.length) throw new Error('Add at least one measure to aggregate.');
      measures.forEach(m => { column(rows, { column: m.column }); if (!['sum','mean','median','count','min','max'].includes(m.op)) throw new Error('Unsupported aggregation.'); });
      const names = measures.map(m => `${m.op}_${m.column}`);
      if (names.some(n => groups.includes(n)) || new Set(names).size !== names.length) throw new Error('Aggregation output names conflict with group columns.');
      rows = [...buckets(rows, groups).values()].map(indices => { const out: Row = Object.fromEntries(groups.map(c => [c, input[indices[0]][c] ?? null])); measures.forEach((m, i) => { out[names[i]] = aggregate(indices.map(j => input[j][m.column] ?? null), m.op); }); return out; });
      message = `Grouped by ${groups.join(', ')} with ${measures.length} measures.`; break;
    }
    case 'window': {
      const c = column(rows, p), mode = p.mode ?? 'cumulative', window = Math.floor(finite(p.window, 3, 2, 10000));
      const name = outputName(rows, p.output, `${c}_${mode === 'cumulative' ? 'cumulative' : `rolling_${window}`}`);
      const partition = p.partition && columnsOf(rows).includes(p.partition) ? p.partition : undefined;
      const state = new Map<string, { sum: number; values: number[] }>();
      rows = rows.map(r => { const key = partition ? String(r[partition] ?? 'null') : '__all'; const s = state.get(key) ?? { sum: 0, values: [] }; state.set(key, s); const n = numeric(r[c]); if (n !== null) { s.sum += n; s.values.push(n); } if (s.values.length > window) s.values.shift(); const value = !s.values.length ? null : mode === 'cumulative' ? s.sum : s.values.reduce((a, b) => a + b, 0) / s.values.length; return { ...r, [name]: value }; });
      message = `Added ${name}${partition ? ` partitioned by ${partition}` : ''}; source row order is preserved.`; break;
    }
    case 'join': {
      const right = sources.get(p.rightId ?? ''); if (!right) throw new Error('Select an uploaded secondary dataset.');
      const keys = columns(rows, p.keys), rightKeys = columns(right.rows, p.rightKeys ?? p.keys);
      if (keys.length !== rightKeys.length) throw new Error('Select the same number of join keys on both sides.');
      const kind = p.joinType ?? 'left', rightMap = new Map<string, Row[]>();
      const joinKey = (row: Row, names: string[]) => JSON.stringify(names.map(k => row[k] ?? null));
      right.rows.forEach(r => { const k = joinKey(r, rightKeys); const bucket = rightMap.get(k); if (bucket) bucket.push(r); else rightMap.set(k, [r]); });
      const matchedKeys = new Set<string>(); let outputCount = 0;
      rows.forEach(r => { const key = joinKey(r, keys); const count = rightMap.get(key)?.length ?? 0; if (count) matchedKeys.add(key); if (kind === 'inner') outputCount += count; else if (kind === 'right') outputCount += count; else outputCount += Math.max(1, count); });
      if (kind === 'right' || kind === 'full') right.rows.forEach(r => { if (!matchedKeys.has(joinKey(r, rightKeys))) outputCount++; });
      limitRows(outputCount);
      const leftNames = columnsOf(rows), rightNames = columnsOf(right.rows);
      const renames = new Map(rightNames.map(c => [c, leftNames.includes(c) && !rightKeys.includes(c) ? `${c}_right` : c]));
      if (new Set(renames.values()).size !== rightNames.length) throw new Error('Join column names conflict. Rename overlapping columns first.');
      const emptyRight = Object.fromEntries(rightNames.map(c => [renames.get(c)!, null]));
      const matched = new Set<string>(); const out: Row[] = [];
      rows.forEach(r => { const key = joinKey(r, keys); const matches = rightMap.get(key); if (matches) matched.add(key); if (matches || kind === 'left' || kind === 'full') { (matches ?? [null]).forEach(rr => out.push({ ...r, ...(rr ? Object.fromEntries(rightNames.map(c => [renames.get(c)!, rr[c] ?? null])) : emptyRight) })); } });
      if (kind === 'right' || kind === 'full') right.rows.forEach(r => { const key = joinKey(r, rightKeys); if (!matched.has(key)) out.push({ ...Object.fromEntries(leftNames.map(c => [c, null])), ...Object.fromEntries(rightNames.map(c => [renames.get(c)!, r[c] ?? null])), ...Object.fromEntries(keys.map((c, i) => [c, r[rightKeys[i]] ?? null])) }); });
      rows = out; message = `${kind.toUpperCase()} joined ${right.name}: ${rows.length} matched output rows.`; break;
    }
    case 'concat': {
      const right = sources.get(p.rightId ?? ''); if (!right) throw new Error('Select a second dataset.');
      if (p.mode === 'horizontal') {
        const leftNames = columnsOf(rows), rightNames = columnsOf(right.rows); limitRows(Math.max(rows.length, right.rows.length));
        const renames = uniqueHeaders([...leftNames, ...rightNames]).slice(leftNames.length);
        rows = Array.from({ length: Math.max(rows.length, right.rows.length) }, (_, i) => ({ ...Object.fromEntries(leftNames.map(c => [c, rows[i]?.[c] ?? null])), ...Object.fromEntries(rightNames.map((c, j) => [renames[j], right.rows[i]?.[c] ?? null])) }));
      } else { const names = [...new Set([...columnsOf(rows), ...columnsOf(right.rows)])]; limitRows(rows.length + right.rows.length); rows = [...rows, ...right.rows].map(r => Object.fromEntries(names.map(c => [c, r[c] ?? null]))); }
      message = `Concatenated ${right.name} ${p.mode === 'horizontal' ? 'horizontally by row position' : 'vertically by column name'}.`; break;
    }
    case 'ai': {
      const c = column(rows, p), mode = p.mode ?? 'sentiment', name = outputName(rows, p.output, `${c}_${mode}`);
      rows = rows.map(r => { const text = String(r[c] ?? ''); const value = !text ? null : mode === 'sentiment' ? sentiment(text) : mode === 'summary' ? summarize(text) : mode === 'entities' ? entities(text) : categorize(text); return { ...r, [name]: value }; });
      message = `Added rule-based ${mode} enrichment as ${name}. No external AI service was used.`; break;
    }
    case 'formula': {
      const name = outputName(rows, p.output, 'calculated_column'); const evaluate = compileFormula(p.formula ?? '', columnsOf(rows)); let errors = 0;
      rows = rows.map(r => { try { return { ...r, [name]: evaluate(r) }; } catch { errors++; return { ...r, [name]: null }; } });
      message = `Calculated ${name}${errors ? `; ${errors} row-level errors were set to null` : ' for every row'}.`; break;
    }
    case 'validate': {
      const report = analyze(rows, p.rules ?? []); message = `Validated ${p.rules?.length ?? 0} rules: ${report.quality.schemaErrors} schema errors.`; break;
    }
    case 'rename': {
      const c = column(rows, p), name = outputName(rows, p.output, ''); rows = rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k === c ? name : k, v]))); message = `Renamed ${c} to ${name}.`; break;
    }
    case 'select': { const cols = columns(rows, p.columns); rows = rows.map(r => Object.fromEntries(cols.map(c => [c, r[c] ?? null]))); message = `Kept ${cols.length} columns in the selected order.`; break; }
    case 'sort': {
      const c = column(rows, p), sign = p.direction === 'desc' ? -1 : 1;
      rows = [...rows].sort((a, b) => { const x = a[c] ?? null, y = b[c] ?? null; if (isNull(x)) return isNull(y) ? 0 : 1; if (isNull(y)) return -1; return sign * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })); });
      message = `Sorted ${c} ${p.direction === 'desc' ? 'descending' : 'ascending'}.`; break;
    }
    case 'filter': {
      const c = column(rows, p), op = p.operator ?? 'contains', value = p.value ?? '';
      rows = rows.filter(r => { const v = r[c] ?? null; if (op === 'not_null') return !isNull(v); if (op === 'is_null') return isNull(v); if (op === 'equals') return String(v) === String(value); if (op === 'not_equals') return String(v) !== String(value); if (op === 'contains') return String(v ?? '').toLowerCase().includes(String(value).toLowerCase()); if (op === 'not_contains') return !String(v ?? '').toLowerCase().includes(String(value).toLowerCase()); const a = numeric(v), b = numeric(value); return a !== null && b !== null && (op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b); });
      message = `Filtered ${c} (${op.replace('_', ' ')} ${value}): kept ${rows.length} rows.`; break;
    }
    default: throw new Error('Unknown operation.');
  }
  if (rows.length > MAX_ROWS) limitRows(rows.length);
  return { rows, message };
}
function modeAny(row: Row, cols: string[], all: boolean): boolean { return all ? cols.some(c => !isNull(row[c])) : cols.every(c => !isNull(row[c])); }
export function runPipeline(source: Row[], steps: PipelineStep[], sources: Map<string, SourceDataset>): ProcessedDataset {
  const start = performance.now(); let rows = source; const logs: string[] = []; const rules: ValidationRule[] = [];
  for (const step of steps) {
    if (!step.enabled) { logs.push(`Skipped: ${step.label}`); continue; }
    try { const result = applyOperation(rows, step.type, step.params, sources); rows = result.rows; logs.push(result.message); if (step.type === 'validate') rules.push(...(step.params.rules ?? [])); }
    catch (error) { throw new Error(`Step ${steps.indexOf(step) + 1} (${step.label}): ${error instanceof Error ? error.message : String(error)}`); }
  }
  const report = analyze(rows, rules);
  return { ...report, rows, logs, duration: performance.now() - start };
}
