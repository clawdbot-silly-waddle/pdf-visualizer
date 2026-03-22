/**
 * Human-readable descriptions and categories for PDF content stream operators.
 */

export type OpCategory =
  | 'path-construct'
  | 'path-paint'
  | 'clip'
  | 'state'
  | 'color'
  | 'text-state'
  | 'text-pos'
  | 'text-show'
  | 'text-obj'
  | 'xobject'
  | 'inline-image'
  | 'marked'
  | 'compat'
  | 'shading'
  | 'unknown';

export interface OpInfo {
  name: string;
  description: string;
  category: OpCategory;
  visual: boolean; // produces visible change or important state change
}

const OP_INFO: Record<string, OpInfo> = {
  // Path construction
  m:  { name: 'moveTo',       description: 'Move to point',                     category: 'path-construct', visual: true },
  l:  { name: 'lineTo',       description: 'Line to point',                     category: 'path-construct', visual: true },
  c:  { name: 'curveTo',      description: 'Bézier curve (3 control points)',   category: 'path-construct', visual: true },
  v:  { name: 'curveToV',     description: 'Bézier curve (initial = current)',  category: 'path-construct', visual: true },
  y:  { name: 'curveToY',     description: 'Bézier curve (final = control)',    category: 'path-construct', visual: true },
  h:  { name: 'closePath',    description: 'Close sub-path',                    category: 'path-construct', visual: true },
  re: { name: 'rectangle',    description: 'Rectangle',                         category: 'path-construct', visual: true },

  // Path painting
  S:    { name: 'stroke',           description: 'Stroke path',                     category: 'path-paint', visual: true },
  s:    { name: 'closeStroke',      description: 'Close & stroke path',             category: 'path-paint', visual: true },
  f:    { name: 'fill',             description: 'Fill path (nonzero)',              category: 'path-paint', visual: true },
  F:    { name: 'fillCompat',       description: 'Fill path (nonzero, compat)',      category: 'path-paint', visual: true },
  'f*': { name: 'fillEvenOdd',     description: 'Fill path (even-odd)',             category: 'path-paint', visual: true },
  B:    { name: 'fillStroke',       description: 'Fill & stroke path',              category: 'path-paint', visual: true },
  'B*': { name: 'fillStrokeEO',    description: 'Fill & stroke (even-odd)',         category: 'path-paint', visual: true },
  b:    { name: 'closeFillStroke',  description: 'Close, fill & stroke',            category: 'path-paint', visual: true },
  'b*': { name: 'closeFillStrokeEO', description: 'Close, fill & stroke (even-odd)', category: 'path-paint', visual: true },
  n:    { name: 'endPath',          description: 'End path (no paint)',              category: 'path-paint', visual: false },

  // Clipping
  W:    { name: 'clip',        description: 'Clip (nonzero)',       category: 'clip', visual: true },
  'W*': { name: 'clipEvenOdd', description: 'Clip (even-odd)',      category: 'clip', visual: true },

  // Graphics state
  q:  { name: 'save',          description: 'Save graphics state',              category: 'state', visual: false },
  Q:  { name: 'restore',       description: 'Restore graphics state',           category: 'state', visual: false },
  cm: { name: 'transform',     description: 'Set transform matrix',             category: 'state', visual: true },
  w:  { name: 'lineWidth',     description: 'Set line width',                   category: 'state', visual: true },
  J:  { name: 'lineCap',       description: 'Set line cap style',               category: 'state', visual: false },
  j:  { name: 'lineJoin',      description: 'Set line join style',              category: 'state', visual: false },
  M:  { name: 'miterLimit',    description: 'Set miter limit',                  category: 'state', visual: false },
  d:  { name: 'dashPattern',   description: 'Set dash pattern',                 category: 'state', visual: true },
  ri: { name: 'renderIntent',  description: 'Set rendering intent',             category: 'state', visual: false },
  i:  { name: 'flatness',      description: 'Set flatness tolerance',           category: 'state', visual: false },
  gs: { name: 'extGState',     description: 'Set extended graphics state',      category: 'state', visual: true },

  // Color
  CS:  { name: 'strokeColorSpace', description: 'Set stroke color space',       category: 'color', visual: true },
  cs:  { name: 'fillColorSpace',   description: 'Set fill color space',         category: 'color', visual: true },
  SC:  { name: 'strokeColor',      description: 'Set stroke color',             category: 'color', visual: true },
  SCN: { name: 'strokeColorN',     description: 'Set stroke color (extended)',   category: 'color', visual: true },
  sc:  { name: 'fillColor',        description: 'Set fill color',               category: 'color', visual: true },
  scn: { name: 'fillColorN',       description: 'Set fill color (extended)',     category: 'color', visual: true },
  G:   { name: 'strokeGray',       description: 'Set stroke gray',              category: 'color', visual: true },
  g:   { name: 'fillGray',         description: 'Set fill gray',                category: 'color', visual: true },
  RG:  { name: 'strokeRGB',        description: 'Set stroke RGB color',         category: 'color', visual: true },
  rg:  { name: 'fillRGB',          description: 'Set fill RGB color',           category: 'color', visual: true },
  K:   { name: 'strokeCMYK',       description: 'Set stroke CMYK color',        category: 'color', visual: true },
  k:   { name: 'fillCMYK',         description: 'Set fill CMYK color',          category: 'color', visual: true },

  // Text state
  Tc: { name: 'charSpacing',       description: 'Set character spacing',        category: 'text-state', visual: true },
  Tw: { name: 'wordSpacing',       description: 'Set word spacing',             category: 'text-state', visual: true },
  Tz: { name: 'hScale',            description: 'Set horizontal text scaling',  category: 'text-state', visual: true },
  TL: { name: 'leading',           description: 'Set text leading',             category: 'text-state', visual: false },
  Tf: { name: 'font',              description: 'Set font & size',              category: 'text-state', visual: true },
  Tr: { name: 'textRender',        description: 'Set text rendering mode',      category: 'text-state', visual: true },
  Ts: { name: 'textRise',          description: 'Set text rise',                category: 'text-state', visual: true },

  // Text positioning
  Td:   { name: 'moveText',         description: 'Move text position',          category: 'text-pos', visual: true },
  TD:   { name: 'moveTextLeading',  description: 'Move text & set leading',     category: 'text-pos', visual: true },
  Tm:   { name: 'textMatrix',       description: 'Set text matrix',             category: 'text-pos', visual: true },
  'T*': { name: 'nextLine',         description: 'Next text line',              category: 'text-pos', visual: true },

  // Text showing
  Tj:  { name: 'showText',          description: 'Show text string',            category: 'text-show', visual: true },
  TJ:  { name: 'showTextArray',     description: 'Show text (with kerning)',    category: 'text-show', visual: true },
  "'": { name: 'nextLineShow',      description: 'Next line & show text',       category: 'text-show', visual: true },
  '"': { name: 'spacingShow',       description: 'Set spacing & show text',     category: 'text-show', visual: true },

  // Text object
  BT: { name: 'beginText',  description: 'Begin text object',   category: 'text-obj', visual: false },
  ET: { name: 'endText',    description: 'End text object',     category: 'text-obj', visual: false },

  // XObject
  Do: { name: 'drawXObject', description: 'Draw external object (image/form)', category: 'xobject', visual: true },

  // Inline image
  BI: { name: 'beginImage', description: 'Begin inline image',   category: 'inline-image', visual: false },
  ID: { name: 'imageData',  description: 'Inline image data',    category: 'inline-image', visual: false },
  EI: { name: 'endImage',   description: 'End inline image',     category: 'inline-image', visual: true },

  // Marked content
  BMC: { name: 'beginMarked',     description: 'Begin marked content',             category: 'marked', visual: false },
  BDC: { name: 'beginMarkedDict', description: 'Begin marked content (with dict)', category: 'marked', visual: false },
  EMC: { name: 'endMarked',       description: 'End marked content',               category: 'marked', visual: false },
  MP:  { name: 'markPoint',       description: 'Marked content point',             category: 'marked', visual: false },
  DP:  { name: 'markPointDict',   description: 'Marked content point (with dict)', category: 'marked', visual: false },

  // Compatibility
  BX: { name: 'beginCompat', description: 'Begin compatibility section', category: 'compat', visual: false },
  EX: { name: 'endCompat',   description: 'End compatibility section',   category: 'compat', visual: false },

  // Shading
  sh: { name: 'shadingFill', description: 'Paint shading pattern', category: 'shading', visual: true },
};

