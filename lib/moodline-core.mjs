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

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { PUNS } from './puns.mjs';
import { jdiSegment, jdiInProject, jdiInRuntime, jdiProjectVersion, globalJdiVersion, fetchJdiLatest } from './jdi.mjs';
import { safeDir, gitBin } from './pathguard.mjs';

const SELF_FILE = fileURLToPath(import.meta.url);
const SELF_DIR = dirname(SELF_FILE);

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
  bar: { width: 10 },
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
  if (full < 0) full = 0;
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
// rotulo da janela de contexto: 200000 -> "200k", 1000000 -> "1M" (revela Opus 1M vs 200k)
function capLabel(n) {
  if (n >= 1e6) { const m = n / 1e6; return `${Number.isInteger(m) ? m : m.toFixed(1)}M`; }
  return `${Math.round(n / 1000)}k`;
}
const tokLabel = (tokens, ctxSize) => (ctxSize ? `${ktok(tokens)}/${capLabel(ctxSize)}` : ktok(tokens));
function money(usd) {
  if (usd == null) return null;
  const n = Number(usd);
  if (!Number.isFinite(n)) return null;
  const dec = n > 0 && n < 0.01 ? 3 : 2; // mostra centavos de centavo so quando minusculo
  return '$' + n.toFixed(dec);
}
function dur(ms) {
  if (ms == null) return null;
  const s = Math.floor(Number(ms) / 1000);
  if (!Number.isFinite(s) || s < 0) return null;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

// ---------------- git ----------------
// `git` e `dir` chegam SEMPRE validados (gitBin = caminho absoluto, S4036; dir = safeDir, S8707).
// So a branch, timeout curto — fallback pra repo gigante onde o status estoura o tempo.
function gitBranchOnly(git, dir) {
  try {
    const opt = { cwd: dir, encoding: 'utf8', timeout: 250, stdio: ['ignore', 'pipe', 'ignore'] };
    const branch = execFileSync(git, ['rev-parse', '--abbrev-ref', 'HEAD'], opt).trim();
    return branch ? { branch, dirty: false, ahead: 0, behind: 0 } : null;
  } catch {
    return null;
  }
}

// 1 spawn em vez de 3: `--porcelain=v2 --branch` traz branch, ahead/behind e sujeira numa saida so.
// Seguranca: `cwd` (entrada externa) validado por safeDir; git por caminho absoluto (nunca do PATH).
// Exportada pra teste direto (e IO de leitura; a logica de parse fica coberta).
export function computeGitInfo(cwd) {
  const dir = safeDir(cwd);
  const git = gitBin();
  if (!dir || !git) return null;
  const opt = { cwd: dir, encoding: 'utf8', timeout: 500, stdio: ['ignore', 'pipe', 'ignore'] };
  try {
    // NOSONAR(S8707): `dir` validado por safeDir e `git` e caminho absoluto; cwd do proprio usuario.
    const out = execFileSync(git, ['status', '--porcelain=v2', '--branch'], opt); // NOSONAR
    let branch = null, ahead = 0, behind = 0, dirty = false;
    for (const line of out.split('\n')) {
      if (line.startsWith('# branch.head ')) branch = line.slice(14).trim();
      else if (line.startsWith('# branch.ab ')) {
        const m = /\+(\d+) -(\d+)/.exec(line);
        if (m) { ahead = Number(m[1]); behind = Number(m[2]); }
      } else if (line && !line.startsWith('#')) dirty = true; // qualquer entrada = worktree sujo
    }
    if (!branch) return null;
    return { branch: branch === '(detached)' ? 'HEAD' : branch, dirty, ahead, behind };
  } catch {
    return gitBranchOnly(git, dir); // status estourou (repo gigante)? mostra ao menos a branch
  }
}

// Cache em disco por chave (tmpdir), TTL curto. Cada refresh e um processo novo (sem memoria
// compartilhada): o cache em arquivo evita refazer IO pesado (git/varredura JDI) a cada refresh.
// `compute` so roda quando o cache expira.
function ttlCache(ns, key, ttlMs, compute) {
  const h = [...key].reduce((a, c) => (a * 31 + c.codePointAt(0)) >>> 0, 7).toString(36);
  const file = join(tmpdir(), `moodline-${ns}-${h}.json`);
  try { const c = JSON.parse(readFileSync(file, 'utf8')); if (Date.now() - c.at < ttlMs) return c.data; } catch {}
  const data = compute();
  try { writeFileSync(file, JSON.stringify({ at: Date.now(), data })); } catch {}
  return data;
}

// git: TTL 10s. Com refreshInterval 5s, o spawn de git roda no maximo 1x a cada 2 refreshes
// (TTL menor que o refresh faria recomputar SEMPRE — cache que nunca acerta).
function gitInfo(cwd) {
  if (!cwd) return null; // validacao real do caminho fica em computeGitInfo (safeDir)
  return ttlCache('git', cwd, 10000, () => computeGitInfo(cwd));
}

// JDI: deteccao (presenca + versao do projeto) varre a arvore de diretorios — caro. Muda raramente,
// entao TTL 60s. Evita statSync/readdirSync subindo ate a raiz do FS a cada refresh.
function jdiInfo(cwd) {
  if (!cwd) return { present: false, projectVersion: null };
  return ttlCache('jdi', cwd, 60000, () => ({
    present: jdiInProject(cwd) || jdiInRuntime(),
    projectVersion: jdiProjectVersion(cwd),
  }));
}

// ---------------- checagem de update (cacheada, nunca bloqueia o render) ----------------
// A barra so LE o cache (sync). A busca na rede roda num processo filho destacado,
// no maximo 1x/dia, disparado por `node moodline-core.mjs --update-check`.
const cachePath = () => process.env.MOODLINE_UPDATE_CACHE || join(SELF_DIR, '.update.json');
const DAY_MS = 86400000;
export function cmpVer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
function readUpdateCache() { try { return JSON.parse(readFileSync(cachePath(), 'utf8')); } catch { return null; } }
export function updateBadge(cfg, cache = readUpdateCache()) {
  if (!cfg.version) return null;
  return cache?.latest && cmpVer(cache.latest, cfg.version) > 0 ? cache.latest : null;
}
export function maybeSpawnCheck(cache = readUpdateCache()) {
  if (cache?.checkedAt && Date.now() - cache.checkedAt < DAY_MS) return; // ainda fresco
  try {
    // carimba ja pra evitar enxame de spawns durante o debounce de 300ms
    writeFileSync(cachePath(), JSON.stringify({ ...cache, checkedAt: Date.now() }));
    spawn(process.execPath, [SELF_FILE, '--update-check'], { detached: true, stdio: 'ignore' }).unref();
  } catch {}
}
export async function doUpdateCheck() {
  let latest = null;
  try {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 3000);
    const r = await fetch('https://registry.npmjs.org/moodline/latest', { signal: ac.signal });
    clearTimeout(to);
    if (r.ok) latest = (await r.json()).version || null;
  } catch {}
  let jdiLatest = null, jdiGlobal = null;
  try { jdiLatest = await fetchJdiLatest(); } catch {}
  try { jdiGlobal = globalJdiVersion(); } catch {}
  try { writeFileSync(cachePath(), JSON.stringify({ latest, checkedAt: Date.now(), jdiLatest, jdiGlobal })); } catch {}
}

