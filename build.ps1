#requires -Version 5
<#
  build.ps1 - Dashboard de trafego (MENSAGEM/CTWA + LP) Dr. Vinicius
  Fonte 1: Meta Graph API (insights nivel anuncio, por dia) -> midia + conversas + programar + leads.
  Fonte 3: planilha das secretarias (gviz CSV) -> faturamento total (consultas + cirurgias).
  Token da Meta vem de $env:META_ACCESS_TOKEN (secret do GitHub Actions / .env local).

  Resultado-headline = CONVERSAS por WhatsApp (messaging_conversation_started_7d).
  Programar (Schedule/LP) e Leads (form) = secundarios (hoje ~0 -> slot pronto p/ quando disparar).
  Imposto x1.1385 sobre TODO gasto (Meta Ads).

  Modelo: daily[] (funil por dia) + grain[] (por dia x campanha x conjunto x anuncio) + fin[] (faturamento/dia).
  Publica so agregados (sem PII).
#>
param([string]$Mode = "all")

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---------------- CONFIG ----------------
$ACCOUNT   = "act_1189400572310429"   # Conta de Dr. Vinicius
$API_VER   = "v19.0"
$TAX       = 1.1385                    # imposto Meta Ads
$START     = "2026-05-01"             # busca desde esta data ate hoje (BRT)

# action_types (nomes reais confirmados via API 06/ago/2026)
$CONV_TYPE  = "onsite_conversion.messaging_conversation_started_7d"  # conversas iniciadas (HEADLINE)
$REPLY_TYPE = "onsite_conversion.messaging_first_reply"              # 1a resposta (qualidade)
$LEAD_TYPE  = "lead"                                                 # leads de formulario (Meta agrega)
# Programar/Schedule: somado por match '*schedule*' (fb_pixel_schedule / onsite_web_schedule / schedule)

# Fonte 3 - planilha das secretarias (faturamento)
$FIN_SHEET = "1cOD2Sa9fp8TPJrBia7RY3br_Htg5pCJc5squzmLY4Dk"
$FIN_GID   = "654429203"
$FIN_YEAR  = 2026   # a planilha usa DD/MM sem ano

$OutFile = Join-Path $PSScriptRoot "data.js"

$TOKEN = $env:META_ACCESS_TOKEN
if ([string]::IsNullOrWhiteSpace($TOKEN)) {
  # fallback: le do .env local (nunca commitado) pra rodar na maquina
  $envFile = Join-Path $PSScriptRoot ".env"
  if (Test-Path $envFile) {
    foreach ($ln in [IO.File]::ReadAllLines($envFile)) {
      if ($ln -match '^\s*META_ACCESS_TOKEN\s*=\s*(.+?)\s*$') { $TOKEN = $matches[1].Trim('"').Trim("'") }
    }
  }
}
if ([string]::IsNullOrWhiteSpace($TOKEN)) { throw "META_ACCESS_TOKEN nao definido (env nem .env)." }
# secret colado costuma vir com \n/espaco/aspas no fim -> Meta rejeita (code 190). Limpa.
$TOKEN = $TOKEN.Trim().Trim('"').Trim("'").Trim()

$today = ([DateTime]::UtcNow.AddHours(-3)).ToString("yyyy-MM-dd")   # BRT

# ---------------- HELPERS ----------------
function Get-ActionVal($actions, $type) {
  if (-not $actions) { return 0 }
  foreach ($a in $actions) { if ($a.action_type -eq $type) { return [int][double]$a.value } }
  return 0
}
function Get-ActionMatch($actions, $pattern) {
  # soma o value de todo action_type que casa com o regex (ex.: qualquer '*schedule*')
  if (-not $actions) { return 0 }
  $s = 0
  foreach ($a in $actions) { if ($a.action_type -match $pattern) { $s += [int][double]$a.value } }
  return $s
}
function ToNum($s) { $o = 0.0; [double]::TryParse(("$s"), [Globalization.NumberStyles]::Any, [Globalization.CultureInfo]::InvariantCulture, [ref]$o) | Out-Null; return $o }
function BrMoney($s) {
  # "R$ 1.000,00" -> 1000.00 ; "0,00" -> 0 ; vazio -> 0
  $t = ("$s") -replace '[^\d,]', ''
  if ([string]::IsNullOrWhiteSpace($t)) { return 0.0 }
  $t = $t -replace '\.', '' -replace ',', '.'
  return (ToNum $t)
}
function JsonStr($items) {
  if (-not $items -or $items.Count -eq 0) { return "[]" }
  $parts = foreach ($it in $items) { $it | ConvertTo-Json -Compress -Depth 6 }
  return "[" + ($parts -join ",") + "]"
}

