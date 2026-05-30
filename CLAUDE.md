# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

`moodline` é uma statusline instalável via `npx` para CLIs de IA. Renderiza barra de contexto em gradiente, emoji-humor, git, custo/tempo/linhas, rate limits e trocadilhos. Distribuído no npm; publicado via GitHub Action.

## Comandos

```bash
npm test                        # smoke tests (node test/smoke.mjs, sem framework)
node test/smoke.mjs             # idem; cada `t(...)` é um caso, não há filtro por nome
echo '<json>' | node bin/moodline.js render --adapter=claude   # renderiza a barra a partir de JSON no stdin
node bin/moodline.js init --home=<dir> --all --yes             # init NÃO-interativo num HOME sandbox (use em testes p/ não tocar ~/.claude real)
node bin/moodline.js doctor --home=<dir>                       # estado das CLIs
```

Não há build nem linter. Runtime é JS puro, **zero dependências** (só Node ≥ 18 built-ins). O `npm test` é o único gate de CI.

**Ao testar `init`/`enable`/`disable`/`uninstall` localmente, SEMPRE passe `--home=<tempdir>`.** Sem isso, eles escrevem no `~/.claude`/`~/.copilot` reais do usuário (e podem sobrescrever uma statusline existente). Todas as funções de `install.mjs` aceitam `home` exatamente por isso.

## Arquitetura

Duas camadas, com uma fronteira que precisa ser respeitada: **engine** (roda a cada update) vs **instalador** (roda só no `init`).

**Engine** — copiado pra dentro da CLI no `init`, executado a cada refresh:
- `lib/moodline-core.mjs` — render + adapters + git + parsing de stdin. Importa apenas built-ins do Node **e `./puns.mjs`**.
- `lib/puns.mjs` — lista de trocadilhos PT-BR.

Os dois são copiados juntos (`install.ENGINE_FILES`) pra `~/.claude/moodline/` (e `~/.copilot/moodline/`), e o `settings.json` aponta pra `node ".../moodline-core.mjs" --adapter=<cli> --config=...`. Por isso o engine **só pode importar arquivos que também são copiados** (hoje: `puns.mjs`) — um import de `logo.mjs`/`ui.mjs`/qualquer outro quebra a cópia instalada.

**Instalador** — roda a partir do pacote npm (node_modules), nunca copiado:
- `lib/install.mjs` — `configure`/`setEnabled`/`uninstall`/`detectInstalled`/`targets`. Escopo **sempre user-level**; aceita `home` injetável.
- `lib/ui.mjs` — prompts (`multiselect`/`select`/`confirm`) e `spinner`, em `node:readline` com raw mode.
- `lib/logo.mjs` — logo ASCII (ANSI Shadow) + `renderLogo`/`printLogo` com gradiente HSL e animação de onda.
- `bin/moodline.js` — dispatcher dos comandos; `init` decide wizard interativo vs flags.

### Fluxo de dados (render)

CLI → JSON no stdin → `from<Cli>(json)` normaliza pro **estado único** → `render(state, cfg)` → string ANSI. O estado é o contrato adapter↔render: `{ model, effort, pct, tokens, ctxSize, costUsd, durationMs, linesAdded, linesRemoved, rate, cwd, gitBranch, repo, git }`.

### Adicionar suporte a uma CLI

Escreva `fromX(json)` em `moodline-core.mjs`, registre em `ADAPTERS`, e (se a CLI tiver statusLine por comando) adicione um alvo em `install.targets()` com o `settings.json` e o `patch` dela. Só **Claude Code** e **GitHub Copilot CLI** têm esse modelo (schemas quase idênticos; no Copilot exige a flag `STATUS_LINE`, ligada pelo `init`). **Gemini**/**OpenCode** não têm (adapters experimentais; OpenCode via `moodline watch` sobre HTTP). **Junie** não dá: o hook `SessionStart` descarta o stdout.

## Invariantes

- **Render nunca lança** — statusline que quebra apaga a barra. `runMain` envolve tudo em try/catch com fallback. Mantenha.
- **Engine só importa arquivos copiados** (`puns.mjs`) + built-ins. Nada de deps no caminho do render (é chamado a cada update).
- **Instalação é global/user-level.** `install.mjs` só escreve em `~/.claude`/`~/.copilot`. Nunca escrever em `.claude` de projeto.
- **`enable`/`disable` não-destrutivos**: `disable` só remove a chave `statusLine`; o engine e o `config.json` ficam, pra re-enable instantâneo.
- **Truncamento width-aware** em `render`: o segmento principal é sempre mantido; extras caem por `prio` quando não cabem em `$COLUMNS`.
- **`.gitattributes` força LF** (shebang/`.sh` quebram com CRLF no Linux/npm). Não reverta.

## Release

Versionamento começa em `v0`. Publicação automática:

```bash
npm version patch            # bumpa a versão e cria a tag v*
git push --follow-tags       # dispara .github/workflows/release.yml → npm publish + GitHub Release
```

Requer o secret `NPM_TOKEN`. `release.yml` usa `--provenance` (exige repo público). Os workflows usam `actions/*@v5`.

## Origem

`legacy/statusline.sh` e `legacy/statusline.ps1` são os scripts originais (Bash+jq / PowerShell) de onde o engine foi portado. Referência; fora do pacote publicado (`files` no `package.json`).
