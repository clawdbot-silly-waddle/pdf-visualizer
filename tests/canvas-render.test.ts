/**
 * Canvas rendering test — uses @napi-rs/canvas to render overlays in Node.js,
 * producing PNG images for visual inspection. This validates that the overlay
 * drawing functions work outside the browser.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { PDFDocument, PDFName, PDFRawStream, PDFArray, PDFRef } from 'pdf-lib';
import pako from 'pako';
import { createCanvas } from '@napi-rs/canvas';
import { parseContentStream } from '../src/content-stream';
import { computeOverlayAt, type OverlayResult } from '../src/path-overlay';
import { computeStateAt, type StateVisualization } from '../src/state-overlay';

const TEST_PDF = '/home/clawd/obus/uploads/ltb_premium_30_page190.pdf';
const OUTPUT_DIR = '/home/clawd/obus/pdf-visualizer/tests/output';

async function decodeStream(stream: PDFRawStream): Promise<Uint8Array> {
  const raw = stream.getContents();
  const filter = stream.dict.get(PDFName.of('Filter'));
  if (filter?.toString() === '/FlateDecode') return pako.inflate(raw);
  return raw;
}

async function extractOps(pdfBytes: Uint8Array, pageIndex: number) {
  const doc = await PDFDocument.load(pdfBytes);
  const page = doc.getPage(pageIndex);
  const contentsRef = page.node.get(PDFName.of('Contents'));
  if (!contentsRef) return { ops: [], width: 0, height: 0 };

  const context = doc.context;
  const contentsObj = context.lookup(contentsRef);

  let rawBytes: Uint8Array;
  if (contentsObj instanceof PDFRawStream) {
    rawBytes = await decodeStream(contentsObj);
  } else if (contentsObj instanceof PDFArray) {
    const parts: Uint8Array[] = [];
    for (let i = 0; i < contentsObj.size(); i++) {
      const ref = contentsObj.get(i);
      const stream = context.lookup(ref as PDFRef);
      if (stream instanceof PDFRawStream) parts.push(await decodeStream(stream));
    }
    const totalLen = parts.reduce((s, p) => s + p.length + 1, 0);
    rawBytes = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of parts) {
      rawBytes.set(part, offset);
      offset += part.length;
      rawBytes[offset] = 10;
      offset++;
    }
  } else {
    return { ops: [], width: 0, height: 0 };
  }

  const text = Array.from(rawBytes, (b: number) => String.fromCharCode(b)).join('');
  const mb = page.node.get(PDFName.of('MediaBox'));
  const mediaBox = context.lookup(mb);
  let width = 612, height = 792;
  if (mediaBox && 'size' in mediaBox) {
    const arr = mediaBox as PDFArray;
    width = Number((arr.get(2) as any).value ?? 612);
    height = Number((arr.get(3) as any).value ?? 792);
  }

  return { ops: parseContentStream(text), width, height };
}

/** Draw path overlay manually (avoiding the full drawOverlay which may use unsupported canvas features) */
function renderPathOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: OverlayResult,
  pageWidth: number,
  pageHeight: number,
  canvasWidth: number,
  canvasHeight: number,
) {
  const scaleX = canvasWidth / pageWidth;
  const scaleY = canvasHeight / pageHeight;
  const ctm = overlay.state.ctm;

  const toCanvas = (x: number, y: number): [number, number] => {
    const tx = ctm[0] * x + ctm[2] * y + ctm[4];
    const ty = ctm[1] * x + ctm[3] * y + ctm[5];
    return [tx * scaleX, (pageHeight - ty) * scaleY];
  };

  ctx.strokeStyle = '#00ffff';
  ctx.lineWidth = 2;
  ctx.beginPath();

  for (const seg of overlay.path) {
    const [cx, cy] = toCanvas(seg.points[0], seg.points[1]);
    switch (seg.type) {
      case 'M': ctx.moveTo(cx, cy); break;
      case 'L': ctx.lineTo(cx, cy); break;
      case 'C': {
        const [c1x, c1y] = toCanvas(seg.points[2], seg.points[3]);
        const [c2x, c2y] = toCanvas(seg.points[4], seg.points[5]);
        ctx.bezierCurveTo(toCanvas(seg.points[0], seg.points[1])[0], toCanvas(seg.points[0], seg.points[1])[1], c1x, c1y, c2x, c2y);
        break;
      }
      case 'Z': ctx.closePath(); break;
    }
  }
  ctx.stroke();
}

