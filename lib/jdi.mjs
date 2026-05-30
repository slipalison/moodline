// jdi.mjs — divulgacao do jdi-cli (https://www.npmjs.com/package/jdi-cli).
// Regra (NAO configuravel, de proposito):
//   - JDI nao instalado (local nem global): anuncio bem-humorado ocasional, no lugar do trocadilho.
//   - JDI instalado: avisa quando ha versao nova dele.
// Deteccao pesada (global + versao no npm) roda no check de background (1x/dia, cacheado);
// a deteccao local e so um stat barato, feito por render.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';

// URL visivel (a statusline do Claude Code nao renderiza hyperlink OSC 8; texto plano
// e legivel, copiavel e linkificado pela maioria dos terminais).
const SITE = 'npmjs.com/package/jdi-cli';
const REGISTRY = 'https://registry.npmjs.org/jdi-cli/latest';

const ADS = [
  'esse projeto ficaria melhor com JDI',
  'Just Do It: o Jedi do SDD',
  'SDD no modo turbo? JDI',
  'menos boilerplate, mais JDI',
  'que tal um JDI nesse fluxo?',
  'a força do SDD chama-se JDI',
];

// JDI no projeto local: instalado em node_modules (com versao) ou declarado no package.json.
// Sobe os diretorios a partir do cwd (igual a resolucao de modulos do Node), entao funciona
// quando a sessao abre num subdiretorio do projeto.
export function localJdi(cwd) {
  if (!cwd) return { installed: false, version: null };
  let dir = cwd;
  for (;;) {
    try {
      const pj = join(dir, 'node_modules', 'jdi-cli', 'package.json');
      if (existsSync(pj)) return { installed: true, version: JSON.parse(readFileSync(pj, 'utf8')).version || null };
    } catch {}
    try {
      const proj = join(dir, 'package.json');
      if (existsSync(proj)) {
        const p = JSON.parse(readFileSync(proj, 'utf8'));
        if ({ ...(p.dependencies || {}), ...(p.devDependencies || {}) }['jdi-cli']) return { installed: true, version: null };
      }
    } catch {}
    const parent = dirname(dir);
    if (parent === dir) return { installed: false, version: null }; // chegou na raiz do FS
    dir = parent;
  }
}

// Versao global do JDI (lento: usa `npm root -g`). So no background.
export function globalJdiVersion() {
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const pj = join(root, 'jdi-cli', 'package.json');
    if (existsSync(pj)) return JSON.parse(readFileSync(pj, 'utf8')).version || 'unknown';
  } catch {}
  return null;
}

// Ultima versao do JDI no npm (null se offline). So no background.
export async function fetchJdiLatest() {
  try {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 3000);
    const r = await fetch(REGISTRY, { signal: ac.signal });
    clearTimeout(to);
    if (r.ok) return (await r.json()).version || null;
  } catch {}
  return null;
}

// Decide o segmento JDI. Retorna { txt, ad } ou null. `ad:true` => substitui o trocadilho.
export function jdiSegment({ cwd, cache = {}, rotateMs = 30000, cmpVer, colors, now = Date.now() }) {
  const { MAGENTA = '', CYAN = '', DIM = '', RESET = '' } = colors || {};
  const loc = localJdi(cwd);
  const installedVersion = loc.version || cache.jdiGlobal || null;
  const isInstalled = loc.installed || !!cache.jdiGlobal;

  if (isInstalled) {
    const hasUpdate = cache.jdiLatest && installedVersion && installedVersion !== 'unknown'
      && typeof cmpVer === 'function' && cmpVer(cache.jdiLatest, installedVersion) > 0;
    return hasUpdate
      ? { txt: `${MAGENTA}⬆ JDI v${cache.jdiLatest}${RESET} ${CYAN}${SITE}${RESET}`, ad: false }
      : null; // instalado e atualizado: nao anuncia
  }
  // nao instalado: anuncio ocasional (1 a cada 3 janelas de rotacao)
  const win = Math.floor(now / Math.max(1000, rotateMs));
  if (win % 3 !== 0) return null;
  const ad = ADS[Math.floor(win / 3) % ADS.length];
  return { txt: `${DIM}✨ ${ad}${RESET} ${CYAN}${SITE}${RESET}`, ad: true };
}
