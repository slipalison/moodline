// smoke test — sem framework, so node. Falha com exit 1 se algo quebrar.
import { render, fromClaude, fromCopilot, fromOpenCode, DEFAULT_CFG } from '../lib/moodline-core.mjs';
import assert from 'node:assert/strict';

process.env.COLUMNS = '120';
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); };

const claudeJson = {
  model: { display_name: 'Opus', id: 'claude-opus-4-8' },
  effort: { level: 'high' },
  context_window: { used_percentage: 92, total_input_tokens: 184000, context_window_size: 200000 },
  cost: { total_cost_usd: 0.42, total_duration_ms: 325000, total_lines_added: 120, total_lines_removed: 30 },
  rate_limits: { five_hour: { used_percentage: 42 }, seven_day: { used_percentage: 13 } },
  workspace: { current_dir: process.cwd() },
};

const copilotJson = {
  model: { display_name: 'GPT-5' },
  context_window: { used_percentage: 25, total_input_tokens: 50000, context_window_size: 128000 },
  cost: { total_duration_ms: 60000, total_lines_added: 5, total_lines_removed: 0 },
  cwd: process.cwd(),
  remote: { branch: 'main' },
};

t('fromClaude normaliza campos', () => {
  const s = fromClaude(claudeJson);
  assert.equal(s.model, 'Opus');
  assert.equal(s.effort, 'high');
  assert.equal(s.pct, 92);
  assert.equal(s.tokens, 184000);
  assert.equal(s.costUsd, 0.42);
  assert.equal(s.rate.five, 42);
});

t('render Claude tem modelo, pct e barra', () => {
  const out = render(fromClaude(claudeJson), DEFAULT_CFG);
  assert.match(out, /Opus/);
  assert.match(out, /92%/);
  assert.match(out, /█/);
  assert.match(out, /\u{1F480}/u); // caveira em 92%
});

t('fromCopilot mapeia branch do remote', () => {
  const s = fromCopilot(copilotJson);
  assert.equal(s.model, 'GPT-5');
  assert.equal(s.pct, 25);
  assert.equal(s.gitBranch, 'main');
});

t('render Copilot ok', () => {
  const out = render(fromCopilot(copilotJson), DEFAULT_CFG);
  assert.match(out, /GPT-5/);
  assert.match(out, /25%/);
});

t('pct nulo nao quebra (cedo na sessao)', () => {
  const s = fromClaude({ model: { display_name: 'Sonnet' }, context_window: {} });
  assert.equal(s.pct, 0);
  const out = render(s, DEFAULT_CFG);
  assert.match(out, /Sonnet/);
  assert.match(out, /0%/);
});

t('fromOpenCode tolerante a shape', () => {
  const s = fromOpenCode({ model: { name: 'Qwen' }, context: { used_percentage: 50, input: 90000 } });
  assert.equal(s.model, 'Qwen');
  assert.equal(s.pct, 50);
});

t('layout multi gera 2 linhas', () => {
  const out = render(fromClaude(claudeJson), { ...DEFAULT_CFG, layout: 'multi' });
  assert.ok(out.includes('\n'));
});

t('truncamento respeita largura estreita', () => {
  const out = render(fromClaude(claudeJson), { ...DEFAULT_CFG, width: 30 });
  const visible = out.replace(/\x1b\[[0-9;]*m/g, '');
  // nao deve estourar muito alem da largura (core sozinho ja cabe)
  assert.ok(visible.length <= 60, `linha muito longa: ${visible.length}`);
});

console.log(`\n\x1b[32m${passed} testes passaram\x1b[0m`);
