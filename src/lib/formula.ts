import type { CellValue, Row } from './types';
import { isNull, numeric } from './data';

type Token = { type: 'value' | 'column' | 'name' | 'op'; value: string | number | boolean | null };
type Expr =
  | { kind: 'literal'; value: CellValue }
  | { kind: 'column'; name: string }
  | { kind: 'unary'; op: string; child: Expr }
  | { kind: 'binary'; op: string; left: Expr; right: Expr }
  | { kind: 'call'; name: string; args: Expr[] }
  | { kind: 'if'; condition: Expr; yes: Expr; no: Expr };
const operators = ['<=', '>=', '!=', '==', '&&', '||', '=', '<', '>', '+', '-', '*', '/', '%', '^', '(', ')', ',', '!'];
function tokenize(input: string): Token[] {
  if (input.length > 2000) throw new Error('Formulas are limited to 2,000 characters.');
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    if (/\s/.test(input[i])) { i++; continue; }
    if (input[i] === '[') {
      const end = input.indexOf(']', i);
      if (end < 0) throw new Error('Close the column reference with ].');
      const rawName = input.slice(i + 1, end); const name = rawName.length >= 2 && ((rawName.startsWith('"') && rawName.endsWith('"')) || (rawName.startsWith("'") && rawName.endsWith("'"))) ? rawName.slice(1, -1) : rawName; tokens.push({ type: 'column', value: name }); i = end + 1; continue;
    }
    if (input[i] === '"' || input[i] === "'") {
      const quote = input[i++]; let value = ''; let closed = false;
      while (i < input.length) {
        if (input[i] === '\\') { if (i + 1 >= input.length) break; value += input[i + 1]; i += 2; }
        else if (input[i] === quote) { i++; closed = true; break; }
        else value += input[i++];
      }
      if (!closed) throw new Error('Unclosed string in formula.');
      tokens.push({ type: 'value', value }); continue;
    }
    const number = input.slice(i).match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
    if (number) { tokens.push({ type: 'value', value: Number(number[0]) }); i += number[0].length; continue; }
    const name = input.slice(i).match(/^[A-Za-z_][A-Za-z_0-9]*/);
    if (name) { tokens.push({ type: 'name', value: name[0].toUpperCase() }); i += name[0].length; continue; }
    const op = operators.find(op => input.startsWith(op, i));
    if (!op) throw new Error(`Unexpected character “${input[i]}” at position ${i + 1}.`);
    tokens.push({ type: 'op', value: op }); i += op.length;
    if (tokens.length > 500) throw new Error('Formula is too complex.');
  }
  return tokens;
}
export function compileFormula(input: string, columns: string[]): (row: Row) => CellValue {
  const tokens = tokenize(input);
  let pos = 0, nodes = 0;
  const peek = (value?: string) => pos < tokens.length && (value === undefined || tokens[pos].value === value);
  const take = () => tokens[pos++];
  const expect = (value: string) => { if (!peek(value)) throw new Error(`Expected “${value}”.`); pos++; };
  const functions = new Set(['IF', 'ROUND', 'ABS', 'SQRT', 'MIN', 'MAX', 'CONCAT', 'UPPER', 'LOWER', 'TRIM', 'LEN', 'COALESCE', 'ISNULL', 'YEAR', 'MONTH']);
  function atom(depth = 0): Expr {
    if (++nodes > 250 || depth > 50) throw new Error('Formula is too deeply nested.');
    const t = take();
    if (!t) throw new Error('The formula is incomplete.');
    if (t.type === 'value') return { kind: 'literal', value: t.value as CellValue };
    if (t.type === 'column') { const name = String(t.value); if (!columns.includes(name)) throw new Error(`Column “${name}” does not exist.`); return { kind: 'column', name }; }
    if (t.value === '(') { const e = expression(0, depth + 1); expect(')'); return e; }
    if (t.value === '-' || t.value === '!' || t.value === 'NOT') return { kind: 'unary', op: String(t.value), child: atom(depth + 1) };
    if (t.type === 'name') {
      const name = String(t.value);
      if (name === 'TRUE' || name === 'FALSE') return { kind: 'literal', value: name === 'TRUE' };
      if (name === 'NULL') return { kind: 'literal', value: null };
      if (name === 'IF') {
        expect('('); const condition = expression(0, depth + 1);
        let yes: Expr, no: Expr;
        if (peek(')')) { expect(')'); expect('THEN'); yes = expression(0, depth + 1); expect('ELSE'); no = expression(0, depth + 1); }
        else { expect(','); yes = expression(0, depth + 1); expect(','); no = expression(0, depth + 1); expect(')'); }
        return { kind: 'if', condition, yes, no };
      }
      if (!functions.has(name)) throw new Error(`Unsupported function “${name}”.`);
      expect('('); const args: Expr[] = [];
      if (!peek(')')) { args.push(expression(0, depth + 1)); while (peek(',')) { take(); args.push(expression(0, depth + 1)); } }
      expect(')'); return { kind: 'call', name, args };
    }
    throw new Error(`Unexpected token “${t.value}”.`);
  }
  const precedence: Record<string, number> = { OR: 1, '||': 1, AND: 2, '&&': 2, '=': 3, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '^': 7 };
  function expression(min = 0, depth = 0): Expr {
    if (depth > 50 || ++nodes > 250) throw new Error('Formula is too complex.');
    let left = atom(depth);
    while (pos < tokens.length) {
      const op = String(tokens[pos].value); const p = precedence[op];
      if (p === undefined || p < min) break;
      take(); const right = expression(op === '^' ? p : p + 1, depth + 1);
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }
  const ast = expression();
  if (pos !== tokens.length) throw new Error(`Unexpected “${tokens[pos].value}” near the end of the formula.`);
  function evaluate(e: Expr, row: Row): CellValue {
    if (e.kind === 'literal') return e.value;
    if (e.kind === 'column') return row[e.name] ?? null;
    if (e.kind === 'if') return truthy(evaluate(e.condition, row)) ? evaluate(e.yes, row) : evaluate(e.no, row);
    if (e.kind === 'unary') { const v = evaluate(e.child, row); return e.op === '-' ? -number(v) : !truthy(v); }
    if (e.kind === 'binary') {
      const a = evaluate(e.left, row);
      if (e.op === 'AND' || e.op === '&&') return truthy(a) && truthy(evaluate(e.right, row));
      if (e.op === 'OR' || e.op === '||') return truthy(a) || truthy(evaluate(e.right, row));
      const b = evaluate(e.right, row);
      if (e.op === '=' || e.op === '==') return a === b;
      if (e.op === '!=') return a !== b;
      if (e.op === '+') return typeof a === 'string' || typeof b === 'string' ? String(a ?? '') + String(b ?? '') : number(a) + number(b);
      if (['<', '>', '<=', '>='].includes(e.op)) {
        if (isNull(a) || isNull(b)) return false;
        switch (e.op) { case '<': return a < b; case '>': return a > b; case '<=': return a <= b; default: return a >= b; }
      }
      const x = number(a), y = number(b);
      if ((e.op === '/' || e.op === '%') && y === 0) throw new Error('Division by zero.');
      const result = e.op === '-' ? x - y : e.op === '*' ? x * y : e.op === '/' ? x / y : e.op === '%' ? x % y : x ** y;
      if (!Number.isFinite(result)) throw new Error('The calculation produced a non-finite number.');
      return result;
    }
    const args = e.name === 'COALESCE' ? e.args.map(a => evaluate(a, row)).filter(v => !isNull(v)).slice(0, 1) : e.args.map(a => evaluate(a, row));
    const x = args[0] ?? null;
    switch (e.name) {
      case 'ROUND': { const places = Math.min(10, Math.max(0, number(args[1] ?? 0))); return Math.round(number(x) * 10 ** places) / 10 ** places; }
      case 'ABS': return Math.abs(number(x));
      case 'SQRT': { const v = number(x); if (v < 0) throw new Error('SQRT requires a non-negative number.'); return Math.sqrt(v); }
      case 'MIN': return Math.min(...args.map(number));
      case 'MAX': return Math.max(...args.map(number));
      case 'CONCAT': return args.map(v => String(v ?? '')).join('');
      case 'UPPER': return String(x ?? '').toUpperCase();
      case 'LOWER': return String(x ?? '').toLowerCase();
      case 'TRIM': return String(x ?? '').trim().replace(/\s+/g, ' ');
      case 'LEN': return String(x ?? '').length;
      case 'COALESCE': return args[0] ?? null;
      case 'ISNULL': return isNull(x);
      case 'YEAR': return new Date(String(x)).getUTCFullYear();
      case 'MONTH': return new Date(String(x)).getUTCMonth() + 1;
      default: throw new Error('Unsupported function.');
    }
  }
  return row => evaluate(ast, row);
}
function truthy(v: CellValue): boolean { return !isNull(v) && v !== false && v !== 0 && v !== ''; }
function number(v: CellValue): number { const n = numeric(v); if (n === null) throw new Error('Expected a numeric value.'); return n; }
