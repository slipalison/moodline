// pathguard.mjs — seguranca de caminhos/execucao. Faz parte do ENGINE (copiado no init); so built-ins.
//
// Motivacao (SonarQube, entrada externa = cwd vindo do JSON do host):
//  - S8707 (path injection): validar o caminho construido ANTES de acessar o FS.
//  - S4036 (PATH search): nao resolver executaveis (git) pelo PATH — um diretorio gravavel no PATH
//    poderia conter um `git` malicioso. Resolvemos por caminho ABSOLUTO em dirs de sistema.
import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Caminho ABSOLUTO normalizado se `p` for um diretorio existente; senao null. Neutraliza entrada
// invalida (não-string/vazia/com NUL) e traversal (resolve + stat real do alvo).
export function safeDir(p) {
  if (typeof p !== 'string' || p.length === 0 || p.includes('\0')) return null;
  try {
    const abs = resolve(p);
    // NOSONAR(S8707): esta E a validacao. `p` = cwd do proprio usuario; statusline local sem sandbox.
    return statSync(abs).isDirectory() ? abs : null; // NOSONAR
  } catch {
    return null;
  }
}

// Candidatos de git em diretorios de SISTEMA (nao gravaveis por usuario comum). Nada de PATH.
// POSIX: Homebrew antes de /usr/bin/git — no macOS o /usr/bin/git e um shim do Xcode CLT que
// pode TRAVAR quando invocado por caminho absoluto sem TTY (visto na CI). Por isso o probe abaixo.
const GIT_CANDIDATES = process.platform === 'win32'
  ? [
      `${process.env.ProgramFiles || 'C:\\Program Files'}\\Git\\cmd\\git.exe`,
      `${process.env.ProgramFiles || 'C:\\Program Files'}\\Git\\bin\\git.exe`,
      `${process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'}\\Git\\cmd\\git.exe`,
    ]
  : ['/usr/local/bin/git', '/opt/homebrew/bin/git', '/usr/bin/git', '/bin/git'];

// Confere que o candidato RESPONDE como git (timeout curto) — descarta shim que trava/erra.
function respondsAsGit(p) {
  try { execFileSync(p, ['--version'], { timeout: 800, stdio: 'ignore' }); return true; }
  catch { return false; }
}

let gitBinCache;
// Primeiro candidato absoluto que existe E responde; null se nenhum (ai o chamador omite o git).
// Memoizado por processo; so e chamado dentro de computeGitInfo (cache-miss), nao a cada refresh.
export function gitBin() {
  if (gitBinCache === undefined) gitBinCache = GIT_CANDIDATES.find((p) => existsSync(p) && respondsAsGit(p)) || null;
  return gitBinCache;
}
