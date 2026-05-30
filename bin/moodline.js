#!/usr/bin/env node
// moodline — instalador/CLI. Escopo de instalacao SEMPRE global (user-level).
//
//   moodline init               wizard interativo (logo animado + seletor de CLIs/features)
//   moodline enable [--all]     liga a statusline (Claude Code / Copilot CLI)
//   moodline disable [--all]    desliga (mantem config; re-enable instantaneo)
//   moodline doctor             mostra estado
//   moodline uninstall [--purge] remove a statusLine (e o engine com --purge)
//   moodline render             le JSON no stdin e imprime a barra (teste)
//   moodline watch              [experimental] poller pro OpenCode
//   moodline --help|--version

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, ADAPTERS, attachGit, loadConfig, fromOpenCode } from '../lib/moodline-core.mjs';
import * as ui from '../lib/ui.mjs';
import { printLogo, smallLogo } from '../lib/logo.mjs';
import * as install from '../lib/install.mjs';

const C = ui.C;
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));

function parseArgs(argv) {
  const o = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); o[k] = v === undefined ? true : v; }
    else o._.push(a);
  }
  return o;
}

const ALL_FEATURES = ['git', 'cost', 'rate', 'puns'];

async function cmdInit(opts) {
  await printLogo({ animate: ui.isInteractive() && !opts['no-anim'] });
  const home = opts.home;
  const detected = install.detectInstalled(home);
  const interactive = ui.isInteractive() && !opts.yes && !opts['no-input'];

  let keys, features, layout;
  if (interactive) {
    const cliChoices = detected.map((d) => ({
      name: d.present ? d.label : `${d.label} ${C.dim}(não detectado)${C.reset}`,
      value: d.key, checked: d.present,
    }));
    keys = await ui.multiselect('Em quais CLIs instalar a statusline?', cliChoices);
    if (!keys.length) { console.log(`${C.yellow}Nada selecionado. Saindo.${C.reset}`); return; }

    features = await ui.multiselect('Quais extras ligar?', [
      { name: 'Git — branch + estado (dirty/ahead/behind)', value: 'git', checked: true },
      { name: 'Custo USD + tempo + linhas +/-', value: 'cost', checked: true },
      { name: 'Rate limits 5h/7d (Claude Pro/Max)', value: 'rate', checked: true },
      { name: 'Trocadilhos de dev 💬', value: 'puns', checked: true },
    ]);
    layout = await ui.select('Layout da barra?', [
      { name: 'Uma linha (compacto)', value: 'single' },
      { name: 'Duas linhas (mais informação)', value: 'multi' },
    ]);
  } else {
    keys = ['claude', 'copilot'].filter((k) => opts[k] || opts.all);
    if (!keys.length) keys = detected.filter((d) => d.present || d.key === 'claude').map((d) => d.key);
    features = typeof opts.features === 'string'
      ? opts.features.split(',').map((s) => s.trim()).filter(Boolean)
      : ALL_FEATURES.filter((k) => !opts[`no-${k}`]);
    layout = opts.multi ? 'multi' : 'single';
  }

  console.log();
  for (const key of keys) {
    const t = install.targets(home)[key];
    const sp = ui.spinner(`Configurando ${t.label}…`);
    try { install.configure(key, { features, layout, home }); sp.stop(true, `${t.label} ${C.green}pronto${C.reset}`); }
    catch (e) { sp.stop(false, `${t.label}: ${e.message}`); }
  }
  postInstall(keys);
}

function postInstall(keys) {
  console.log(`\n${C.green}✓ Instalado${C.reset} (global, user-level). Abra uma sessão da CLI pra ver a barra.`);
  if (keys.includes('copilot')) {
    console.log(`${C.yellow}!${C.reset} Copilot CLI: statusLine é experimental — se não aparecer, rode ${C.cyan}/experimental${C.reset} ou reinicie.`);
  }
  console.log(`\n${C.dim}Ligar/desligar quando quiser:${C.reset}`);
  console.log(`  ${C.cyan}moodline disable${C.reset}   ${C.dim}# desliga (mantém config)${C.reset}`);
  console.log(`  ${C.cyan}moodline enable${C.reset}    ${C.dim}# liga de novo${C.reset}`);
  console.log(`\n${C.dim}Teste agora:${C.reset} ${C.cyan}moodline render${C.reset}`);
}

function resolveKeys(opts, needConfigured) {
  let keys = ['claude', 'copilot'].filter((k) => opts[k] || opts.all);
  if (!keys.length) {
    const det = install.detectInstalled(opts.home);
    keys = det.filter((d) => (needConfigured ? d.engine || d.wired : d.present)).map((d) => d.key);
  }
  return keys;
}

function cmdToggle(opts, enabled) {
  const keys = resolveKeys(opts, true);
  if (!keys.length) { console.log(`${C.yellow}Nada configurado.${C.reset} Rode ${C.cyan}moodline init${C.reset}.`); return; }
  for (const key of keys) {
    const t = install.targets(opts.home)[key];
    try { install.setEnabled(key, enabled, { home: opts.home }); console.log(`${C.green}✓${C.reset} ${t.label}: statusline ${enabled ? 'habilitada' : 'desabilitada'}`); }
    catch (e) { console.log(`${C.yellow}!${C.reset} ${e.message}`); }
  }
}

