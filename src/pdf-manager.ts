/**
 * PDF Manager — handles loading, page management, content stream access, and rendering.
 * Uses pdfjs-dist for rendering and pdf-lib for content stream manipulation.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, PDFName, PDFRawStream, PDFArray, PDFRef, PDFDict, PDFStream } from 'pdf-lib';
import { parseContentStream, serializeOps, type ContentStreamOp, type XObjectMeta } from './content-stream';
import { countOps, linearToPath, opAtPath, type OpPath } from './op-path';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export interface PageInfo {
  index: number;       // 0-based
  width: number;
  height: number;
  ops: ContentStreamOp[];
  totalOps: number;    // total including XObject children
}

export class PdfManager {
  private pdfBytes: Uint8Array | null = null;
  private pdfJsDoc: pdfjsLib.PDFDocumentProxy | null = null;
  private pageInfoCache = new Map<number, PageInfo>();
  private renderCache = new Map<string, ImageBitmap>();

  async load(data: ArrayBuffer): Promise<number> {
    this.dispose();
    this.pdfBytes = new Uint8Array(data);

    const loadingTask = pdfjsLib.getDocument({ data: data.slice(0) });
    this.pdfJsDoc = await loadingTask.promise;
    return this.pdfJsDoc.numPages;
  }

  get numPages(): number {
    return this.pdfJsDoc?.numPages ?? 0;
  }

  async getPageInfo(pageIndex: number): Promise<PageInfo> {
    if (this.pageInfoCache.has(pageIndex)) {
      return this.pageInfoCache.get(pageIndex)!;
    }

    if (!this.pdfJsDoc || !this.pdfBytes) throw new Error('No PDF loaded');

    const page = await this.pdfJsDoc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1 });

    // Extract content stream using pdf-lib
    const pdfLibDoc = await PDFDocument.load(this.pdfBytes, { ignoreEncryption: true });
    const pdfLibPage = pdfLibDoc.getPages()[pageIndex];
    const ops = await this.extractOps(pdfLibDoc, pdfLibPage);

    const info: PageInfo = {
      index: pageIndex,
      width: viewport.width,
      height: viewport.height,
      ops,
      totalOps: countOps(ops),
    };

    this.pageInfoCache.set(pageIndex, info);
    return info;
  }

  private async extractOps(doc: PDFDocument, page: any): Promise<ContentStreamOp[]> {
    try {
      const node = page.node;
      const contentsRef = node.get(PDFName.of('Contents'));
      if (!contentsRef) return [];

      const context = doc.context;
      const contentsObj = context.lookup(contentsRef);

      let rawBytes: Uint8Array;

      if (contentsObj instanceof PDFRawStream) {
        rawBytes = await this.decodeStream(contentsObj);
      } else if (contentsObj instanceof PDFArray) {
        const parts: Uint8Array[] = [];
        for (let i = 0; i < contentsObj.size(); i++) {
          const ref = contentsObj.get(i);
          const stream = context.lookup(ref as PDFRef);
          if (stream instanceof PDFRawStream) {
            parts.push(await this.decodeStream(stream));
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

      // Decode bytes 1:1 to code points. TextDecoder('latin1') actually uses
      // Windows-1252 per WHATWG, remapping 0x80-0x9F to higher code points.
      const text = Array.from(rawBytes, (b) => String.fromCharCode(b)).join('');
      const ops = parseContentStream(text);

      // Get page resources for XObject resolution
      const resources = this.getResources(node);
      if (resources) {
        await this.resolveXObjects(doc, ops, resources, new Set<string>(), 0);
      }

      return ops;
    } catch (e) {
      console.error('Failed to extract content stream ops:', e);
      return [];
    }
  }

  /** Get the /Resources dictionary from a page or XObject dict node. */
  private getResources(node: PDFDict): PDFDict | null {
    try {
      const resRef = node.get(PDFName.of('Resources'));
      if (!resRef) return null;
      if (resRef instanceof PDFDict) return resRef;
      const resolved = node.context.lookup(resRef);
      if (resolved instanceof PDFDict) return resolved;
      return null;
    } catch {
      return null;
    }
  }

  /** Recursively resolve Do operators that reference Form XObjects. */
  private async resolveXObjects(
    doc: PDFDocument,
    ops: ContentStreamOp[],
    resources: PDFDict,
    visited: Set<string>,
    depth: number,
  ): Promise<void> {
    if (depth > 10) return; // depth limit

    const xobjectDict = this.lookupDict(resources, 'XObject');
    if (!xobjectDict) return;

    for (const op of ops) {
      if (op.operator !== 'Do' || op.operands.length === 0) continue;

      const name = op.operands[0]; // e.g., '/Fm0'
      const cleanName = name.startsWith('/') ? name.slice(1) : name;

      try {
        const xobjRef = xobjectDict.get(PDFName.of(cleanName));
        if (!xobjRef) continue;

        // Resolve to actual ref
        const ref = xobjRef instanceof PDFRef ? xobjRef : null;
        if (!ref) continue;

        const refKey = `${ref.objectNumber} ${ref.generationNumber}`;
        if (visited.has(refKey)) continue; // circular reference

        const xobj = doc.context.lookup(ref);
        if (!(xobj instanceof PDFRawStream)) continue;

        const dict = xobj.dict;
        const subtype = dict.get(PDFName.of('Subtype'));
        if (!subtype || subtype.toString() !== '/Form') continue;

        // It's a Form XObject — parse it
        visited.add(refKey);

        const meta: XObjectMeta = {
          name: `/${cleanName}`,
          objNum: ref.objectNumber,
          genNum: ref.generationNumber,
        };

        // Extract BBox
        const bboxObj = dict.get(PDFName.of('BBox'));
        if (bboxObj instanceof PDFArray) {
          meta.bbox = [];
          for (let j = 0; j < bboxObj.size(); j++) {
            const v = bboxObj.get(j);
            meta.bbox.push(Number(v?.toString() ?? 0));
          }
        }

        // Extract Matrix
        const matrixObj = dict.get(PDFName.of('Matrix'));
        if (matrixObj instanceof PDFArray) {
          meta.matrix = [];
          for (let j = 0; j < matrixObj.size(); j++) {
            const v = matrixObj.get(j);
            meta.matrix.push(Number(v?.toString() ?? 0));
          }
        }

        // Check for transparency group
        const group = dict.get(PDFName.of('Group'));
        if (group) meta.hasGroup = true;

        // Decode and parse the XObject's content stream
        let childBytes: Uint8Array;
        try {
          childBytes = await this.decodeStream(xobj);
        } catch {
          console.warn(`Failed to decode XObject ${cleanName}, treating as atomic`);
          visited.delete(refKey);
          continue;
        }

        const childText = Array.from(childBytes, (b) => String.fromCharCode(b)).join('');
        const children = parseContentStream(childText);

        // Recursively resolve nested XObjects
        const childResources = this.getResources(dict);
        if (childResources && children.length > 0) {
          await this.resolveXObjects(doc, children, childResources, visited, depth + 1);
        }

        op.children = children;
        op.xobjectMeta = meta;

        visited.delete(refKey); // Allow same XObject in different branches
      } catch (e) {
        console.warn(`Failed to resolve XObject ${cleanName}:`, e);
      }
    }
  }

  /** Safely look up a sub-dictionary. */
  private lookupDict(parent: PDFDict, key: string): PDFDict | null {
    try {
      const ref = parent.get(PDFName.of(key));
      if (!ref) return null;
      if (ref instanceof PDFDict) return ref;
      const resolved = parent.context.lookup(ref as PDFRef);
      if (resolved instanceof PDFDict) return resolved;
      return null;
    } catch {
      return null;
    }
  }

  private async decodeStream(stream: PDFRawStream): Promise<Uint8Array> {
    const raw = stream.getContents();
    const filter = stream.dict.get(PDFName.of('Filter'));
    const filterName = filter?.toString();

    if (filterName === '/FlateDecode') {
      return this.inflateBytes(raw);
    }
    // Uncompressed or unsupported filter — return as-is
    return raw;
  }

  private async inflateBytes(data: Uint8Array): Promise<Uint8Array> {
    // PDF FlateDecode uses zlib format (deflate with zlib header)
    // Try 'deflate' first (zlib-wrapped), fall back to 'raw' if that fails
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
    // All formats failed — return raw data and hope for the best
    console.warn('Failed to decompress FlateDecode stream, returning raw');
    return data;
  }

  /**
   * Render the full page at a given scale.
   */
  async renderPage(pageIndex: number, scale: number): Promise<ImageBitmap> {
    const cacheKey = `full-${pageIndex}-${scale}`;
    if (this.renderCache.has(cacheKey)) {
      return this.renderCache.get(cacheKey)!;
    }

    if (!this.pdfJsDoc) throw new Error('No PDF loaded');

    const page = await this.pdfJsDoc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });

    const canvas = new OffscreenCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    const ctx = canvas.getContext('2d')!;

    await page.render({ canvas: null, canvasContext: ctx as any, viewport }).promise;

    const bitmap = await createImageBitmap(canvas);
    this.renderCache.set(cacheKey, bitmap);
    return bitmap;
  }

  /**
   * Render a page thumbnail.
   */
  async renderThumbnail(pageIndex: number, maxHeight: number): Promise<ImageBitmap> {
    const cacheKey = `thumb-${pageIndex}-${maxHeight}`;
    if (this.renderCache.has(cacheKey)) {
      return this.renderCache.get(cacheKey)!;
    }

    if (!this.pdfJsDoc) throw new Error('No PDF loaded');

    const page = await this.pdfJsDoc.getPage(pageIndex + 1);
    const defaultVp = page.getViewport({ scale: 1 });
    const scale = maxHeight / defaultVp.height;
    const viewport = page.getViewport({ scale });

    const canvas = new OffscreenCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    const ctx = canvas.getContext('2d')!;

    await page.render({ canvas: null, canvasContext: ctx as any, viewport }).promise;

    const bitmap = await createImageBitmap(canvas);
    this.renderCache.set(cacheKey, bitmap);
    return bitmap;
  }

  /**
   * Render a partial page (first N content stream operators, supporting XObject descent).
   */
  async renderPartial(pageIndex: number, numOps: number, scale: number): Promise<ImageBitmap> {
    const cacheKey = `partial-${pageIndex}-${numOps}-${scale}`;
    if (this.renderCache.has(cacheKey)) {
      return this.renderCache.get(cacheKey)!;
    }

    if (!this.pdfBytes) throw new Error('No PDF loaded');

    const info = await this.getPageInfo(pageIndex);
    const clampedOps = Math.max(0, Math.min(numOps, info.totalOps));

    if (clampedOps === 0) {
      // Return blank page
      const canvas = new OffscreenCanvas(
        Math.ceil(info.width * scale),
        Math.ceil(info.height * scale),
      );
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return createImageBitmap(canvas);
    }

    if (clampedOps === info.totalOps) {
      // Render full page (use cached full render)
      return this.renderPage(pageIndex, scale);
    }

    // Convert linear position to path to determine truncation strategy
    const path = linearToPath(info.ops, clampedOps);

    let truncatedStream: string;
    let xobjectMods: Map<string, { ref: PDFRef; stream: string }> | undefined;

    if (path.length <= 1) {
      // Top-level only: simple page stream truncation
      const topCount = path.length === 0 ? 0 : path[0] + 1;
      truncatedStream = serializeOps(info.ops.slice(0, topCount));
    } else {
      // Descending into XObject(s): keep page stream up to the Do op (inclusive),
      // then truncate the XObject stream
      const topCount = path[0] + 1;
      truncatedStream = serializeOps(info.ops.slice(0, topCount));

      xobjectMods = new Map();
      this.buildXObjectMods(info.ops, path, 0, xobjectMods);
    }

    const modifiedBytes = await this.createModifiedPdf(pageIndex, truncatedStream, xobjectMods);

    // Render with pdf.js
    const loadingTask = pdfjsLib.getDocument({ data: modifiedBytes });
    const doc = await loadingTask.promise;
    const page = await doc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });

    const canvas = new OffscreenCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    const ctx = canvas.getContext('2d')!;

    try {
      await page.render({ canvas: null, canvasContext: ctx as any, viewport }).promise;
    } catch {
      // Some partial content streams may produce render warnings; that's OK
    }

    doc.destroy();

    const bitmap = await createImageBitmap(canvas);
    this.renderCache.set(cacheKey, bitmap);
    return bitmap;
  }

  /**
   * Recursively build XObject stream modifications for a path that descends into XObjects.
   */
  private buildXObjectMods(
    ops: ContentStreamOp[],
    path: OpPath,
    pathOffset: number,
    mods: Map<string, { ref: PDFRef; stream: string }>,
  ): void {
    const idx = path[pathOffset];
    const op = ops[idx];

    if (!op?.children || !op.xobjectMeta) return;

    if (pathOffset + 1 < path.length - 1) {
      // Still descending — keep XObject stream up to the child Do (inclusive)
      const childIdx = path[pathOffset + 1];
      const truncatedChildren = serializeOps(op.children.slice(0, childIdx + 1));
      const ref = PDFRef.of(op.xobjectMeta.objNum, op.xobjectMeta.genNum);
      mods.set(`${op.xobjectMeta.objNum}-${op.xobjectMeta.genNum}`, { ref, stream: truncatedChildren });
      // Recurse into the nested XObject
      this.buildXObjectMods(op.children, path, pathOffset + 1, mods);
    } else if (pathOffset + 1 === path.length - 1) {
      // Terminal level — truncate this XObject's children
      const childIdx = path[pathOffset + 1];
      const truncatedChildren = serializeOps(op.children.slice(0, childIdx + 1));
      const ref = PDFRef.of(op.xobjectMeta.objNum, op.xobjectMeta.genNum);
      mods.set(`${op.xobjectMeta.objNum}-${op.xobjectMeta.genNum}`, { ref, stream: truncatedChildren });
    }
    // pathOffset + 1 >= path.length means we're on the Do itself, no XObject mod needed
  }

  private async createModifiedPdf(
    pageIndex: number,
    newContentStream: string,
    xobjectMods?: Map<string, { ref: PDFRef; stream: string }>,
  ): Promise<Uint8Array> {
    const pdfLibDoc = await PDFDocument.load(this.pdfBytes!, { ignoreEncryption: true });
    const page = pdfLibDoc.getPages()[pageIndex];

    // Encode string back to raw bytes (1 byte per char, inverse of the decode).
    const encoded = Uint8Array.from(newContentStream, (c) => c.charCodeAt(0));
    const newStream = pdfLibDoc.context.stream(encoded);
    const newStreamRef = pdfLibDoc.context.register(newStream);

    page.node.set(PDFName.of('Contents'), newStreamRef);

    // Replace modified XObject streams
    if (xobjectMods) {
      for (const [, { ref, stream }] of xobjectMods) {
        const xobj = pdfLibDoc.context.lookup(ref);
        if (!(xobj instanceof PDFRawStream)) continue;

        const dict = xobj.dict;
        // Must remove Filter since we're writing uncompressed bytes
        dict.delete(PDFName.of('Filter'));
        dict.delete(PDFName.of('DecodeParms'));

        const xEncoded = Uint8Array.from(stream, (c) => c.charCodeAt(0));
        const newXobjStream = PDFRawStream.of(dict, xEncoded);
        pdfLibDoc.context.assign(ref, newXobjStream);
      }
    }

    return pdfLibDoc.save();
  }

  clearRenderCache(): void {
    for (const bmp of this.renderCache.values()) {
      bmp.close();
    }
    this.renderCache.clear();
  }

  dispose(): void {
    this.clearRenderCache();
    this.pdfJsDoc?.destroy();
    this.pdfJsDoc = null;
    this.pdfBytes = null;
    this.pageInfoCache.clear();
  }
}
