/**
 * State Visualization Overlay — shows the current graphics state:
 * current point marker, CTM axes, and clipping area boundary.
 * Intended as a debug/educational tool, separate from the path wireframe overlay.
 */

import type { ContentStreamOp } from './content-stream';

type Matrix = [number, number, number, number, number, number];

interface ClipPath {
  segments: { type: 'M' | 'L' | 'C' | 'Z'; points: number[] }[];
  ctm: Matrix;
}

export interface StateVisualization {
  /** Current drawing position in user space (null if no path has been started). */
  currentPoint: { x: number; y: number } | null;
  /** Current transformation matrix. */
  ctm: Matrix;
  /** Accumulated clipping paths (each entry is one W/W* clip). */
  clipPaths: ClipPath[];
  /** Text state: matrix and whether we're inside a BT..ET block. */
  text: {
    active: boolean;
    matrix: Matrix;
    lineMatrix: Matrix;
  } | null;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const PAINT_OPS = new Set([
  'S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n',
]);

function concatMatrix(
  cur: Matrix,
  a: number, b: number, c: number, d: number, e: number, f: number,
): Matrix {
  return [
    a * cur[0] + b * cur[2],
    a * cur[1] + b * cur[3],
    c * cur[0] + d * cur[2],
    c * cur[1] + d * cur[3],
    e * cur[0] + f * cur[2] + cur[4],
    e * cur[1] + f * cur[3] + cur[5],
  ];
}

function transformPoint(ctm: Matrix, x: number, y: number): [number, number] {
  return [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
}

/**
 * Walk ops[0..opIndex) and compute the current graphics state.
 */
export function computeStateAt(
  ops: ContentStreamOp[],
  opIndex: number,
): StateVisualization {
  let ctm: Matrix = [...IDENTITY];
  const ctmStack: Matrix[] = [];
  const clipStack: ClipPath[][] = [];
  let clipPaths: ClipPath[] = [];
  let curX = 0, curY = 0;
  let startX = 0, startY = 0;
  let hasPoint = false;
  let textLeading = 0;
  let inText = false;
  let textMatrix: Matrix = [...IDENTITY];
  let textLineMatrix: Matrix = [...IDENTITY];

  // Accumulate current path for potential clipping
  let pathSegs: ClipPath['segments'] = [];

  const limit = Math.min(opIndex, ops.length);
  for (let i = 0; i < limit; i++) {
    const op = ops[i];
    const nums = op.operands.map(Number);

    switch (op.operator) {
      // Path construction
      case 'm':
        if (nums.length < 2) break;
        curX = nums[0]; curY = nums[1];
        startX = curX; startY = curY;
        hasPoint = true;
        pathSegs.push({ type: 'M', points: [curX, curY] });
        break;
      case 'l':
        if (nums.length < 2) break;
        curX = nums[0]; curY = nums[1];
        pathSegs.push({ type: 'L', points: [curX, curY] });
        break;
      case 'c':
        if (nums.length < 6) break;
        curX = nums[4]; curY = nums[5];
        pathSegs.push({ type: 'C', points: nums.slice(0, 6) });
        break;
      case 'v':
        if (nums.length < 4) break;
        pathSegs.push({ type: 'C', points: [curX, curY, nums[0], nums[1], nums[2], nums[3]] });
        curX = nums[2]; curY = nums[3];
        break;
      case 'y':
        if (nums.length < 4) break;
        pathSegs.push({ type: 'C', points: [nums[0], nums[1], nums[2], nums[3], nums[2], nums[3]] });
        curX = nums[2]; curY = nums[3];
        break;
      case 'h':
        pathSegs.push({ type: 'Z', points: [] });
        curX = startX; curY = startY;
        break;
      case 're': {
        if (nums.length < 4) break;
        const [rx, ry, rw, rh] = nums;
        pathSegs.push({ type: 'M', points: [rx, ry] });
        pathSegs.push({ type: 'L', points: [rx + rw, ry] });
        pathSegs.push({ type: 'L', points: [rx + rw, ry + rh] });
        pathSegs.push({ type: 'L', points: [rx, ry + rh] });
        pathSegs.push({ type: 'Z', points: [] });
        curX = rx; curY = ry;
        startX = rx; startY = ry;
        hasPoint = true;
        break;
      }

      // Clipping — snapshot the current path immediately
      case 'W':
      case 'W*':
        if (pathSegs.length > 0) {
          clipPaths.push({ segments: [...pathSegs], ctm: [...ctm] });
        }
        break;

      // CTM
      case 'cm':
        if (nums.length < 6) break;
        ctm = concatMatrix(ctm, nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]);
        break;

      // State stack
      case 'q':
        ctmStack.push([...ctm]);
        clipStack.push([...clipPaths]);
        break;
      case 'Q':
        if (ctmStack.length > 0) ctm = ctmStack.pop()!;
        if (clipStack.length > 0) clipPaths = clipStack.pop()!;
        break;

      // Text object
      case 'BT':
        inText = true;
        textMatrix = [...IDENTITY];
        textLineMatrix = [...IDENTITY];
        break;
      case 'ET':
        inText = false;
        break;

      // Text positioning
      case 'Tm':
        if (nums.length >= 6) {
          textMatrix = [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]];
          textLineMatrix = [...textMatrix];
        }
        break;
      case 'Td':
        if (nums.length >= 2) {
          textLineMatrix = concatMatrix(textLineMatrix, 1, 0, 0, 1, nums[0], nums[1]);
          textMatrix = [...textLineMatrix];
        }
        break;
      case 'TD':
        if (nums.length >= 2) {
          textLeading = -nums[1];
          textLineMatrix = concatMatrix(textLineMatrix, 1, 0, 0, 1, nums[0], nums[1]);
          textMatrix = [...textLineMatrix];
        }
        break;
      case 'T*':
        textLineMatrix = concatMatrix(textLineMatrix, 1, 0, 0, 1, 0, -textLeading);
        textMatrix = [...textLineMatrix];
        break;
      case 'TL':
        if (nums.length >= 1) textLeading = nums[0];
        break;

      // Text rendering (advance position is font-dependent, tracked as-is)
      case "'":
        // Equivalent to T* then Tj
        textLineMatrix = concatMatrix(textLineMatrix, 1, 0, 0, 1, 0, -textLeading);
        textMatrix = [...textLineMatrix];
        break;
      case '"':
        // Equivalent to Tw Tc T* Tj
        textLineMatrix = concatMatrix(textLineMatrix, 1, 0, 0, 1, 0, -textLeading);
        textMatrix = [...textLineMatrix];
        break;

      default:
        // Paint ops clear path
        if (PAINT_OPS.has(op.operator)) {
          pathSegs = [];
          hasPoint = false;
        }
        break;
    }
  }

