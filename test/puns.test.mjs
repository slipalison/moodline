import test from 'node:test';
import assert from 'node:assert/strict';
import { PUNS } from '../lib/puns.mjs';

test('lista de trocadilhos PT tem volume e itens válidos', () => {
  assert.ok(PUNS.length >= 50, `poucas puns: ${PUNS.length}`);
  assert.ok(PUNS.every((p) => typeof p === 'string' && p.length > 0 && p.length <= 60));
  assert.equal(new Set(PUNS).size, PUNS.length, 'sem duplicatas');
  assert.ok(PUNS.includes('se eu quisesse fazer consulta tinha virado médico'));
});
