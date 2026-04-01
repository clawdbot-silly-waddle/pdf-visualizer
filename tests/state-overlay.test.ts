import { describe, it, expect } from 'vitest';
import { computeStateAt } from '../src/state-overlay';
import { parseContentStream } from '../src/content-stream';

function ops(stream: string) {
  return parseContentStream(stream);
}

describe('computeStateAt', () => {
  it('starts with identity CTM and no current point', () => {
    const state = computeStateAt([], 0);
    expect(state.ctm).toEqual([1, 0, 0, 1, 0, 0]);
    expect(state.currentPoint).toBeNull();
    expect(state.clipPaths).toEqual([]);
    expect(state.text).toBeNull();
  });

  it('tracks CTM via cm operator', () => {
    const o = ops('2 0 0 2 10 20 cm');
    const state = computeStateAt(o, 1);
    // cm pre-multiplies: new_CTM = arg × current
    expect(state.ctm[0]).toBeCloseTo(2);
    expect(state.ctm[3]).toBeCloseTo(2);
    expect(state.ctm[4]).toBeCloseTo(10);
    expect(state.ctm[5]).toBeCloseTo(20);
  });

  it('tracks nested CTM via cm', () => {
    const o = ops('2 0 0 2 0 0 cm 1 0 0 1 10 20 cm');
    const state = computeStateAt(o, 2);
    // second cm: [1,0,0,1,10,20] × [2,0,0,2,0,0] = [2,0,0,2,20,40]
    expect(state.ctm[0]).toBeCloseTo(2);
    expect(state.ctm[4]).toBeCloseTo(20);
    expect(state.ctm[5]).toBeCloseTo(40);
  });

  it('saves and restores CTM via q/Q', () => {
    const o = ops('q 2 0 0 2 0 0 cm Q');
    const state = computeStateAt(o, 3);
    expect(state.ctm).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('tracks current point via m operator', () => {
    const o = ops('100 200 m');
    const state = computeStateAt(o, 1);
    expect(state.currentPoint).toEqual({ x: 100, y: 200 });
  });

  it('updates current point via l operator', () => {
    const o = ops('0 0 m 50 75 l');
    const state = computeStateAt(o, 2);
    expect(state.currentPoint).toEqual({ x: 50, y: 75 });
  });

  it('clears current point after paint operator', () => {
    const o = ops('0 0 m 100 100 l S');
    const state = computeStateAt(o, 3);
    expect(state.currentPoint).toBeNull();
  });

  it('tracks text state inside BT..ET', () => {
    const o = ops('BT 1 0 0 1 50 100 Tm ET');
    const stateInText = computeStateAt(o, 2);
    expect(stateInText.text).not.toBeNull();
    expect(stateInText.text!.active).toBe(true);
    expect(stateInText.text!.matrix[4]).toBeCloseTo(50);
    expect(stateInText.text!.matrix[5]).toBeCloseTo(100);

    const stateAfterET = computeStateAt(o, 3);
    expect(stateAfterET.text).toBeNull();
  });

  it('tracks text position via Td', () => {
    const o = ops('BT 1 0 0 1 10 20 Tm 5 -10 Td');
    const state = computeStateAt(o, 3);
    expect(state.text).not.toBeNull();
    // Td translates: new Tm = Td × lineMatrix
    expect(state.text!.matrix[4]).toBeCloseTo(15);
    expect(state.text!.matrix[5]).toBeCloseTo(10);
  });

  it('handles clipping path via W', () => {
    const o = ops('0 0 m 100 0 l 100 100 l 0 100 l h W n');
    const state = computeStateAt(o, 7);
    expect(state.clipPaths.length).toBe(1);
  });

  it('preserves clip paths across q/Q when set before', () => {
    const o = ops('0 0 100 100 re W n q 2 0 0 2 0 0 cm Q');
    const stateInQ = computeStateAt(o, 4);
    expect(stateInQ.clipPaths.length).toBe(1);
    const stateAfterQ = computeStateAt(o, 6);
    expect(stateAfterQ.clipPaths.length).toBe(1);
  });
});
