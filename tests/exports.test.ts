import { describe, expect, it } from 'vitest';
import { parquetReadObjects } from 'hyparquet';
import ExcelJS from 'exceljs';
import { createExport, createWebhookPayload, type ExportContext } from '@/lib/export';
import { analyze } from '@/lib/data';
import { parseFile } from '@/lib/parsers';
import type { ExportFormat } from '@/lib/export';
const rows = [{ id: 1, name: 'Ada', score: 9.5, active: true, date: '2026-01-01', note: null }, { id: 2, name: 'Grace', score: 8.2, active: false, date: '2026-02-01', note: '=SUM(A1:A2)' }];
const context: ExportContext = { dataset: { ...analyze(rows), rows, duration: 1, logs: [] }, name: 'test.csv', projectName: 'Test pipeline', steps: [] };
const options = { header: 'auto', encoding: 'auto', delimiter: 'auto' } as const;
describe('real export round trips', () => {
  it('exports typed JSON and complete webhook envelopes', async () => {
    const blob = await createExport('json', context); expect(JSON.parse(await blob.text())).toEqual(rows);
    const payload = createWebhookPayload(rows, 'test'); expect(payload.row_count).toBe(2); expect(payload.schema).toHaveLength(6); expect(payload.data).toEqual(rows);
  });
  it('exports UTF-8 CSV with spreadsheet formula protection', async () => { const blob = await createExport('csv', context); const text = await blob.text(); expect(new Uint8Array(await blob.arrayBuffer()).slice(0, 3)).toEqual(Uint8Array.of(0xef, 0xbb, 0xbf)); expect(text).toContain("'=SUM(A1:A2)"); expect(text).toContain('Ada'); });
  it('exports styled XLSX with frozen headers, filters, and literal formulas', async () => {
    const blob = await createExport('xlsx', context); const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await blob.arrayBuffer() as never);
    const sheet = workbook.getWorksheet('Processed data')!; expect(sheet.rowCount).toBe(3); expect(sheet.views[0].state).toBe('frozen'); expect(sheet.autoFilter).toBeTruthy(); expect(sheet.getCell('A1').font?.bold).toBe(true); expect(sheet.getCell('F3').value).toBe('=SUM(A1:A2)'); expect(sheet.getCell('F3').type).toBe(ExcelJS.ValueType.String); expect(workbook.getWorksheet('Quality summary')).toBeTruthy();
    const parsed = await parseFile(new File([blob], 'roundtrip.xlsx'), options); expect(parsed.datasets[0].rows).toHaveLength(2); expect(parsed.datasets[0].rows[0].name).toBe('Ada');
  });
  it('exports valid Parquet with nulls and inferred scalar types', async () => {
    const blob = await createExport('parquet', context); const buffer = await blob.arrayBuffer(); const result = await parquetReadObjects({ file: buffer, rowFormat: 'object' });
    expect(result).toHaveLength(2); expect(result[0].id).toBe(1n); expect(result[0].score).toBe(9.5); expect(result[0].active).toBe(true); expect(result[0].note).toBeNull();
    const parsed = await parseFile(new File([blob], 'roundtrip.parquet'), options); expect(parsed.datasets[0].rows[1].name).toBe('Grace');
  });
  it('generates a real PDF summary and Word document', async () => {
    const pdf = await createExport('pdf', context); expect(await pdf.text().then(t => t.slice(0, 4))).toBe('%PDF'); expect(pdf.size).toBeGreaterThan(1000);
    const docx = await createExport('docx', context); expect(new Uint8Array(await docx.arrayBuffer()).slice(0, 2)).toEqual(Uint8Array.of(80, 75));
    const parsed = await parseFile(new File([blobToArray(await docx.arrayBuffer())], 'roundtrip.docx'), options); expect(parsed.datasets[0].rows.some(r => Object.values(r).includes('Ada'))).toBe(true);
  });
  it('rejects unknown formats', async () => { await expect(createExport('zip' as ExportFormat, context)).rejects.toThrow('Unsupported'); });
});
function blobToArray(buffer: ArrayBuffer) { return new Blob([buffer]); }
