export type CellValue = string | number | boolean | null;
export type Row = Record<string, CellValue>;
export type DataType = 'Integer' | 'Float' | 'String' | 'Datetime' | 'Boolean';
export type Stage = 'overview' | 'ingest' | 'normalize' | 'clean' | 'transform' | 'validate' | 'export' | 'visualize' | 'api';
export type SourceFormat = 'csv' | 'tsv' | 'xlsx' | 'xls' | 'parquet' | 'pdf' | 'docx' | 'txt' | 'rtf' | 'md' | 'json' | 'jsonl' | 'xml' | 'yaml' | 'api' | 'database';
export interface SourceDataset {
  id: string;
  name: string;
  format: SourceFormat;
  rows: Row[];
  sourceBytes: number;
  importedAt: string;
  encoding?: string;
  delimiter?: string;
  note?: string;
  demo?: boolean;
}
export interface ColumnSchema {
  name: string;
  type: DataType;
  missing: number;
  missingPercent: number;
  unique: number;
  anomalies: number;
  min?: number;
  max?: number;
}
export interface ValidationRule {
  column: string;
  type?: DataType;
  required?: boolean;
  notNull?: boolean;
  unique?: boolean;
  min?: number;
  max?: number;
  pattern?: string;
  allowed?: string[];
}
export interface QualityIssue {
  row: number;
  column: string;
  message: string;
  rule: string;
}
export interface QualityReport {
  score: number;
  missing: number;
  missingPercent: number;
  duplicates: number;
  anomalies: number;
  schemaErrors: number;
  issues: QualityIssue[];
  totalCells: number;
}
export interface ProcessedDataset {
  rows: Row[];
  columns: ColumnSchema[];
  quality: QualityReport;
  duration: number;
  logs: string[];
}
export type OperationType = 'missing' | 'deduplicate' | 'normalize' | 'cast' | 'pivot' | 'melt' | 'split' | 'outliers' | 'feature' | 'group' | 'window' | 'join' | 'concat' | 'ai' | 'formula' | 'validate' | 'rename' | 'select' | 'sort' | 'filter';
export interface OperationParams {
  column?: string;
  columns?: string[];
  mode?: string;
  value?: CellValue;
  threshold?: number;
  delimiter?: string;
  pattern?: string;
  replacement?: string;
  case?: string;
  dataType?: DataType;
  dateFormat?: string;
  countryCode?: string;
  index?: string[];
  pivotColumn?: string;
  valueColumn?: string;
  agg?: string;
  keys?: string[];
  rightKeys?: string[];
  parts?: number;
  newNames?: string[];
  multiplier?: number;
  action?: string;
  feature?: string;
  bins?: number;
  groups?: string[];
  measures?: { column: string; op: string }[];
  window?: number;
  partition?: string;
  rightId?: string;
  joinType?: string;
  output?: string;
  formula?: string;
  rules?: ValidationRule[];
  direction?: string;
  operator?: string;
}
export interface PipelineStep {
  id: string;
  type: OperationType;
  label: string;
  params: OperationParams;
  enabled: boolean;
}
export interface OperationResult { rows: Row[]; message: string }
export interface ParseOptions { header: 'auto' | 'yes' | 'no'; encoding: 'auto' | 'UTF-8' | 'Windows-1252' | 'Latin-1'; delimiter: 'auto' | ',' | '\t' | ';' | '|'; }
export interface ParseResult { datasets: SourceDataset[]; warnings: string[] }
export type WorkerRequest =
  | { type: 'parse'; requestId: number; file: File; options: ParseOptions }
  | { type: 'load'; requestId: number; datasets: SourceDataset[] }
  | { type: 'remove'; requestId: number; id: string }
  | { type: 'run'; requestId: number; id: string; steps: PipelineStep[] };
export type WorkerResponse = { requestId: number; ok: true; result: ProcessedDataset | SourceDataset[] | null } | { requestId: number; ok: false; error: string };
export interface SavedWorkspace { version: 1; sources: SourceDataset[]; recipes: Record<string, PipelineStep[]>; activeId: string; projectName: string; }
export const MAX_ROWS = 250_000;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = ['csv','tsv','xlsx','xls','parquet','pdf','docx','txt','rtf','md','json','jsonl','xml','yaml','yml'];

export type WorkerRequestPayload = WorkerRequest extends infer T ? T extends WorkerRequest ? Omit<T, 'requestId'> : never : never;