# ---------------- FETCH 1 (Meta Graph API) ----------------
Write-Host "Buscando insights (nivel ad, por dia) de $START ate $today ..."
$fields = "campaign_name,adset_name,ad_name,impressions,reach,clicks,inline_link_clicks,spend,actions"
$tr = '{"since":"' + $START + '","until":"' + $today + '"}'
$url = "https://graph.facebook.com/$API_VER/$ACCOUNT/insights"
$qs  = "?level=ad&time_increment=1&limit=500&fields=$fields&time_range=$tr&access_token=$TOKEN"
$next = $url + $qs

$rows = New-Object System.Collections.Generic.List[object]
$page = 0
while ($next) {
  $resp = Invoke-RestMethod -Uri $next -Method Get
  if ($resp.data) { foreach ($d in $resp.data) { $rows.Add($d) } }
  $page++
  $next = if ($resp.paging -and $resp.paging.next) { $resp.paging.next } else { $null }
}
Write-Host ("  paginas: {0} | linhas ad-dia: {1}" -f $page, $rows.Count)

# ---------------- AGREGACAO MIDIA ----------------
$grain = New-Object System.Collections.Generic.List[object]
$dd = @{}   # date -> agregados do funil
foreach ($r in $rows) {
  $day = ("$($r.date_start)").Trim()
  if ($day -notmatch '^\d{4}-\d{2}-\d{2}$') { continue }
  $spend = (ToNum $r.spend) * $TAX
  $impr  = [int](ToNum $r.impressions); $reach = [int](ToNum $r.reach)
  $clk   = [int](ToNum $r.inline_link_clicks)        # cliques no LINK (Leandro: CTR sempre de link)
  $conv  = Get-ActionVal   $r.actions $CONV_TYPE
  $reply = Get-ActionVal   $r.actions $REPLY_TYPE
  $lead  = Get-ActionVal   $r.actions $LEAD_TYPE
  $sched = Get-ActionMatch $r.actions 'schedule'
  $grain.Add([ordered]@{
    d=$day; camp=("$($r.campaign_name)").Trim(); adset=("$($r.adset_name)").Trim(); ad=("$($r.ad_name)").Trim();
    spend=[math]::Round($spend,2); impr=$impr; reach=$reach; clk=$clk; conv=$conv; reply=$reply; lead=$lead; sched=$sched
  })
  if (-not $dd.ContainsKey($day)) { $dd[$day] = @{ spend=0.0; impr=0; reach=0; clk=0; conv=0; reply=0; lead=0; sched=0 } }
  $dd[$day].spend += $spend; $dd[$day].impr += $impr; $dd[$day].reach += $reach
  $dd[$day].clk += $clk; $dd[$day].conv += $conv; $dd[$day].reply += $reply; $dd[$day].lead += $lead; $dd[$day].sched += $sched
}

$daily = New-Object System.Collections.Generic.List[object]
$allDays = New-Object System.Collections.Generic.SortedSet[string]
foreach ($k in $dd.Keys) { [void]$allDays.Add($k) }
foreach ($day in $allDays) {
  $a = $dd[$day]
  $daily.Add([ordered]@{ d=$day; spend=[math]::Round($a.spend,2); impr=$a.impr; reach=$a.reach;
    clk=$a.clk; conv=$a.conv; reply=$a.reply; lead=$a.lead; sched=$a.sched })
}
$totConv=0; ($dd.Values | ForEach-Object { $totConv += $_.conv })
$totSched=0;($dd.Values | ForEach-Object { $totSched += $_.sched })
$totLead=0; ($dd.Values | ForEach-Object { $totLead += $_.lead })
Write-Host ("  dias: {0} | conversas: {1} | programar: {2} | leads: {3}" -f $daily.Count, $totConv, $totSched, $totLead)

