---
description: Menu da statusline moodline — escolha o que aparece (git, cost, rate, puns), tamanho e layout, sem sair do Claude Code
allowed-tools: Bash(moodline:*)
---
Config atual da moodline:
!`moodline config --cli=claude --show`

Pedido do usuário: $ARGUMENTS

**Se o pedido for específico** (ex.: "desliga o custo", "barra 8", "layout duas linhas", "atualiza"): aplique direto com UM comando e confirme em uma linha. Flags de `moodline config --cli=claude`: `--on=a,b` `--off=c,d` `--toggle=x` `--bar=N` `--layout=single|multi`. Para atualizar: `moodline update`.

**Se o pedido estiver vazio ou genérico** ("config", "menu", "ajustar"): abra um menu interativo com a ferramenta **AskUserQuestion** (use o estado atual acima pra pré-marcar os defaults):
1. header "Barra", multiSelect: true — "O que mostrar na statusline?" — opções: "Git (branch + estado)", "Custo + tempo + linhas", "Rate limits 5h/7d", "Trocadilhos".
2. header "Tamanho" — "Tamanho da barra?" — opções: "8", "10", "12", "16".
3. header "Layout" — "Layout?" — opções: "Uma linha", "Duas linhas".

Depois das respostas, aplique TUDO num único comando, mapeando features (git, cost, rate, puns) marcadas → `--on`, desmarcadas → `--off`:
`moodline config --cli=claude --on=<marcadas> --off=<desmarcadas> --bar=<n> --layout=<single|multi>`
Confirme em uma linha — a barra atualiza no próximo refresh, sem reiniciar.
