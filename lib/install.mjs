// install.mjs — logica de instalacao/toggle. SOMENTE escopo global (user-level):
// ~/.claude/settings.json e ~/.copilot/settings.json. Nunca escreve em .claude de projeto.
// Todas as funcoes aceitam `home` opcional (default os.homedir()) pra permitir testes em sandbox.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CFG } from './moodline-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Arquivos do engine copiados juntos pro dir da CLI (core importa ./puns/./jdi/./pathguard em runtime).
export const ENGINE_FILES = ['moodline-core.mjs', 'puns.mjs', 'jdi.mjs', 'pathguard.mjs'];
// Versao lida do DISCO em tempo de chamada (nao um const compilado): durante o `moodline update`,
// o `npm i -g` ja reescreveu este package.json antes do refreshEngine rodar, entao o carimbo
// fica correto mesmo o processo em memoria sendo a versao antiga. Evita badge de update falso.
export const pkgVersion = () => JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).version;

// Template do slash command /moodline (Claude Code), lido do DISCO (lib/commands/...).
// De proposito: um const compilado faria o `moodline update` (rodando na versao antiga)
// gravar o template velho. Lendo do arquivo, o update sempre grava a versao recem-instalada.
const claudeCommandMd = () => readFileSync(join(HERE, 'commands', 'moodline.command.md'), 'utf8');

export function targets(home = homedir()) {
  const mk = (key, label, sub, adapter) => {
    const dir = join(home, sub);
    const engineDir = join(dir, 'moodline');
    return {
      key, label, adapter, dir, engineDir,
      settings: join(dir, 'settings.json'),
      core: join(engineDir, 'moodline-core.mjs'),
      config: join(engineDir, 'config.json'),
      commandFile: key === 'claude' ? join(dir, 'commands', 'moodline.md') : null,
    };
  };
  return {
    claude: mk('claude', 'Claude Code', '.claude', 'claude'),
    copilot: mk('copilot', 'GitHub Copilot CLI', '.copilot', 'copilot'),
  };
}

const fwd = (p) => p.replaceAll('\\', '/');
function readJson(p) {
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}
function writeJson(p, o) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); }

function buildFeatures(list) {
  const f = structuredClone(DEFAULT_CFG.features);
  if (Array.isArray(list)) for (const k of Object.keys(f)) f[k] = list.includes(k);
  return f;
}
function commandFor(t) {
  return `node "${fwd(t.core)}" --adapter=${t.adapter} --config="${fwd(t.config)}"`;
}
function setStatusLine(s, t) {
  const command = commandFor(t);
  if (t.adapter === 'copilot') {
    s.statusLine = { type: 'command', command, padding: 1 };
    // statusLine no Copilot e experimental: garante a feature flag
    s.feature_flags = s.feature_flags || {};
    s.feature_flags.enabled = Array.from(new Set([...(s.feature_flags.enabled || []), 'STATUS_LINE']));
  } else {
    // refreshInterval: 5 — cada refresh e um processo node novo; 5s minimiza o churn mantendo a
    // barra util. (Statusline e print-once: animacao real e impossivel; isto e o pulso de atualizacao.)
    s.statusLine = { type: 'command', command, padding: 0, refreshInterval: 5 };
  }
}

// Copia o engine, escreve o config e liga a statusLine.
export function configure(key, { features, layout, home } = {}) {
  const t = targets(home)[key];
  mkdirSync(t.engineDir, { recursive: true });
  for (const f of ENGINE_FILES) copyFileSync(join(HERE, f), join(t.engineDir, f));
  const cfg = { ...structuredClone(DEFAULT_CFG), features: buildFeatures(features) };
  if (layout) cfg.layout = layout;
  cfg.version = pkgVersion(); // engine compara com a ultima do npm pro badge de update
  writeJson(t.config, cfg);
  const s = readJson(t.settings);
  setStatusLine(s, t);
  writeJson(t.settings, s);
  // slash command /moodline (Claude Code) pra togglar de dentro da sessao
  if (t.commandFile) { mkdirSync(dirname(t.commandFile), { recursive: true }); writeFileSync(t.commandFile, claudeCommandMd()); }
  return t;
}

