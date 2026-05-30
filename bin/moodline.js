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
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, ADAPTERS, attachGit, loadConfig, fromOpenCode, cmpVer } from '../lib/moodline-core.mjs';
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

async function cmdDoctor(opts) {
  console.log(`${smallLogo()} ${C.dim}v${PKG.version}${C.reset}\n`);
  for (const d of install.detectInstalled(opts.home)) {
    const state = d.wired ? `${C.green}ativa${C.reset}` : d.engine ? `${C.yellow}configurada, desligada${C.reset}` : `${C.dim}não instalada${C.reset}`;
    console.log(`${C.bold}${d.label}${C.reset}`);
    console.log(`  dir detectado: ${d.present ? 'sim' : 'não'}   statusline: ${state}`);
  }
  const latest = await install.fetchLatest();
  if (latest && cmpVer(latest, PKG.version) > 0) console.log(`\n${C.yellow}⬆ atualização disponível:${C.reset} v${PKG.version} → v${latest}   rode ${C.cyan}moodline update${C.reset}`);
  else if (latest) console.log(`\n${C.green}✓ na última versão${C.reset} (v${PKG.version})`);
}

async function cmdUpdate(opts) {
  const latest = await install.fetchLatest();
  const cur = PKG.version;
  if (latest && cmpVer(latest, cur) <= 0 && !opts.force) { console.log(`${C.green}✓${C.reset} moodline já está na última versão (v${cur}).`); return; }
  console.log(`${C.cyan}↑${C.reset} Atualizando moodline ${cur} → ${latest || 'latest'}…`);
  // versao EXATA (nao @latest): burla o cache do dist-tag 'latest' do npm logo apos um release
  const target = latest ? `moodline@${latest}` : 'moodline@latest';
  const sp = ui.spinner(`npm i -g ${target}`);
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'; // evita shell:true (DEP0190)
  const r = spawnSync(npmCmd, ['i', '-g', target], { stdio: 'ignore' });
  sp.stop(r.status === 0, r.status === 0 ? 'pacote global atualizado' : `npm i -g ${target} falhou — rode manualmente`);
  for (const key of install.configuredKeys(opts.home)) {
    try { install.refreshEngine(key, opts.home); console.log(`${C.green}✓${C.reset} ${install.targets(opts.home)[key].label}: engine atualizado`); }
    catch (e) { console.log(`${C.yellow}!${C.reset} ${e.message}`); }
  }
  console.log(`${C.green}Pronto.${C.reset} A barra usa a nova versão no próximo refresh.`);
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

const featLabel = (f) => ({ git: 'Git — branch + estado', cost: 'Custo + tempo + linhas', rate: 'Rate limits 5h/7d', puns: 'Trocadilhos 💬' }[f] || f);
function barPreview(n) {
  const full = Math.round(n * 0.4);
  const edge = Math.min(2, Math.max(0, n - full));
  return '[' + '█'.repeat(full) + '▒'.repeat(edge) + '░'.repeat(Math.max(0, n - full - edge)) + ']';
}
function applyConfigFlags(cfg, opts) {
  const list = (v) => String(v).split(',').map((s) => s.trim()).filter(Boolean);
  if (opts.on) for (const f of list(opts.on)) if (ALL_FEATURES.includes(f)) cfg.features[f] = true;
  if (opts.off) for (const f of list(opts.off)) if (ALL_FEATURES.includes(f)) cfg.features[f] = false;
  if (opts.toggle) for (const f of list(opts.toggle)) if (ALL_FEATURES.includes(f)) cfg.features[f] = !cfg.features[f];
  if (opts.bar !== undefined) cfg.bar = { width: parseInt(opts.bar, 10) || 10 };
  if (opts.layout) cfg.layout = opts.layout === 'multi' ? 'multi' : 'single';
  if (opts.rotate) cfg.punRotateMs = parseInt(opts.rotate, 10) || 30000;
}

async function cmdConfig(opts) {
  const home = opts.home;
  let keys = ['claude', 'copilot'].filter((k) => opts[k]);
  if (opts.cli) keys = opts.cli === 'all' ? ['claude', 'copilot'] : [opts.cli];
  if (!keys.length) keys = install.configuredKeys(home);
  keys = keys.filter((k) => install.readConfigFile(k, home));
  if (!keys.length) { console.log(`${C.yellow}Nada configurado.${C.reset} Rode ${C.cyan}moodline init${C.reset}.`); return; }

  if (opts.show) {
    for (const key of keys) {
      const t = install.targets(home)[key];
      const cfg = install.readConfigFile(key, home);
      const on = ALL_FEATURES.filter((f) => cfg.features?.[f]);
      const off = ALL_FEATURES.filter((f) => !cfg.features?.[f]);
      console.log(`${C.bold}${t.label}${C.reset}`);
      console.log(`  ligados:    ${on.length ? C.green + on.join(', ') + C.reset : C.dim + '—' + C.reset}`);
      console.log(`  desligados: ${off.length ? C.dim + off.join(', ') + C.reset : C.dim + '—' + C.reset}`);
      console.log(`  barra: ${cfg.bar?.width ?? 10} ${C.dim}${barPreview(cfg.bar?.width ?? 10)}${C.reset}   layout: ${cfg.layout || 'single'}`);
    }
    return;
  }

  const flagMode = opts.toggle || opts.on || opts.off || opts.bar !== undefined || opts.layout || opts.rotate;
  const interactive = ui.isInteractive() && !flagMode && !opts.yes;
  let patch = null;
  if (interactive) {
    const base = install.readConfigFile(keys[0], home);
    const feats = await ui.multiselect('O que mostrar na barra?', ALL_FEATURES.map((f) => ({ name: featLabel(f), value: f, checked: !!base.features?.[f] })));
    const sizes = [8, 10, 12, 16, 20];
    const bar = await ui.select('Tamanho da barra?', sizes.map((n) => ({ name: `${n}  ${barPreview(n)}`, value: n })), Math.max(0, sizes.indexOf(base.bar?.width ?? 10)));
    const layout = await ui.select('Layout?', [{ name: 'Uma linha (compacto)', value: 'single' }, { name: 'Duas linhas', value: 'multi' }], base.layout === 'multi' ? 1 : 0);
    patch = { features: Object.fromEntries(ALL_FEATURES.map((f) => [f, feats.includes(f)])), bar: { width: bar }, layout };
  }

  for (const key of keys) {
    const cfg = install.readConfigFile(key, home);
    cfg.features = cfg.features || {};
    if (interactive) { Object.assign(cfg.features, patch.features); cfg.bar = patch.bar; cfg.layout = patch.layout; }
    else applyConfigFlags(cfg, opts);
    install.writeConfigFile(key, cfg, home);
    const t = install.targets(home)[key];
    console.log(`${C.green}✓${C.reset} ${t.label}: ${ALL_FEATURES.filter((f) => cfg.features[f]).join(', ') || '(nada)'} ${C.dim}· barra ${cfg.bar?.width ?? 10} · ${cfg.layout || 'single'}${C.reset}`);
  }
  console.log(`${C.dim}A barra atualiza no próximo refresh — sem reiniciar.${C.reset}`);
}

function cmdHelp() {
  console.log(`${smallLogo()} ${C.dim}v${PKG.version}${C.reset} — statusline divertida pra CLIs de IA

${C.bold}Uso:${C.reset} npx moodline <comando> [opções]

${C.bold}Comandos:${C.reset}
  ${C.cyan}init${C.reset}        Wizard de instalação (interativo) — escopo global
  ${C.cyan}enable${C.reset}      Liga a statusline   ${C.dim}[--all | --claude | --copilot]${C.reset}
  ${C.cyan}disable${C.reset}     Desliga (mantém config; re-enable instantâneo)
  ${C.cyan}config${C.reset}      Escolhe o que aparece (menu ou flags) — atualiza ao vivo
              ${C.dim}--show · --toggle=git · --on=a,b · --off=c · --bar=10 · --layout=multi · --cli=claude|copilot|all${C.reset}
  ${C.cyan}doctor${C.reset}      Mostra o que está instalado, ligado e se há update
  ${C.cyan}update${C.reset}      Atualiza o moodline (npm global + engine das CLIs)
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
  case 'config': await cmdConfig(opts); break;
  case 'uninstall': cmdUninstall(opts); break;
  case 'update': await cmdUpdate(opts); break;
  case 'doctor': await cmdDoctor(opts); break;
  case 'render': cmdRender(opts); break;
  case 'watch': await cmdWatch(opts); break;
  case 'version': console.log(PKG.version); break;
  default: cmdHelp();
}
