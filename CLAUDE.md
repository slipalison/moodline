# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

`moodline` é uma statusline instalável via `npx` para CLIs de IA. Renderiza barra de contexto em gradiente, emoji-humor, git, custo/tempo/linhas, rate limits e trocadilhos. Distribuído no npm; publicado via GitHub Action.

## Comandos

```bash
npm test                        # smoke tests (node test/smoke.mjs, sem framework)
node test/smoke.mjs             # idem; cada `t(...)` é um caso, não há filtro por nome
echo '<json>' | node bin/moodline.js render --adapter=claude   # renderiza a barra a partir de JSON no stdin
node bin/moodline.js doctor     # mostra CLIs detectadas e statusLine configurada
```

Não há build nem linter. Runtime é JS puro, **zero dependências** (só Node ≥ 18 built-ins). O `npm test` é o único gate de CI.

## Arquitetura

Duas peças, com uma separação que precisa ser respeitada:

- **`lib/moodline-core.mjs` — o engine.** Renderiza a barra. É **auto-contido por contrato**: importa apenas built-ins do Node, nada de outros arquivos do projeto. O motivo é que o `init` **copia esse arquivo sozinho** para `~/.claude/moodline/` (e `~/.copilot/moodline/`), e o `settings.json` da CLI o executa direto via `node`. Se você adicionar um `import` de outro arquivo local aqui, a cópia instalada quebra. Roda de dois modos: importado (exporta `render`, `ADAPTERS`, `from*`, `attachGit`, `loadConfig`, `DEFAULT_CFG`) e executado direto (lê stdin, imprime — protegido por checagem `isMain`).

- **`bin/moodline.js` — o instalador/CLI.** Comandos `init`/`render`/`doctor`/`uninstall`/`watch`. O `init` copia o engine, escreve um `config.json` e faz patch do `settings.json` da CLI alvo apontando para `node "<core>" --adapter=<cli> --config="<cfg>"`.

### Fluxo de dados

CLI de IA → JSON no stdin → `from<Cli>(json)` normaliza para um **estado único** → `render(state, cfg)` → string ANSI no stdout. O estado normalizado é o contrato entre adapters e o render: `{ model, effort, pct, tokens, ctxSize, costUsd, durationMs, linesAdded, linesRemoved, rate, cwd, gitBranch, repo, git }`.

### Adicionar suporte a uma CLI

Escreva `fromX(json)` em `moodline-core.mjs` que mapeia o JSON daquela CLI para o estado normalizado, registre em `ADAPTERS`, e (se ela tiver statusLine por comando) adicione uma entrada em `TARGETS` no `bin/moodline.js` com o `patch(settings, command)` que edita o `settings.json` dela.

### Realidade de compatibilidade (não regredir)

Só **Claude Code** e **GitHub Copilot CLI** têm statusline por comando + JSON no stdin (schemas quase idênticos → um engine serve os dois; no Copilot é experimental e exige a feature flag `STATUS_LINE`, ligada pelo `init`). **Gemini** e **OpenCode** não têm statusline por comando (adapters `gemini`/`opencode` são experimentais — OpenCode é alimentado por fora via `moodline watch` sobre a API HTTP). **Junie** não tem como: o hook `SessionStart` descarta o stdout.

## Invariantes

- **O render nunca pode lançar exceção** — uma statusline que quebra apaga a barra da CLI. `runMain` envolve tudo em try/catch e cai num fallback mínimo; mantenha assim.
- **Truncamento width-aware**: em `render`, o segmento principal (modelo/barra/%/tokens) é sempre mantido; os extras (git, cost, rate, puns) caem por prioridade quando não cabem em `$COLUMNS`. Ao adicionar segmento, atribua `prio`.
- **`.gitattributes` força LF.** O shebang do `bin` e os scripts `.sh` quebram com CRLF no Linux/npm. Não reverta para CRLF nesses arquivos.
- **Sem dependências de runtime.** Manter o `render` rápido (é chamado a cada update). Não adicione pacotes ao que roda no caminho da barra.

## Release

Versionamento começa em `v0`. Publicação é automática:

```bash
npm version patch            # bumpa a versão e cria a tag v*
git push --follow-tags       # dispara .github/workflows/release.yml → npm publish + GitHub Release
```

Requer o secret `NPM_TOKEN` no repositório. `release.yml` usa `--provenance` (exige repo público).

## Origem

`legacy/statusline.sh` e `legacy/statusline.ps1` são os scripts originais (Bash+jq / PowerShell) de onde o engine foi portado. Mantidos como referência; não fazem parte do pacote publicado (`files` no `package.json`).
