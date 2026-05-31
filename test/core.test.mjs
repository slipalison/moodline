// Testes do engine (render + adapters + formatadores + update). node:test, zero deps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  render, buildLine, fromClaude, fromCopilot, fromOpenCode, fromGemini,
  attachGit, loadConfig, cmpVer, updateBadge, maybeSpawnCheck, doUpdateCheck, DEFAULT_CFG,
} from '../lib/moodline-core.mjs';

// Cache de update "fresco" por padrão → buildLine() não dispara processo filho nos testes.
const FRESH_DIR = mkdtempSync(join(tmpdir(), 'mood-fresh-'));
const FRESH = join(FRESH_DIR, 'u.json');
writeFileSync(FRESH, JSON.stringify({ checkedAt: Date.now() }));
process.env.MOODLINE_UPDATE_CACHE = FRESH;

const wide = (over = {}) => ({ ...structuredClone(DEFAULT_CFG), width: 200, ...over });
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

const claudeJson = {
  model: { display_name: 'Opus' }, effort: { level: 'high' },
  context_window: { used_percentage: 92, total_input_tokens: 184000, context_window_size: 200000 },
  cost: { total_cost_usd: 0.42, total_duration_ms: 325000, total_lines_added: 120, total_lines_removed: 30 },
  rate_limits: { five_hour: { used_percentage: 42 }, seven_day: { used_percentage: 13 } },
  workspace: { current_dir: process.cwd(), repo: { name: 'moodline' } },
};

test('fromClaude normaliza todos os campos', () => {
  const s = fromClaude(claudeJson);
  assert.equal(s.model, 'Opus'); assert.equal(s.effort, 'high');
  assert.equal(s.pct, 92); assert.equal(s.tokens, 184000); assert.equal(s.ctxSize, 200000);
  assert.equal(s.costUsd, 0.42); assert.equal(s.durationMs, 325000);
  assert.equal(s.linesAdded, 120); assert.equal(s.linesRemoved, 30);
  assert.equal(s.rate.five, 42); assert.equal(s.rate.seven, 13);
});

test('fromClaude com context_window vazio e sem model', () => {
  const s = fromClaude({ context_window: {} });
  assert.equal(s.pct, 0); assert.equal(s.tokens, 0); assert.equal(s.rate, null);
  assert.equal(s.effort, null); assert.equal(s.model, '?');
});

test('fromCopilot mapeia branch, current_context_tokens e displayed_context_limit', () => {
  const s = fromCopilot({ model: { display_name: 'GPT-5' }, context_window: { used_percentage: 25, current_context_tokens: 50000, displayed_context_limit: 128000 }, remote: { branch: 'main' }, cwd: '/x' });
  assert.equal(s.model, 'GPT-5'); assert.equal(s.pct, 25); assert.equal(s.tokens, 50000);
  assert.equal(s.ctxSize, 128000); assert.equal(s.gitBranch, 'main'); assert.equal(s.rate, null);
});

test('fromOpenCode e fromGemini toleram shapes variados', () => {
  assert.equal(fromOpenCode({ model: { name: 'Qwen' }, context: { used_percentage: 50, input: 9 } }).model, 'Qwen');
  assert.equal(fromOpenCode({ model: 'Plain' }).model, 'Plain');
  assert.equal(fromOpenCode({}).model, '?');
  assert.equal(fromGemini({ model: 'Gemini', context_window: { used_percentage: 10, tokens: 100 } }).pct, 10);
  assert.equal(fromGemini({}).model, '?');
});

test('render: núcleo tem modelo, %, tokens e barra', () => {
  const out = render(fromClaude(claudeJson), wide());
  assert.match(out, /Opus/); assert.match(out, /92%/); assert.match(out, /184k/); assert.match(out, /█/);
});