# ---------------- FETCH 3 (faturamento secretarias, gviz CSV) ----------------
$fin = New-Object System.Collections.Generic.List[object]
try {
  Add-Type -AssemblyName Microsoft.VisualBasic
  $csvUrl = "https://docs.google.com/spreadsheets/d/$FIN_SHEET/gviz/tq?tqx=out:csv&gid=$FIN_GID"
  $wc = New-Object System.Net.WebClient
  $wc.Encoding = [Text.Encoding]::UTF8
  $csv = $wc.DownloadString($csvUrl)
  $parser = New-Object Microsoft.VisualBasic.FileIO.TextFieldParser([IO.StringReader]$csv)
  $parser.TextFieldType = [Microsoft.VisualBasic.FileIO.FieldType]::Delimited
  $parser.SetDelimiters(",")
  $parser.HasFieldsEnclosedInQuotes = $true
  $hdr = $null
  # colunas por posicao (planilha fixa): 0 Data | 1 Agend | 2 ValConsulta | 3 TotConsulta | 4 Cirurgias | 5 ValCirurgia | 6 TotCirurgias
  while (-not $parser.EndOfData) {
    $f = $parser.ReadFields()
    if (-not $hdr) { $hdr = $f; continue }
    if ($f.Count -lt 7) { continue }
    $dm = ("$($f[0])").Trim()
    if ($dm -notmatch '^(\d{1,2})/(\d{1,2})') { continue }
    $day = "{0:D4}-{1:D2}-{2:D2}" -f $FIN_YEAR, [int]$matches[2], [int]$matches[1]
    $agend  = [int](ToNum ($f[1] -replace ',', '.'))
    $cirurg = [int](ToNum ($f[4] -replace ',', '.'))
    $fatCon = BrMoney $f[3]
    $fatCir = BrMoney $f[6]
    if ($agend -eq 0 -and $cirurg -eq 0 -and $fatCon -eq 0 -and $fatCir -eq 0) { continue }
    $fin.Add([ordered]@{ d=$day; agend=$agend; cirurg=$cirurg; fatCon=[math]::Round($fatCon,2); fatCir=[math]::Round($fatCir,2); fatTot=[math]::Round($fatCon+$fatCir,2) })
  }
  $parser.Close()
  $tFat=0.0; ($fin | ForEach-Object { $tFat += $_.fatTot })
  Write-Host ("  faturamento: {0} dias com registro | total R$ {1:n2}" -f $fin.Count, $tFat)
} catch {
  Write-Host ("  AVISO: falha ao ler planilha de faturamento -> {0}" -f $_.Exception.Message)
}

# ---------------- OUTPUT data.js ----------------
$now = [DateTime]::UtcNow.AddHours(-3)   # BRT
$meta = [ordered]@{ generatedAt = $now.ToString("yyyy-MM-dd HH:mm"); tz="BRT"; tax=$TAX;
  client="Dr. Vinicius"; account=$ACCOUNT; start=$START }

$js = "window.DASH=" + ($meta | ConvertTo-Json -Compress -Depth 4) + ";" + [Environment]::NewLine
$js += "window.DASH.daily=" + (JsonStr $daily) + ";" + [Environment]::NewLine
$js += "window.DASH.grain=" + (JsonStr $grain) + ";" + [Environment]::NewLine
$js += "window.DASH.fin="   + (JsonStr $fin)   + ";" + [Environment]::NewLine

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($OutFile, $js, $utf8NoBom)
Write-Host ("OK -> {0} ({1:n0} bytes) | dias={2} grain={3} fin={4}" -f $OutFile, (Get-Item $OutFile).Length, $daily.Count, $grain.Count, $fin.Count)
