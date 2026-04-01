import { describe, it, expect } from 'vitest';
import type { ContentStreamOp } from '../src/content-stream';
import {
  countOps,
  linearToPath,
  pathToLinear,
  opAtPath,
  opAtLinear,
  pathDepth,
  advancePath,
} from '../src/op-path';

/** Helper to create a simple op */
function op(operator: string, children?: ContentStreamOp[]): ContentStreamOp {
  return { operator, operands: [], raw: operator, children };
}

describe('countOps', () => {
  it('counts flat ops', () => {
    expect(countOps([op('m'), op('l'), op('S')])).toBe(3);
  });

  it('counts zero ops', () => {
    expect(countOps([])).toBe(0);
  });

  it('counts Do with children: 1 + children', () => {
    const doOp = op('Do', [op('m'), op('l'), op('S')]);
    expect(countOps([doOp])).toBe(4); // Do itself + 3 children
  });

  it('counts nested XObjects', () => {
    const inner = op('Do', [op('A'), op('B')]);
    const outer = op('Do', [op('X'), inner, op('Y')]);
    // outer: 1 + (X:1 + inner:1+2 + Y:1) = 1 + 5 = 6
    expect(countOps([outer])).toBe(6);
  });

  it('counts mixed flat and XObject ops', () => {
    const doOp = op('Do', [op('C'), op('D'), op('E')]);
    // A:1 + B:1 + Do:1+3 + F:1 = 7
    expect(countOps([op('A'), op('B'), doOp, op('F')])).toBe(7);
  });
});

describe('linearToPath / pathToLinear', () => {
  const ops = [op('A'), op('B'), op('Do', [op('C'), op('D'), op('E')]), op('F')];
  // Layout: A=1, B=2, Do=3, C=4, D=5, E=6, F=7

  it('linear 0 → empty path', () => {
    expect(linearToPath(ops, 0)).toEqual([]);
  });

  it('round-trips flat ops', () => {
    expect(linearToPath(ops, 1)).toEqual([0]); // A
    expect(linearToPath(ops, 2)).toEqual([1]); // B
    expect(linearToPath(ops, 7)).toEqual([3]); // F
  });

  it('linear 3 → Do itself [2]', () => {
    expect(linearToPath(ops, 3)).toEqual([2]);
  });

  it('linear 4..6 → children [2, 0]..[2, 2]', () => {
    expect(linearToPath(ops, 4)).toEqual([2, 0]); // C
    expect(linearToPath(ops, 5)).toEqual([2, 1]); // D
    expect(linearToPath(ops, 6)).toEqual([2, 2]); // E
  });

  it('pathToLinear is inverse of linearToPath', () => {
    for (let i = 0; i <= countOps(ops); i++) {
      const path = linearToPath(ops, i);
      expect(pathToLinear(ops, path)).toBe(i);
    }
  });

  it('handles nested XObjects', () => {
    const inner = op('Do', [op('X'), op('Y')]);
    const nested = [op('A'), op('Do', [op('B'), inner, op('C')])];
    // A=1, Do=2, B=3, inner_Do=4, X=5, Y=6, C=7
    expect(linearToPath(nested, 5)).toEqual([1, 1, 0]); // X
    expect(linearToPath(nested, 6)).toEqual([1, 1, 1]); // Y
    expect(pathToLinear(nested, [1, 1, 0])).toBe(5);
    expect(pathToLinear(nested, [1, 1, 1])).toBe(6);
  });

  it('clamps past-end linear to last op', () => {
    const path = linearToPath(ops, 100);
    expect(path).toEqual([3]); // F, the last op
  });

  it('handles empty ops', () => {
    expect(linearToPath([], 0)).toEqual([]);
    expect(linearToPath([], 5)).toEqual([]);
    expect(pathToLinear([], [])).toBe(0);
  });
});

describe('opAtPath', () => {
  const ops = [op('A'), op('Do', [op('B'), op('C')]), op('D')];

  it('returns null for empty path', () => {
    expect(opAtPath(ops, [])).toBeNull();
  });

  it('returns top-level ops', () => {
    expect(opAtPath(ops, [0])?.operator).toBe('A');
    expect(opAtPath(ops, [1])?.operator).toBe('Do');
    expect(opAtPath(ops, [2])?.operator).toBe('D');
  });

  it('returns child ops', () => {
    expect(opAtPath(ops, [1, 0])?.operator).toBe('B');
    expect(opAtPath(ops, [1, 1])?.operator).toBe('C');
  });

  it('returns null for out-of-bounds', () => {
    expect(opAtPath(ops, [10])).toBeNull();
    expect(opAtPath(ops, [0, 0])).toBeNull(); // A has no children
  });
});

describe('opAtLinear', () => {
  const ops = [op('A'), op('Do', [op('B'), op('C')]), op('D')];

  it('returns null for linear 0', () => {
    expect(opAtLinear(ops, 0)).toBeNull();
  });

  it('returns correct ops for linear positions', () => {
    expect(opAtLinear(ops, 1)?.operator).toBe('A');
    expect(opAtLinear(ops, 2)?.operator).toBe('Do');
    expect(opAtLinear(ops, 3)?.operator).toBe('B');
    expect(opAtLinear(ops, 4)?.operator).toBe('C');
    expect(opAtLinear(ops, 5)?.operator).toBe('D');
  });
});

describe('pathDepth', () => {
  it('empty path → 0', () => expect(pathDepth([])).toBe(0));
  it('[0] → 0 (root level)', () => expect(pathDepth([0])).toBe(0));
  it('[2, 3] → 1 (one level deep)', () => expect(pathDepth([2, 3])).toBe(1));
  it('[1, 2, 3] → 2', () => expect(pathDepth([1, 2, 3])).toBe(2));
});

describe('advancePath', () => {
  const ops = [op('A'), op('Do', [op('B'), op('C')]), op('D')];
  // A=1, Do=2, B=3, C=4, D=5

  it('steps forward through flat ops', () => {
    expect(advancePath(ops, [], 1)).toEqual([0]); // → A
  });

  it('steps into XObject children', () => {
    expect(advancePath(ops, [1], 1)).toEqual([1, 0]); // Do → B
    expect(advancePath(ops, [1, 0], 1)).toEqual([1, 1]); // B → C
  });

  it('steps out of XObject', () => {
    expect(advancePath(ops, [1, 1], 1)).toEqual([2]); // C → D
  });

  it('steps backward into XObject from outside', () => {
    expect(advancePath(ops, [2], -1)).toEqual([1, 1]); // D → C
  });

  it('steps backward from first child to Do', () => {
    expect(advancePath(ops, [1, 0], -1)).toEqual([1]); // B → Do
  });

  it('clamps to bounds', () => {
    expect(advancePath(ops, [], -1)).toEqual([]); // already at start
    // [2] is linear 5 = total, stepping +1 stays at [2] (clamped)
    expect(advancePath(ops, [2], 1)).toEqual([2]);
  });

  it('does not go past end', () => {
    // D is the last op at linear 5, total is 5
    const path = advancePath(ops, [2], 100);
    // Should clamp to total (5), which maps back to [2] (the last op)
    expect(pathToLinear(ops, path)).toBeLessThanOrEqual(countOps(ops));
  });
});
