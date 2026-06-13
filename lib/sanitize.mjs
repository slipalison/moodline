// sanitize.mjs — utilitarios de seguranca compartilhados (validacao de entrada + saida de log).
// Usados pelo CLI (bin/moodline.js). Centralizados aqui pra ter um unico ponto de verdade e serem
// testaveis isoladamente (bin tem efeitos no import; este modulo e puro).

// Nome de pacote npm valido (allowlist estrita): opcional @escopo/, nome, e opcional @versao/tag.
// Bloqueia qualquer metacaractere de shell (`;`, `&`, `|`, espaco, `$`, etc.) por construcao.
const NPM_PKG = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:@[\w.-]+)?$/;

// Remove quebras de linha/tab e tudo fora do ASCII imprimivel — evita log injection/forging.
export const sanitizeForLog = (v) => String(v).replace(/[\n\r\t]/g, ' ').replace(/[^\x20-\x7E]/g, '');

// Valida e retorna o nome do pacote; lanca se nao casar a allowlist. Centraliza a sanitizacao
// ANTES de qualquer uso em spawn/exec — nenhuma entrada nao validada chega ao processo filho.
export function validatePackageName(name) {
  const s = String(name);
  if (!NPM_PKG.test(s)) throw new Error(`pacote inválido: ${sanitizeForLog(s)}`);
  return s;
}
