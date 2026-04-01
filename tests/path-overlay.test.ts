import { describe, it, expect } from 'vitest';
import { computeOverlayAt } from '../src/path-overlay';
import { parseContentStream } from '../src/content-stream';

function ops(stream: string) {
  return parseContentStream(stream);
}

describe('computeOverlayAt', () => {
  it('returns null when no path is in progress', () => {
    const result = computeOverlayAt([], 0);
    expect(result).toBeNull();
  });

  it('returns null for ops that only have paint (no active path)', () => {
    const o = ops('0 0 m 100 100 l S');
    // After S (paint), path is cleared
    const result = computeOverlayAt(o, 3);
    expect(result).toBeNull();
  });

  it('tracks a simple line path', () => {
    const o = ops('10 20 m 100 200 l');
    const result = computeOverlayAt(o, 2);
    expect(result).not.toBeNull();
    expect(result!.path.length).toBeGreaterThanOrEqual(2);
    // Should have M then L segments
    const types = result!.path.map(s => s.type);
    expect(types).toContain('M');
    expect(types).toContain('L');
  });

  it('tracks a rectangle', () => {
    const o = ops('10 20 100 200 re');
    const result = computeOverlayAt(o, 1);
    expect(result).not.toBeNull();
    // re generates M + 3L + Z
    expect(result!.path.length).toBe(5);
  });

  it('tracks cubic bezier curve', () => {
    const o = ops('0 0 m 10 20 30 40 50 60 c');
    const result = computeOverlayAt(o, 2);
    expect(result).not.toBeNull();
    const types = result!.path.map(s => s.type);
    expect(types).toContain('C');
  });

  it('clears path after paint op', () => {
    const o = ops('0 0 m 100 100 l S 50 50 m');
    // After S at index 2, path clears. At index 3, new path starts.
    const afterPaint = computeOverlayAt(o, 3);
    expect(afterPaint).toBeNull();

    const newPath = computeOverlayAt(o, 4);
    expect(newPath).not.toBeNull();
    expect(newPath!.path.length).toBe(1); // just the M
  });

  it('handles closepath (h)', () => {
    const o = ops('0 0 m 100 0 l 100 100 l h');
    const result = computeOverlayAt(o, 4);
    expect(result).not.toBeNull();
    const types = result!.path.map(s => s.type);
    expect(types).toContain('Z');
  });

  it('tracks CTM through state save/restore', () => {
    const o = ops('q 2 0 0 2 0 0 cm 10 10 m Q');
    // After Q, state is restored but path should reflect m at scaled coords
    const result = computeOverlayAt(o, 3);
    expect(result).not.toBeNull();
    // path point is in user space coords: 10, 10
    expect(result!.path[0].points[0]).toBeCloseTo(10);
    expect(result!.path[0].points[1]).toBeCloseTo(10);
  });
});
