/**
 * PDF Manager — handles loading, page management, content stream access, and rendering.
 * Uses pdfjs-dist for rendering and pdf-lib for content stream manipulation.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, PDFName, PDFRawStream, PDFArray, PDFRef } from 'pdf-lib';
import { parseContentStream, serializeOps, type ContentStreamOp } from './content-stream';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export interface PageInfo {
  index: number;       // 0-based
  width: number;
  height: number;
  ops: ContentStreamOp[];
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

      const text = new TextDecoder('latin1').decode(rawBytes);
      return parseContentStream(text);
    } catch (e) {
      console.error('Failed to extract content stream ops:', e);
      return [];
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
   * Render a partial page (first N content stream operators).
   */
  async renderPartial(pageIndex: number, numOps: number, scale: number): Promise<ImageBitmap> {
    const cacheKey = `partial-${pageIndex}-${numOps}-${scale}`;
    if (this.renderCache.has(cacheKey)) {
      return this.renderCache.get(cacheKey)!;
    }

    if (!this.pdfBytes) throw new Error('No PDF loaded');

    const info = await this.getPageInfo(pageIndex);
    const clampedOps = Math.max(0, Math.min(numOps, info.ops.length));

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

    if (clampedOps === info.ops.length) {
      // Render full page (use cached full render)
      return this.renderPage(pageIndex, scale);
    }

    // Create modified PDF with truncated content stream
    const truncatedStream = serializeOps(info.ops.slice(0, clampedOps));
    const modifiedBytes = await this.createModifiedPdf(pageIndex, truncatedStream);

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

  private async createModifiedPdf(pageIndex: number, newContentStream: string): Promise<Uint8Array> {
    const pdfLibDoc = await PDFDocument.load(this.pdfBytes!, { ignoreEncryption: true });
    const page = pdfLibDoc.getPages()[pageIndex];

    // Must encode as Latin-1 (single byte per char) to preserve raw PDF byte values.
    // The stream was decoded with TextDecoder('latin1'), so each JS char maps 1:1 to a byte.
    // Using TextEncoder (UTF-8) would corrupt chars > 127 with multi-byte sequences.
    const encoded = new Uint8Array(newContentStream.length);
    for (let i = 0; i < newContentStream.length; i++) {
      encoded[i] = newContentStream.charCodeAt(i) & 0xff;
    }
    const newStream = pdfLibDoc.context.stream(encoded);
    const newStreamRef = pdfLibDoc.context.register(newStream);

    page.node.set(PDFName.of('Contents'), newStreamRef);

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
