/**
 * Path Overlay — tracks PDF graphics state while walking content stream operators
 * and renders in-progress (uncommitted) paths as wireframe overlays.
 */

import type { ContentStreamOp } from './content-stream';

interface PathSegment {
  type: 'M' | 'L' | 'C' | 'Z';
  points: number[];
}

interface GraphicsState {
  ctm: [number, number, number, number, number, number];
  strokeColor: string;
  fillColor: string;
  lineWidth: number;
}

const IDENTITY_CTM: GraphicsState['ctm'] = [1, 0, 0, 1, 0, 0];

// Paint operators that consume (clear) the current path
const PAINT_OPS = new Set([
  'S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n',
]);

function defaultState(): GraphicsState {
  return {
    ctm: [...IDENTITY_CTM],
    strokeColor: 'rgb(0, 0, 0)',
    fillColor: 'rgb(0, 0, 0)',
    lineWidth: 1,
  };
}

function cloneState(s: GraphicsState): GraphicsState {
  return {
    ctm: [...s.ctm],
    strokeColor: s.strokeColor,
    fillColor: s.fillColor,
    lineWidth: s.lineWidth,
  };
}

/** Pre-multiply: result = M × current */
function concatMatrix(
  current: GraphicsState['ctm'],
  a: number, b: number, c: number, d: number, e: number, f: number,
): GraphicsState['ctm'] {
  const [ca, cb, cc, cd, ce, cf] = current;
  return [
    a * ca + b * cc,
    a * cb + b * cd,
    c * ca + d * cc,
    c * cb + d * cd,
    e * ca + f * cc + ce,
    e * cb + f * cd + cf,
  ];
}

/** Transform a point by CTM: [x', y'] */
function transformPoint(
  ctm: GraphicsState['ctm'],
  x: number, y: number,
): [number, number] {
  return [
    ctm[0] * x + ctm[2] * y + ctm[4],
    ctm[1] * x + ctm[3] * y + ctm[5],
  ];
}

export interface OverlayResult {
  path: PathSegment[];
  state: GraphicsState;
}

/**
 * Walk ops[0..opIndex) and return the in-progress path (if any) plus current state.
 * Returns null if no path is being constructed at the given point.
 */