export function getOpInfo(operator: string): OpInfo {
  return OP_INFO[operator] ?? {
    name: operator,
    description: `Unknown operator: ${operator}`,
    category: 'unknown' as OpCategory,
    visual: false,
  };
}

export function getCategoryColor(category: OpCategory): string {
  const colors: Record<OpCategory, string> = {
    'path-construct': '#4ecdc4',
    'path-paint':     '#ff6b6b',
    'clip':           '#a78bfa',
    'state':          '#94a3b8',
    'color':          '#fbbf24',
    'text-state':     '#60a5fa',
    'text-pos':       '#818cf8',
    'text-show':      '#34d399',
    'text-obj':       '#6b7280',
    'xobject':        '#f472b6',
    'inline-image':   '#fb923c',
    'marked':         '#6b7280',
    'compat':         '#6b7280',
    'shading':        '#e879f9',
    'unknown':        '#6b7280',
  };
  return colors[category];
}

export function getCategoryLabel(category: OpCategory): string {
  const labels: Record<OpCategory, string> = {
    'path-construct': 'Path',
    'path-paint':     'Paint',
    'clip':           'Clip',
    'state':          'State',
    'color':          'Color',
    'text-state':     'Text Style',
    'text-pos':       'Text Pos',
    'text-show':      'Text',
    'text-obj':       'Text Block',
    'xobject':        'XObject',
    'inline-image':   'Image',
    'marked':         'Marked',
    'compat':         'Compat',
    'shading':        'Shading',
    'unknown':        'Unknown',
  };
  return labels[category];
}
