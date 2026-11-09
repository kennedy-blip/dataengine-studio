import Papa from 'papaparse';
import { XMLParser } from 'fast-xml-parser';
import { parse as parseYaml } from 'yaml';
import { cleanNull, detectHeader, flattenObject, matrixToRows } from './data';
import { MAX_FILE_BYTES, MAX_ROWS, type ParseOptions, type ParseResult, type Row, type SourceDataset, type SourceFormat } from './types';

export function detectEncoding(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'UTF-16LE';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'UTF-16BE';
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return 'UTF-8'; }
  catch { return bytes.some(b => b >= 0x80 && b <= 0x9f) ? 'Windows-1252' : 'Latin-1'; }
}
export function decodeText(bytes: Uint8Array, requested = 'auto'): { text: string; encoding: string } {
  const encoding = requested === 'auto' ? detectEncoding(bytes) : requested;
  let text: string;
  try { text = encoding === 'Latin-1' ? Array.from(bytes, byte => String.fromCharCode(byte)).join('') : new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new Error(`This file is not valid ${encoding}. Choose automatic encoding or the source encoding.`); }
  return { text: text.replace(/^\uFEFF/, ''), encoding };
}
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 20).join('\n');
  let best = ',', bestScore = -1;
  for (const delimiter of [',', '\t', ';', '|']) {
    const result = Papa.parse<string[]>(sample, { delimiter, preview: 20, skipEmptyLines: 'greedy' });
    const counts = result.data.map(r => r.length).filter(n => n > 1);
    if (!counts.length) continue;
    const mode = counts.sort((a, b) => counts.filter(n => n === b).length - counts.filter(n => n === a).length)[0];
    const consistent = counts.filter(n => n === mode).length / counts.length;
    const score = consistent * Math.log2(mode) - result.errors.length * 0.1;
    if (score > bestScore) { best = delimiter; bestScore = score; }
  }
  return best;
}
export function parseDelimited(text: string, options: Pick<ParseOptions, 'header' | 'delimiter'>): { rows: Row[]; delimiter: string; hasHeader: boolean } {
  const delimiter = options.delimiter === 'auto' ? detectDelimiter(text) : options.delimiter;
  const preview = Papa.parse<unknown[]>(text, { delimiter, header: false, preview: 30, skipEmptyLines: 'greedy' });
  const hasHeader = options.header === 'yes' || (options.header === 'auto' && detectHeader(preview.data));
  const result = Papa.parse<unknown[]>(text, { delimiter, header: false, skipEmptyLines: 'greedy', transformHeader: h => h.trim() });
  if (result.errors.some(e => e.type === 'Quotes')) throw new Error('The CSV contains unclosed quotes. Repair the file or export it with standard CSV quoting.');
  if (result.data.length > MAX_ROWS + 1) throw new Error(`Files are limited to ${MAX_ROWS.toLocaleString()} rows in this browser workspace.`);
  const rows = matrixToRows(result.data, hasHeader);
  if (result.data.some(r => r.length > 500)) throw new Error('Datasets are limited to 500 source columns.');
  return { rows, delimiter, hasHeader };
}
function normalizeRecords(records: unknown[]): Row[] {
  if (records.length > MAX_ROWS) throw new Error(`The normalized table exceeds ${MAX_ROWS.toLocaleString()} rows.`);
  const rows = records.map(record => flattenObject(record));
  if (rows.some(r => Object.keys(r).length > 500)) throw new Error('Datasets are limited to 500 normalized columns.');
  return rows;
}
export function structuredRows(value: unknown): Row[] {
  if (Array.isArray(value)) return normalizeRecords(value);
  if (value && typeof value === 'object') {
    function findArray(object: Record<string, unknown>, depth = 0): unknown[] | null {
      if (depth > 8) return null;
      const arrays = Object.values(object).filter(v => Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0] !== null) as unknown[][];
      if (arrays.length) return arrays.sort((a, b) => b.length - a.length)[0];
      for (const child of Object.values(object)) if (child && typeof child === 'object' && !Array.isArray(child)) { const found = findArray(child as Record<string, unknown>, depth + 1); if (found) return found; }
      return null;
    }
    const records = findArray(value as Record<string, unknown>);
    return normalizeRecords(records ?? [value]);
  }
  return [{ value: cleanNull(value) }];
}
export function xmlRows(text: string): Row[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('XML DOCTYPE and entity declarations are not accepted.');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false, processEntities: true, removeNSPrefix: true });
  const value = parser.parse(text);
  function findRecords(node: unknown, depth = 0): unknown {
    if (depth > 20) throw new Error('XML nesting is too deep.');
    if (Array.isArray(node)) return node;
    if (node && typeof node === 'object') {
      const arrays = Object.values(node).filter(v => Array.isArray(v) && v.length && typeof v[0] === 'object') as unknown[][];
      if (arrays.length) return arrays.sort((a, b) => b.length - a.length)[0];
      const children = Object.entries(node).filter(([k]) => !k.startsWith('@') && k !== '#text');
      if (children.length === 1) return findRecords(children[0][1], depth + 1);
    }
    return node;
  }
  return structuredRows(findRecords(value));
}
function markdownOrText(text: string): { rows: Row[]; note: string } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const tableStart = lines.findIndex((line, i) => line.includes('|') && !!lines[i + 1] && /^[\s|:\-]+$/.test(lines[i + 1]) && lines[i + 1].includes('-'));
  if (tableStart >= 0) {
    const split = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim());
    const matrix = [split(lines[tableStart])];
    for (let i = tableStart + 2; i < lines.length && lines[i].includes('|'); i++) matrix.push(split(lines[i]));
    return { rows: matrixToRows(matrix, true), note: 'Markdown table extracted.' };
  }
  return { rows: text.split(/\n\s*\n/).filter(p => p.trim()).map((paragraph, i) => ({ paragraph: i + 1, text: paragraph.trim() })), note: 'Document text extracted as paragraphs. No structured table was detected.' };
}
async function docxDatasets(buffer: ArrayBuffer, base: string, importedAt: string): Promise<{ datasets: SourceDataset[]; warnings: string[] }> {
  const mammoth = await import('mammoth');
  const { value: html, messages } = await mammoth.convertToHtml({ arrayBuffer: buffer, ...(typeof Buffer !== 'undefined' ? { buffer: Buffer.from(buffer) } : {}) } as unknown as Parameters<typeof mammoth.convertToHtml>[0], { ignoreEmptyParagraphs: true });
  const { parse } = await import('node-html-parser');
  const root = parse(html);
  const tables = root.querySelectorAll('table');
  const datasets: SourceDataset[] = [];
  tables.forEach((table, i) => {
    const matrix = table.querySelectorAll('tr').map(tr => tr.querySelectorAll('td,th').flatMap(td => { const span = Math.min(50, Math.max(1, Number(td.getAttribute('colspan') ?? 1))); return Array.from({ length: span }, (_, j) => j === 0 ? td.text.trim() : ''); }));
    if (!matrix.length) return;
    const hasHeader = table.querySelectorAll('th').length > 0 || detectHeader(matrix);
    const rows = matrixToRows(matrix, hasHeader);
    if (rows.length) datasets.push({ id: crypto.randomUUID(), name: `${base} · table ${i + 1}.docx`, format: 'docx', rows, sourceBytes: buffer.byteLength, importedAt, note: 'Table extracted from Word document layout. Verify merged cells and headers.' });
  });
  if (!datasets.length) {
    const paragraphs = root.querySelectorAll('p,h1,h2,h3,h4,li').map(n => n.text.trim()).filter(Boolean);
    datasets.push({ id: crypto.randomUUID(), name: `${base}.docx`, format: 'docx', rows: (paragraphs.length ? paragraphs : [root.text]).map((text, i) => ({ paragraph: i + 1, text })), sourceBytes: buffer.byteLength, importedAt, note: 'No tables detected; document paragraphs extracted.' });
  }
  return { datasets, warnings: messages.slice(0, 5).map(m => m.message) };
}
async function pdfDatasets(buffer: ArrayBuffer, base: string, importedAt: string, size: number): Promise<{ datasets: SourceDataset[]; warnings: string[] }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, cMapUrl: '/pdf-cmaps/', cMapPacked: true, standardFontDataUrl: '/pdf-standard-fonts/' });
  const doc = await task.promise;
  const datasets: SourceDataset[] = [], warnings: string[] = [];
  let extractedCharacters = 0;
  try {
    const pages = Math.min(doc.numPages, 100);
    if (doc.numPages > pages) warnings.push(`Only the first 100 of ${doc.numPages} pages were parsed.`);
    for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items.filter((item): item is Extract<typeof item, { str: string }> => 'str' in item && !!item.str.trim());
      extractedCharacters += items.reduce((n, item) => n + item.str.length, 0);
      const lines = new Map<number, { x: number; width: number; text: string }[]>();
      items.forEach(item => { const y = Math.round(item.transform[5] / 3) * 3; const line = lines.get(y) ?? []; line.push({ x: item.transform[4], width: item.width, text: item.str }); lines.set(y, line); });
      const matrix: string[][] = [];
      [...lines.entries()].sort((a, b) => b[0] - a[0]).forEach(([, line]) => {
        line.sort((a, b) => a.x - b.x);
        const cells: string[] = []; let end = -Infinity;
        line.forEach(item => { if (item.x - end > 12) cells.push(item.text.trim()); else cells[cells.length - 1] += ` ${item.text.trim()}`; end = item.x + item.width; });
        if (cells.length >= 2) matrix.push(cells);
      });
      if (matrix.length >= 2) {
        const counts = matrix.map(r => r.length); const common = counts.sort((a, b) => counts.filter(n => n === b).length - counts.filter(n => n === a).length)[0];
        const table = matrix.filter(r => r.length === common);
        datasets.push({ id: crypto.randomUUID(), name: `${base} · page ${pageNumber}.pdf`, format: 'pdf', rows: matrixToRows(table, detectHeader(table)), sourceBytes: size, importedAt, note: 'Layout-based PDF table extraction. Column boundaries are heuristic; verify the schema.' });
      } else {
        const text = [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, line]) => line.sort((a, b) => a.x - b.x).map(i => i.text).join(' ')).join('\n');
        if (text.trim()) datasets.push({ id: crypto.randomUUID(), name: `${base} · page ${pageNumber}.pdf`, format: 'pdf', rows: [{ page: pageNumber, text }], sourceBytes: size, importedAt, note: 'No clear table layout; page text extracted.' });
      }
      page.cleanup();
    }
  } finally { await task.destroy(); }
  if (!extractedCharacters) throw new Error('No selectable text found. This may be a scanned PDF; run OCR before importing.');
  return { datasets, warnings };
}
export async function parseFile(file: File, options: ParseOptions): Promise<ParseResult> {
  if (file.size > MAX_FILE_BYTES) throw new Error('This file exceeds the 100 MB upload limit.');
  if (!file.size) throw new Error('The file is empty.');
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'yml') file = new File([file], file.name.replace(/\.yml$/i, '.yaml'), { type: file.type });
  const format = file.name.split('.').pop()?.toLowerCase() as SourceFormat;
  const buffer = await file.arrayBuffer();
  const importedAt = new Date().toISOString();
  const base = file.name.replace(/\.[^.]+$/, '');
  let result: ParseResult;
  if (['csv', 'tsv', 'txt'].includes(format)) {
    const { text, encoding } = decodeText(new Uint8Array(buffer), options.encoding);
    if (format === 'txt' && options.header === 'auto') { const extracted = markdownOrText(text); result = { datasets: [{ id: crypto.randomUUID(), name: file.name, format, rows: extracted.rows, sourceBytes: file.size, importedAt, encoding, note: extracted.note }], warnings: [] }; }
    else { const parsed = parseDelimited(text, { ...options, delimiter: format === 'tsv' && options.delimiter === 'auto' ? '\t' : options.delimiter }); result = { datasets: [{ id: crypto.randomUUID(), name: file.name, format, rows: parsed.rows, sourceBytes: file.size, importedAt, encoding, delimiter: parsed.delimiter, note: parsed.hasHeader ? 'Header row detected automatically.' : 'No header detected; generated column names. First row retained as data.' }], warnings: [] }; }
  } else if (['json', 'jsonl', 'yaml', 'xml'].includes(format)) {
    const { text, encoding } = decodeText(new Uint8Array(buffer), options.encoding);
    let rows: Row[];
    if (format === 'json') rows = structuredRows(JSON.parse(text));
    else if (format === 'jsonl') rows = normalizeRecords(text.split(/\r?\n/).filter(l => l.trim()).map((line, i) => { try { return JSON.parse(line); } catch { throw new Error(`Invalid JSON on line ${i + 1}.`); } }));
    else if (format === 'xml') rows = xmlRows(text);
    else { if (/!<[^>]+>/.test(text)) throw new Error('Custom YAML tags are not accepted.'); rows = structuredRows(parseYaml(text, { maxAliasCount: 50, uniqueKeys: true })); }
    result = { datasets: [{ id: crypto.randomUUID(), name: file.name, format, rows, sourceBytes: file.size, importedAt, encoding }], warnings: [] };
  } else if (format === 'xlsx' || format === 'xls') {
    const XLSX = await import('@e965/xlsx');
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, dense: true, sheetRows: MAX_ROWS + 31 });
    const datasets: SourceDataset[] = [], warnings: string[] = [];
    for (const name of workbook.SheetNames.slice(0, 20)) {
      const fullRef = workbook.Sheets[name]['!fullref'];
      if (fullRef && XLSX.utils.decode_range(fullRef).e.r > MAX_ROWS) throw new Error(`Sheet “${name}” exceeds ${MAX_ROWS.toLocaleString()} rows.`);
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: null, raw: true, blankrows: false });
      if (!matrix.length) continue;
      if (matrix.length > MAX_ROWS + 1) throw new Error(`Sheet “${name}” exceeds ${MAX_ROWS.toLocaleString()} rows.`);
      const hasHeader = options.header === 'yes' || (options.header === 'auto' && detectHeader(matrix));
      const rows = matrixToRows(matrix.map(r => r.map(v => v instanceof Date ? v.toISOString().slice(0, 10) : v)), hasHeader);
      if (rows.length) datasets.push({ id: crypto.randomUUID(), name: workbook.SheetNames.length > 1 ? `${base} · ${name}.${format}` : file.name, format, rows, sourceBytes: file.size, importedAt, note: `Imported sheet “${name}”. Formulas use stored cell values, not external links.` });
    }
    if (workbook.SheetNames.length > 20) warnings.push('Only the first 20 worksheets were imported.');
    result = { datasets, warnings };
  } else if (format === 'parquet') {
    const { parquetReadObjects, parquetMetadata } = await import('hyparquet');
    const { compressors } = await import('hyparquet-compressors');
    const metadata = parquetMetadata(buffer);
    if (Number(metadata.num_rows) > MAX_ROWS) throw new Error(`Parquet file exceeds ${MAX_ROWS.toLocaleString()} rows.`);
    const records = await parquetReadObjects({ file: buffer, compressors, rowFormat: 'object' });
    result = { datasets: [{ id: crypto.randomUUID(), name: file.name, format, rows: normalizeRecords(records), sourceBytes: file.size, importedAt, note: 'Parquet schema and compression decoded locally.' }], warnings: [] };
  } else if (format === 'docx') {
    const parsed = await docxDatasets(buffer, base, importedAt); result = { ...parsed, datasets: parsed.datasets.map(d => ({ ...d, sourceBytes: file.size })) };
  } else if (format === 'pdf') result = await pdfDatasets(buffer, base, importedAt, file.size);
  else if (format === 'md') { const { text, encoding } = decodeText(new Uint8Array(buffer), options.encoding); const parsed = markdownOrText(text); result = { datasets: [{ id: crypto.randomUUID(), name: file.name, format, rows: parsed.rows, sourceBytes: file.size, importedAt, encoding, note: parsed.note }], warnings: [] }; }
  else if (format === 'rtf') {
    const raw = new TextDecoder('windows-1252').decode(buffer);
    if (!raw.startsWith('{\\rtf')) throw new Error('This is not a valid RTF document.');
    const text = raw.replace(/\{\\\*?\\(?:fonttbl|colortbl|stylesheet|info|pict|object)[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '').replace(/\\'([0-9a-f]{2})/gi, (_, hex: string) => new TextDecoder('windows-1252').decode(Uint8Array.of(parseInt(hex, 16)))).replace(/\\par[d]?/g, '\n').replace(/\\[a-z]+-?\d* ?|[{}]/gi, '').replace(/\\\n/g, '\n');
    result = { datasets: [{ id: crypto.randomUUID(), name: file.name, format, rows: text.split(/\n+/).filter(l => l.trim()).map((line, i) => ({ line: i + 1, text: line.trim() })), sourceBytes: file.size, importedAt, encoding: 'Windows-1252', note: 'RTF control words stripped. Complex embedded tables should be exported as DOCX.' }], warnings: [] };
  } else throw new Error(`Unsupported file type “.${extension}”. See supported formats in the importer.`);
  if (!result.datasets.length || result.datasets.every(d => !d.rows.length)) throw new Error('No data rows were found. Check the header settings or choose a different sheet/file.');
  return result;
}
