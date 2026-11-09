import Papa from 'papaparse';
import { analyze, displayValue } from './data';
import type { PipelineStep, ProcessedDataset, Row } from './types';
export type ExportFormat = 'csv' | 'xlsx' | 'json' | 'parquet' | 'pdf' | 'docx';
export interface ExportContext { dataset: ProcessedDataset; name: string; projectName: string; steps: PipelineStep[] }
function spreadsheetValue(value: unknown) { return value === null || value === undefined ? '' : value; }
export async function createExport(format: ExportFormat, context: ExportContext): Promise<Blob> {
  const { dataset, projectName, steps } = context;
  const { rows, quality } = dataset;
  const columns = dataset.columns;
  if (format === 'csv') {
    const safeRows = rows.map(row => Object.fromEntries(columns.map(c => { const value = row[c.name]; return [c.name, typeof value === 'string' && /^[=+@\t\r]|^-\D/.test(value) ? `'${value}` : value ?? '']; })));
    return new Blob(['\uFEFF', Papa.unparse(safeRows, { columns: columns.map(c => c.name), escapeFormulae: true })], { type: 'text/csv;charset=utf-8' });
  }
  if (format === 'json') return new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
  if (format === 'xlsx') {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'DataEngine Studio'; workbook.created = new Date();
    const sheet = workbook.addWorksheet('Processed data', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = columns.map(c => ({ header: c.name, key: c.name, width: Math.min(45, Math.max(14, c.name.length + 3)) }));
    sheet.addRows(rows.map(row => Object.fromEntries(columns.map(c => [c.name, spreadsheetValue(row[c.name])]))));
    sheet.getRow(1).eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D8A6A' } }; cell.alignment = { vertical: 'middle' }; });
    sheet.getRow(1).height = 28;
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: columns.length } };
    columns.forEach((c, i) => { if (c.type === 'Float') sheet.getColumn(i + 1).numFmt = '#,##0.00'; });
    const summary = workbook.addWorksheet('Quality summary');
    summary.columns = [{ header: 'Metric', key: 'metric', width: 28 }, { header: 'Value', key: 'value', width: 80 }];
    summary.addRows([['Project', projectName], ['Generated', new Date().toISOString()], ['Rows', rows.length], ['Columns', columns.length], ['Health score', quality.score], ['Missing values', quality.missing], ['Duplicate rows', quality.duplicates], ['Anomalies (IQR)', quality.anomalies], ['Schema errors', quality.schemaErrors], ...steps.map((s, i) => [`Step ${i + 1}${s.enabled ? '' : ' (disabled)'}`, s.label])]);
    summary.getRow(1).font = { bold: true };
    const buffer = await workbook.xlsx.writeBuffer();
    return new Blob([buffer as unknown as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  if (format === 'parquet') {
    const { parquetWriteBuffer } = await import('hyparquet-writer');
    const columnData = columns.map(c => ({ name: c.name, data: rows.map(r => c.type === 'Integer' ? (isNullValue(r[c.name]) ? null : BigInt(Number(r[c.name]))) : c.type === 'String' || c.type === 'Datetime' ? (isNullValue(r[c.name]) ? null : String(r[c.name])) : r[c.name] ?? null), type: c.type === 'Integer' ? 'INT64' as const : c.type === 'Float' ? 'DOUBLE' as const : c.type === 'Boolean' ? 'BOOLEAN' as const : 'STRING' as const, nullable: true }));
    const buffer = parquetWriteBuffer({ columnData, codec: 'UNCOMPRESSED' });
    return new Blob([buffer], { type: 'application/vnd.apache.parquet' });
  }
  if (format === 'pdf') {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF();
    let y = 24;
    const line = (text: string, size = 10, color: [number, number, number] = [65, 73, 87]) => {
      doc.setFontSize(size); doc.setTextColor(...color);
      const parts = doc.splitTextToSize(text.replace(/[^\x20-\x7E\n]/g, ' '), 170);
      for (const part of parts) { if (y > 274) { doc.addPage(); y = 24; } doc.text(part, 20, y); y += size * 0.48; }
      y += 3;
    };
    line('DATAENGINE STUDIO', 11, [10, 132, 102]);
    line('Data quality & processing report', 22, [20, 32, 44]);
    line(projectName, 14); line(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
    line(`${rows.length.toLocaleString()} records | ${columns.length} columns | Health score ${quality.score}/100`, 12);
    line(`Missing: ${quality.missing} (${quality.missingPercent.toFixed(1)}%) | Duplicates: ${quality.duplicates} | IQR anomalies: ${quality.anomalies} | Schema errors: ${quality.schemaErrors}`);
    y += 5; line('SCHEMA', 12, [10, 132, 102]);
    columns.forEach(c => line(`${c.name}  /  ${c.type}  /  ${c.missing} missing  /  ${c.unique} unique`, 9));
    y += 5; line('PIPELINE', 12, [10, 132, 102]);
    if (!steps.length) line('Source data exported without transformations.');
    steps.forEach((s, i) => line(`${i + 1}. ${s.enabled ? '' : '[Disabled] '}${s.label}`, 10));
    if (quality.issues.length) { y += 5; line('VALIDATION ISSUES (FIRST 100)', 12, [170, 70, 40]); quality.issues.slice(0, 30).forEach(issue => line(`Row ${issue.row}, ${issue.column}: ${issue.message}`, 9)); }
    y += 5; line('DATA PREVIEW', 12, [10, 132, 102]);
    rows.slice(0, 12).forEach((row, i) => line(`${i + 1}. ${columns.slice(0, 5).map(c => `${c.name}: ${displayValue(row[c.name]) || 'null'}`).join(' | ')}`, 8));
    line('Anomalies use 1.5 x IQR. AI enrichment is simulated with deterministic rules. PDF uses built-in Latin fonts; non-Latin characters are approximated. CSV/XLSX/JSON/Parquet preserve Unicode.', 8);
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(140); doc.text(`DataEngine Studio | ${i} / ${pages}`, 20, 287); }
    return doc.output('blob');
  }
  if (format === 'docx') {
    const { Document, Paragraph, TextRun, Table, TableRow, TableCell, Packer, WidthType, HeadingLevel, PageOrientation } = await import('docx');
    const docColumns = columns.slice(0, 20), docRows = rows.slice(0, 5000);
    const table = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ tableHeader: true, children: docColumns.map(c => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: c.name, bold: true, size: 18 })] })] })) }), ...docRows.map(row => new TableRow({ children: docColumns.map(c => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: displayValue(row[c.name]), size: 16 })] })] })) }))] });
    const doc = new Document({ creator: 'DataEngine Studio', title: projectName, description: 'Processed dataset and quality summary', sections: [{ properties: { page: { size: { orientation: PageOrientation.LANDSCAPE } } }, children: [
      new Paragraph({ text: 'DataEngine Studio', heading: HeadingLevel.TITLE }),
      new Paragraph({ text: projectName, heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: `Generated ${new Date().toISOString()} | ${rows.length} rows | ${columns.length} columns | Health ${quality.score}/100` }),
      new Paragraph({ text: `Missing values: ${quality.missing}. Duplicate rows: ${quality.duplicates}. IQR anomalies: ${quality.anomalies}. Schema errors: ${quality.schemaErrors}.` }),
      new Paragraph({ text: `Pipeline: ${steps.map(s => s.label).join(' → ') || 'No transformations'}` }),
      new Paragraph({ children: [new TextRun({ text: `Word table includes ${docRows.length} rows and ${docColumns.length} columns. Use CSV/XLSX/Parquet for the complete dataset. AI enrichment is simulated.`, italics: true })] }),
      table,
    ] }] });
    return Packer.toBlob(doc);
  }
  throw new Error('Unsupported export format.');
}
function isNullValue(value: unknown) { return value === null || value === undefined; }
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_'); document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export function createWebhookPayload(rows: Row[], name: string) { return { dataset: name, generated_at: new Date().toISOString(), row_count: rows.length, schema: analyze(rows).columns.map(c => ({ name: c.name, type: c.type })), data: rows }; }
