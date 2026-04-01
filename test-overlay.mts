import { parseContentStream } from './src/content-stream.js';
import { computeOverlayAt } from './src/path-overlay.js';
import { PDFDocument, PDFName, PDFRef, PDFArray, decodePDFRawStream } from 'pdf-lib';
import { readFileSync } from 'fs';

const pdfBytes = readFileSync('/home/clawd/obus/uploads/ltb_premium_30_page190.pdf');
const pdfDoc = await PDFDocument.load(pdfBytes);
const page = pdfDoc.getPage(0);
const contentsVal = page.node.get(PDFName.of('Contents'));

let fullText = '';
const refs: PDFRef[] = [];

if (contentsVal instanceof PDFRef) {
  refs.push(contentsVal);
} else if (contentsVal instanceof PDFArray) {
  for (let i = 0; i < contentsVal.size(); i++) {
    const item = contentsVal.get(i);
    if (item instanceof PDFRef) refs.push(item);
  }
}

for (const ref of refs) {
  const stream = pdfDoc.context.lookup(ref) as any;
  try {
    const decoded = decodePDFRawStream(stream);
    const bytes = decoded.decode();
    fullText += Array.from(bytes, (b: number) => String.fromCharCode(b)).join('');
    fullText += '\n';
  } catch (e: any) {
    console.log('Error decoding stream:', e.message);
  }
}

const ops = parseContentStream(fullText);
console.log('Total ops:', ops.length);

const pathOpsSet = new Set(['m', 'l', 'c', 'v', 'y', 'h', 're']);
let pathOpCount = 0;
for (const op of ops) {
  if (pathOpsSet.has(op.operator)) pathOpCount++;
}
console.log('Path construction ops:', pathOpCount);

// Count steps with overlay
let overlayCount = 0;
for (let i = 0; i <= ops.length; i++) {
  const result = computeOverlayAt(ops, i);
  if (result) overlayCount++;
}
console.log('Steps with overlay:', overlayCount, 'out of', ops.length + 1);

// First overlay
for (let i = 0; i <= ops.length; i++) {
  const result = computeOverlayAt(ops, i);
  if (result) {
    console.log('First overlay at step', i);
    console.log('  Path segments:', result.path.length);
    console.log('  Op at index i-1:', ops[i-1]?.operator, JSON.stringify(ops[i-1]?.operands));
    console.log('  Op at index i:', ops[i]?.operator, JSON.stringify(ops[i]?.operands));
    break;
  }
}