function cmdUninstall(opts) {
  const keys = resolveKeys(opts, true);
  if (!keys.length) { console.log('Nada pra remover.'); return; }
  for (const key of keys) {
    const t = install.targets(opts.home)[key];
    const r = install.uninstall(key, { home: opts.home, purge: opts.purge });
    console.log(`${C.green}✓${C.reset} ${t.label}: ${r.had ? 'statusLine removida' : 'nada na statusLine'}${opts.purge ? ' + engine apagado' : ''}`);
  }
}

function cmdDoctor(opts) {
  console.log(`${smallLogo()} ${C.dim}v${PKG.version}${C.reset}\n`);
  for (const d of install.detectInstalled(opts.home)) {
    const state = d.wired ? `${C.green}ativa${C.reset}` : d.engine ? `${C.yellow}configurada, desligada${C.reset}` : `${C.dim}não instalada${C.reset}`;
    console.log(`${C.bold}${d.label}${C.reset}`);
    console.log(`  dir detectado: ${d.present ? 'sim' : 'não'}   statusline: ${state}`);
  }
}

function cmdRender(opts) {
  const adapter = ADAPTERS[(opts.adapter || 'claude').toLowerCase()] || ADAPTERS.claude;
  const cfg = loadConfig(opts.config);
  for (const k of ALL_FEATURES) if (opts[`no-${k}`]) cfg.features[k] = false;
  if (opts.multi) cfg.layout = 'multi';
  if (opts.width) cfg.width = parseInt(opts.width, 10) || undefined;

  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch {}
  if (!raw.trim()) {
    console.log(`${C.dim}sem stdin — demo:${C.reset}`);
    raw = JSON.stringify({ model: { display_name: 'Opus' }, effort: { level: 'high' }, context_window: { used_percentage: 42, total_input_tokens: 84000 }, cost: { total_cost_usd: 0.12, total_duration_ms: 320000, total_lines_added: 120, total_lines_removed: 30 } });
  }
  let j = {}; try { j = JSON.parse(raw); } catch {}
  console.log(render(attachGit(adapter(j), cfg.features.git), cfg));
}

async function cmdWatch(opts) {
  const url = opts.url || `http://127.0.0.1:${opts.port || 4096}/session`;
  const cfg = loadConfig(opts.config);
  const interval = (parseInt(opts.interval, 10) || 2) * 1000;
  console.log(`${C.yellow}[experimental]${C.reset} OpenCode watch: GET ${url}`);
  const tick = async () => {
    try {
      const r = await fetch(url);
      const j = await r.json();
      process.stdout.write('\r\x1b[K' + render(fromOpenCode(Array.isArray(j) ? j[0] : j), cfg));
    } catch { process.stdout.write(`\r\x1b[K${C.dim}aguardando OpenCode em ${url}${C.reset}`); }
  };
  await tick();
  setInterval(tick, interval);
}

function cmdHelp() {
  console.log(`${smallLogo()} ${C.dim}v${PKG.version}${C.reset} — statusline divertida pra CLIs de IA

${C.bold}Uso:${C.reset} npx moodline <comando> [opções]

${C.bold}Comandos:${C.reset}
  ${C.cyan}init${C.reset}        Wizard de instalação (interativo) — escopo global
  ${C.cyan}enable${C.reset}      Liga a statusline   ${C.dim}[--all | --claude | --copilot]${C.reset}
  ${C.cyan}disable${C.reset}     Desliga (mantém config; re-enable instantâneo)
  ${C.cyan}doctor${C.reset}      Mostra o que está instalado e ligado
  ${C.cyan}uninstall${C.reset}   Remove a statusLine ${C.dim}[--purge apaga o engine]${C.reset}
  ${C.cyan}render${C.reset}      Lê JSON no stdin e imprime a barra (teste)
  ${C.cyan}watch${C.reset}       [experimental] Poller pro OpenCode → stdout

${C.bold}init não-interativo:${C.reset}
  --all | --claude | --copilot     escolhe a(s) CLI(s)
  --features=git,cost,rate,puns    liga só essas
  --no-puns --no-rate              desliga uma feature
  --multi                          layout em 2 linhas
  --yes                            pula o wizard (usa defaults/flags)

${C.bold}Exemplo:${C.reset}
  echo '{"model":{"display_name":"Opus"},"context_window":{"used_percentage":92,"total_input_tokens":184000}}' | npx moodline render
`);
}

const opts = parseArgs(process.argv.slice(2));
const cmd = opts._[0] || (opts.version ? 'version' : 'help');
switch (cmd) {
  case 'init': await cmdInit(opts); break;
  case 'enable': cmdToggle(opts, true); break;
  case 'disable': cmdToggle(opts, false); break;
  case 'uninstall': cmdUninstall(opts); break;
  case 'doctor': cmdDoctor(opts); break;
  case 'render': cmdRender(opts); break;
  case 'watch': await cmdWatch(opts); break;
  case 'version': console.log(PKG.version); break;
  default: cmdHelp();
}
