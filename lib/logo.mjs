// logo.mjs — logo ASCII do moodline + render com gradiente + animacao de onda.
// Usado so no instalador (nao entra no caminho da barra). Auto-contido.

const ESC = '\x1b';
const RESET = `${ESC}[0m`;

// HSL -> RGB (h em graus 0..360, s/l em 0..1)
function hsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
const tc = (r, g, b) => `${ESC}[38;2;${r};${g};${b}m`;

// Glyphs (fonte ANSI Shadow). Cada letra: 6 linhas de largura igual.
const G = {
  M: ['███╗   ███╗', '████╗ ████║', '██╔████╔██║', '██║╚██╔╝██║', '██║ ╚═╝ ██║', '╚═╝     ╚═╝'],
  O: [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  D: ['██████╗ ', '██╔══██╗', '██║  ██║', '██║  ██║', '██████╔╝', '╚═════╝ '],
  L: ['██╗     ', '██║     ', '██║     ', '██║     ', '███████╗', '╚══════╝'],
  I: ['██╗ ', '██║ ', '██║ ', '██║ ', '██║ ', '╚═╝ '],
  N: ['███╗   ██╗', '████╗  ██║', '██╔██╗ ██║', '██║╚██╗██║', '██║ ╚████║', '╚═╝  ╚═══╝'],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
};
const WORD = 'MOODLINE';
export const LOGO_LINES = Array.from({ length: 6 }, (_, r) => [...WORD].map((ch) => G[ch][r]).join(' '));
const MAXW = Math.max(...LOGO_LINES.map((l) => [...l].length));
export const TAGLINE = '🌿 statusline divertida e informativa pra CLIs de IA';

// Colore cada coluna por matiz, com deslocamento de fase (onda verde->vermelho).
export function renderLogo(phase = 0) {
  return LOGO_LINES.map((line) => {
    const chars = [...line];
    let out = '';
    for (let x = 0; x < chars.length; x++) {
      const ch = chars[x];
      if (ch === ' ') { out += ' '; continue; }
      const hue = (((x / MAXW) * 120 + phase) % 120 + 120) % 120; // 0..120 (verde->vermelho)
      const [r, g, b] = hsl(hue, 1, 0.55);
      out += tc(r, g, b) + ch;
    }
    return out + RESET;
  }).join('\n');
}

// Versao compacta pra terminais estreitos
export function smallLogo() {
  const [r, g, b] = hsl(90, 1, 0.55);
  return `${tc(r, g, b)}🌿 moodline${RESET}`;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Imprime o logo. Anima (onda) se for TTY e couber; senao imprime estatico.
export async function printLogo({ animate = true, frames = 16, delay = 45 } = {}) {
  const out = process.stdout;
  const cols = out.columns || parseInt(process.env.COLUMNS || '80', 10);
  if (cols < MAXW) { out.write('\n' + smallLogo() + '\n' + '\x1b[2m' + TAGLINE + '\x1b[0m\n\n'); return; }

  if (!animate || !out.isTTY) {
    out.write('\n' + renderLogo(0) + '\n\x1b[2m  ' + TAGLINE + '\x1b[0m\n\n');
    return;
  }
  out.write('\x1b[?25l'); // esconde cursor
  out.write('\n');
  for (let i = 0; i < frames; i++) {
    if (i > 0) out.write(`\x1b[${LOGO_LINES.length}A`); // sobe N linhas
    const block = renderLogo(i * 9).split('\n').map((l) => '\x1b[0G\x1b[K' + l).join('\n');
    out.write(block + '\n');
    await sleep(delay);
  }
  out.write('\x1b[2m  ' + TAGLINE + '\x1b[0m\n\n');
  out.write('\x1b[?25h'); // mostra cursor
}
