// pathguard.mjs — seguranca de caminhos/execucao. Faz parte do ENGINE (copiado no init); so built-ins.
//
// Motivacao (SonarQube, entrada externa = cwd vindo do JSON do host):
//  - S8707 (path injection): validar o caminho construido ANTES de acessar o FS.
//  - S4036 (PATH search): nao resolver executaveis (git) pelo PATH — um diretorio gravavel no PATH
//    poderia conter um `git` malicioso. Resolvemos por caminho ABSOLUTO em dirs de sistema.
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// Caminho ABSOLUTO normalizado se `p` for um diretorio existente; senao null. Neutraliza entrada
// invalida (não-string/vazia/com NUL) e traversal (resolve + stat real do alvo).
export function safeDir(p) {
  if (typeof p !== 'string' || p.length === 0 || p.includes('\0')) return null;
  try {
    const abs = resolve(p);
    return statSync(abs).isDirectory() ? abs : null;
  } catch {
    return null;
  }
}

// Candidatos de git em diretorios de SISTEMA (nao gravaveis por usuario comum). Nada de PATH.
const GIT_CANDIDATES = process.platform === 'win32'
  ? [
      `${process.env.ProgramFiles || 'C:\\Program Files'}\\Git\\cmd\\git.exe`,
      `${process.env.ProgramFiles || 'C:\\Program Files'}\\Git\\bin\\git.exe`,
      `${process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'}\\Git\\cmd\\git.exe`,
    ]
  : ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git', '/bin/git'];

let gitBinCache;
// Caminho absoluto do git, ou null se nao houver em local confiavel (ai o chamador omite o git).
export function gitBin() {
  if (gitBinCache === undefined) gitBinCache = GIT_CANDIDATES.find((p) => existsSync(p)) || null;
  return gitBinCache;
}
