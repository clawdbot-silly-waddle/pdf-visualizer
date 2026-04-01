/**
 * Integration test: loads a real PDF file, extracts ops via pdf-lib,
 * and verifies content-stream parsing + state computation work end-to-end.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { PDFDocument, PDFName, PDFRawStream, PDFArray, PDFRef } from 'pdf-lib';
import pako from 'pako';
import { parseContentStream, serializeOps } from '../src/content-stream';
import { computeStateAt } from '../src/state-overlay';
import { computeOverlayAt } from '../src/path-overlay';

const TEST_PDF = '/home/clawd/obus/uploads/ltb_premium_30_page190.pdf';
const XOBJECT_PDF = '/home/clawd/obus/uploads/1477792515644985511/ltb608_page_full-1.pdf';

async function decodeStream(stream: PDFRawStream): Promise<Uint8Array> {
  const raw = stream.getContents();
  const filter = stream.dict.get(PDFName.of('Filter'));
  if (filter?.toString() === '/FlateDecode') {
    return pako.inflate(raw);
  }
  return raw;
}

async function extractOps(pdfBytes: Uint8Array, pageIndex: number) {
  const doc = await PDFDocument.load(pdfBytes);
  const page = doc.getPage(pageIndex);
  const node = page.node;
  const contentsRef = node.get(PDFName.of('Contents'));
  if (!contentsRef) return [];

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
      if (stream instanceof PDFRawStream) {
        parts.push(await decodeStream(stream));
      }
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
    return [];
  }

  const text = Array.from(rawBytes, (b: number) => String.fromCharCode(b)).join('');
  return parseContentStream(text);
}

describe('PDF integration (ltb_premium_30)', () => {
  let ops: ReturnType<typeof parseContentStream>;

  beforeAll(async () => {
    const bytes = readFileSync(TEST_PDF);
    ops = await extractOps(new Uint8Array(bytes), 0);
  });

  it('extracts a non-trivial number of operators', () => {
    expect(ops.length).toBeGreaterThan(50);
  });

  it('contains expected operator types', () => {
    const operators = new Set(ops.map(o => o.operator));
    // A real comic page should have path, paint, text, and state ops
    expect(operators.has('m')).toBe(true);  // moveto
    expect(operators.has('q')).toBe(true);  // save state
    expect(operators.has('Q')).toBe(true);  // restore state
    expect(operators.has('cm')).toBe(true); // concat matrix
  });

  it('round-trips through serialize and reparse', () => {
    const serialized = serializeOps(ops);
    const reparsed = parseContentStream(serialized);
    expect(reparsed.length).toBe(ops.length);
    for (let i = 0; i < ops.length; i++) {
      expect(reparsed[i].operator).toBe(ops[i].operator);
    }
  });

  it('computes state at every op index without crashing', () => {
    for (let i = 0; i <= ops.length; i++) {
      const state = computeStateAt(ops, i);
      expect(state).toBeDefined();
      expect(state.ctm).toHaveLength(6);
    }
  });

  it('computes overlay at every op index without crashing', () => {
    for (let i = 0; i <= ops.length; i++) {
      // May return null (no active path) — that's fine
      computeOverlayAt(ops, i);
    }
  });

  it('has balanced q/Q stack', () => {
    let depth = 0;
    for (const op of ops) {
      if (op.operator === 'q') depth++;
      if (op.operator === 'Q') depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });
});

describe('PDF integration (XObject PDF)', () => {
  let ops: ReturnType<typeof parseContentStream>;

  beforeAll(async () => {
    const bytes = readFileSync(XOBJECT_PDF);
    ops = await extractOps(new Uint8Array(bytes), 0);
  });

  it('extracts the page-level operators (few, with Do)', () => {
    // This PDF wraps everything in a Form XObject
    expect(ops.length).toBeLessThan(10);
    const operators = ops.map(o => o.operator);
    expect(operators).toContain('Do');
  });

  it('has the XObject name as operand to Do', () => {
    const doOp = ops.find(o => o.operator === 'Do');
    expect(doOp).toBeDefined();
    expect(doOp!.operands[0]).toBe('/Fm0');
  });
});
