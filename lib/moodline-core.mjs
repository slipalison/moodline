// moodline-core.mjs — engine da statusline (zero dependencias, ESM puro)
//
// Roda de dois jeitos:
//   1) Importado pelo bin/CLI (exporta render, adapters, DEFAULT_CFG).
//   2) Executado direto pela CLI de IA: le JSON no stdin, imprime a barra no stdout.
//      Ex.: node moodline-core.mjs --adapter=claude --config=/caminho/config.json
//
// Este arquivo e copiado para ~/.claude/moodline/ (e ~/.copilot/moodline/) no `moodline init`,
// e o settings.json da CLI aponta direto pra ca. Mantido auto-contido de proposito: sem
// imports entre arquivos, so node built-ins, pra poder ser copiado sozinho e rodar rapido.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { PUNS } from './puns.mjs';

// ---------------- ANSI ----------------
const ESC = '\x1b';
const RESET = `${ESC}[0m`;
const DIM = `${ESC}[2m`;
const CYAN = `${ESC}[36m`;
const MAGENTA = `${ESC}[35m`;
const GREEN = `${ESC}[32m`;
const RED = `${ESC}[31m`;
const YELLOW = `${ESC}[33m`;
const truecolor = (r, g, b) => `${ESC}[38;2;${r};${g};${b}m`;

// ---------------- config padrao ----------------
export const DEFAULT_CFG = {
  layout: 'single',          // 'single' | 'multi'
  bar: { width: 20 },
  punRotateMs: 30000,        // troca o trocadilho a cada ~30s
  features: {
    git: true,               // branch + estado (dirty/ahead/behind)
    cost: true,              // custo USD + tempo + linhas +/-
    rate: true,              // rate limits 5h/7d (Claude Pro/Max)
    puns: true,              // trocadilhos rotativos de dev
  },
};

// ---------------- gradiente HSL (verde 120 -> vermelho 0) ----------------
function gradColor(pct) {
  let h = (120 * (100 - pct)) / 100;
  if (h < 0) h = 0;
  if (h > 120) h = 120;
  let r, g, b;
  if (h < 60) { r = 255; g = (255 * h) / 60; b = 0; }
  else { r = (255 * (120 - h)) / 60; g = 255; b = 0; }
  return truecolor(Math.round(r), Math.round(g), Math.round(b));
}

// ---------------- barra (cheio / borda / vazio) ----------------
function bar(pct, width = 20) {
  let full = Math.floor((pct * width) / 100);
  if (full > width) full = width;
  let edge = 0;
  if (full < width && pct > 0) {
    edge = 2;
    if (full + edge > width) edge = width - full;
  }
  const empty = Math.max(0, width - full - edge);
  return '█'.repeat(full) + '▒'.repeat(edge) + '░'.repeat(empty);
}

// ---------------- emoji-humor pela ocupacao ----------------
function mood(p) {
  if (p >= 90) return '\u{1F480}'; // caveira
  if (p >= 75) return '\u{1F975}'; // rosto quente
  if (p >= 50) return '\u{1F605}'; // suando
  if (p >= 25) return '\u{1F642}'; // sorriso leve
  return '\u{1F60E}';              // de boa
}

// ---------------- trocadilhos de dev (lista em ./puns.mjs) ----------------
// Rotaciona devagar (por janela de tempo) pra mudar sem piscar. `extra` permite
// adicionar trocadilhos via config.json sem editar o engine.
function pickPun(rotateMs, extra = []) {
  const pool = Array.isArray(extra) && extra.length ? PUNS.concat(extra) : PUNS;
  const idx = Math.floor(Date.now() / Math.max(1000, rotateMs)) % pool.length;
  return pool[idx];
}

// ---------------- formatadores ----------------
const ktok = (t) => `${Math.round((Number(t) || 0) / 1000)}k`;
function money(usd) {
  if (usd == null) return null;
  const n = Number(usd);
  if (!isFinite(n)) return null;
  const dec = n > 0 && n < 0.01 ? 3 : 2; // mostra centavos de centavo so quando minusculo
  return '$' + n.toFixed(dec);
}
function dur(ms) {
  if (ms == null) return null;
  const s = Math.floor(Number(ms) / 1000);
  if (!isFinite(s) || s < 0) return null;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

// ---------------- git ----------------
function gitInfo(cwd) {
  if (!cwd || !existsSync(cwd)) return null;
  const opt = { cwd, encoding: 'utf8', timeout: 250, stdio: ['ignore', 'pipe', 'ignore'] };
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opt).trim();
    if (!branch) return null;
    let dirty = false, ahead = 0, behind = 0;
    try { dirty = execFileSync('git', ['status', '--porcelain'], opt).trim().length > 0; } catch {}
    try {
      const lr = execFileSync('git', ['rev-list', '--left-right', '--count', '@{u}...HEAD'], opt)
        .trim().split(/\s+/);
      behind = Number(lr[0]) || 0;
      ahead = Number(lr[1]) || 0;
    } catch {}
    return { branch, dirty, ahead, behind };
  } catch {
    return null;
  }
}

