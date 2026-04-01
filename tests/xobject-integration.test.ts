/**
 * Integration tests for XObject step-into feature.
 * Uses a real PDF with Form XObjects to verify parsing, tree structure, and truncation.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { PDFDocument, PDFName, PDFRawStream, PDFArray, PDFRef, PDFDict } from 'pdf-lib';
import { parseContentStream, serializeOps, type ContentStreamOp } from '../src/content-stream';
import { countOps, linearToPath, pathToLinear, opAtLinear, opAtPath } from '../src/op-path';
import { walkOpsUpTo } from '../src/op-walker';

// The XObject test PDF: page content is `q cm /Fm0 Do Q`, everything inside a Form XObject
const XOBJ_PDF_PATH = '/home/clawd/obus/uploads/1477792515644985511/ltb608_page_full-1.pdf';

let pdfBytes: Uint8Array;
let doc: PDFDocument;

async function inflateBytes(data: Uint8Array): Promise<Uint8Array> {
  for (const format of ['deflate', 'deflate-raw'] as CompressionFormat[]) {
    try {
      const ds = new DecompressionStream(format);
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      writer.write(data as any);
      writer.close();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLen = chunks.reduce((s, c) => s + c.length, 0);
      const result = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    } catch {
      continue;
    }
  }
  return data;
}

async function decodeStream(stream: PDFRawStream): Promise<Uint8Array> {
  const raw = stream.getContents();
  const filter = stream.dict.get(PDFName.of('Filter'));
  if (filter?.toString() === '/FlateDecode') {
    return inflateBytes(raw);
  }
  return raw;
}

function bytesToString(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => String.fromCharCode(b)).join('');
}

describe('XObject Integration', () => {
  beforeAll(async () => {
    pdfBytes = readFileSync(XOBJ_PDF_PATH);
    doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  });

  it('parses page content stream with Do operator', async () => {
    const page = doc.getPages()[0];
    const contentsRef = page.node.get(PDFName.of('Contents'));
    const stream = doc.context.lookup(contentsRef as PDFRef) as PDFRawStream;
    const bytes = await decodeStream(stream);
    const text = bytesToString(bytes);
    const ops = parseContentStream(text);

    // Page should have a small number of ops ending with Do
    expect(ops.length).toBeLessThan(20);
    const doOps = ops.filter(o => o.operator === 'Do');
    expect(doOps.length).toBeGreaterThanOrEqual(1);
  });

  it('resolves Form XObject and adds children', async () => {
    const page = doc.getPages()[0];
    const contentsRef = page.node.get(PDFName.of('Contents'));
    const stream = doc.context.lookup(contentsRef as PDFRef) as PDFRawStream;
    const bytes = await decodeStream(stream);
    const text = bytesToString(bytes);
    const ops = parseContentStream(text);

    // Manually resolve the first Do XObject
    const doOp = ops.find(o => o.operator === 'Do');
    expect(doOp).toBeDefined();

    const xobjName = doOp!.operands[0];
    const cleanName = xobjName.startsWith('/') ? xobjName.slice(1) : xobjName;

    // Get page resources
    const resRef = page.node.get(PDFName.of('Resources'));
    const resources = (resRef instanceof PDFDict ? resRef : doc.context.lookup(resRef as PDFRef)) as PDFDict;
    const xobjDictRef = resources.get(PDFName.of('XObject'));
    const xobjDict = (xobjDictRef instanceof PDFDict ? xobjDictRef : doc.context.lookup(xobjDictRef as PDFRef)) as PDFDict;

    const ref = xobjDict.get(PDFName.of(cleanName)) as PDFRef;
    expect(ref).toBeDefined();

    const xobj = doc.context.lookup(ref) as PDFRawStream;
    const subtype = xobj.dict.get(PDFName.of('Subtype'));
    expect(subtype?.toString()).toBe('/Form');

    // Parse the XObject's content stream
    const xobjBytes = await decodeStream(xobj);
    const xobjText = bytesToString(xobjBytes);
    const children = parseContentStream(xobjText);

    expect(children.length).toBeGreaterThan(0);

    // Attach children to the Do op (simulating what PdfManager.resolveXObjects does)
    doOp!.children = children;
    doOp!.xobjectMeta = {
      name: `/${cleanName}`,
      objNum: ref.objectNumber,
      genNum: ref.generationNumber,
    };

    // Verify tree structure
    const total = countOps(ops);
    expect(total).toBe(ops.length - 1 + 1 + children.length);
    // (non-Do ops) + (Do itself, counted as 1) + (children)

    // Verify linear↔path round-trip for all positions
    for (let i = 0; i <= total; i++) {
      const path = linearToPath(ops, i);
      expect(pathToLinear(ops, path)).toBe(i);
    }
  });

  it('opAtLinear returns correct ops for XObject children', async () => {
    const page = doc.getPages()[0];
    const contentsRef = page.node.get(PDFName.of('Contents'));
    const stream = doc.context.lookup(contentsRef as PDFRef) as PDFRawStream;
    const bytes = await decodeStream(stream);
    const text = bytesToString(bytes);
    const ops = parseContentStream(text);

    // Find and resolve the Do
    const doOp = ops.find(o => o.operator === 'Do')!;
    const xobjName = doOp.operands[0];
    const cleanName = xobjName.startsWith('/') ? xobjName.slice(1) : xobjName;

    const resRef = page.node.get(PDFName.of('Resources'));
    const resources = (resRef instanceof PDFDict ? resRef : doc.context.lookup(resRef as PDFRef)) as PDFDict;
    const xobjDictRef = resources.get(PDFName.of('XObject'));
    const xobjDict = (xobjDictRef instanceof PDFDict ? xobjDictRef : doc.context.lookup(xobjDictRef as PDFRef)) as PDFDict;
    const ref = xobjDict.get(PDFName.of(cleanName)) as PDFRef;
    const xobj = doc.context.lookup(ref) as PDFRawStream;
    const xobjBytes = await decodeStream(xobj);
    const children = parseContentStream(bytesToString(xobjBytes));

    doOp.children = children;
    doOp.xobjectMeta = { name: `/${cleanName}`, objNum: ref.objectNumber, genNum: ref.generationNumber };

    // Find the linear index of the Do
    const doIdx = ops.indexOf(doOp);
    let doLinear = 0;
    for (let i = 0; i < doIdx; i++) {
      doLinear += 1 + (ops[i].children ? countOps(ops[i].children!) : 0);
    }
    doLinear += 1; // The Do itself

    // The op at doLinear should be the Do
    const atDo = opAtLinear(ops, doLinear);
    expect(atDo?.operator).toBe('Do');

    // The op at doLinear+1 should be the first child
    const firstChild = opAtLinear(ops, doLinear + 1);
    expect(firstChild).not.toBeNull();
    expect(firstChild?.operator).toBe(children[0].operator);

    // The op at doLinear+children.length should be the last child
    const lastChild = opAtLinear(ops, doLinear + children.length);
    expect(lastChild?.operator).toBe(children[children.length - 1].operator);
  });

  it('walker synthesizes q/Q around XObject content', async () => {
    // Simple synthetic tree for walker verification
    const children: ContentStreamOp[] = [
      { operator: 'm', operands: ['10', '20'], raw: '10 20 m' },
      { operator: 'l', operands: ['30', '40'], raw: '30 40 l' },
      { operator: 'S', operands: [], raw: 'S' },
    ];

    const ops: ContentStreamOp[] = [
      { operator: 'q', operands: [], raw: 'q' },
      {
        operator: 'Do',
        operands: ['/Fm0'],
        raw: '/Fm0 Do',
        children,
        xobjectMeta: {
          name: '/Fm0',
          objNum: 5,
          genNum: 0,
          matrix: [1, 0, 0, 1, 50, 100],
        },
      },
      { operator: 'Q', operands: [], raw: 'Q' },
    ];

    // Walk to the last page op [2] (Q)
    // Do is fully passed: should synthesize q, cm, walk(m, l, S), Q
    const collected: string[] = [];
    walkOpsUpTo(ops, [2], (op) => collected.push(op.operator));

    expect(collected).toEqual(['q', 'q', 'cm', 'm', 'l', 'S', 'Q', 'Q']);
  });
});
