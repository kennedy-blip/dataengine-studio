import { ArrowDownWideNarrow, Binary, Braces, CaseSensitive, Combine, CopyMinus, Filter, GitMerge, Group, Layers3, ListFilter, Scissors, ShieldCheck, Sparkles, Split, TableProperties, TextCursorInput, TrendingUp, WandSparkles, type LucideIcon } from 'lucide-react';
import type { OperationParams, OperationType } from './types';
export interface OperationDefinition { type: OperationType; title: string; description: string; icon: LucideIcon; category: 'clean' | 'transform' | 'structure'; tag?: string; defaults: OperationParams; }
export const operations: OperationDefinition[] = [
  { type: 'missing', title: 'Handle missing values', description: 'Drop, fill, or carry forward missing entries.', icon: CopyMinus, category: 'clean', defaults: { columns: [], mode: 'drop-rows' } },
  { type: 'deduplicate', title: 'Remove duplicates', description: 'Find exact matches or fuzzy duplicate records.', icon: Layers3, category: 'clean', defaults: { columns: [], mode: 'exact', threshold: 0.9 } },
  { type: 'normalize', title: 'Normalize text', description: 'Clean whitespace, cases, HTML, and patterns.', icon: CaseSensitive, category: 'clean', defaults: { columns: [], mode: 'trim' } },
  { type: 'cast', title: 'Cast & format types', description: 'Parse dates, currencies, and consistent types.', icon: Binary, category: 'clean', defaults: { dataType: 'String', dateFormat: 'ISO / auto', mode: 'standard' } },
  { type: 'outliers', title: 'Manage outliers', description: 'Cap or filter anomalies with IQR and Z-score.', icon: Filter, category: 'clean', defaults: { mode: 'iqr', multiplier: 1.5, action: 'cap' } },
  { type: 'filter', title: 'Filter rows', description: 'Keep the records that match your conditions.', icon: ListFilter, category: 'clean', defaults: { operator: 'contains', value: '' } },
  { type: 'formula', title: 'Formula builder', description: 'Create calculated columns with safe expressions.', icon: Braces, category: 'transform', tag: 'POPULAR', defaults: { output: 'calculated_column', formula: 'IF([monthly_spend] > 100) THEN "High value" ELSE "Standard"' } },
  { type: 'ai', title: 'AI text enrichment', description: 'Summarize, score sentiment, and find entities.', icon: Sparkles, category: 'transform', tag: 'SIMULATED', defaults: { mode: 'sentiment' } },
  { type: 'feature', title: 'Feature engineering', description: 'Extract date parts, text lengths, and numeric bins.', icon: WandSparkles, category: 'transform', defaults: { feature: 'year' } },
  { type: 'group', title: 'Group & aggregate', description: 'Roll up measures across multiple dimensions.', icon: Group, category: 'transform', defaults: { groups: [], measures: [] } },
  { type: 'window', title: 'Running calculations', description: 'Cumulative totals and moving averages.', icon: TrendingUp, category: 'transform', defaults: { mode: 'cumulative', window: 3 } },
  { type: 'join', title: 'Join datasets', description: 'Connect records with four SQL-style join types.', icon: GitMerge, category: 'transform', defaults: { joinType: 'left', keys: [], rightKeys: [] } },
  { type: 'concat', title: 'Concatenate datasets', description: 'Stack rows or combine columns side by side.', icon: Combine, category: 'transform', defaults: { mode: 'vertical' } },
  { type: 'pivot', title: 'Pivot · long to wide', description: 'Turn category values into measure columns.', icon: TableProperties, category: 'structure', defaults: { index: [], agg: 'sum' } },
  { type: 'melt', title: 'Unpivot · wide to long', description: 'Reshape measures into variable/value pairs.', icon: Split, category: 'structure', defaults: { index: [], columns: [] } },
  { type: 'split', title: 'Split columns', description: 'Separate names, addresses, and delimited text.', icon: Scissors, category: 'structure', defaults: { delimiter: ' ', parts: 2, newNames: [] } },
  { type: 'select', title: 'Select & reorder', description: 'Keep only the columns your pipeline needs.', icon: TableProperties, category: 'structure', defaults: { columns: [] } },
  { type: 'rename', title: 'Rename column', description: 'Give a field a clear, consistent name.', icon: TextCursorInput, category: 'structure', defaults: { output: '' } },
  { type: 'sort', title: 'Sort records', description: 'Order rows before window calculations.', icon: ArrowDownWideNarrow, category: 'structure', defaults: { direction: 'asc' } },
  { type: 'validate', title: 'Schema validation', description: 'Set required fields, types, and value constraints.', icon: ShieldCheck, category: 'clean', defaults: { rules: [] } },
];
export const getOperation = (type: OperationType) => operations.find(o => o.type === type)!;
export const stageOperations = { clean: operations.filter(o => o.category === 'clean' && o.type !== 'validate'), transform: operations.filter(o => o.category === 'transform' || o.category === 'structure'), normalize: operations.filter(o => ['cast','rename','select','sort','filter'].includes(o.type)) };
export const pipelineStages = [
  { id: 'ingest', number: '01', label: 'Import data', short: 'Import' },
  { id: 'normalize', number: '02', label: 'Normalize', short: 'Normalize' },
  { id: 'clean', number: '03', label: 'Clean & prepare', short: 'Clean' },
  { id: 'transform', number: '04', label: 'Transform', short: 'Transform' },
  { id: 'validate', number: '05', label: 'Validate', short: 'Validate' },
  { id: 'export', number: '06', label: 'Export & share', short: 'Export' },
] as const;
