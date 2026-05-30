#!/usr/bin/env node
// moodline — instalador/configurador da statusline para CLIs de IA.
//
// Comandos:
//   moodline init        configura a(s) CLI(s) detectada(s) (Claude Code, Copilot CLI)
//   moodline render      le JSON no stdin e imprime a barra (pra testar)
//   moodline doctor      mostra o que esta instalado/configurado
//   moodline uninstall   remove a statusLine das CLIs
//   moodline watch       [EXPERIMENTAL] poller pro OpenCode (HTTP) -> stdout
//   moodline --help|--version

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { render, ADAPTERS, fromOpenCode, loadConfig, attachGit, DEFAULT_CFG } from '../lib/moodline-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE_SRC = join(HERE, '..', 'lib', 'moodline-core.mjs');
const PKG = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));

const C = { cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', red: '\x1b[31m', reset: '\x1b[0m', bold: '\x1b[1m' };
const ok = (s) => console.log(`${C.green}✓${C.reset} ${s}`);
const warn = (s) => console.log(`${C.yellow}!${C.reset} ${s}`);
const info = (s) => console.log(`  ${C.dim}${s}${C.reset}`);

// --------- arg parsing ---------
function parseArgs(argv) {
  const o = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      o[k] = v === undefined ? true : v;
    } else o._.push(a);
  }
  return o;
}

// --------- alvos de CLI suportados (statusLine nativa por comando + JSON no stdin) ---------
const TARGETS = {
  claude: {
    label: 'Claude Code',
    dir: join(homedir(), '.claude'),
    settings: join(homedir(), '.claude', 'settings.json'),
    adapter: 'claude',
    patch(s, command) {
      s.statusLine = { type: 'command', command, padding: 0, refreshInterval: 5 };
    },
  },
  copilot: {
    label: 'GitHub Copilot CLI',
    dir: join(homedir(), '.copilot'),
    settings: join(homedir(), '.copilot', 'settings.json'),
    adapter: 'copilot',
    patch(s, command) {
      s.statusLine = { type: 'command', command, padding: 1 };
      // statusLine no Copilot e experimental: liga a feature flag
      s.feature_flags = s.feature_flags || {};
      s.feature_flags.enabled = Array.from(new Set([...(s.feature_flags.enabled || []), 'STATUS_LINE']));
    },
  },
};

function readJson(path) {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}
function fwd(p) { return p.replace(/\\/g, '/'); }

function buildFeatures(opts) {
  const f = structuredClone(DEFAULT_CFG.features);
  if (typeof opts.features === 'string') {
    const want = new Set(opts.features.split(',').map((x) => x.trim()).filter(Boolean));
    for (const k of Object.keys(f)) f[k] = want.has(k);
  }
  for (const k of Object.keys(f)) {
    if (opts[`no-${k}`]) f[k] = false;
  }
  return f;
}

function configureTarget(key, opts) {
  const t = TARGETS[key];
  const root = join(t.dir, 'moodline');
  const coreDest = join(root, 'moodline-core.mjs');
  const cfgDest = join(root, 'config.json');

  mkdirSync(root, { recursive: true });
  copyFileSync(CORE_SRC, coreDest);

  const cfg = { ...structuredClone(DEFAULT_CFG), features: buildFeatures(opts) };
  if (opts.multi) cfg.layout = 'multi';
  writeFileSync(cfgDest, JSON.stringify(cfg, null, 2) + '\n');

  const command = `node "${fwd(coreDest)}" --adapter=${t.adapter} --config="${fwd(cfgDest)}"`;
  const settings = readJson(t.settings);
  t.patch(settings, command);
  mkdirSync(dirname(t.settings), { recursive: true });
  writeFileSync(t.settings, JSON.stringify(settings, null, 2) + '\n');

  ok(`${t.label} configurado`);
  info(`engine: ${fwd(coreDest)}`);
  info(`config: ${fwd(cfgDest)}`);
  info(`settings: ${fwd(t.settings)}`);
  return { coreDest, cfgDest, command };
}

function cmdInit(opts) {
  console.log(`${C.bold}\u{1F33F}  moodline init${C.reset}\n`);

  const explicit = ['claude', 'copilot'].filter((k) => opts[k] || opts.all);
  let keys;
  if (explicit.length) {
    keys = explicit;
  } else {
    // default: Claude Code sempre; Copilot se detectado
    keys = ['claude'];
    if (existsSync(TARGETS.copilot.dir)) keys.push('copilot');
  }

  for (const k of keys) configureTarget(k, opts);

  console.log();
  if (keys.includes('copilot')) {
    warn('Copilot CLI: statusLine e experimental — reinicie o copilot ou rode `/experimental` se a barra nao aparecer.');
  }
  console.log(`\n${C.bold}Outras CLIs:${C.reset}`);
  info('Gemini CLI  — sem statusLine por comando; so footer fixo (toggles) ou extensao HUD 3rd-party. [experimental]');
  info('OpenCode    — sem statusLine na TUI; use `moodline watch` num painel tmux/zellij. [experimental]');
  info('Junie CLI   — nao suporta statusline (hook SessionStart descarta o output). Sem suporte.');
  console.log(`\n${C.green}Pronto.${C.reset} Abra uma sessao da CLI pra ver a barra. Teste agora: ${C.cyan}moodline render${C.reset}`);
}

function cmdUninstall(opts) {
  const keys = ['claude', 'copilot'].filter((k) => opts[k] || opts.all);
  const list = keys.length ? keys : ['claude', 'copilot'];
  for (const k of list) {
    const t = TARGETS[k];
    if (!existsSync(t.settings)) continue;
    const s = readJson(t.settings);
    if (s.statusLine) { delete s.statusLine; writeFileSync(t.settings, JSON.stringify(s, null, 2) + '\n'); ok(`${t.label}: statusLine removida`); }
    else info(`${t.label}: nada pra remover`);
  }
}

function cmdDoctor() {
  console.log(`${C.bold}moodline doctor${C.reset}  v${PKG.version}\n`);
  info(`home: ${fwd(homedir())}`);
  for (const [k, t] of Object.entries(TARGETS)) {
    const has = existsSync(t.dir);
    const s = readJson(t.settings);
    const wired = !!s.statusLine && /moodline-core\.mjs/.test(s.statusLine.command || '');
    console.log(`\n${C.bold}${t.label}${C.reset} (${k})`);
    info(`dir existe: ${has ? 'sim' : 'nao'}`);
    info(`statusLine moodline: ${wired ? C.green + 'ativa' + C.reset : 'nao'}`);
    if (s.statusLine?.command) info(`command: ${s.statusLine.command}`);
  }
}

function cmdRender(opts) {
  // delega pro engine: le stdin, imprime barra. Reusa as mesmas flags.
  const adapterName = (opts.adapter || 'claude').toLowerCase();
  const adapter = ADAPTERS[adapterName] || ADAPTERS.claude;
  const cfg = loadConfig(opts.config);
  for (const k of ['git', 'cost', 'rate', 'puns']) if (opts[`no-${k}`]) cfg.features[k] = false;
  if (opts.multi) cfg.layout = 'multi';
  if (opts.width) cfg.width = parseInt(opts.width, 10) || undefined;

  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch {}
  if (!raw.trim()) {
    // sem stdin: demo
    raw = JSON.stringify({ model: { display_name: 'Opus' }, effort: { level: 'high' }, context_window: { used_percentage: 42, total_input_tokens: 84000 }, cost: { total_cost_usd: 0.12, total_duration_ms: 320000, total_lines_added: 120, total_lines_removed: 30 } });
    warn('sem stdin — mostrando demo:');
  }
  let j = {};
  try { j = JSON.parse(raw); } catch {}
  const state = attachGit(adapter(j), cfg.features.git);
  console.log(render(state, cfg));
}

async function cmdWatch(opts) {
  // EXPERIMENTAL: poller pro OpenCode. Endpoint pode variar por versao.
  const port = opts.port || 4096;
  const url = opts.url || `http://127.0.0.1:${port}/session`;
  const cfg = loadConfig(opts.config);
  warn(`[experimental] OpenCode watch: GET ${url} a cada ${opts.interval || 2}s`);
  const interval = (parseInt(opts.interval, 10) || 2) * 1000;
  const tick = async () => {
    try {
      const r = await fetch(url);
      const j = await r.json();
      const state = fromOpenCode(Array.isArray(j) ? j[0] : j);
      process.stdout.write('\r\x1b[K' + render(state, cfg));
    } catch (e) {
      process.stdout.write('\r\x1b[K' + C.dim + 'moodline: aguardando OpenCode em ' + url + C.reset);
    }
  };
  await tick();
  setInterval(tick, interval);
}

function cmdHelp() {
  console.log(`${C.bold}\u{1F33F}  moodline${C.reset} v${PKG.version} — statusline divertida pra CLIs de IA

${C.bold}Uso:${C.reset}
  npx moodline <comando> [opcoes]

${C.bold}Comandos:${C.reset}
  init           Configura a statusline nas CLIs detectadas (Claude Code, Copilot CLI)
  render         Le JSON no stdin e imprime a barra (pra testar)
  doctor         Mostra o que esta instalado e configurado
  uninstall      Remove a statusLine das CLIs
  watch          [experimental] Poller pro OpenCode -> stdout (use num painel tmux)

${C.bold}Opcoes do init:${C.reset}
  --all                  Configura Claude Code E Copilot CLI
  --claude / --copilot   So a CLI escolhida
  --features=git,cost    Liga so essas features (git,cost,rate,puns)
  --no-puns --no-rate    Desliga uma feature especifica
  --multi                Layout em 2 linhas

${C.bold}Exemplos:${C.reset}
  npx moodline init
  npx moodline init --all --no-rate
  echo '{"model":{"display_name":"Opus"},"context_window":{"used_percentage":92,"total_input_tokens":184000}}' | npx moodline render
`);
}

// --------- dispatch ---------
const argv = process.argv.slice(2);
const opts = parseArgs(argv);
const cmd = opts._[0] || (opts.version ? 'version' : opts.help ? 'help' : 'help');

switch (cmd) {
  case 'init': cmdInit(opts); break;
  case 'uninstall': cmdUninstall(opts); break;
  case 'doctor': cmdDoctor(); break;
  case 'render': cmdRender(opts); break;
  case 'watch': await cmdWatch(opts); break;
  case 'version': console.log(PKG.version); break;
  case 'help':
  default: cmdHelp(); break;
}
