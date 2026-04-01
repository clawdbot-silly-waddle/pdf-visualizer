/**
 * Op Walker — shared tree walker for overlay computation.
 *
 * Walks the op tree up to a given OpPath, calling a visitor for each op.
 * At XObject boundaries, synthesizes implicit q/cm/Q operations per PDF spec §8.10.1:
 *   entering: q, cm (Matrix), then walk children
 *   fully-passed: q, cm, walk ALL children, Q
 */

import type { ContentStreamOp } from './content-stream';
import type { OpPath } from './op-path';

/** Synthetic op helper — minimal ContentStreamOp for state tracking. */
function syntheticOp(operator: string, operands: string[] = []): ContentStreamOp {
  return { operator, operands, raw: operands.length ? operands.join(' ') + ' ' + operator : operator };
}

/**
 * Walk the op tree up to the given path, calling visitor for each op encountered.
 * For XObject Do ops with children:
 *   - Fully-passed XObjects: synthesize q + cm(Matrix) + walk all children + Q
 *   - Descending into XObject: synthesize q + cm(Matrix) + walk children up to sub-path
 *     (no Q — we're still inside at the target position)
 *   - Do ops without children (image XObjects): just visit the op
 */
export function walkOpsUpTo(
  ops: ContentStreamOp[],
  path: OpPath,
  visitor: (op: ContentStreamOp) => void,
): void {
  if (path.length === 0) return;

  const targetIdx = path[0];

  for (let i = 0; i <= targetIdx && i < ops.length; i++) {
    const op = ops[i];

    if (i < targetIdx) {
      // Op before target: visit fully
      if (op.children && op.children.length > 0) {
        // Synthesize XObject entry
        visitor(syntheticOp('q'));
        if (op.xobjectMeta?.matrix) {
          visitor(syntheticOp('cm', op.xobjectMeta.matrix.map(String)));
        }
        // Walk ALL children
        walkOpsUpTo(op.children, [op.children.length - 1], visitor);
        // Synthesize XObject exit
        visitor(syntheticOp('Q'));
      } else {
        visitor(op);
      }
    } else {
      // i === targetIdx
      if (path.length === 1) {
        // This is the target op — visit it
        if (op.children && op.children.length > 0) {
          // Landing ON the Do itself — treat as "about to enter"
          // Synthesize the state boundary so overlays show correct CTM
          visitor(syntheticOp('q'));
          if (op.xobjectMeta?.matrix) {
            visitor(syntheticOp('cm', op.xobjectMeta.matrix.map(String)));
          }
          // Don't walk children — we're on the Do, not inside it yet
        } else {
          visitor(op);
        }
      } else {
        // Descending into children
        visitor(syntheticOp('q'));
        if (op.xobjectMeta?.matrix) {
          visitor(syntheticOp('cm', op.xobjectMeta.matrix.map(String)));
        }
        walkOpsUpTo(op.children!, path.slice(1), visitor);
        // No Q — still inside the XObject at the target position
      }
    }
  }
}