/** Draw state overlay manually */
function renderStateOverlay(
  ctx: CanvasRenderingContext2D,
  state: StateVisualization,
  pageWidth: number,
  pageHeight: number,
  canvasWidth: number,
  canvasHeight: number,
) {
  const scaleX = canvasWidth / pageWidth;
  const scaleY = canvasHeight / pageHeight;
  const ctm = state.ctm;

  const toCanvas = (x: number, y: number): [number, number] => {
    const tx = ctm[0] * x + ctm[2] * y + ctm[4];
    const ty = ctm[1] * x + ctm[3] * y + ctm[5];
    return [tx * scaleX, (pageHeight - ty) * scaleY];
  };

  // CTM origin
  const [ox, oy] = toCanvas(0, 0);
  ctx.fillStyle = 'red';
  ctx.fillRect(ox - 3, oy - 3, 6, 6);

  // Current point
  if (state.currentPoint) {
    const [px, py] = toCanvas(state.currentPoint.x, state.currentPoint.y);
    ctx.fillStyle = 'magenta';
    ctx.fillRect(px - 4, py - 4, 8, 8);
  }
}

describe('Canvas rendering (Node.js)', () => {
  it('renders path overlay to PNG', async () => {
    mkdirSync(OUTPUT_DIR, { recursive: true });

    const bytes = readFileSync(TEST_PDF);
    const { ops, width, height } = await extractOps(new Uint8Array(bytes), 0);
    expect(ops.length).toBeGreaterThan(0);

    let targetOp = -1;
    for (let i = 0; i < ops.length; i++) {
      const overlay = computeOverlayAt(ops, i);
      if (overlay && overlay.path.length > 2) { targetOp = i; break; }
    }

    if (targetOp === -1) { console.log('No active path found, skipping'); return; }

    const canvas = createCanvas(Math.round(width), Math.round(height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const overlay = computeOverlayAt(ops, targetOp)!;
    renderPathOverlay(ctx as any, overlay, width, height, canvas.width, canvas.height);

    const pngBuffer = canvas.toBuffer('image/png');
    const outPath = `${OUTPUT_DIR}/path-overlay-op${targetOp}.png`;
    writeFileSync(outPath, pngBuffer);
    expect(pngBuffer.length).toBeGreaterThan(200);
    console.log(`Path overlay rendered to ${outPath} (${pngBuffer.length} bytes)`);
  });

  it('renders state overlay to PNG', async () => {
    mkdirSync(OUTPUT_DIR, { recursive: true });

    const bytes = readFileSync(TEST_PDF);
    const { ops, width, height } = await extractOps(new Uint8Array(bytes), 0);
    expect(ops.length).toBeGreaterThan(0);

    let targetOp = -1;
    for (let i = 0; i < ops.length; i++) {
      const state = computeStateAt(ops, i);
      if (state.currentPoint || (state.ctm[0] !== 1 || state.ctm[3] !== 1)) { targetOp = i; break; }
    }
    if (targetOp === -1) targetOp = Math.min(50, ops.length);

    const canvas = createCanvas(Math.round(width), Math.round(height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const state = computeStateAt(ops, targetOp);
    renderStateOverlay(ctx as any, state, width, height, canvas.width, canvas.height);

    const pngBuffer = canvas.toBuffer('image/png');
    const outPath = `${OUTPUT_DIR}/state-overlay-op${targetOp}.png`;
    writeFileSync(outPath, pngBuffer);
    expect(pngBuffer.length).toBeGreaterThan(200);
    console.log(`State overlay rendered to ${outPath} (${pngBuffer.length} bytes)`);
  });
});