export function computeOverlayAt(
  ops: ContentStreamOp[],
  opIndex: number,
): OverlayResult | null {
  let state = defaultState();
  const stateStack: GraphicsState[] = [];
  let path: PathSegment[] = [];
  let curX = 0, curY = 0;
  let startX = 0, startY = 0;

  const limit = Math.min(opIndex, ops.length);
  for (let i = 0; i < limit; i++) {
    const op = ops[i];
    const nums = op.operands.map(Number);

    switch (op.operator) {
      // — Path construction (with operand count guards) —
      case 'm':
        if (nums.length < 2) break;
        curX = nums[0]; curY = nums[1];
        startX = curX; startY = curY;
        path.push({ type: 'M', points: [curX, curY] });
        break;
      case 'l':
        if (nums.length < 2) break;
        curX = nums[0]; curY = nums[1];
        path.push({ type: 'L', points: [curX, curY] });
        break;
      case 'c':
        if (nums.length < 6) break;
        curX = nums[4]; curY = nums[5];
        path.push({ type: 'C', points: [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]] });
        break;
      case 'v':
        if (nums.length < 4) break;
        path.push({ type: 'C', points: [curX, curY, nums[0], nums[1], nums[2], nums[3]] });
        curX = nums[2]; curY = nums[3];
        break;
      case 'y':
        if (nums.length < 4) break;
        path.push({ type: 'C', points: [nums[0], nums[1], nums[2], nums[3], nums[2], nums[3]] });
        curX = nums[2]; curY = nums[3];
        break;
      case 'h':
        path.push({ type: 'Z', points: [] });
        curX = startX; curY = startY;
        break;
      case 're': {
        if (nums.length < 4) break;
        const [rx, ry, rw, rh] = nums;
        path.push({ type: 'M', points: [rx, ry] });
        path.push({ type: 'L', points: [rx + rw, ry] });
        path.push({ type: 'L', points: [rx + rw, ry + rh] });
        path.push({ type: 'L', points: [rx, ry + rh] });
        path.push({ type: 'Z', points: [] });
        curX = rx; curY = ry;
        startX = rx; startY = ry;
        break;
      }

      // — CTM —
      case 'cm':
        if (nums.length < 6) break;
        state.ctm = concatMatrix(state.ctm, nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]);
        break;

      // — Graphics state stack —
      case 'q':
        stateStack.push(cloneState(state));
        break;
      case 'Q':
        if (stateStack.length > 0) state = stateStack.pop()!;
        break;

      // — Line style —
      case 'w':
        state.lineWidth = nums[0];
        break;

      // — Colors (for display context only) —
      case 'RG':
        state.strokeColor = `rgb(${nums[0] * 255}, ${nums[1] * 255}, ${nums[2] * 255})`;
        break;
      case 'rg':
        state.fillColor = `rgb(${nums[0] * 255}, ${nums[1] * 255}, ${nums[2] * 255})`;
        break;
      case 'G':
        state.strokeColor = `rgb(${nums[0] * 255}, ${nums[0] * 255}, ${nums[0] * 255})`;
        break;
      case 'g':
        state.fillColor = `rgb(${nums[0] * 255}, ${nums[0] * 255}, ${nums[0] * 255})`;
        break;
      case 'K': {
        const [c, m, y, k] = nums;
        const r = 255 * (1 - c) * (1 - k), g = 255 * (1 - m) * (1 - k), b = 255 * (1 - y) * (1 - k);
        state.strokeColor = `rgb(${r}, ${g}, ${b})`;
        break;
      }
      case 'k': {
        const [c, m, y, k] = nums;
        const r = 255 * (1 - c) * (1 - k), g = 255 * (1 - m) * (1 - k), b = 255 * (1 - y) * (1 - k);
        state.fillColor = `rgb(${r}, ${g}, ${b})`;
        break;
      }

      default:
        // Paint ops clear the path
        if (PAINT_OPS.has(op.operator)) {
          path = [];
        }
        break;
    }
  }

  if (path.length === 0) return null;
  return { path, state };
}

/**
 * Draw the in-progress path as a wireframe overlay on the given canvas context.
 * Coordinates are transformed from PDF space → canvas pixel space.
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: OverlayResult,
  pageWidth: number,
  pageHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const scaleX = canvasWidth / pageWidth;
  const scaleY = canvasHeight / pageHeight;
  const { path, state } = overlay;

  const toCanvas = (x: number, y: number): [number, number] => {
    const [tx, ty] = transformPoint(state.ctm, x, y);
    return [tx * scaleX, (pageHeight - ty) * scaleY];
  };

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Wireframe style: dashed cyan, semi-transparent
  ctx.strokeStyle = '#00ffff';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.globalAlpha = 0.85;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  for (const seg of path) {
    switch (seg.type) {
      case 'M': {
        const [cx, cy] = toCanvas(seg.points[0], seg.points[1]);
        ctx.moveTo(cx, cy);
        break;
      }
      case 'L': {
        const [cx, cy] = toCanvas(seg.points[0], seg.points[1]);
        ctx.lineTo(cx, cy);
        break;
      }
      case 'C': {
        const [c1x, c1y] = toCanvas(seg.points[0], seg.points[1]);
        const [c2x, c2y] = toCanvas(seg.points[2], seg.points[3]);
        const [ex, ey] = toCanvas(seg.points[4], seg.points[5]);
        ctx.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey);
        break;
      }
      case 'Z':
        ctx.closePath();
        break;
    }
  }
  ctx.stroke();

  // Draw dots at path vertices for clarity
  ctx.setLineDash([]);
  ctx.fillStyle = '#00ffff';
  ctx.globalAlpha = 0.6;
  for (const seg of path) {
    if (seg.type === 'Z') continue;
    const lastIdx = seg.points.length - 2;
    const [px, py] = toCanvas(seg.points[lastIdx], seg.points[lastIdx + 1]);
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
