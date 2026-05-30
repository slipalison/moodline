#!/bin/bash
# Status line: modelo + effort, barra de contexto (gradiente verde->vermelho),
# porcentagem e tamanho do contexto em ###k.
input=$(cat)

# ---- campos do JSON ----
MODEL=$(echo "$input"  | jq -r '.model.display_name // "?"')
EFFORT=$(echo "$input" | jq -r '.effort.level // empty')
PCT=$(echo "$input"    | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
TOKENS=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
[ -z "$PCT" ] && PCT=0

# ---- tokens em ###k (arredondado) ----
KTOK=$(( (TOKENS + 500) / 1000 ))

# ---- cor em gradiente (HSL hue 120=verde -> 0=vermelho), truecolor 24-bit ----
RGB=$(awk -v p="$PCT" 'BEGIN{
  h=120*(100-p)/100; if(h<0)h=0; if(h>120)h=120;
  if(h<60){r=255; g=255*h/60; b=0} else {r=255*(120-h)/60; g=255; b=0}
  printf "%d %d %d", r+0.5, g+0.5, b+0.5
}')
R=${RGB%% *}; _rest=${RGB#* }; G=${_rest%% *}; B=${RGB##* }
COLOR="\033[38;2;${R};${G};${B}m"
CYAN="\033[36m"; DIM="\033[2m"; RESET="\033[0m"

# ---- barra (20 chars): █ cheio, ▒ borda suave, ░ vazio ----
WIDTH=20
FULL=$(( PCT * WIDTH / 100 )); [ $FULL -gt $WIDTH ] && FULL=$WIDTH
EDGE=0
if [ $FULL -lt $WIDTH ] && [ $PCT -gt 0 ]; then
  EDGE=2; [ $((FULL+EDGE)) -gt $WIDTH ] && EDGE=$((WIDTH-FULL))
fi
EMPTY=$(( WIDTH - FULL - EDGE ))
BAR=""
[ $FULL  -gt 0 ] && printf -v S "%${FULL}s"  && BAR="${S// /█}"
[ $EDGE  -gt 0 ] && printf -v S "%${EDGE}s"  && BAR="${BAR}${S// /▒}"
[ $EMPTY -gt 0 ] && printf -v S "%${EMPTY}s" && BAR="${BAR}${S// /░}"

# ---- humor pela ocupação (💀 quando perto de encher) ----
if   [ "$PCT" -ge 90 ]; then MOOD="💀"
elif [ "$PCT" -ge 75 ]; then MOOD="🥵"
elif [ "$PCT" -ge 50 ]; then MOOD="😅"
elif [ "$PCT" -ge 25 ]; then MOOD="🙂"
else                         MOOD="😎"; fi

# ---- effort (só aparece se o modelo suportar) ----
EFF=""
[ -n "$EFFORT" ] && EFF=" ${DIM}${EFFORT}${RESET}"

printf "%b" "${CYAN}${MODEL}${RESET}${EFF} ${COLOR}[${BAR}]${RESET} ${MOOD} ${COLOR}${PCT}% ${KTOK}k${RESET}\n"
