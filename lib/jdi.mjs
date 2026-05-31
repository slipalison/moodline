// jdi.mjs — deteccao + divulgacao do JDI (get-shit-done / jdi-cli).
//
// JDI e um WORKFLOW pra IA: instala commands/skills/agents nos runtimes (ex.: ~/.claude/commands/jdi-do.md)
// e mantem estado em uma pasta .jdi/ no projeto. NAO e dependencia node do projeto — por isso a deteccao
// olha ARTEFATOS (a pasta .jdi/ e os comandos jdi-*), nunca node_modules. O jdi-cli (npm) e so o instalador.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

// URL visivel (a statusline do Claude Code nao renderiza hyperlink OSC 8; texto plano e copiavel).
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

// Um diretorio estilo-.claude tem comandos/agentes do JDI? (ex.: commands/jdi-do.md, agents/jdi-architect.md)
function hasJdiArtifacts(runtimeDir) {
  for (const sub of ['commands', 'agents']) {
    try { if (readdirSync(join(runtimeDir, sub)).some((f) => f.startsWith('jdi-'))) return true; } catch {}
  }
  return false;
}

// JDI no PROJETO: pasta de estado .jdi/ ou comandos jdi-* em .claude/ — subindo do cwd ate a raiz do FS.
export function jdiInProject(cwd) {
  if (!cwd) return false;
  let dir = cwd;
  for (;;) {
    try { if (statSync(join(dir, '.jdi')).isDirectory()) return true; } catch {}
    if (hasJdiArtifacts(join(dir, '.claude'))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false; // raiz do FS
    dir = parent;
  }
}

// JDI instalado no RUNTIME (user-level): comandos/agentes jdi-* em ~/.claude ou ~/.copilot.
export function jdiInRuntime(home = homedir()) {
  return hasJdiArtifacts(join(home, '.claude')) || hasJdiArtifacts(join(home, '.copilot'));
}

// Versao do INSTALADOR jdi-cli, se instalado global via npm (lento: `npm root -g`). So no background.
export function globalJdiVersion() {
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const pj = join(root, 'jdi-cli', 'package.json');
    if (existsSync(pj)) return JSON.parse(readFileSync(pj, 'utf8')).version || 'unknown';
  } catch {}
  return null;
}

// Ultima versao do instalador jdi-cli no npm (null se offline). So no background.
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
// JDI presente (projeto ou runtime) => nunca anuncia; so avisa update do instalador, se houver.
export function jdiSegment({ cwd, home, cache = {}, rotateMs = 30000, cmpVer, colors, now = Date.now() }) {
  const { MAGENTA = '', CYAN = '', DIM = '', RESET = '' } = colors || {};
  const present = jdiInProject(cwd) || jdiInRuntime(home);

  if (present) {
    const v = cache.jdiGlobal; // versao do instalador, se global
    const hasUpdate = cache.jdiLatest && v && v !== 'unknown'
      && typeof cmpVer === 'function' && cmpVer(cache.jdiLatest, v) > 0;
    return hasUpdate
      ? { txt: `${MAGENTA}⬆ JDI v${cache.jdiLatest}${RESET} ${CYAN}${SITE}${RESET}`, ad: false }
      : null; // presente: nao anuncia
  }
  // nao instalado: anuncio ocasional (1 a cada 3 janelas de rotacao)
  const win = Math.floor(now / Math.max(1000, rotateMs));
  if (win % 3 !== 0) return null;
  const ad = ADS[Math.floor(win / 3) % ADS.length];
  return { txt: `${DIM}✨ ${ad}${RESET} ${CYAN}${SITE}${RESET}`, ad: true };
}
