import { describe, expect, it } from 'vitest';
import { decodeText, detectDelimiter, detectEncoding, parseDelimited, parseFile, structuredRows, xmlRows } from '@/lib/parsers';
import type { ParseOptions } from '@/lib/types';
const options: ParseOptions = { header: 'auto', encoding: 'auto', delimiter: 'auto' };
const file = (name: string, content: string | Uint8Array | ArrayBuffer) => new File([typeof content === 'string' || content instanceof ArrayBuffer ? content : new Uint8Array(content).buffer], name);
describe('encoding and delimiter detection', () => {
  it('detects UTF-8, Windows-1252, Latin-1, and UTF-16 BOMs', () => {
    expect(detectEncoding(new TextEncoder().encode('Hello café'))).toBe('UTF-8');
    expect(detectEncoding(Uint8Array.of(0x91, 0x61, 0x92))).toBe('Windows-1252');
    expect(detectEncoding(Uint8Array.of(0xe9, 0x61))).toBe('Latin-1');
    expect(detectEncoding(Uint8Array.of(0xff, 0xfe, 0x61, 0))).toBe('UTF-16LE');
    expect(decodeText(Uint8Array.of(0x91, 0x61, 0x92)).text).toBe('‘a’');
    expect(decodeText(Uint8Array.of(0xe9)).text).toBe('é');
  });
  it('resolves commas, tabs, pipes, and semicolons including quoted delimiters', () => {
    expect(detectDelimiter('a,b\n1,2\n3,4')).toBe(','); expect(detectDelimiter('a\tb\n1\t2')).toBe('\t'); expect(detectDelimiter('a|b\n1|2')).toBe('|'); expect(detectDelimiter('a;b\n1;2')).toBe(';'); expect(detectDelimiter('a,b\n"hello, world",2')).toBe(',');
  });
  it('auto-detects headers and preserves headerless data', () => {
    expect(parseDelimited('name,age\nAda,31\nGrace,42', options).rows).toEqual([{ name: 'Ada', age: '31' }, { name: 'Grace', age: '42' }]);
    expect(parseDelimited('1,2\n3,4', options).rows[0]).toEqual({ column_1: '1', column_2: '2' });
    expect(parseDelimited('1,2\n3,4', { ...options, header: 'yes' }).rows).toEqual([{ '1': '3', '2': '4' }]);
  });
  it('rejects unclosed CSV quotes and explicit encoding mismatches', () => { expect(() => parseDelimited('a,b\n"unclosed,2', options)).toThrow('unclosed quotes'); expect(() => decodeText(Uint8Array.of(0xff, 0xff), 'UTF-8')).toThrow('not valid'); });
});
describe('semi-structured and document parsing', () => {
  it('finds record arrays nested in API envelopes and flattens objects', () => { expect(structuredRows({ result: { data: [{ id: 1, user: { name: 'Ada' } }] } })).toEqual([{ id: 1, 'user.name': 'Ada' }]); expect(structuredRows({ a: 1, b: true })).toEqual([{ a: 1, b: true }]); });
  it('extracts repeated XML records', () => { expect(xmlRows('<response><rows><row><id>1</id><name>Ada</name></row><row><id>2</id><name>Grace</name></row></rows></response>')).toEqual([{ id: '1', name: 'Ada' }, { id: '2', name: 'Grace' }]); });
  it('rejects XML entities', () => { expect(() => xmlRows('<!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>')).toThrow('DOCTYPE'); });
  it('parses JSON, JSONL, YAML, Markdown, TXT, and RTF files', async () => {
    expect((await parseFile(file('a.json', '[{"a":1}]'), options)).datasets[0].rows).toEqual([{ a: 1 }]);
    expect((await parseFile(file('a.jsonl', '{"a":1}\n{"a":2}'), options)).datasets[0].rows).toEqual([{ a: 1 }, { a: 2 }]);
    expect((await parseFile(file('a.yaml', '- name: Ada\n  age: 31\n- name: Grace\n  age: 42'), options)).datasets[0].rows).toHaveLength(2);
    expect((await parseFile(file('a.md', '| Name | Age |\n| --- | --- |\n| Ada | 31 |'), options)).datasets[0].rows).toEqual([{ Name: 'Ada', Age: '31' }]);
    expect((await parseFile(file('a.txt', 'First paragraph.\n\nSecond paragraph.'), options)).datasets[0].rows).toHaveLength(2);
    expect((await parseFile(file('a.rtf', "{\\rtf1\\ansi Hello\\par World}"), options)).datasets[0].rows.map(r => r.text)).toEqual(['Hello', 'World']);
  });
  it('reports malformed JSONL line numbers and empty files', async () => { await expect(parseFile(file('a.jsonl', '{}\nnot json'), options)).rejects.toThrow('line 2'); await expect(parseFile(file('a.csv', ''), options)).rejects.toThrow('empty'); });
  it('rejects unsupported types and oversized files', async () => { await expect(parseFile(file('a.exe', 'bad'), options)).rejects.toThrow('Unsupported'); const f = file('a.csv', 'a,b'); Object.defineProperty(f, 'size', { value: 101 * 1024 * 1024 }); await expect(parseFile(f, options)).rejects.toThrow('100 MB'); });
});
