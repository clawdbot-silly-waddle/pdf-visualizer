import { describe, it, expect } from 'vitest';
import { parseContentStream, serializeOps } from '../src/content-stream';

describe('parseContentStream', () => {
  it('parses simple operators', () => {
    const ops = parseContentStream('100 200 m 300 400 l S');
    expect(ops).toHaveLength(3);
    expect(ops[0]).toMatchObject({ operator: 'm', operands: ['100', '200'] });
    expect(ops[1]).toMatchObject({ operator: 'l', operands: ['300', '400'] });
    expect(ops[2]).toMatchObject({ operator: 'S', operands: [] });
  });

  it('handles graphics state save/restore', () => {
    const ops = parseContentStream('q 1 0 0 1 10 20 cm Q');
    expect(ops).toHaveLength(3);
    expect(ops[0].operator).toBe('q');
    expect(ops[1]).toMatchObject({ operator: 'cm', operands: ['1', '0', '0', '1', '10', '20'] });
    expect(ops[2].operator).toBe('Q');
  });

  it('parses text operators with string operands', () => {
    const ops = parseContentStream('BT /F1 12 Tf (Hello) Tj ET');
    expect(ops).toHaveLength(4);
    expect(ops[0].operator).toBe('BT');
    expect(ops[1]).toMatchObject({ operator: 'Tf', operands: ['/F1', '12'] });
    expect(ops[2].operator).toBe('Tj');
    expect(ops[2].operands[0]).toContain('Hello');
    expect(ops[3].operator).toBe('ET');
  });

  it('parses hex strings', () => {
    const ops = parseContentStream('<48656C6C6F> Tj');
    expect(ops).toHaveLength(1);
    expect(ops[0].operator).toBe('Tj');
    expect(ops[0].operands[0]).toBe('<48656C6C6F>');
  });

  it('parses array operands (TJ)', () => {
    const ops = parseContentStream('[(Hello) 100 (World)] TJ');
    expect(ops).toHaveLength(1);
    expect(ops[0].operator).toBe('TJ');
    expect(ops[0].operands[0]).toContain('Hello');
  });

  it('handles empty input', () => {
    expect(parseContentStream('')).toEqual([]);
    expect(parseContentStream('   ')).toEqual([]);
  });

  it('handles negative numbers', () => {
    const ops = parseContentStream('-5.5 -10 m');
    expect(ops).toHaveLength(1);
    expect(ops[0].operands).toEqual(['-5.5', '-10']);
  });

  it('handles color operators', () => {
    const ops = parseContentStream('0.5 0.3 0.1 rg 1 0 0 RG');
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ operator: 'rg', operands: ['0.5', '0.3', '0.1'] });
    expect(ops[1]).toMatchObject({ operator: 'RG', operands: ['1', '0', '0'] });
  });

  it('parses rectangle operator', () => {
    const ops = parseContentStream('10 20 100 200 re');
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ operator: 're', operands: ['10', '20', '100', '200'] });
  });

  it('parses Do (XObject invocation)', () => {
    const ops = parseContentStream('q 1 0 0 1 0 0 cm /Fm0 Do Q');
    expect(ops).toHaveLength(4);
    expect(ops[2]).toMatchObject({ operator: 'Do', operands: ['/Fm0'] });
  });

  it('preserves raw text for round-tripping', () => {
    const input = '100 200 m\n300 400 l\nS';
    const ops = parseContentStream(input);
    for (const op of ops) {
      expect(op.raw).toBeTruthy();
    }
  });
});

describe('serializeOps', () => {
  it('round-trips simple operators', () => {
    const input = '100 200 m\n300 400 l\nS';
    const ops = parseContentStream(input);
    const serialized = serializeOps(ops);
    const reparsed = parseContentStream(serialized);
    expect(reparsed).toHaveLength(ops.length);
    for (let i = 0; i < ops.length; i++) {
      expect(reparsed[i].operator).toBe(ops[i].operator);
      expect(reparsed[i].operands).toEqual(ops[i].operands);
    }
  });

  it('preserves raw text', () => {
    const input = '100 200 m';
    const ops = parseContentStream(input);
    const serialized = serializeOps(ops);
    expect(serialized.trim()).toBe(ops[0].raw.trim());
  });
});
