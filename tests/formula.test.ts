import { describe, expect, it } from 'vitest';
import { compileFormula } from '@/lib/formula';

describe('safe formula engine', () => {
  const row = { price: 10, quantity: 3, name: 'Ada', country: 'KE', active: true, date: '2026-07-04', missing: null };
  const value = (formula: string) => compileFormula(formula, Object.keys(row))(row);
  it('evaluates arithmetic precedence and powers', () => { expect(value('[price] + [quantity] * 2')).toBe(16); expect(value('([price] + [quantity]) * 2')).toBe(26); expect(value('2 ^ 3 ^ 2')).toBe(512); expect(value('10 % 3')).toBe(1); });
  it('supports both IF syntaxes with lazy branches', () => { expect(value('IF([price] > 5) THEN "High" ELSE "Low"')).toBe('High'); expect(value('IF([price] < 5, 1 / 0, 42)')).toBe(42); });
  it('supports nested conditions and boolean logic', () => { expect(value('IF([active] AND [price] >= 10) THEN IF([quantity] = 3) THEN "Yes" ELSE "No" ELSE "No"')).toBe('Yes'); expect(value('NOT [active] OR false')).toBe(false); });
  it('evaluates whitelisted functions', () => { expect(value('ROUND(10 / 3, 2)')).toBe(3.33); expect(value('CONCAT([name], " ", [country])')).toBe('Ada KE'); expect(value('UPPER([name])')).toBe('ADA'); expect(value('LEN([name])')).toBe(3); expect(value('COALESCE([missing], 7)')).toBe(7); expect(value('ISNULL([missing])')).toBe(true); expect(value('YEAR([date])')).toBe(2026); expect(value('MONTH([date])')).toBe(7); expect(value('MIN(3, 2, 8)')).toBe(2); expect(value('MAX(3, 2, 8)')).toBe(8); expect(value('ABS(-3)')).toBe(3); expect(value('SQRT(9)')).toBe(3); });
  it('never evaluates JavaScript or arbitrary globals', () => { for (const formula of ['globalThis.process.exit()', 'fetch("https://example.com")', 'constructor("alert(1)")()', 'process.env.SECRET']) expect(() => compileFormula(formula, Object.keys(row))).toThrow(); });
  it('rejects malformed and oversized expressions', () => { for (const formula of ['', '1 +', '[price', 'ROUND(1,2', '1; 2', '"unclosed', 'x'.repeat(2001), '('.repeat(60) + '1' + ')'.repeat(60)]) expect(() => compileFormula(formula, Object.keys(row))).toThrow(); });
  it('rejects unknown columns and functions', () => { expect(() => compileFormula('[nope]', ['price'])).toThrow('does not exist'); expect(() => value('EVAL("1")')).toThrow('Unsupported'); });
  it('throws catchable row-level errors for division and incompatible values', () => { expect(() => value('1 / 0')).toThrow('Division by zero'); expect(() => value('[name] * 2')).toThrow('numeric'); expect(() => value('SQRT(-1)')).toThrow(); });
  it('handles escaped strings and bracket names with spaces', () => { expect(compileFormula('["first name"] + "\\\"quoted\\\""', ['first name'])({ 'first name': 'Ada' })).toBe('Ada"quoted"'); });
});
