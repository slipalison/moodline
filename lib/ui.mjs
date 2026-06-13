// ui.mjs — helpers de terminal pro instalador interativo. Zero dependencias (node:readline).
// Prompts (multiselect/select/confirm) usam raw mode; sempre restauram o terminal no fim.
import readline from 'node:readline';

const out = process.stdout;
export const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', magenta: '\x1b[35m', gray: '\x1b[90m',
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const hideCursor = () => out.isTTY && out.write('\x1b[?25l');
export const showCursor = () => out.isTTY && out.write('\x1b[?25h');

export const isInteractive = () => !!process.stdin.isTTY && !!process.stdout.isTTY;

function withKeypress(onKey, draw) {
  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    hideCursor();
    const cleanup = () => {
      process.stdin.removeListener('keypress', handler);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      showCursor();
    };
    const handler = (str, key) => {
      if (!key) return;
      if (key.ctrl && key.name === 'c') { cleanup(); out.write('\n'); process.exit(130); }
      onKey(key, (result) => { cleanup(); resolve(result); }, draw);
    };
    process.stdin.on('keypress', handler);
    draw(true);
  });
}

// choices: [{ name, value, checked? }]  -> retorna array de values marcados
export function multiselect(message, choices) {
  let idx = 0;
  const sel = choices.map((c) => !!c.checked);
  const render = (first) => {
    const lines = choices.length + 1;
    if (!first) out.write(`\x1b[${lines}A`);
    out.write(`\x1b[0G\x1b[K${C.bold}? ${message}${C.reset} ${C.dim}(↑↓ · espaço marca · a=todos · enter)${C.reset}\n`);
    choices.forEach((c, i) => {
      const ptr = i === idx ? `${C.cyan}❯${C.reset}` : ' ';
      const box = sel[i] ? `${C.green}◉${C.reset}` : `${C.dim}◯${C.reset}`;
      const label = i === idx ? `${C.cyan}${c.name}${C.reset}` : c.name;
      out.write(`\x1b[0G\x1b[K ${ptr} ${box} ${label}\n`);
    });
  };
  return withKeypress((key, done) => {
    if (key.name === 'up') idx = (idx - 1 + choices.length) % choices.length;
    else if (key.name === 'down') idx = (idx + 1) % choices.length;
    else if (key.name === 'space') sel[idx] = !sel[idx];
    else if (key.name === 'a') { const all = sel.every(Boolean); sel.fill(!all); }
    else if (key.name === 'return') return done(choices.filter((_, i) => sel[i]).map((c) => c.value));
    render(false);
  }, render);
}

// choices: [{ name, value }] -> retorna 1 value
export function select(message, choices, initial = 0) {
  let idx = initial;
  const render = (first) => {
    const lines = choices.length + 1;
    if (!first) out.write(`\x1b[${lines}A`);
    out.write(`\x1b[0G\x1b[K${C.bold}? ${message}${C.reset} ${C.dim}(↑↓ · enter)${C.reset}\n`);
    choices.forEach((c, i) => {
      const ptr = i === idx ? `${C.cyan}❯${C.reset}` : ' ';
      const label = i === idx ? `${C.cyan}${c.name}${C.reset}` : c.name;
      out.write(`\x1b[0G\x1b[K ${ptr} ${label}\n`);
    });
  };
  return withKeypress((key, done) => {
    if (key.name === 'up') idx = (idx - 1 + choices.length) % choices.length;
    else if (key.name === 'down') idx = (idx + 1) % choices.length;
    else if (key.name === 'return') return done(choices[idx].value);
    render(false);
  }, render);
}

export function confirm(message, def = true) {
  const render = (first) => {
    if (!first) out.write('\x1b[1A');
    out.write(`\x1b[0G\x1b[K${C.bold}? ${message}${C.reset} ${C.dim}(${def ? 'Y/n' : 'y/N'})${C.reset}\n`);
  };
  return withKeypress((key, done) => {
    if (key.name === 'y') return done(true);
    if (key.name === 'n') return done(false);
    if (key.name === 'return') return done(def);
    render(false);
  }, render);
}

// spinner com checkmark no fim
export function spinner(text) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  if (!out.isTTY) { out.write(`  ${C.dim}…${C.reset} ${text}\n`); return { stop() {} }; }
  hideCursor();
  let i = 0;
  const t = setInterval(() => out.write(`\x1b[0G\x1b[K${C.cyan}${frames[i++ % frames.length]}${C.reset} ${text}`), 80);
  return {
    stop(msg = text, ok = true) {
      clearInterval(t);
      out.write(`\x1b[0G\x1b[K${ok ? C.green + '✓' : C.red + '✗'}${C.reset} ${msg}\n`);
      showCursor();
    },
  };
}
