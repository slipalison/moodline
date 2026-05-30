// install.mjs — logica de instalacao/toggle. SOMENTE escopo global (user-level):
// ~/.claude/settings.json e ~/.copilot/settings.json. Nunca escreve em .claude de projeto.
// Todas as funcoes aceitam `home` opcional (default os.homedir()) pra permitir testes em sandbox.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CFG } from './moodline-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Arquivos do engine copiados juntos pro dir da CLI (core importa ./puns.mjs em runtime).
export const ENGINE_FILES = ['moodline-core.mjs', 'puns.mjs'];

export function targets(home = homedir()) {
  const mk = (key, label, sub, adapter) => {
    const dir = join(home, sub);
    const engineDir = join(dir, 'moodline');
    return {
      key, label, adapter, dir, engineDir,
      settings: join(dir, 'settings.json'),
      core: join(engineDir, 'moodline-core.mjs'),
      config: join(engineDir, 'config.json'),
    };
  };
  return {
    claude: mk('claude', 'Claude Code', '.claude', 'claude'),
    copilot: mk('copilot', 'GitHub Copilot CLI', '.copilot', 'copilot'),
  };
}

const fwd = (p) => p.replace(/\\/g, '/');
function readJson(p) { if (!existsSync(p)) return {}; try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; } }
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
  writeJson(t.config, cfg);
  const s = readJson(t.settings);
  setStatusLine(s, t);
  writeJson(t.settings, s);
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

export function uninstall(key, { home, purge } = {}) {
  const t = targets(home)[key];
  const s = readJson(t.settings);
  const had = !!s.statusLine;
  delete s.statusLine;
  writeJson(t.settings, s);
  if (purge && existsSync(t.engineDir)) rmSync(t.engineDir, { recursive: true, force: true });
  return { ...t, had };
}

export function detectInstalled(home) {
  return Object.values(targets(home)).map((t) => {
    const s = readJson(t.settings);
    const wired = !!s.statusLine && /moodline-core\.mjs/.test(s.statusLine?.command || '');
    return { ...t, present: existsSync(t.dir), engine: existsSync(t.core), wired };
  });
}
