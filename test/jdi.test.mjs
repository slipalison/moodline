// Testes da deteccao do JDI por ARTEFATOS (.jdi/ no projeto, comandos jdi-* no runtime).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jdiInProject, jdiProjectVersion, jdiInRuntime, globalJdiVersion, fetchJdiLatest, jdiSegment } from '../lib/jdi.mjs';
import { cmpVer } from '../lib/moodline-core.mjs';

const COLORS = { MAGENTA: '', CYAN: '', DIM: '', RESET: '' };
const tmp = () => mkdtempSync(join(tmpdir(), 'jdi-'));
const writeFile = (p, c) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, c); };

test('jdiInProject: pasta .jdi/ no cwd', () => {
  const cwd = tmp();
  try { mkdirSync(join(cwd, '.jdi')); assert.equal(jdiInProject(cwd), true); }
  finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('jdiInProject: .jdi/ na raiz, cwd num subdiretorio', () => {
  const root = tmp();
  try {
    mkdirSync(join(root, '.jdi'));
    const sub = join(root, 'src', 'deep');
    mkdirSync(sub, { recursive: true });
    assert.equal(jdiInProject(sub), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('jdiInProject: comandos jdi-* em .claude/commands do projeto', () => {
  const cwd = tmp();
  try {
    mkdirSync(join(cwd, '.claude', 'commands'), { recursive: true });
    writeFileSync(join(cwd, '.claude', 'commands', 'jdi-do.md'), '# jdi-do');
    assert.equal(jdiInProject(cwd), true);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('jdiInProject: ausente e cwd nulo', () => {
  const cwd = tmp();
  try { assert.equal(jdiInProject(cwd), false); }
  finally { rmSync(cwd, { recursive: true, force: true }); }
  assert.equal(jdiInProject(null), false);
});

test('jdiProjectVersion: .jdi/VERSION tem prioridade; config é fallback; sobe do subdir', () => {
  const root = tmp();
  try {
    mkdirSync(join(root, '.jdi'));
    writeFileSync(join(root, '.jdi', 'config.json'), JSON.stringify({ $schema_version: '1.1' }));
    assert.equal(jdiProjectVersion(root), null); // só schema de estado, não release
    writeFileSync(join(root, '.jdi', 'config.json'), JSON.stringify({ jdi_version: '0.1.0' }));
    assert.equal(jdiProjectVersion(root), '0.1.0'); // fallback via config
    writeFileSync(join(root, '.jdi', 'VERSION'), '0.1.12\n');
    assert.equal(jdiProjectVersion(root), '0.1.12'); // VERSION ganha
    const sub = join(root, 'a', 'b'); mkdirSync(sub, { recursive: true });
    assert.equal(jdiProjectVersion(sub), '0.1.12'); // sobe do subdir
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('jdiSegment: aviso de update via versão do projeto (sem instalador global)', () => {
  const cwd = tmp(); const home = tmp();
  try {
    mkdirSync(join(cwd, '.jdi'));
    writeFileSync(join(cwd, '.jdi', 'config.json'), JSON.stringify({ jdi_version: '0.1.0' }));
    const seg = jdiSegment({ cwd, home, cache: { jdiLatest: '0.1.13' }, cmpVer, colors: COLORS });
    assert.ok(seg && seg.ad === false);
    assert.match(seg.txt, /JDI v0\.1\.13/);
  } finally { rmSync(cwd, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); }
});

test('jdiInRuntime: comandos jdi-* em ~/.claude', () => {
  const home = tmp();
  try {
    mkdirSync(join(home, '.claude', 'commands'), { recursive: true });
    writeFileSync(join(home, '.claude', 'commands', 'jdi-plan.md'), '# jdi-plan');
    assert.equal(jdiInRuntime(home), true);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('jdiInRuntime: agentes jdi-* tambem contam; vazio = false', () => {
  const home = tmp();
  try {
    assert.equal(jdiInRuntime(home), false);
    mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(home, '.claude', 'agents', 'jdi-architect.md'), '# a');
    assert.equal(jdiInRuntime(home), true);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('globalJdiVersion: nao lanca (string|null)', () => {
  const v = globalJdiVersion();
  assert.ok(v === null || typeof v === 'string');
});

test('fetchJdiLatest: stub sucesso e falha', async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: '0.1.13' }) });
    assert.equal(await fetchJdiLatest(), '0.1.13');
    globalThis.fetch = async () => ({ ok: false });
    assert.equal(await fetchJdiLatest(), null);
  } finally { globalThis.fetch = real; }
});

test('jdiSegment: JDI presente no projeto -> sem anuncio', () => {
  const cwd = tmp(); const home = tmp();
  try {
    mkdirSync(join(cwd, '.jdi'));
    assert.equal(jdiSegment({ cwd, home, cache: {}, cmpVer, colors: COLORS }), null);
  } finally { rmSync(cwd, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); }
});

test('jdiSegment: presente + instalador desatualizado -> aviso de update', () => {
  const cwd = tmp(); const home = tmp();
  try {
    mkdirSync(join(cwd, '.jdi'));
    const seg = jdiSegment({ cwd, home, cache: { jdiGlobal: '0.1.0', jdiLatest: '0.1.13' }, cmpVer, colors: COLORS });
    assert.ok(seg && seg.ad === false);
    assert.match(seg.txt, /JDI v0\.1\.13/); assert.match(seg.txt, /npmjs\.com\/package\/jdi-cli/);
  } finally { rmSync(cwd, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); }
});

test('jdiSegment: presente + instalador atual -> silencioso', () => {
  const cwd = tmp(); const home = tmp();
  try {
    mkdirSync(join(cwd, '.jdi'));
    assert.equal(jdiSegment({ cwd, home, cache: { jdiGlobal: '0.1.13', jdiLatest: '0.1.13' }, cmpVer, colors: COLORS }), null);
  } finally { rmSync(cwd, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); }
});

test('jdiSegment: ausente -> anuncio na janela certa, null fora dela', () => {
  const cwd = tmp(); const home = tmp();
  try {
    const ad = jdiSegment({ cwd, home, cache: {}, rotateMs: 1000, cmpVer, colors: COLORS, now: 0 });
    assert.ok(ad && ad.ad === true);
    assert.match(ad.txt, /npmjs\.com\/package\/jdi-cli/);
    assert.equal(jdiSegment({ cwd, home, cache: {}, rotateMs: 1000, cmpVer, colors: COLORS, now: 1000 }), null);
  } finally { rmSync(cwd, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); }
});
