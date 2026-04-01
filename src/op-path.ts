/**
 * OpPath — path-based cursor into the operator tree.
 *
 * Convention:
 *   linear 0 → OpPath []      (before all ops, blank page)
 *   linear 1 → OpPath [0]     (first op)
 *   linear N → OpPath [i]     (page op i)
 *   linear N → OpPath [i, j]  (child op j inside Do at page op i)
 *
 * A Do with children counts as 1 (itself) + countOps(children) in linear space.
 */

import type { ContentStreamOp } from './content-stream';

export type OpPath = number[];

/** Recursively count all ops in a tree (each op = 1, children add to parent). */
export function countOps(ops: ContentStreamOp[]): number {
  let total = 0;
  for (const op of ops) {
    total += 1;
    if (op.children) {
      total += countOps(op.children);
    }
  }
  return total;
}

/** Convert a linear position (0..totalOps) to an OpPath. */
export function linearToPath(ops: ContentStreamOp[], linear: number): OpPath {
  if (linear <= 0) return [];

  let remaining = linear;
  for (let i = 0; i < ops.length; i++) {
    const childCount = ops[i].children ? countOps(ops[i].children!) : 0;
    const weight = 1 + childCount;

    if (remaining <= weight) {
      if (remaining === 1) return [i];
      // Descend into children
      return [i, ...linearToPath(ops[i].children!, remaining - 1)];
    }
    remaining -= weight;
  }
  // Past end — clamp to last op
  if (ops.length > 0) return [ops.length - 1];
  return [];
}

/** Convert an OpPath back to a linear position. */
export function pathToLinear(ops: ContentStreamOp[], path: OpPath): number {
  if (path.length === 0) return 0;

  let linear = 0;
  const idx = path[0];

  // Sum all ops before this index
  for (let i = 0; i < idx && i < ops.length; i++) {
    linear += 1;
    if (ops[i].children) {
      linear += countOps(ops[i].children!);
    }
  }

  // Add this op itself
  linear += 1;

  // Descend if deeper
  if (path.length > 1 && idx < ops.length && ops[idx].children) {
    linear += pathToLinear(ops[idx].children!, path.slice(1));
  }

  return linear;
}

/** Get the op at a given path, or null if path is empty (before all ops). */
export function opAtPath(ops: ContentStreamOp[], path: OpPath): ContentStreamOp | null {
  if (path.length === 0) return null;

  const idx = path[0];
  if (idx < 0 || idx >= ops.length) return null;

  if (path.length === 1) return ops[idx];

  const op = ops[idx];
  if (!op.children) return null;
  return opAtPath(op.children, path.slice(1));
}

/** Get the op at a linear position (convenience wrapper). */
export function opAtLinear(ops: ContentStreamOp[], linear: number): ContentStreamOp | null {
  return opAtPath(ops, linearToPath(ops, linear));
}

/** Get the nesting depth of a path. 0 = root level. */
export function pathDepth(path: OpPath): number {
  return Math.max(0, path.length - 1);
}

/** Advance path by delta steps (handles entering/exiting XObjects). */
export function advancePath(ops: ContentStreamOp[], path: OpPath, delta: number): OpPath {
  const linear = pathToLinear(ops, path);
  const total = countOps(ops);
  const newLinear = Math.max(0, Math.min(linear + delta, total));
  return linearToPath(ops, newLinear);
}
