// jdi.mjs — deteccao + divulgacao do JDI (get-shit-done / jdi-cli).
//
// JDI e um WORKFLOW pra IA: instala commands/skills/agents nos runtimes (ex.: ~/.claude/commands/jdi-do.md)
// e mantem estado em uma pasta .jdi/ no projeto. NAO e dependencia node do projeto — por isso a deteccao
// olha ARTEFATOS (a pasta .jdi/ e os comandos jdi-*), nunca node_modules. O jdi-cli (npm) e so o instalador.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
  // Jedi / Star Wars
  'que a Força do SDD esteja com você: JDI',
  'do or do not, there is no try — Just Do It',
  'use o JDI, Luke',
  'JDI: o lado luminoso do workflow',
  'estes não são os bugs que você procura — JDI resolve',
  'menos Sith, mais SDD: JDI',
  'treina como Yoda, entrega como JDI',
  'o império dos bugs cai com JDI',
  // Nike / Just Do It
  'para de planejar. Just Do It: JDI',
  'amanhã não. JDI hoje',
  'menos desculpa, mais JDI',
  'só faz. JDI.',
  'sonhe grande, JDI maior',
];

// ---- efeitos visuais do anuncio (variam por estilo + frame -> pseudo-animacao entre refreshes) ----
const ESC = '\x1b', RST = `${ESC}[0m`, BOLD = `${ESC}[1m`, DIMc = `${ESC}[2m`;
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

// pulso dourado com sparkle trocando
function fxPulse(t, frame) {
  const sp = ['✦', '✧', '⋆', '✺'][frame % 4];
  const l = 0.5 + 0.18 * (1 - Math.abs(((frame % 6) / 5) * 2 - 1));
  const [r, g, b] = hsl(48, 1, l);
  return `${tc(r, g, b)}${BOLD}${sp} ${t} ${sp}${RST}`;
}
// gradiente correndo letra a letra
function fxSweep(t, frame) {
  let out = '';
  const cs = [...t];
  for (let i = 0; i < cs.length; i++) { const [r, g, b] = hsl((90 + i * 7 + frame * 18) % 360, 1, 0.6); out += tc(r, g, b) + cs[i]; }
  const [er, eg, eb] = hsl((frame * 18) % 360, 1, 0.6);
  return `${tc(er, eg, eb)}${BOLD}✦${RST} ${out}${RST}`;
}
// lightsaber: cor da lamina cicla (verde/azul/roxo/vermelho — Jedi & Sith)
function fxSaber(t, frame) {
  const blades = [[57, 255, 20], [40, 150, 255], [170, 90, 255], [255, 45, 45]];
  const [r, g, b] = blades[frame % blades.length];
  const bl = tc(r, g, b);
  return `${bl}${BOLD}▮═━${RST} ${BOLD}${t}${RST} ${bl}${BOLD}━═▮${RST}`;
}
// destaque varrendo o texto
function fxScan(t, frame) {
  const cs = [...t];
  const pos = cs.length ? (frame * 3) % cs.length : 0;
  let out = '';
  for (let i = 0; i < cs.length; i++) out += i === pos ? `${tc(255, 255, 150)}${BOLD}${cs[i]}${RST}${DIMc}` : cs[i];
  return `${DIMc}✨ ${out} ✨${RST}`;
}
const EFFECTS = [fxPulse, fxSweep, fxSaber, fxScan];

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

// Versao da release do JDI gravada no projeto. O JDI grava em .jdi/VERSION (ex.: "0.1.12");
// tambem aceitamos jdi_version/version no .jdi/config.json como fallback. Permite o aviso de
// update mesmo rodando o JDI via npx (sem instalador global). Para na pasta .jdi mais proxima.
export function jdiProjectVersion(cwd) {
  if (!cwd) return null;
  let dir = cwd;
  for (;;) {
    const jdiDir = join(dir, '.jdi');
    if (existsSync(jdiDir)) {
      try {
        const vfile = join(jdiDir, 'VERSION');
        if (existsSync(vfile)) { const v = readFileSync(vfile, 'utf8').trim(); if (v) return v; }
      } catch {}
      try {
        const cfg = join(jdiDir, 'config.json');
        if (existsSync(cfg)) {
          const j = JSON.parse(readFileSync(cfg, 'utf8'));
          const v = j.jdi_version || j.jdiVersion || j.version;
          if (v) return String(v);
        }
      } catch {}
      return null; // achou .jdi mas sem versao legivel
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// JDI instalado no RUNTIME (user-level): comandos/agentes jdi-* em ~/.claude ou ~/.copilot.
export function jdiInRuntime(home = homedir()) {
  return hasJdiArtifacts(join(home, '.claude')) || hasJdiArtifacts(join(home, '.copilot'));
}

// Versao do INSTALADOR jdi-cli, se instalado global via npm. Deriva o dir de modulos globais
// a partir do node em execucao — SEM spawnar `npm root -g` (npm e um processo pesado e, no Windows,
// `execFileSync('npm', ...)` orfana o node filho ao matar o wrapper .cmd). So leitura de arquivo.
export function globalJdiVersion() {
  const exeDir = dirname(process.execPath);
  const roots = process.platform === 'win32'
    ? [join(exeDir, 'node_modules')]                                   // Windows: <node>\node_modules
    : [join(exeDir, '..', 'lib', 'node_modules'), join(exeDir, '..', 'node_modules')]; // POSIX
  for (const root of roots) {
    try {
      const pj = join(root, 'jdi-cli', 'package.json');
      if (existsSync(pj)) return JSON.parse(readFileSync(pj, 'utf8')).version || 'unknown';
    } catch {}
  }
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
// `present`/`projectVersion` podem vir pre-computados (cache TTL no core) pra evitar a varredura
// de FS a cada refresh; se ausentes, sao detectados aqui (mantem o uso direto/testavel).
export function jdiSegment({ cwd, home, present, projectVersion, cache = {}, rotateMs = 30000, cmpVer, colors, now = Date.now() }) {
  const { MAGENTA = '', CYAN = '', DIM = '', RESET = '' } = colors || {};
  if (present === undefined) present = jdiInProject(cwd) || jdiInRuntime(home);

  if (present) {
    const v = (projectVersion !== undefined ? projectVersion : jdiProjectVersion(cwd)) || cache.jdiGlobal; // projeto (npx) ou instalador global
    const hasUpdate = cache.jdiLatest && v && v !== 'unknown'
      && typeof cmpVer === 'function' && cmpVer(cache.jdiLatest, v) > 0;
    return hasUpdate
      ? { txt: `${MAGENTA}⬆ JDI v${cache.jdiLatest}${RESET} ${CYAN}${SITE}${RESET}`, ad: false }
      : null; // presente: nao anuncia
  }
  // nao instalado: anuncio ocasional (1 a cada 3 janelas de rotacao) com efeito visual
  const win = Math.floor(now / Math.max(1000, rotateMs));
  if (win % 3 !== 0) return null;
  const adIndex = Math.floor(win / 3);
  const ad = ADS[adIndex % ADS.length];
  const fx = EFFECTS[adIndex % EFFECTS.length];     // efeito FIXO por anuncio (nao troca enquanto ele aparece)
  const decorated = fx(ad, Math.floor(now / 1000)); // frame anima 1x/seg DENTRO do efeito
  return { txt: `${decorated} ${CYAN}${SITE}${RESET}`, ad: true };
}