// ---------------- medir largura visivel (ignora ANSI; emoji conta 2) ----------------
function vlen(s) {
  const t = s.replace(/\x1b\[[0-9;]*m/g, '');
  let n = 0;
  for (const ch of t) n += ch.codePointAt(0) > 0xffff ? 2 : 1;
  return n;
}

// ---------------- render ----------------
export function render(state, cfg = DEFAULT_CFG) {
  const f = cfg.features || {};
  const cols = cfg.width || parseInt(process.env.COLUMNS || '', 10) || 80;
  const c = gradColor(state.pct);

  // segmento principal (sempre presente): modelo + effort + barra + emoji + pct + tokens
  let core = `${CYAN}${state.model}${RESET}`;
  if (state.effort) core += ` ${DIM}${state.effort}${RESET}`;
  core += ` ${c}[${bar(state.pct, cfg.bar?.width ?? 20)}]${RESET}`;
  core += ` ${mood(state.pct)} ${c}${state.pct}%${RESET} ${DIM}${ktok(state.tokens)}${RESET}`;

  // segmentos opcionais (prioridade menor = sai por ultimo quando o terminal e estreito)
  const opt = [];

  if (f.git && state.git && state.git.branch) {
    let g = `${MAGENTA}\u{1F33F} ${state.git.branch}${RESET}`;
    const flags = [];
    if (state.git.dirty) flags.push(`${YELLOW}*${RESET}`);
    if (state.git.ahead) flags.push(`${GREEN}↑${state.git.ahead}${RESET}`);
    if (state.git.behind) flags.push(`${RED}↓${state.git.behind}${RESET}`);
    if (flags.length) g += ' ' + flags.join('');
    opt.push({ txt: g, prio: 1 });
  }

  if (f.cost) {
    const parts = [];
    const mo = money(state.costUsd);
    if (mo) parts.push(`\u{1F4B8} ${mo}`);
    const d = dur(state.durationMs);
    if (d) parts.push(`⏱ ${d}`);
    if (state.linesAdded != null || state.linesRemoved != null) {
      parts.push(`${GREEN}+${state.linesAdded || 0}${RESET}/${RED}-${state.linesRemoved || 0}${RESET}`);
    }
    if (parts.length) opt.push({ txt: parts.join(' '), prio: 2 });
  }

  if (f.rate && state.rate && (state.rate.five != null || state.rate.seven != null)) {
    const parts = [];
    if (state.rate.five != null) {
      const v = Math.round(state.rate.five);
      parts.push(`${gradColor(v)}5h ${v}%${RESET}`);
    }
    if (state.rate.seven != null) {
      const v = Math.round(state.rate.seven);
      parts.push(`${gradColor(v)}7d ${v}%${RESET}`);
    }
    opt.push({ txt: `⏳ ${parts.join(' ')}`, prio: 3 });
  }

  if (f.puns) {
    opt.push({ txt: `${DIM}\u{1F4AC} ${pickPun(cfg.punRotateMs ?? 30000, cfg.extraPuns)}${RESET}`, prio: 4 });
  }

  const sep = ` ${DIM}·${RESET} `;
  const sepLen = 3;

  if (cfg.layout === 'multi') {
    const line2 = opt.sort((a, b) => a.prio - b.prio).map((s) => s.txt).join(sep);
    return line2 ? `${core}\n${line2}` : core;
  }

  // single: encaixa o que couber na largura, dropando por prioridade
  let out = core;
  let used = vlen(core);
  for (const s of opt.sort((a, b) => a.prio - b.prio)) {
    const add = sepLen + vlen(s.txt);
    if (used + add <= cols - 1) { out += sep + s.txt; used += add; }
  }
  return out;
}

// ---------------- adapters (entrada bruta -> estado normalizado) ----------------
export function attachGit(state, useGit) {
  if (state.gitBranch) {
    state.git = { branch: state.gitBranch, dirty: false, ahead: 0, behind: 0 };
  } else if (useGit) {
    state.git = gitInfo(state.cwd);
  } else {
    state.git = null;
  }
  return state;
}

// Claude Code — schema oficial (code.claude.com/docs/en/statusline)
export function fromClaude(j) {
  const cw = j.context_window || {};
  const rl = j.rate_limits || null;
  return {
    model: j.model?.display_name || '?',
    effort: j.effort?.level || null,
    pct: Math.floor(Number(cw.used_percentage) || 0),
    tokens: Number(cw.total_input_tokens) || 0,
    ctxSize: cw.context_window_size || null,
    costUsd: j.cost?.total_cost_usd ?? null,
    durationMs: j.cost?.total_duration_ms ?? null,
    linesAdded: j.cost?.total_lines_added ?? null,
    linesRemoved: j.cost?.total_lines_removed ?? null,
    rate: rl ? { five: rl.five_hour?.used_percentage ?? null, seven: rl.seven_day?.used_percentage ?? null } : null,
    cwd: j.workspace?.current_dir || j.cwd || null,
    gitBranch: null, // Claude nao manda branch; calculamos via git
    repo: j.workspace?.repo || null,
  };
}

// GitHub Copilot CLI — schema espelha o do Claude Code (statusLine experimental)
export function fromCopilot(j) {
  const cw = j.context_window || {};
  return {
    model: j.model?.display_name || '?',
    effort: j.effort?.level || j.model?.effort || null,
    pct: Math.floor(Number(cw.used_percentage) || 0),
    tokens: Number(cw.total_input_tokens ?? cw.current_context_tokens) || 0,
    ctxSize: cw.context_window_size || cw.displayed_context_limit || null,
    costUsd: j.cost?.total_cost_usd ?? null,
    durationMs: j.cost?.total_duration_ms ?? null,
    linesAdded: j.cost?.total_lines_added ?? null,
    linesRemoved: j.cost?.total_lines_removed ?? null,
    rate: null,
    cwd: j.cwd || null,
    gitBranch: j.remote?.branch || null,
    repo: null,
  };
}

// OpenCode — EXPERIMENTAL. Sem statusLine nativa; alimentado pelo `moodline watch` (HTTP/SSE).
// Mapeamento tolerante; ajuste conforme a versao da API do OpenCode.
export function fromOpenCode(j) {
  const ctx = j.context || j.tokens || {};
  return {
    model: j.model?.name || j.model?.id || j.model || '?',
    effort: null,
    pct: Math.floor(Number(ctx.used_percentage ?? ctx.percentage ?? j.percentage) || 0),
    tokens: Number(ctx.input ?? ctx.tokens ?? j.input_tokens) || 0,
    ctxSize: ctx.limit || null,
    costUsd: j.cost ?? null,
    durationMs: null,
    linesAdded: null,
    linesRemoved: null,
    rate: null,
    cwd: j.directory || j.cwd || null,
    gitBranch: j.git?.branch || null,
    repo: null,
  };
}

// Gemini CLI — EXPERIMENTAL. Sem statusLine nativa por comando; passthroughgenerico de JSON
// caso o usuario ligue via hook/extensao. Veja docs do projeto.
export function fromGemini(j) {
  const cw = j.context_window || j.context || {};
  return {
    model: j.model?.display_name || j.model || '?',
    effort: null,
    pct: Math.floor(Number(cw.used_percentage ?? j.percentage) || 0),
    tokens: Number(cw.total_input_tokens ?? cw.tokens) || 0,
    ctxSize: cw.context_window_size || null,
    costUsd: null,
    durationMs: null,
    linesAdded: null,
    linesRemoved: null,
    rate: null,
    cwd: j.cwd || null,
    gitBranch: null,
    repo: null,
  };
}

export const ADAPTERS = {
  claude: fromClaude,
  copilot: fromCopilot,
  opencode: fromOpenCode,
  gemini: fromGemini,
};

// ---------------- util ----------------
function deepMerge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k])) {
      out[k] = deepMerge(base[k] || {}, over[k]);
    } else {
      out[k] = over[k];
    }
  }
  return out;
}