// Habilita/desabilita sem destruir config — re-enable e instantaneo.
export function setEnabled(key, enabled, { home } = {}) {
  const t = targets(home)[key];
  const s = readJson(t.settings);
  if (enabled) {
    if (!existsSync(t.core)) throw new Error(`${t.label}: não configurado — rode 'moodline init' primeiro`);
    setStatusLine(s, t);
  } else {
    delete s.statusLine; // mantem engine + config.json
  }
  writeJson(t.settings, s);
  return t;
}

// Liga/desliga o Co-Authored-By nos commits, editando o settings.json da CLI (nao-destrutivo).
// So Claude Code: `attribution.commit=''` remove "Generated with Claude Code" + o trailer.
// Ligar = remover os overrides (volta ao default, que e ligado). Copilot/outras: fixo, lanca.
export function setCoauthor(key, enabled, { home } = {}) {
  const t = targets(home)[key];
  if (key !== 'claude') throw new Error(`${t.label}: co-autor é comportamento fixo da CLI (não configurável)`);
  const s = readJson(t.settings);
  if (enabled) {
    delete s.attribution;
    delete s.includeCoAuthoredBy;
  } else {
    s.attribution = { ...(s.attribution || {}), commit: '', pr: '' };
  }
  writeJson(t.settings, s);
  return t;
}

export function uninstall(key, { home, purge } = {}) {
  const t = targets(home)[key];
  const s = readJson(t.settings);
  const had = !!s.statusLine;
  delete s.statusLine;
  writeJson(t.settings, s);
  if (purge && existsSync(t.engineDir)) rmSync(t.engineDir, { recursive: true, force: true });
  if (purge && t.commandFile && existsSync(t.commandFile)) rmSync(t.commandFile, { force: true });
  return { ...t, had };
}

// ---- config ao vivo (editado por `moodline config`; a statusLine relê a cada refresh) ----
export function readConfigFile(key, home) {
  const t = targets(home)[key];
  if (!existsSync(t.config)) return null;
  try { return JSON.parse(readFileSync(t.config, 'utf8')); } catch { return null; }
}
export function writeConfigFile(key, cfg, home) {
  const t = targets(home)[key];
  if (!existsSync(t.engineDir)) throw new Error(`${t.label}: não configurado — rode 'moodline init'`);
  writeJson(t.config, cfg);
  return t;
}
export function configuredKeys(home) {
  return detectInstalled(home).filter((d) => d.engine).map((d) => d.key);
}

// ---- update ----
// Re-copia os arquivos do engine (preservando config.json/features) e re-carimba a versao.
export function refreshEngine(key, home) {
  const t = targets(home)[key];
  if (!existsSync(t.engineDir)) throw new Error(`${t.label}: não configurado`);
  for (const f of ENGINE_FILES) copyFileSync(join(HERE, f), join(t.engineDir, f));
  const cfg = existsSync(t.config) ? JSON.parse(readFileSync(t.config, 'utf8')) : {};
  cfg.version = pkgVersion();
  writeJson(t.config, cfg);
  if (t.commandFile) { mkdirSync(dirname(t.commandFile), { recursive: true }); writeFileSync(t.commandFile, claudeCommandMd()); }
  try { rmSync(join(t.engineDir, '.update.json'), { force: true }); } catch {} // revalida o badge
  return t;
}

// Ultima versao publicada no npm (null se offline). Timeout curto.
export async function fetchLatest() {
  try {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 3000);
    const r = await fetch('https://registry.npmjs.org/moodline/latest', { signal: ac.signal });
    clearTimeout(to);
    if (r.ok) return (await r.json()).version || null;
  } catch {}
  return null;
}

export function detectInstalled(home) {
  return Object.values(targets(home)).map((t) => {
    const s = readJson(t.settings);
    const wired = !!s.statusLine && /moodline-core\.mjs/.test(s.statusLine?.command || '');
    return { ...t, present: existsSync(t.dir), engine: existsSync(t.core), wired };
  });
}
