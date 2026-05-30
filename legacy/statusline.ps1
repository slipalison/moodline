# statusline.ps1
# modelo + effort, barra de contexto (gradiente verde->vermelho), porcentagem e tamanho ###k
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ---- le o JSON que o Claude Code manda no stdin ----
$j = $input | Out-String | ConvertFrom-Json

$model  = if ($j.model.display_name) { $j.model.display_name } else { "?" }
$effort = $j.effort.level
$pct    = $j.context_window.used_percentage
$tokens = $j.context_window.total_input_tokens
if ($null -eq $pct)    { $pct = 0 }
if ($null -eq $tokens) { $tokens = 0 }
$pct = [int][math]::Floor([double]$pct)

# ---- tokens em ###k (arredondado) ----
$ktok = [int][math]::Round([double]$tokens / 1000)

# ---- cor em gradiente (HSL hue 120=verde -> 0=vermelho), truecolor 24-bit ----
$h = 120 * (100 - $pct) / 100
if ($h -lt 0)   { $h = 0 }
if ($h -gt 120) { $h = 120 }
if ($h -lt 60) { $r = 255;                 $g = 255 * $h / 60;        $b = 0 }
else           { $r = 255 * (120 - $h) / 60; $g = 255;                 $b = 0 }
$r = [int][math]::Round($r); $g = [int][math]::Round($g); $b = [int][math]::Round($b)

$ESC   = [char]27
$COLOR = "$ESC[38;2;$r;$g;${b}m"
$CYAN  = "$ESC[36m"
$DIM   = "$ESC[2m"
$RESET = "$ESC[0m"

# ---- barra (20 chars): cheio / borda suave / vazio ----
$width = 20
$full  = [int][math]::Floor($pct * $width / 100)
if ($full -gt $width) { $full = $width }
$edge = 0
if ($full -lt $width -and $pct -gt 0) {
    $edge = 2
    if (($full + $edge) -gt $width) { $edge = $width - $full }
}
$empty = $width - $full - $edge

$F = [string][char]0x2588   # full block
$E = [string][char]0x2592   # medium shade (borda)
$V = [string][char]0x2591   # light shade (vazio)
$bar = ($F * $full) + ($E * $edge) + ($V * $empty)

# ---- humor pela ocupacao (caveira quando perto de encher) ----
if     ($pct -ge 90) { $mood = [char]::ConvertFromUtf32(0x1F480) }  # caveira
elseif ($pct -ge 75) { $mood = [char]::ConvertFromUtf32(0x1F975) }  # rosto quente
elseif ($pct -ge 50) { $mood = [char]::ConvertFromUtf32(0x1F605) }  # suando
elseif ($pct -ge 25) { $mood = [char]::ConvertFromUtf32(0x1F642) }  # sorriso leve
else                 { $mood = [char]::ConvertFromUtf32(0x1F60E) }  # de boa

# ---- effort (so aparece se o modelo suportar) ----
$eff = ""
if ($effort) { $eff = " $DIM$effort$RESET" }

Write-Host "$CYAN$model$RESET$eff ${COLOR}[$bar]$RESET $mood ${COLOR}$pct% ${ktok}k$RESET"
