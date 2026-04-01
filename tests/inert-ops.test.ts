import { describe, it, expect } from 'vitest';
import { INERT_OPS } from '../src/inert-ops';

describe('INERT_OPS', () => {
  it('contains path construction operators', () => {
    for (const op of ['m', 'l', 'c', 'v', 'y', 'h', 're']) {
      expect(INERT_OPS.has(op)).toBe(true);
    }
  });

  it('contains graphics state operators', () => {
    for (const op of ['q', 'Q', 'cm', 'w', 'J', 'j', 'M', 'd', 'i', 'gs']) {
      expect(INERT_OPS.has(op)).toBe(true);
    }
  });

  it('contains color operators', () => {
    for (const op of ['g', 'G', 'rg', 'RG', 'k', 'K', 'cs', 'CS', 'sc', 'SC', 'scn', 'SCN']) {
      expect(INERT_OPS.has(op)).toBe(true);
    }
  });

  it('contains text state operators', () => {
    for (const op of ['Tf', 'Tc', 'Tw', 'Tz', 'TL', 'Tr', 'Ts']) {
      expect(INERT_OPS.has(op)).toBe(true);
    }
  });

  it('does NOT contain paint operators', () => {
    for (const op of ['S', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n']) {
      expect(INERT_OPS.has(op)).toBe(false);
    }
  });

  it('does NOT contain text rendering operators', () => {
    for (const op of ['Tj', 'TJ', "'", '"']) {
      expect(INERT_OPS.has(op)).toBe(false);
    }
  });

  it('does NOT contain image/XObject operators', () => {
    expect(INERT_OPS.has('Do')).toBe(false);
    expect(INERT_OPS.has('BI')).toBe(false);
  });
});