// ---------------- medir largura visivel (ignora ANSI; emoji conta 2) ----------------
function vlen(s) {
  const t = s.replace(/\x1b\[[0-9;]*m/g, '');
  let n = 0;
  for (const ch of t) n += ch.codePointAt(0) > 0xffff ? 2 : 1;
  return n;
}

// ---------------- render ----------------
// Separador e ordenacao compartilhados pelos dois layouts.
const SEP = ` ${DIM}·${RESET} `;
const SEP_LEN = 3;
const byPrio = (a, b) => a.prio - b.prio;

// nucleo (sempre presente): modelo + effort + barra + emoji + pct + tokens
function coreSegment(state, cfg, c) {
  let s = `${CYAN}${state.model}${RESET}`;
  if (state.effort) s += ` ${DIM}${state.effort}${RESET}`;
  s += ` ${c}[${bar(state.pct, cfg.bar?.width ?? 20)}]${RESET}`;
  s += ` ${mood(state.pct)} ${c}${state.pct}%${RESET} ${DIM}${tokLabel(state.tokens, state.ctxSize)}${RESET}`;
  return s;
}

// Cada *Segment retorna { txt, prio, line } ou null. line define a linha no layout multi:
// linha 1 (com o nucleo) = metricas (update/custo/rate); linha 2 = contexto + diversao (git/JDI/puns).
function gitSegment(state) {
  if (!state.git?.branch) return null;
  let g = `${MAGENTA}\u{1F33F} ${state.git.branch}${RESET}`;
  const flags = [];
  if (state.git.dirty) flags.push(`${YELLOW}*${RESET}`);
  if (state.git.ahead) flags.push(`${GREEN}↑${state.git.ahead}${RESET}`);
  if (state.git.behind) flags.push(`${RED}↓${state.git.behind}${RESET}`);
  if (flags.length) g += ' ' + flags.join('');
  return { txt: g, prio: 1, line: 2 };
}

function costSegment(state) {
  const parts = [];
  const mo = money(state.costUsd);
  if (mo) parts.push(`\u{1F4B8} ${mo}`);
  const d = dur(state.durationMs);
  if (d) parts.push(`⏱ ${d}`);
  if (state.linesAdded != null || state.linesRemoved != null) {
    parts.push(`${GREEN}+${state.linesAdded || 0}${RESET}/${RED}-${state.linesRemoved || 0}${RESET}`);
  }
  return parts.length ? { txt: parts.join(' '), prio: 2, line: 1 } : null;
}

function rateSegment(state) {
  const r = state.rate;
  if (!r || (r.five == null && r.seven == null)) return null;
  const parts = [];
  if (r.five != null) { const v = Math.round(r.five); parts.push(`${gradColor(v)}5h ${v}%${RESET}`); }
  if (r.seven != null) { const v = Math.round(r.seven); parts.push(`${gradColor(v)}7d ${v}%${RESET}`); }
  return { txt: `⏳ ${parts.join(' ')}`, prio: 3, line: 1 };
}

function punSegment(cfg) {
  return { txt: `${DIM}\u{1F4AC} ${pickPun(cfg.punRotateMs ?? 30000, cfg.extraPuns)}${RESET}`, prio: 4, line: 2 };
}

// layout 'multi': nucleo + metricas na linha 1; resto na linha 2 (so se houver).
function layoutMulti(core, opt) {
  const l1 = opt.filter((s) => s.line === 1).toSorted(byPrio).map((s) => s.txt);
  const l2 = opt.filter((s) => s.line !== 1).toSorted(byPrio).map((s) => s.txt);
  const top = [core, ...l1].join(SEP);
  return l2.length ? `${top}\n${l2.join(SEP)}` : top;
}

// layout 'single': encaixa o que couber na largura, dropando por prioridade.
function layoutSingle(core, opt, cols) {
  let out = core, used = vlen(core);
  for (const s of opt.toSorted(byPrio)) {
    const add = SEP_LEN + vlen(s.txt);
    if (used + add <= cols - 1) { out += SEP + s.txt; used += add; }
  }
  return out;
}

export function render(state, cfg = DEFAULT_CFG) {
  const f = cfg.features || {};
  const cols = cfg.width || Number.parseInt(process.env.COLUMNS || '', 10) || 80;
  const core = coreSegment(state, cfg, gradColor(state.pct));

  // Cada entrada e `condicao && segmento` (ou false); filter(Boolean) descarta os ausentes.
  // O anuncio do JDI (state.jdi.ad) ocupa o slot do trocadilho.
  const opt = [
    state.update && { txt: `${MAGENTA}⬆ v${state.update}${RESET}`, prio: 1, line: 1 },
    state.jdi && { txt: state.jdi.txt, prio: state.jdi.ad ? 4 : 1, line: 2 },
    f.git && gitSegment(state),
    f.cost && costSegment(state),
    f.rate && rateSegment(state),
    f.puns && !state.jdi?.ad && punSegment(cfg),
  ].filter(Boolean);

  return cfg.layout === 'multi' ? layoutMulti(core, opt) : layoutSingle(core, opt, cols);
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
// Le stdin via STREAM, nao `readFileSync(0)` bloqueante. CAUSA-RAIZ dos processos orfaos no Windows:
// o pipe de stdin do Claude Code as vezes NUNCA manda EOF -> o read sincrono trava pra sempre
// (event loop congelado), o processo nao sai e acumula ("Suspended"). Aqui o watchdog GARANTE a
// resolucao em <=timeoutMs mesmo sem EOF. `stdin`/`timeoutMs` sao injetaveis pra teste (DIP).
// Watchdog REF'd de proposito: e o que mantem o loop vivo ate resolver; no caminho normal o 'end'
// limpa o timer na hora (sem latencia extra). unref'd quebrava com stream mockado (loop esvazia
// antes do timer: "Promise resolution is still pending but the event loop has already resolved").
export function readStdin(stdin = process.stdin, timeoutMs = 1500) {
  if (stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    let data = '', done = false;
    const finish = (val) => { if (!done) { done = true; resolve(val); } };
    const watchdog = setTimeout(() => finish(data), timeoutMs);
    try {
      stdin.setEncoding('utf8');
      stdin.on('data', (c) => { data += c; });
      stdin.on('end', () => { clearTimeout(watchdog); finish(data); });
      stdin.on('error', () => { clearTimeout(watchdog); finish(data); });
      stdin.resume();
    } catch { clearTimeout(watchdog); finish(''); }
  });
}

// Logica pura (sem IO): texto bruto + args -> linha pronta. Testavel isoladamente.
export function buildLine(rawText, args = {}) {
  const adapter = ADAPTERS[(args.adapter || 'claude').toLowerCase()] || fromClaude;
  const cfg = loadConfig(args.config);
  if (args['no-git']) cfg.features.git = false;
  if (args['no-cost']) cfg.features.cost = false;
  if (args['no-rate']) cfg.features.rate = false;
  if (args['no-puns']) cfg.features.puns = false;
  if (args.multi) cfg.layout = 'multi';
  if (args.width) cfg.width = Number.parseInt(args.width, 10) || undefined;

  let raw = {};
  try { raw = JSON.parse(rawText || '{}'); } catch { raw = {}; }
  try {
    const cache = readUpdateCache() || {}; // le o cache de update UMA vez por refresh (era 3x)
    const state = attachGit(adapter(raw), cfg.features.git);
    state.update = updateBadge(cfg, cache);
    const jdi = jdiInfo(state.cwd);    // deteccao cacheada (TTL 60s) — evita varrer o FS a cada refresh
    state.jdi = jdiSegment({ cwd: state.cwd, present: jdi.present, projectVersion: jdi.projectVersion, cache, rotateMs: cfg.punRotateMs ?? 30000, cmpVer, colors: { MAGENTA, CYAN, DIM, RESET } });
    maybeSpawnCheck(cache);            // dispara busca em background no maximo 1x/dia
    return render(state, cfg);
  } catch {
    return `${CYAN}${raw?.model?.display_name || 'moodline'}${RESET}`; // statusline nunca quebra
  }
}

// Entry point IO: le stdin, escreve stdout. Sempre termina o processo explicitamente — nenhum
// caminho pode deixar o node vivo (= orfao). async pq a leitura de stdin agora e por stream.
export async function runMain(argv) {
  const args = parseArgs(argv);
  if (args['update-check']) {
    // Processo filho destacado: faz a busca, GRAVA o cache e MORRE na hora. O process.exit fecha
    // o pool keep-alive do fetch (undici) que, sozinho, manteria o node pendurado por segundos
    // (= "processo orfao"). Watchdog garante saida mesmo se a rede travar.
    const watchdog = setTimeout(() => process.exit(0), 8000); watchdog.unref();
    doUpdateCheck().finally(() => process.exit(0));
    return;
  }
  const raw = await readStdin();
  // Rede de seguranca: sai em <=300ms mesmo se algum keep-alive (undici/timer) segurar o event loop.
  const safety = setTimeout(() => process.exit(0), 300); safety.unref();
  process.stdout.write(buildLine(raw, args) + '\n', () => process.exit(0));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  // top-level await: nunca deixa a promessa pendurar; erro -> saida limpa.
  try { await runMain(process.argv.slice(2)); }
  catch { process.exit(1); }
}
