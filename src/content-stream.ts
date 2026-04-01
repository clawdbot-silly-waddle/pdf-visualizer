/**
 * PDF Content Stream Parser
 * Tokenizes and parses PDF content stream operators for display and manipulation.
 */

export interface ContentStreamOp {
  operands: string[];
  operator: string;
  raw: string;
}

type Token =
  | { type: 'number'; value: string }
  | { type: 'name'; value: string }
  | { type: 'string'; value: string }
  | { type: 'hexstring'; value: string }
  | { type: 'array'; value: string }
  | { type: 'dict'; value: string }
  | { type: 'bool'; value: string }
  | { type: 'operator'; value: string };

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\0' || ch === '\f';
}

function isDelimiter(ch: string): boolean {
  return '()[]<>{}/%'.includes(ch);
}

function tokenize(data: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < data.length) {
    // Skip whitespace
    while (i < data.length && isWhitespace(data[i])) i++;
    if (i >= data.length) break;

    const ch = data[i];

    // Comment
    if (ch === '%') {
      while (i < data.length && data[i] !== '\n' && data[i] !== '\r') i++;
      continue;
    }

    // String literal
    if (ch === '(') {
      let depth = 1;
      let s = '(';
      i++;
      while (i < data.length && depth > 0) {
        if (data[i] === '\\') {
          s += data[i] + (data[i + 1] || '');
          i += 2;
          continue;
        }
        if (data[i] === '(') depth++;
        if (data[i] === ')') depth--;
        s += data[i];
        i++;
      }
      tokens.push({ type: 'string', value: s });
      continue;
    }

    // Hex string
    if (ch === '<' && data[i + 1] !== '<') {
      let s = '<';
      i++;
      while (i < data.length && data[i] !== '>') {
        s += data[i];
        i++;
      }
      if (i < data.length) {
        s += '>';
        i++;
      }
      tokens.push({ type: 'hexstring', value: s });
      continue;
    }

    // Dictionary
    if (ch === '<' && data[i + 1] === '<') {
      let depth = 1;
      let s = '<<';
      i += 2;
      while (i < data.length && depth > 0) {
        if (data[i] === '<' && data[i + 1] === '<') {
          depth++;
          s += '<<';
          i += 2;
          continue;
        }
        if (data[i] === '>' && data[i + 1] === '>') {
          depth--;
          s += '>>';
          i += 2;
          continue;
        }
        s += data[i];
        i++;
      }
      tokens.push({ type: 'dict', value: s });
      continue;
    }

    // Name
    if (ch === '/') {
      let s = '/';
      i++;
      while (i < data.length && !isWhitespace(data[i]) && !isDelimiter(data[i])) {
        s += data[i];
        i++;
      }
      tokens.push({ type: 'name', value: s });
      continue;
    }

    // Array
    if (ch === '[') {
      let depth = 1;
      let s = '[';
      i++;
      while (i < data.length && depth > 0) {
        if (data[i] === '[') depth++;
        if (data[i] === ']') depth--;
        s += data[i];
        i++;
      }
      tokens.push({ type: 'array', value: s });
      continue;
    }

    // Number or operator
    if (!isDelimiter(ch)) {
      let s = '';
      while (i < data.length && !isWhitespace(data[i]) && !isDelimiter(data[i])) {
        s += data[i];
        i++;
      }

      // Check if it's a number
      if (/^[+-]?\d*\.?\d+$/.test(s)) {
        tokens.push({ type: 'number', value: s });
      } else if (s === 'true' || s === 'false') {
        tokens.push({ type: 'bool', value: s });
      } else if (s === 'null') {
        tokens.push({ type: 'number', value: s });
      } else {
        tokens.push({ type: 'operator', value: s });
      }
      continue;
    }

    // Skip unknown
    i++;
  }

  return tokens;
}

export function parseContentStream(streamData: string): ContentStreamOp[] {
  const tokens = tokenize(streamData);
  const ops: ContentStreamOp[] = [];
  let operands: string[] = [];

  for (const token of tokens) {
    if (token.type === 'operator') {
      ops.push({
        operands: [...operands],
        operator: token.value,
        raw: operands.length > 0
          ? operands.join(' ') + ' ' + token.value
          : token.value,
      });
      operands = [];
    } else {
      operands.push(token.value);
    }
  }

  return ops;
}

export function serializeOps(ops: ContentStreamOp[]): string {
  return ops.map((op) => op.raw).join('\n');
}
