import { describe, it, expect } from 'vitest';
import { decodeForDisplay } from '../src/display-decode';

describe('decodeForDisplay', () => {
  it('passes through regular ASCII', () => {
    expect(decodeForDisplay('Hello World')).toBe('Hello World');
  });

  it('passes through regular Latin-1 chars (>= 0xA0)', () => {
    expect(decodeForDisplay('café')).toBe('café');
  });

  it('maps C1 control code 0x85 → ellipsis', () => {
    expect(decodeForDisplay('\u0085')).toBe('…');
  });

  it('maps C1 control code 0x96 → en-dash', () => {
    expect(decodeForDisplay('\u0096')).toBe('–');
  });

  it('maps C1 control code 0x97 → em-dash', () => {
    expect(decodeForDisplay('\u0097')).toBe('—');
  });

  it('maps C1 control code 0x93 → left double quote', () => {
    expect(decodeForDisplay('\u0093')).toBe('\u201C');
  });

  it('maps C1 control code 0x94 → right double quote', () => {
    expect(decodeForDisplay('\u0094')).toBe('\u201D');
  });

  it('handles mixed content', () => {
    const input = 'Price: 5\u009620 EUR';
    const result = decodeForDisplay(input);
    expect(result).toBe('Price: 5–20 EUR');
  });
});
