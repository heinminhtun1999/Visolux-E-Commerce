const fs = require('fs');

const targetPath = process.argv[2] || 'src/routes/admin.js';
const source = fs.readFileSync(targetPath, 'utf8');

let line = 1;
let col = 0;

const stack = [];
let state = 'normal';
let regexCharClass = false;
let prevSig = '';

let templateExprDepth = 0;

function push(ch) {
  stack.push({ ch, line, col, templateExpr: false });
}

function pushTemplateExprBrace() {
  templateExprDepth++;
  stack.push({ ch: '{', line, col, templateExpr: true });
}

function pop(expected) {
  const top = stack.pop();
  if (!top || top.ch !== expected) {
    console.error('MISMATCH', { at: { line, col }, got: top?.ch, expected, top });
    // Keep going to collect more useful info.
    return { ok: false, top };
  }

  if (top.templateExpr) {
    templateExprDepth = Math.max(0, templateExprDepth - 1);
    state = 'template';
  }

  return { ok: true, top };
}

function isRegexStart(prev) {
  return prev === '' || /[=(:,\[\{!\?;\|&^~<>+\-*/%\n]/.test(prev);
}

for (let i = 0; i < source.length; i++) {
  const ch = source[i];
  col++;

  if (ch === '\n') {
    line++;
    col = 0;
    if (state === 'lineComment') state = 'normal';
    prevSig = '\n';
    continue;
  }

  if (state === 'lineComment') continue;

  if (state === 'blockComment') {
    if (ch === '*' && source[i + 1] === '/') {
      i++;
      col++;
      state = 'normal';
    }
    continue;
  }

  if (state === 'sQuote') {
    if (ch === '\\') {
      i++;
      col++;
      continue;
    }
    if (ch === "'") state = 'normal';
    continue;
  }

  if (state === 'dQuote') {
    if (ch === '\\') {
      i++;
      col++;
      continue;
    }
    if (ch === '"') state = 'normal';
    continue;
  }

  if (state === 'template') {
    if (ch === '\\') {
      i++;
      col++;
      continue;
    }
    if (ch === '`') {
      state = 'normal';
      continue;
    }
    if (ch === '$' && source[i + 1] === '{') {
      // Enter expression mode (normal), but ensure braces match.
      i++;
      col++;
      pushTemplateExprBrace();
      state = 'normal';
      prevSig = '{';
      continue;
    }
    continue;
  }

  if (state === 'regex') {
    if (ch === '\\') {
      i++;
      col++;
      continue;
    }
    if (ch === '[') regexCharClass = true;
    if (ch === ']') regexCharClass = false;
    if (ch === '/' && !regexCharClass) {
      state = 'normal';
      // consume flags
      while (/[a-z]/i.test(source[i + 1] || '')) {
        i++;
        col++;
      }
    }
    continue;
  }

  // normal
  if (ch === '/' && source[i + 1] === '/') {
    state = 'lineComment';
    i++;
    col++;
    continue;
  }
  if (ch === '/' && source[i + 1] === '*') {
    state = 'blockComment';
    i++;
    col++;
    continue;
  }
  if (ch === '`') {
    state = 'template';
    continue;
  }
  if (ch === "'") {
    state = 'sQuote';
    continue;
  }
  if (ch === '"') {
    state = 'dQuote';
    continue;
  }
  if (ch === '/' && isRegexStart(prevSig)) {
    state = 'regex';
    regexCharClass = false;
    continue;
  }

  if (ch === '{' || ch === '(' || ch === '[') {
    push(ch);
    prevSig = ch;
    continue;
  }

  if (ch === '}') {
    pop('{');
    prevSig = ch;
    continue;
  }
  if (ch === ')') {
    pop('(');
    prevSig = ch;
    continue;
  }
  if (ch === ']') {
    pop('[');
    prevSig = ch;
    continue;
  }

  if (!/\s/.test(ch)) prevSig = ch;
}

if (state !== 'normal') console.error('Ended in non-normal state:', state);

if (stack.length) {
  console.error('Unclosed tokens (last 15):');
  console.error(stack.slice(-15));
  process.exit(1);
}

console.log('Balanced (best-effort).');
