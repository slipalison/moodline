// Testes da instalação/toggle/config/update. Tudo em HOME sandbox (nunca toca config real).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as I from '../lib/install.mjs';

const sandbox = () => mkdtempSync(join(tmpdir(), 'mood-inst-'));
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const run = (fn) => { const home = sandbox(); try { fn(home); } finally { rmSync(home, { recursive: true, force: true }); } };

test('configure claude: engine + versão + slash command + statusLine', () => run((home) => {
  const t = I.configure('claude', { features: ['git', 'puns'], home });
  assert.ok(existsSync(t.core));
  assert.ok(existsSync(join(t.engineDir, 'puns.mjs')));
  assert.ok(existsSync(join(t.engineDir, 'jdi.mjs')));
  const cfg = readJson(t.config);
  assert.equal(cfg.features.git, true); assert.equal(cfg.features.cost, false);
  assert.equal(cfg.version, I.pkgVersion()); assert.equal(cfg.bar.width, 10);
  assert.match(readJson(t.settings).statusLine.command, /--adapter=claude/);
  assert.ok(existsSync(t.commandFile));
  const md = readFileSync(t.commandFile, 'utf8');
  assert.match(md, /moodline config/);
  assert.match(md, /AskUserQuestion/); // menu interativo no Claude Code
}));

test('configure copilot: feature flag STATUS_LINE e sem slash command', () => run((home) => {
  const t = I.configure('copilot', { home });
  const s = readJson(t.settings);
  assert.ok(s.feature_flags.enabled.includes('STATUS_LINE'));
  assert.match(s.statusLine.command, /--adapter=copilot/);
  assert.equal(t.commandFile, null);
}));

test('configure sem features liga todas; layout aplicado', () => run((home) => {
  I.configure('claude', { layout: 'multi', home });
  const c = I.readConfigFile('claude', home);
  for (const f of ['git', 'cost', 'rate', 'puns']) assert.equal(c.features[f], true);
  assert.equal(c.layout, 'multi');
}));

test('enable/disable não-destrutivo + detectInstalled', () => run((home) => {
  I.configure('claude', { home });
  I.setEnabled('claude', false, { home });
  assert.equal(readJson(I.targets(home).claude.settings).statusLine, undefined);
  assert.ok(existsSync(I.targets(home).claude.core), 'engine permanece');
  I.setEnabled('claude', true, { home });
  const d = I.detectInstalled(home).find((x) => x.key === 'claude');
  assert.equal(d.wired, true); assert.equal(d.engine, true); assert.equal(d.present, true);
}));

test('setEnabled sem configurar lança', () => run((home) => {
  assert.throws(() => I.setEnabled('claude', true, { home }), /não configurado/);
}));

test('readConfigFile/writeConfigFile round-trip; write sem configurar lança', () => run((home) => {
  assert.equal(I.readConfigFile('claude', home), null);
  assert.throws(() => I.writeConfigFile('claude', {}, home), /não configurado/);
  I.configure('claude', { home });
  const c = I.readConfigFile('claude', home); c.features.puns = false;
  I.writeConfigFile('claude', c, home);
  assert.equal(I.readConfigFile('claude', home).features.puns, false);
}));

test('refreshEngine preserva features e recarimba versão; sem configurar lança', () => run((home) => {
  assert.throws(() => I.refreshEngine('claude', home), /não configurado/);
  I.configure('claude', { features: ['git'], home });
  const c = I.readConfigFile('claude', home); c.features.cost = true; c.version = '0.0.1';
  I.writeConfigFile('claude', c, home);
  I.refreshEngine('claude', home);
  const a = I.readConfigFile('claude', home);
  assert.equal(a.features.cost, true); assert.equal(a.version, I.pkgVersion());
}));

test('setCoauthor: off grava attribution vazio; on remove overrides; não-claude lança', () => run((home) => {
  I.configure('claude', { features: [], home });
  const settings = I.targets(home).claude.settings;
  I.setCoauthor('claude', false, { home });
  assert.equal(readJson(settings).attribution.commit, ''); // desliga Generated + Co-Authored-By
  assert.ok(readJson(settings).statusLine, 'preserva o resto do settings.json');
  I.setCoauthor('claude', true, { home });
  assert.equal(readJson(settings).attribution, undefined); // volta ao default (ligado)
  assert.throws(() => I.setCoauthor('copilot', false, { home }), /fixo|configurável/);
}));

test('uninstall --purge remove statusLine, engine e slash command', () => run((home) => {
  I.configure('claude', { home });
  const t = I.targets(home).claude;
  const r = I.uninstall('claude', { home, purge: true });
  assert.equal(r.had, true);
  assert.equal(existsSync(t.engineDir), false);
  assert.equal(existsSync(t.commandFile), false);
  assert.equal(readJson(t.settings).statusLine, undefined);
}));

test('uninstall sem purge mantém o engine', () => run((home) => {
  I.configure('claude', { home });
  I.uninstall('claude', { home });
  assert.ok(existsSync(I.targets(home).claude.core));
}));

test('configuredKeys lista só quem tem engine', () => run((home) => {
  assert.deepEqual(I.configuredKeys(home), []);
  I.configure('claude', { home });
  assert.deepEqual(I.configuredKeys(home), ['claude']);
}));

test('targets: paths user-level; copilot/antigravity sem commandFile', () => {
  const t = I.targets('/HOME');
  assert.ok(t.claude.settings.includes('.claude'));
  assert.ok(t.copilot.settings.includes('.copilot'));
  assert.equal(t.copilot.commandFile, null);
  assert.match(t.antigravity.settings.replaceAll('\\', '/'), /\.gemini\/antigravity-cli\/settings\.json$/);
  assert.equal(t.antigravity.commandFile, null);
});

test('configure antigravity: statusLine com enabled:true, sem padding; preserva settings existentes', () => run((home) => {
  const t = I.targets(home).antigravity;
  // settings pre-existentes do agy (colorScheme etc) — configure nao pode destruir
  mkdirSync(t.dir, { recursive: true });
  writeFileSync(t.settings, JSON.stringify({ colorScheme: 'tokyo night', trustedWorkspaces: ['C:\\x'] }));
  I.configure('antigravity', { home });
  const s = readJson(t.settings);
  assert.equal(s.colorScheme, 'tokyo night');
  assert.deepEqual(s.trustedWorkspaces, ['C:\\x']);
  assert.equal(s.statusLine.type, 'command');
  assert.equal(s.statusLine.enabled, true);
  assert.equal(s.statusLine.padding, undefined);
  // agy nao interpreta aspas/args (split ingenuo): comando BARE, engine se autoconfigura
  assert.match(s.statusLine.command, /^node [^"]+moodline-core\.mjs$/);
  assert.doesNotMatch(s.statusLine.command, /--adapter|"/);
  assert.equal(readJson(t.config).adapter, 'antigravity'); // adapter vai no config.json
  assert.ok(existsSync(t.core));
  const d = I.detectInstalled(home).find((x) => x.key === 'antigravity');
  assert.equal(d.wired, true);
}));

test('fetchLatest: sucesso, !ok e exceção', async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: '1.0.0' }) });
    assert.equal(await I.fetchLatest(), '1.0.0');
    globalThis.fetch = async () => ({ ok: false });
    assert.equal(await I.fetchLatest(), null);
    globalThis.fetch = async () => { throw new Error('x'); };
    assert.equal(await I.fetchLatest(), null);
  } finally { globalThis.fetch = real; }
});
