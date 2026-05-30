// Testes da divulgação do JDI (deteccao local/global, fetch, decisao do segmento).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localJdi, globalJdiVersion, fetchJdiLatest, jdiSegment } from '../lib/jdi.mjs';
import { cmpVer } from '../lib/moodline-core.mjs';

const COLORS = { MAGENTA: '', CYAN: '', DIM: '', RESET: '' };
const tmp = () => mkdtempSync(join(tmpdir(), 'jdi-'));

test('localJdi: node_modules com versão', () => {
  const cwd = tmp();
  try {
    mkdirSync(join(cwd, 'node_modules', 'jdi-cli'), { recursive: true });
    writeFileSync(join(cwd, 'node_modules', 'jdi-cli', 'package.json'), JSON.stringify({ version: '2.0.0' }));
    assert.deepEqual(localJdi(cwd), { installed: true, version: '2.0.0' });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('localJdi: declarado no package.json (sem node_modules)', () => {
  const cwd = tmp();
  try {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ devDependencies: { 'jdi-cli': '^1.0.0' } }));
    assert.deepEqual(localJdi(cwd), { installed: true, version: null });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('localJdi: ausente e cwd nulo', () => {
  const cwd = tmp();
  try {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ dependencies: {} }));
    assert.equal(localJdi(cwd).installed, false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
  assert.equal(localJdi(null).installed, false);
});

test('globalJdiVersion não lança (string|null)', () => {
  const v = globalJdiVersion();
  assert.ok(v === null || typeof v === 'string');
});

test('fetchJdiLatest: stub sucesso e falha', async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: '3.1.4' }) });
    assert.equal(await fetchJdiLatest(), '3.1.4');
    globalThis.fetch = async () => ({ ok: false });
    assert.equal(await fetchJdiLatest(), null);
  } finally { globalThis.fetch = real; }
});

test('jdiSegment: instalado com update disponível', () => {
  const cwd = tmp();
  try {
    mkdirSync(join(cwd, 'node_modules', 'jdi-cli'), { recursive: true });
    writeFileSync(join(cwd, 'node_modules', 'jdi-cli', 'package.json'), JSON.stringify({ version: '1.0.0' }));
    const seg = jdiSegment({ cwd, cache: { jdiLatest: '1.2.0' }, cmpVer, colors: COLORS });
    assert.ok(seg && seg.ad === false);
    assert.match(seg.txt, /JDI v1\.2\.0/); assert.match(seg.txt, /npmjs\.com\/package\/jdi-cli/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('jdiSegment: instalado (global) e atualizado -> null', () => {
  assert.equal(jdiSegment({ cwd: null, cache: { jdiGlobal: '2.0.0', jdiLatest: '2.0.0' }, cmpVer, colors: COLORS }), null);
});

test('jdiSegment: não instalado -> anúncio na janela certa, null fora dela', () => {
  const cwd = tmp();
  try {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({}));
    const ad = jdiSegment({ cwd, cache: {}, rotateMs: 1000, cmpVer, colors: COLORS, now: 0 }); // win 0 -> anúncio
    assert.ok(ad && ad.ad === true);
    assert.match(ad.txt, /npmjs\.com\/package\/jdi-cli/);
    assert.equal(jdiSegment({ cwd, cache: {}, rotateMs: 1000, cmpVer, colors: COLORS, now: 1000 }), null); // win 1 -> null
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
