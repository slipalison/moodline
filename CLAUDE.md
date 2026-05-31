# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

`moodline` é uma statusline instalável via `npx` para CLIs de IA. Renderiza barra de contexto em gradiente, emoji-humor, git, custo/tempo/linhas, rate limits, trocadilhos e um aviso de update. Distribuído no npm; publicado via GitHub Action.

## Princípios (obrigatórios neste repo)

- **Clean Code.** Nomes claros, funções pequenas e com uma responsabilidade, sem código morto, sem comentário óbvio. Comentário explica o *porquê*, não o *o quê*. Early return em vez de aninhar.
- **SOLID** — na prática, com módulos (não classes):
  - **SRP**: um arquivo = uma responsabilidade (engine, puns, jdi, logo, ui, install). Separe IO de lógica — ex.: `buildLine()` é puro (testável), `runMain()` só faz o IO (stdin/stdout).
  - **OCP**: para uma CLI nova, *adicione* um adapter `fromX`/um alvo em `targets()` — não reescreva o `render`.
  - **DIP**: dependa de parâmetros injetáveis, não de globais fixos. Toda função de `install.mjs` recebe `home`; `jdiSegment` recebe `now`/`cmpVer`/`colors`; o cache de update lê `MOODLINE_UPDATE_CACHE`. Isso existe pra testabilidade — preserve.
- **Leve**: zero dependências de runtime (só built-ins do Node). Nada de pacote no caminho do render. Ferramentas de teste/cobertura são built-in do Node — não adicione libs.
- **Testes de unidade** com `node:test`. **Cobertura obrigatória: linhas e funções ≥ 90%, branches ≥ 80%** (gate no CI). Toda mudança de lógica vem com teste. IO puro (stdin/stdout/spawn) pode ficar de fora da meta, desde que a lógica em volta esteja coberta.

## Comandos

```bash
npm test            # node:test (zero deps)
npm run coverage    # node:test + gate de cobertura (90/90/80) — falha se abaixo
echo '<json>' | node bin/moodline.js render --adapter=claude
node bin/moodline.js init --home=<dir> --all --yes    # init NÃO-interativo em HOME sandbox
node bin/moodline.js config --home=<dir> --show
```

**Ao testar `init`/`enable`/`disable`/`config`/`uninstall` localmente, SEMPRE passe `--home=<tempdir>`** — senão escreve no `~/.claude`/`~/.copilot` reais. Os testes usam `mkdtempSync` + `home` injetável e nunca tocam config real.

## Arquitetura

**Engine** (copiado pra dentro da CLI no `init`, roda a cada refresh): `lib/moodline-core.mjs` + `lib/puns.mjs` + `lib/jdi.mjs`. Listados em `install.ENGINE_FILES` e copiados juntos pra `~/.claude/moodline/` (e `~/.copilot/moodline/`); o `settings.json` aponta pra `node ".../moodline-core.mjs" --adapter=<cli> --config=...`. **O engine só pode importar arquivos que também são copiados** (`puns.mjs`, `jdi.mjs`) + built-ins. Importar `ui`/`logo`/`install` daqui quebra a cópia instalada.

**Instalador** (roda do pacote npm, nunca copiado): `lib/install.mjs` (configure/enable/disable/uninstall/config/refreshEngine, sempre user-level, `home` injetável), `lib/ui.mjs` (prompts + spinner), `lib/logo.mjs` (logo + animação), `bin/moodline.js` (dispatcher).

### Fluxo de dados (render)

CLI → JSON no stdin → `from<Cli>(json)` normaliza pro **estado único** → `buildLine` injeta `update`/`jdi` → `render(state, cfg)` → string ANSI. Estado = `{ model, effort, pct, tokens, ctxSize, costUsd, durationMs, linesAdded, linesRemoved, rate, cwd, gitBranch, repo, git, update, jdi }`.

### Segmentos e prioridade

`render` monta o núcleo (sempre presente) + opcionais, cada um com `prio` (ordem de queda no single quando estreito) e `line` (no layout `multi`: `line 1` = núcleo + métricas = update/cost/rate; `line 2` = git/jdi/puns). No single o `line` é ignorado e cai por `prio`. Ao adicionar segmento, defina `prio` e `line`.

### Update e JDI (não-opcionais)

- **Update**: `buildLine` lê um cache (sync) e mostra `⬆ vX` se há versão nova; `maybeSpawnCheck` dispara um processo filho destacado (`--update-check`) no máx. 1×/dia pra buscar no npm. O render **nunca** faz rede.
- **JDI** (`jdi.mjs`): se o jdi-cli não está instalado (local nem global), anúncio ocasional no lugar do trocadilho; se está, aviso de update dele. Deteção pesada (global via `npm root -g` + versão no npm) vai no check de background; a local é stat barato por render. **Por decisão de produto, não é configurável** — não passe por `cfg.features`.

### Adicionar suporte a uma CLI

Escreva `fromX(json)` em `moodline-core.mjs`, registre em `ADAPTERS`, e (se tiver statusLine por comando) adicione um alvo em `install.targets()`. Só **Claude Code** e **Copilot CLI** têm esse modelo (no Copilot exige a flag `STATUS_LINE`, ligada pelo `init`). Gemini/OpenCode = adapters experimentais; Junie não suporta (hook descarta stdout).

## Invariantes

- **Render nunca lança** — `buildLine` tem try/catch com fallback. Statusline que quebra apaga a barra.
- **Engine só importa arquivos copiados + built-ins.** Sem deps no caminho do render.
- **Instalação é global/user-level.** Nunca escrever em `.claude` de projeto.
- **`enable`/`disable`/`config` não-destrutivos**: editam `settings.json`/`config.json` preservando o resto; a barra atualiza no próximo refresh (sem reiniciar).
- **Slash command `/moodline`** (Claude Code) é instalado pelo `init` em `~/.claude/commands/moodline.md`: deixa togglar/atualizar de dentro da sessão.
- **`.gitattributes` força LF** (shebang/`.sh` quebram com CRLF no Linux/npm).

## Release

Versionamento em `v0`. Publicação automática:

```bash
npm version patch && git push --follow-tags   # dispara release.yml → coverage gate → npm publish + GitHub Release
```

Requer o secret `NPM_TOKEN`. `release.yml` usa `--provenance` (repo público). Workflows usam `actions/*@v5`; cobertura roda em Node 24 (flags de cobertura nativas exigem Node ≥ 22.8).

## Origem

`legacy/statusline.sh` e `legacy/statusline.ps1` são os scripts originais (Bash+jq / PowerShell) de onde o engine foi portado. Referência; fora do pacote publicado.
