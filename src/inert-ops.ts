/**
 * Operators that don't change the pdfjs bitmap output — only affect state for
 * future drawing. Used for render skipping and visual-only stepping.
 */
export const INERT_OPS = new Set([
  // Path construction (accumulates path buffer, no visual output)
  'm', 'l', 'c', 'v', 'y', 'h', 're',
  // Graphics state
  'q', 'Q', 'cm', 'w', 'J', 'j', 'M', 'd', 'gs', 'ri', 'i',
  // Color
  'g', 'G', 'rg', 'RG', 'k', 'K', 'cs', 'CS', 'sc', 'SC', 'scn', 'SCN',
  // Text state
  'Tf', 'Tc', 'Tw', 'Tz', 'TL', 'Ts', 'Tr',
]);
