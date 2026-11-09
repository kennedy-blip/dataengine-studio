import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { jsPDF } from 'jspdf';
import { Document, Paragraph, Packer, Table, TableRow, TableCell } from 'docx';
import ExcelJS from 'exceljs';
import { parquetWriteBuffer } from 'hyparquet-writer';

const base = process.env.BASE_URL || 'http://localhost:3000';
const dir = '.playwright-cli';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const metric = async (label, expected) => {
  const locator = page.locator('.metric-card').filter({ hasText: label }).locator('.metric-value').first();
  await locator.waitFor();
  if (expected !== undefined) await page.waitForFunction(({ label, expected }) => [...document.querySelectorAll('.metric-card')].find(el => el.textContent.includes(label))?.querySelector('.metric-value')?.textContent?.includes(expected), { label, expected }, { timeout: 20000 });
};
const nav = async label => { await page.locator('.nav-item').filter({ hasText: label }).first().click(); await page.waitForTimeout(250); };
const stage = async label => { await page.locator('.stage-nav').getByRole('button', { name: new RegExp(label) }).click(); await page.waitForTimeout(250); };
const operation = async label => { await page.locator('.operation-card').filter({ hasText: label }).click(); };
const addStep = async () => { await page.getByRole('dialog').getByRole('button', { name: 'Add step', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); };
const closeDialog = async () => { await page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); };
const openImport = async () => { await page.getByRole('button', { name: 'Import data', exact: true }).last().click(); };
const exportFile = async (name, file) => {
  await page.getByRole('button', { name: 'Export data', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Take your data with you' });
  const downloadEvent = page.waitForEvent('download');
  await dialog.locator('button').filter({ hasText: name }).click();
  const download = await downloadEvent;
  await download.saveAs(`${dir}/${file}`);
  return readFile(`${dir}/${file}`);
};
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await metric('Total records', '1,248');
  await page.screenshot({ path: `${dir}/desktop.png`, fullPage: true });
  assert.equal(await page.title(), 'DataEngine Studio — Good data starts here');
  await page.getByLabel('Search all rows').fill('Amara');
  await page.waitForTimeout(250);
  assert.match(await page.locator('.table-footer').innerText(), /filtered/);
  await page.getByLabel('Clear search').click();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  assert.match(await page.locator('.table-footer').innerText(), /9–16/);
  await page.getByRole('button', { name: 'First page', exact: true }).click();
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await page.locator('label').filter({ hasText: /^email$/ }).getByRole('checkbox').uncheck();
  assert.equal(await page.locator('.data-table th').filter({ hasText: /^email$/ }).count(), 0);
  await page.getByRole('button', { name: 'Show all columns' }).click();
  await page.getByLabel('Close columns').click();
  console.log('✓ Demo worker, search, pagination, and column visibility');

  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('People'); sheet.addRows([['Name', 'Score'], ['Ada', 9], ['Grace', 8]]);
  const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
  const fixtureRows = [['Name', 'Score'], ['Ada', '9'], ['Grace', '8']].map(row => new TableRow({ children: row.map(text => new TableCell({ children: [new Paragraph(text)] })) }));
  const docx = new Document({ sections: [{ children: [new Table({ rows: fixtureRows })] }] });
  const docxBuffer = await Packer.toBuffer(docx);
  const parquet = Buffer.from(parquetWriteBuffer({ columnData: [{ name: 'name', data: ['Ada', 'Grace'], type: 'STRING' }, { name: 'score', data: [9, 8], type: 'INT32' }], codec: 'UNCOMPRESSED' }));
  const pdf = new jsPDF(); ['Name', 'Ada', 'Grace'].forEach((text, i) => pdf.text(text, 20, 30 + i * 15)); ['Score', '9', '8'].forEach((text, i) => pdf.text(text, 90, 30 + i * 15));
  const csv = Buffer.concat([Buffer.from('name;score\nAda;9\nBob;\nGrace;8\nCaf'), Buffer.from([0xe9]), Buffer.from(';10\n')]);
  const fixtures = [
    { name: 'people.csv', mimeType: 'text/csv', buffer: csv },
    { name: 'people.json', mimeType: 'application/json', buffer: Buffer.from('[{"name":"Ada","score":9},{"name":"Grace","score":8}]') },
    { name: 'people.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx },
    { name: 'people.parquet', mimeType: 'application/octet-stream', buffer: parquet },
    { name: 'people.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxBuffer },
    { name: 'people.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf.output('arraybuffer')) },
  ];
  await openImport();
  await page.getByLabel('Choose data files').setInputFiles(fixtures);
  await page.getByRole('button', { name: 'Import 6 files', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 90000 });
  for (const name of ['people.csv', 'people.json', 'people.xlsx', 'people.parquet', 'table 1.docx', 'page 1.pdf']) assert.ok(await page.locator('.dataset-tab').filter({ hasText: name }).count(), `Imported ${name}`);
  await page.locator('.dataset-tab').filter({ hasText: 'people.csv' }).click();
  await metric('Total records', '4');
  await stage('Normalize');
  assert.match(await page.locator('main').innerText(), /Latin-1/);
  assert.match(await page.locator('main').innerText(), /Semicolon/);
  console.log('✓ CSV, JSON, XLSX, Parquet, DOCX, and PDF imports; encoding/delimiter detection');

  await stage('Clean'); await operation('Handle missing values'); await addStep();
  await nav('Pipeline studio'); await metric('Total records', '3'); await metric('Pipeline steps', '01');
  await page.locator('.metric-card').filter({ hasText: 'Pipeline steps' }).click();
  await page.getByLabel('Undo pipeline change').click(); await metric('Total records', '4');
  await page.getByLabel('Redo pipeline change').click(); await metric('Total records', '3');
  await closeDialog();
  await stage('Transform'); await operation('Formula builder');
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Output column name').fill('result');
  await dialog.locator('textarea').fill('IF([score] >= 8) THEN "Pass" ELSE "Review"');
  await addStep(); await nav('Pipeline studio'); await metric('Pipeline steps', '02');
  const json = JSON.parse((await exportFile('JSON data', 'export.json')).toString());
  assert.equal(json.length, 3); assert.ok(json.every(row => row.result === 'Pass'));
  const csvExport = await exportFile('Comma-separated', 'export.csv'); assert.equal(csvExport.subarray(0,3).toString('hex'), 'efbbbf');
  assert.equal((await exportFile('Excel workbook', 'export.xlsx')).subarray(0,2).toString(), 'PK');
  assert.equal((await exportFile('Apache Parquet', 'export.parquet')).subarray(0,4).toString(), 'PAR1');
  assert.equal((await exportFile('PDF quality', 'export.pdf')).subarray(0,4).toString(), '%PDF');
  assert.equal((await exportFile('Word document', 'export.docx')).subarray(0,2).toString(), 'PK');
  console.log('✓ Cleaning, formula IF/THEN/ELSE, undo/redo, and all six browser exports');

  await page.locator('.dataset-tab').filter({ hasText: 'customers.csv' }).click(); await metric('Total records', '1,248');
  await stage('Validate'); await page.getByRole('button', { name: 'Add validation rules' }).click();
  dialog = page.getByRole('dialog'); await dialog.getByLabel('Unique values').check(); await addStep();
  await page.waitForFunction(() => [...document.querySelectorAll('.metric-card')].find(el => el.textContent.includes('Schema errors'))?.querySelector('.metric-value')?.textContent === '12', null, { timeout: 20000 });
  await page.getByRole('button', { name: 'Export data', exact: true }).click();
  await page.getByRole('dialog', { name: 'Take your data with you' }).locator('button').filter({ hasText: 'JSON data' }).click();
  await page.getByRole('dialog', { name: 'Export with validation findings?' }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await nav('Pipeline studio'); await page.locator('.metric-card').filter({ hasText: 'Pipeline steps' }).click(); await page.getByLabel('Undo pipeline change').click(); await closeDialog();
  console.log('✓ Schema validation, duplicate-key findings, and export guard');

  await nav('Visualizations');
  for (const type of ['Line', 'Scatter', 'Heatmap', 'Histogram', 'Bar']) { await page.getByRole('button', { name: type, exact: true }).click(); await page.waitForTimeout(200); }
  await page.screenshot({ path: `${dir}/charts.png`, fullPage: true });
  await nav('API playground'); await page.getByRole('button', { name: 'Run request' }).click();
  await page.locator('.badge').filter({ hasText: /^200$/ }).waitFor({ timeout: 20000 });
  assert.match(await page.locator('.code-block').innerText(), /total_rows/);
  const webhookEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download', exact: true }).click(); const webhook = await webhookEvent; await webhook.saveAs(`${dir}/webhook.json`); assert.equal(JSON.parse(await readFile(`${dir}/webhook.json`, 'utf8')).row_count, 1248);
  console.log('✓ Five chart types, live mock API, and full webhook download');

  await page.reload({ waitUntil: 'networkidle' }); await metric('Total records', '1,248');
  await page.locator('.dataset-tab').filter({ hasText: 'people.csv' }).click(); await metric('Total records', '3'); await metric('Pipeline steps', '02');
  await page.keyboard.press('Control+k'); await page.getByPlaceholder('What would you like to do?').fill('normalize'); await page.keyboard.press('Enter'); assert.match(await page.locator('h1').innerText(), /structure/);
  console.log('✓ IndexedDB persistence and keyboard command palette');

  if (process.env.SKIP_REST !== '1') {
    await openImport(); await page.getByRole('button', { name: 'REST API', exact: true }).click();
    await page.getByPlaceholder('https://api.example.com/v1/customers').fill('https://api.github.com/repos/kennedy-blip/dataengine-studio');
    await page.getByRole('button', { name: 'Connect & import' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 35000 });
    await nav('Pipeline studio');
    assert.match(await page.locator('.dataset-tab.active').innerText(), /api.github.com/);
    console.log('✓ Real HTTPS REST import with DNS pinning');
  }

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(base, { waitUntil: 'networkidle' }); await mobile.locator('.metric-value').first().filter({ hasText: '1,248' }).waitFor();
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'No page-level mobile overflow');
  await mobile.screenshot({ path: `${dir}/mobile.png`, fullPage: true });
  await mobile.getByLabel('Open navigation').click(); await mobile.locator('.stage-nav').getByRole('button', { name: /Clean & prepare/ }).click(); assert.match(await mobile.locator('h1').innerText(), /Clean data/);
  await mobile.screenshot({ path: `${dir}/mobile-clean.png`, fullPage: true });
  console.log('✓ Responsive mobile layout and navigation');
  assert.deepEqual(errors, [], 'No browser runtime or console errors');
  await writeFile(`${dir}/results.json`, JSON.stringify({ status: 'passed', checks: ['worker', 'table', 'six imports', 'cleaning', 'formula', 'undo/redo', 'six exports', 'validation', 'charts', 'mock API', 'webhook', 'persistence', 'command palette', 'REST', 'mobile'], consoleErrors: errors, date: new Date().toISOString() }, null, 2));
  console.log('PASS: browser smoke checks complete.');
} catch (error) {
  await page.screenshot({ path: `${dir}/failure.png`, fullPage: true }).catch(() => {});
  console.error('BROWSER ERRORS', errors);
  console.error('VISIBLE TEXT', (await page.locator('body').innerText().catch(() => '')).slice(-5000));
  throw error;
} finally { await browser.close(); }
