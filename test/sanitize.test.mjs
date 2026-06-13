// Testes dos utilitarios de seguranca: allowlist de nome de pacote + sanitizacao de log.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePackageName, sanitizeForLog } from '../lib/sanitize.mjs';

test('validatePackageName aceita nomes/escopos/versoes validos', () => {
  for (const ok of ['moodline', 'moodline@1.2.3', 'moodline@latest', '@scope/pkg', '@scope/pkg@1.0.0-beta.1', 'a-b_c.d']) {
    assert.equal(validatePackageName(ok), ok);
  }
});

test('validatePackageName rejeita injecao de comando e nomes invalidos', () => {
  for (const bad of ['moodline; rm -rf /', 'moodline && evil', 'a b', 'pkg|cat', '$(whoami)', 'moodline\n-g', '', '../evil', 'UPPER']) {
    assert.throws(() => validatePackageName(bad), /pacote inválido/);
  }
});

test('sanitizeForLog remove CR/LF/TAB e nao-ASCII; mantem ASCII imprimivel', () => {
  assert.equal(sanitizeForLog('a\nb\r\nc\td'), 'a b  c d'); // quebras viram espaco
  assert.equal(sanitizeForLog('moodline@1.2.3'), 'moodline@1.2.3');
  assert.equal(sanitizeForLog('emoji💸 x'), 'emoji x');     // remove nao-ASCII
  assert.equal(sanitizeForLog(123), '123');
  assert.equal(sanitizeForLog(null), 'null');
});

test('sanitizeForLog neutraliza forging de log (sem CR/LF que forjem nova linha)', () => {
  const forged = 'v1.0.0\n[ERRO] linha falsa injetada';
  assert.doesNotMatch(sanitizeForLog(forged), /\n/);
});
