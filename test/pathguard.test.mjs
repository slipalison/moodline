// Testes de seguranca de caminho/execucao: safeDir (validacao de dir externo) + gitBin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { safeDir, gitBin } from '../lib/pathguard.mjs';

test('safeDir: diretorio real -> caminho absoluto normalizado', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pg-'));
  try {
    assert.equal(safeDir(dir), resolve(dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('safeDir: arquivo (nao-dir) -> null; inexistente -> null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pg-'));
  try {
    const f = join(dir, 'x.txt'); writeFileSync(f, '1');
    assert.equal(safeDir(f), null);                       // e arquivo, nao diretorio
    assert.equal(safeDir(join(dir, 'nao-existe')), null); // inexistente
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('safeDir: entradas invalidas (null, vazio, não-string, NUL) -> null', () => {
  assert.equal(safeDir(null), null);
  assert.equal(safeDir(undefined), null);
  assert.equal(safeDir(''), null);
  assert.equal(safeDir(123), null);
  assert.equal(safeDir('/tmp/\0/etc'), null); // byte NUL neutralizado
});

test('gitBin: string absoluta existente ou null (nunca resolve pelo PATH)', () => {
  const g = gitBin();
  assert.ok(g === null || (typeof g === 'string' && g.length > 0));
});