test('tokens revelam a janela de contexto (200k vs 1M)', () => {
  assert.match(strip(render(fromClaude(claudeJson), wide())), /184k\/200k/);
  const big = { ...claudeJson, context_window: { used_percentage: 48, total_input_tokens: 477000, context_window_size: 1000000 } };
  assert.match(strip(render(fromClaude(big), wide())), /477k\/1M/);
  assert.doesNotMatch(strip(render({ model: 'M', pct: 10, tokens: 5000 }, wide({ features: {} }))), /5k\//);
});

test('emoji-humor cobre todas as faixas (😎🙂😅🥵💀)', () => {
  const m = (p) => strip(render({ model: 'M', pct: p, tokens: 0 }, wide({ features: {} })));
  assert.match(m(5), /😎/); assert.match(m(30), /🙂/); assert.match(m(60), /😅/);
  assert.match(m(80), /🥵/); assert.match(m(95), /💀/);
});

test('barra: 0% e 100% nas pontas', () => {
  const at = (p) => strip(render({ model: 'M', pct: p, tokens: 0 }, wide({ features: {}, bar: { width: 10 } })));
  assert.match(at(0), /\[░{8,10}\]/);
  assert.match(at(100), /\[█{10}\]/);
});

test('git: branch + dirty/ahead/behind aparecem', () => {
  const s = { model: 'M', pct: 10, tokens: 0, git: { branch: 'feat/x', dirty: true, ahead: 2, behind: 1 } };
  const out = strip(render(s, wide({ features: { git: true } })));
  assert.match(out, /feat\/x/); assert.match(out, /\*/); assert.match(out, /↑2/); assert.match(out, /↓1/);
});

test('cost: usd null some; pequeno usa 3 casas; normal 2', () => {
  const base = { model: 'M', pct: 10, tokens: 0 };
  assert.doesNotMatch(strip(render({ ...base, costUsd: null }, wide({ features: { cost: true } }))), /\$/);
  assert.match(strip(render({ ...base, costUsd: 0.004 }, wide({ features: { cost: true } }))), /\$0\.004/);
  assert.match(strip(render({ ...base, costUsd: 1.5 }, wide({ features: { cost: true } }))), /\$1\.50/);
});

test('dur: segundos, minutos e horas', () => {
  const d = (ms) => strip(render({ model: 'M', pct: 10, tokens: 0, durationMs: ms }, wide({ features: { cost: true } })));
  assert.match(d(5000), /5s/); assert.match(d(120000), /2m/); assert.match(d(3720000), /1h2m/);
});

test('rate: 5h e 7d aparecem', () => {
  const out = strip(render({ model: 'M', pct: 10, tokens: 0, rate: { five: 42, seven: 13 } }, wide({ features: { rate: true } })));
  assert.match(out, /5h 42%/); assert.match(out, /7d 13%/);
});

test('puns ligados e extraPuns entram no pool', () => {
  assert.match(strip(render({ model: 'M', pct: 10, tokens: 0 }, wide({ features: { puns: true } }))), /💬/);
  assert.match(render({ model: 'M', pct: 10, tokens: 0 }, wide({ features: { puns: true }, punRotateMs: 1, extraPuns: ['ZZZ'] })), /M/);
});

test('layout multi gera 2 linhas', () => {
  assert.ok(render(fromClaude(claudeJson), { ...wide(), layout: 'multi' }).includes('\n'));
});

test('layout multi: custo/rate na linha 1 (núcleo); git e pun na linha 2', () => {
  const s = { model: 'M', pct: 10, tokens: 1000, ctxSize: 200000, costUsd: 1.2, durationMs: 60000, rate: { five: 40, seven: 10 }, git: { branch: 'main' } };
  const out = render(s, { ...DEFAULT_CFG, layout: 'multi', width: 200, features: { git: true, cost: true, rate: true, puns: true } });
  const [l1, l2] = out.split('\n');
  assert.match(l1, /\$1\.20/); assert.match(l1, /5h 40%/);     // custo + rate na linha 1
  assert.doesNotMatch(l1, /main/);                              // branch NÃO na linha 1
  assert.match(l2, /main/); assert.match(l2, /💬/);             // branch + pun na linha 2
  assert.doesNotMatch(strip(l2), /\$1\.20/);
});

test('truncamento: largura estreita mantém só o núcleo', () => {
  const out = strip(render(fromClaude(claudeJson), { ...DEFAULT_CFG, width: 28 }));
  assert.ok(out.length <= 40, `len=${out.length}`); assert.match(out, /Opus/);
});

test('badge ⬆ aparece quando state.update', () => {
  const s = fromClaude(claudeJson); s.update = '9.9.9';
  assert.match(render(s, wide()), /⬆ v9\.9\.9/);
});

test('anúncio do JDI ocupa o slot do trocadilho (suprime o pun)', () => {
  const out = strip(render({ model: 'M', pct: 10, tokens: 0, jdi: { txt: 'ADX', ad: true } }, wide({ features: { puns: true } })));
  assert.match(out, /ADX/);
  assert.doesNotMatch(out, /💬/);
});

test('aviso de update do JDI não suprime o pun', () => {
  const out = strip(render({ model: 'M', pct: 10, tokens: 0, jdi: { txt: 'UPD', ad: false } }, wide({ features: { puns: true } })));
  assert.match(out, /UPD/); assert.match(out, /💬/);
});

test('attachGit: usa gitBranch; desligado vira null; ligado consulta git', () => {
  assert.equal(attachGit({ gitBranch: 'main', cwd: null }, true).git.branch, 'main');
  assert.equal(attachGit({ gitBranch: null, cwd: process.cwd() }, false).git, null);
  const real = attachGit({ gitBranch: null, cwd: process.cwd() }, true).git;
  assert.ok(real === null || typeof real.branch === 'string');
});

test('loadConfig: default sem arquivo; merge com arquivo', () => {
  assert.equal(loadConfig(undefined).bar.width, 10);
  const dir = mkdtempSync(join(tmpdir(), 'mood-cfg-'));
  try {
    const p = join(dir, 'c.json');
    writeFileSync(p, JSON.stringify({ bar: { width: 30 }, features: { puns: false } }));
    const cfg = loadConfig(p);
    assert.equal(cfg.bar.width, 30); assert.equal(cfg.features.puns, false); assert.equal(cfg.features.git, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('buildLine: render via JSON, flags e fallback', () => {
  const out = buildLine(JSON.stringify(claudeJson), { adapter: 'claude', width: '200' });
  assert.match(out, /Opus/); assert.match(out, /92%/);
  // flags --no-*
  assert.doesNotMatch(strip(buildLine(JSON.stringify(claudeJson), { width: '200', 'no-puns': true, 'no-cost': true, 'no-rate': true })), /💬/);
  // multi
  assert.ok(buildLine(JSON.stringify(claudeJson), { multi: true }).includes('\n'));
  // JSON inválido não quebra
  assert.equal(typeof buildLine('{lixo', {}), 'string');
  // vazio
  assert.match(buildLine('', {}), /\?|moodline/);
});

test('bordas: pct fora de 0..100 e custo NaN não quebram', () => {
  assert.match(strip(render({ model: 'M', pct: 150, tokens: 0 }, wide({ features: {}, bar: { width: 10 } }))), /\[█{10}\]/);
  assert.match(strip(render({ model: 'M', pct: -5, tokens: 0 }, wide({ features: {}, bar: { width: 10 } }))), /\[░{10}\]/);
  assert.doesNotMatch(strip(render({ model: 'M', pct: 10, tokens: 0, costUsd: 'abc' }, wide({ features: { cost: true } }))), /\$/);
});

test('updateBadge: cache sem campo latest -> null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mood-upd2-'));
  const cache = join(dir, 'u.json');
  process.env.MOODLINE_UPDATE_CACHE = cache;
  try {
    writeFileSync(cache, JSON.stringify({ checkedAt: Date.now() }));
    assert.equal(updateBadge({ version: '0.1.0' }), null);
  } finally { process.env.MOODLINE_UPDATE_CACHE = FRESH; rmSync(dir, { recursive: true, force: true }); }
});

test('cmpVer compara semver', () => {
  assert.equal(cmpVer('0.3.0', '0.2.9'), 1);
  assert.equal(cmpVer('0.2.0', '0.2.0'), 0);
  assert.equal(cmpVer('0.2.0', '0.10.0'), -1);
});

test('updateBadge / doUpdateCheck / maybeSpawnCheck', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mood-upd-'));
  const cache = join(dir, 'u.json');
  process.env.MOODLINE_UPDATE_CACHE = cache;
  const realFetch = globalThis.fetch;
  try {
    assert.equal(updateBadge({ version: '0.1.0' }), null);                 // sem cache
    writeFileSync(cache, JSON.stringify({ latest: '9.9.9', checkedAt: Date.now() }));
    assert.equal(updateBadge({}), null);                                   // sem versão no cfg
    assert.equal(updateBadge({ version: '0.1.0' }), '9.9.9');              // newer
    writeFileSync(cache, JSON.stringify({ latest: '0.0.1', checkedAt: Date.now() }));
    assert.equal(updateBadge({ version: '9.9.9' }), null);                 // older

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: '1.2.3' }) });
    await doUpdateCheck();
    assert.equal(JSON.parse(readFileSync(cache, 'utf8')).latest, '1.2.3');
    globalThis.fetch = async () => { throw new Error('offline'); };
    await doUpdateCheck();
    assert.equal(JSON.parse(readFileSync(cache, 'utf8')).latest, null);

    rmSync(cache, { force: true });
    maybeSpawnCheck();                                                     // stale → carimba + spawn
    const stamped = JSON.parse(readFileSync(cache, 'utf8')).checkedAt;
    assert.ok(stamped);
    maybeSpawnCheck();                                                     // fresco → early return
    assert.equal(JSON.parse(readFileSync(cache, 'utf8')).checkedAt, stamped);
  } finally {
    globalThis.fetch = realFetch;
    process.env.MOODLINE_UPDATE_CACHE = FRESH;
    rmSync(dir, { recursive: true, force: true });
  }
});