export function loadConfig(path) {
  let cfg = structuredClone(DEFAULT_CFG);
  if (path && existsSync(path)) {
    try { cfg = deepMerge(cfg, JSON.parse(readFileSync(path, 'utf8'))); } catch {}
  }
  return cfg;
}

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

// ---------------- main (so quando executado direto) ----------------
function readStdin() {
  if (process.stdin.isTTY) return '';
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

export function runMain(argv) {
  const args = parseArgs(argv);
  const adapterName = (args.adapter || 'claude').toLowerCase();
  const adapter = ADAPTERS[adapterName] || fromClaude;

  const cfg = loadConfig(args.config);
  if (args['no-git']) cfg.features.git = false;
  if (args['no-cost']) cfg.features.cost = false;
  if (args['no-rate']) cfg.features.rate = false;
  if (args['no-puns']) cfg.features.puns = false;
  if (args.multi) cfg.layout = 'multi';
  if (args.width) cfg.width = parseInt(args.width, 10) || undefined;

  let raw = {};
  try { raw = JSON.parse(readStdin() || '{}'); } catch { raw = {}; }

  try {
    const state = attachGit(adapter(raw), cfg.features.git);
    process.stdout.write(render(state, cfg) + '\n');
  } catch (e) {
    // statusline nunca deve quebrar a CLI: imprime algo minimo
    process.stdout.write(`${CYAN}${raw?.model?.display_name || 'moodline'}${RESET}\n`);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) runMain(process.argv.slice(2));