  return {
    currentPoint: hasPoint ? { x: curX, y: curY } : null,
    ctm,
    clipPaths,
    text: inText ? { active: true, matrix: textMatrix, lineMatrix: textLineMatrix } : null,
  };
}

/**
 * Draw the state visualization overlay.
 */
export function drawStateOverlay(
  ctx: CanvasRenderingContext2D,
  state: StateVisualization,
  pageWidth: number,
  pageHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  dpr = 1,
): void {
  const scaleX = canvasWidth / pageWidth;
  const scaleY = canvasHeight / pageHeight;

  const toCanvas = (x: number, y: number): [number, number] => {
    const [tx, ty] = transformPoint(state.ctm, x, y);
    return [tx * scaleX, (pageHeight - ty) * scaleY];
  };

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // 1. Draw clipping area boundaries
  for (const clip of state.clipPaths) {
    const clipToCanvas = (x: number, y: number): [number, number] => {
      const [tx, ty] = transformPoint(clip.ctm, x, y);
      return [tx * scaleX, (pageHeight - ty) * scaleY];
    };

    ctx.beginPath();
    for (const seg of clip.segments) {
      switch (seg.type) {
        case 'M': {
          const [cx, cy] = clipToCanvas(seg.points[0], seg.points[1]);
          ctx.moveTo(cx, cy);
          break;
        }
        case 'L': {
          const [cx, cy] = clipToCanvas(seg.points[0], seg.points[1]);
          ctx.lineTo(cx, cy);
          break;
        }
        case 'C': {
          const [c1x, c1y] = clipToCanvas(seg.points[0], seg.points[1]);
          const [c2x, c2y] = clipToCanvas(seg.points[2], seg.points[3]);
          const [ex, ey] = clipToCanvas(seg.points[4], seg.points[5]);
          ctx.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey);
          break;
        }
        case 'Z':
          ctx.closePath();
          break;
      }
    }
    // Fill with semi-transparent orange and stroke with dashed orange
    ctx.fillStyle = 'rgba(255, 165, 0, 0.08)';
    ctx.fill();
    ctx.strokeStyle = '#ff8c00';
    ctx.lineWidth = 1.5 * dpr;
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.globalAlpha = 0.7;
    ctx.stroke();
  }

  // 2. Draw CTM axes at page origin
  ctx.globalAlpha = 0.9;
  ctx.setLineDash([]);
  const axisLen = 20 * dpr;
  const [ox, oy] = toCanvas(0, 0);

  // Transform unit vectors by CTM (direction only, normalized to axisLen)
  const [xxRaw, xyRaw] = [state.ctm[0], state.ctm[1]];
  const [yxRaw, yyRaw] = [state.ctm[2], state.ctm[3]];

  const xMag = Math.sqrt(xxRaw * xxRaw + xyRaw * xyRaw);
  const yMag = Math.sqrt(yxRaw * yxRaw + yyRaw * yyRaw);

  if (xMag > 0.001) {
    const xDirX = (xxRaw / xMag) * axisLen * scaleX;
    const xDirY = -(xyRaw / xMag) * axisLen * scaleY; // y-flip
    drawArrow(ctx, ox, oy, ox + xDirX, oy + xDirY, '#ff4444', 2 * dpr, 6 * dpr);
    ctx.fillStyle = '#ff4444';
    ctx.font = `${11 * dpr}px monospace`;
    ctx.fillText('X', ox + xDirX + 4 * dpr, oy + xDirY + 4 * dpr);
  }

  if (yMag > 0.001) {
    const yDirX = (yxRaw / yMag) * axisLen * scaleX;
    const yDirY = -(yyRaw / yMag) * axisLen * scaleY; // y-flip
    drawArrow(ctx, ox, oy, ox + yDirX, oy + yDirY, '#44cc44', 2 * dpr, 6 * dpr);
    ctx.fillStyle = '#44cc44';
    ctx.font = `${11 * dpr}px monospace`;
    ctx.fillText('Y', ox + yDirX + 4 * dpr, oy + yDirY + 4 * dpr);
  }

  // Origin dot
  ctx.beginPath();
  ctx.arc(ox, oy, 3 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1 * dpr;
  ctx.fill();
  ctx.stroke();

  // 3. Draw current point marker
  if (state.currentPoint) {
    const [px, py] = toCanvas(state.currentPoint.x, state.currentPoint.y);
    const size = 8 * dpr;

    ctx.strokeStyle = '#ff00ff';
    ctx.lineWidth = 2 * dpr;
    ctx.globalAlpha = 0.9;

    // Crosshair
    ctx.beginPath();
    ctx.moveTo(px - size, py);
    ctx.lineTo(px + size, py);
    ctx.moveTo(px, py - size);
    ctx.lineTo(px, py + size);
    ctx.stroke();

    // Center dot
    ctx.beginPath();
    ctx.arc(px, py, 2.5 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = '#ff00ff';
    ctx.fill();
  }

  // 4. Draw text position and text matrix axes (blue/cyan, inside BT..ET only)
  if (state.text) {
    const tm = state.text.matrix;
    // Text rendering matrix = Tm × CTM
    const trm: Matrix = [
      tm[0] * state.ctm[0] + tm[1] * state.ctm[2],
      tm[0] * state.ctm[1] + tm[1] * state.ctm[3],
      tm[2] * state.ctm[0] + tm[3] * state.ctm[2],
      tm[2] * state.ctm[1] + tm[3] * state.ctm[3],
      tm[4] * state.ctm[0] + tm[5] * state.ctm[2] + state.ctm[4],
      tm[4] * state.ctm[1] + tm[5] * state.ctm[3] + state.ctm[5],
    ];

    // Text origin in canvas coords
    const [tox, toy] = [trm[4] * scaleX, (pageHeight - trm[5]) * scaleY];

    // Text matrix axes
    ctx.globalAlpha = 0.9;
    ctx.setLineDash([]);
    const tAxisLen = 15 * dpr;

    const [txRaw, tyRaw] = [trm[0], trm[1]];
    const [tyxRaw, tyyRaw] = [trm[2], trm[3]];
    const txMag = Math.sqrt(txRaw * txRaw + tyRaw * tyRaw);
    const tyMag = Math.sqrt(tyxRaw * tyxRaw + tyyRaw * tyyRaw);

    if (txMag > 0.001) {
      const xDirX = (txRaw / txMag) * tAxisLen * scaleX;
      const xDirY = -(tyRaw / txMag) * tAxisLen * scaleY;
      drawArrow(ctx, tox, toy, tox + xDirX, toy + xDirY, '#4488ff', 1.5 * dpr, 5 * dpr);
      ctx.fillStyle = '#4488ff';
      ctx.font = `${10 * dpr}px monospace`;
      ctx.fillText('Tx', tox + xDirX + 3 * dpr, toy + xDirY + 3 * dpr);
    }

    if (tyMag > 0.001) {
      const yDirX = (tyxRaw / tyMag) * tAxisLen * scaleX;
      const yDirY = -(tyyRaw / tyMag) * tAxisLen * scaleY;
      drawArrow(ctx, tox, toy, tox + yDirX, toy + yDirY, '#44dddd', 1.5 * dpr, 5 * dpr);
      ctx.fillStyle = '#44dddd';
      ctx.font = `${10 * dpr}px monospace`;
      ctx.fillText('Ty', tox + yDirX + 3 * dpr, toy + yDirY + 3 * dpr);
    }

    // Text cursor dot
    ctx.beginPath();
    ctx.arc(tox, toy, 4 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = '#4488ff';
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();
  }

  ctx.restore();
}

/** Draw an arrow from (x1,y1) to (x2,y2). */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  color: string,
  lineWidth: number,
  headLen: number,
): void {
  const dx = x2 - x1, dy = y2 - y1;
  const angle = Math.atan2(dy, dx);

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}
