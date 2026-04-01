import { describe, it, expect } from 'vitest';
import type { ContentStreamOp } from '../src/content-stream';
import { walkOpsUpTo } from '../src/op-walker';

function op(operator: string, children?: ContentStreamOp[], matrix?: number[]): ContentStreamOp {
  return {
    operator,
    operands: [],
    raw: operator,
    children,
    xobjectMeta: children ? {
      name: '/Fm0',
      objNum: 1,
      genNum: 0,
      matrix,
    } : undefined,
  };
}

function collect(ops: ContentStreamOp[], path: number[]): string[] {
  const result: string[] = [];
  walkOpsUpTo(ops, path, (o) => result.push(o.operator));
  return result;
}

describe('walkOpsUpTo', () => {
  it('walks flat ops up to target', () => {
    const ops = [op('m'), op('l'), op('S'), op('q')];
    expect(collect(ops, [2])).toEqual(['m', 'l', 'S']);
  });

  it('empty path walks nothing', () => {
    expect(collect([op('m')], [])).toEqual([]);
  });

  it('single op path [0]', () => {
    expect(collect([op('m'), op('l')], [0])).toEqual(['m']);
  });

  it('synthesizes q/Q for fully-passed XObject', () => {
    const doOp = op('Do', [op('A'), op('B')]);
    const ops = [doOp, op('X')];
    // Walking to [1] (X): Do is fully passed → q, walk(A,B), Q, then X
    expect(collect(ops, [1])).toEqual(['q', 'A', 'B', 'Q', 'X']);
  });

  it('synthesizes q + cm for XObject with matrix', () => {
    const doOp = op('Do', [op('A')], [2, 0, 0, 2, 10, 20]);
    const ops = [doOp, op('X')];
    expect(collect(ops, [1])).toEqual(['q', 'cm', 'A', 'Q', 'X']);
  });

  it('descending into XObject: no Q at end', () => {
    const doOp = op('Do', [op('A'), op('B'), op('C')]);
    const ops = [doOp, op('X')];
    // Walking to [0, 1] — inside the XObject at child B
    expect(collect(ops, [0, 1])).toEqual(['q', 'A', 'B']);
  });

  it('landing ON Do itself synthesizes q (about to enter)', () => {
    const doOp = op('Do', [op('A'), op('B')]);
    const ops = [op('m'), doOp];
    // Walking to [1] — landing on the Do
    expect(collect(ops, [1])).toEqual(['m', 'q']);
  });

  it('handles nested XObjects', () => {
    const inner = op('Do', [op('X'), op('Y')]);
    const outer = op('Do', [op('A'), inner, op('Z')]);
    const ops = [outer, op('END')];

    // Walk to [0, 2] — inside outer, at Z
    // outer entered: q, walk children up to [2]
    //   A visited, inner fully passed: q, X, Y, Q, then Z
    expect(collect(ops, [0, 2])).toEqual(['q', 'A', 'q', 'X', 'Y', 'Q', 'Z']);
  });

  it('handles nested descent', () => {
    const inner = op('Do', [op('X'), op('Y')]);
    const outer = op('Do', [op('A'), inner]);
    const ops = [outer];

    // Walk to [0, 1, 0] — inside inner, at X
    expect(collect(ops, [0, 1, 0])).toEqual(['q', 'A', 'q', 'X']);
  });

  it('ops without children are visited directly', () => {
    const imgDo = op('Do'); // image XObject — no children
    const ops = [op('m'), imgDo, op('S')];
    expect(collect(ops, [2])).toEqual(['m', 'Do', 'S']);
  });
});
