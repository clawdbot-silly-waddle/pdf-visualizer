/**
 * Map C1 control codes (U+0080-U+009F) to Windows-1252 display characters.
 * The content stream uses String.fromCharCode(byte) for 1:1 byte preservation,
 * but bytes 0x80-0x9F in WinAnsiEncoding should display as real characters.
 */
const CP1252_MAP: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†',
  0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8A: 'Š', 0x8B: '‹', 0x8C: 'Œ',
  0x8E: 'Ž', 0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201C', 0x94: '\u201D',
  0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9A: 'š',
  0x9B: '›', 0x9C: 'œ', 0x9E: 'ž', 0x9F: 'Ÿ',
};

/** Decode C1 control codes to their Windows-1252 equivalents for display. */
export function decodeForDisplay(s: string): string {
  return s.replace(/[\x80-\x9F]/g, (ch) => CP1252_MAP[ch.charCodeAt(0)] ?? ch);
}
