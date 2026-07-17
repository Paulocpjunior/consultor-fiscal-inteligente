# ============================================================================
# CFI - Agente A3 - Captura de saida de NFC-e (SAE-NFC-e / SEFAZ-SP)
# ----------------------------------------------------------------------------
# Roda NA MAQUINA onde o cartao A3 esta inserido (leitora + middleware do
# fornecedor instalado). Faz EXATAMENTE o mesmo trajeto do servidor CFI com
# certificado A1: lista as chaves das NFC-e emitidas no periodo (webservice
# NFCeListagemChaves), baixa cada XML completo (NFCeDownloadXML) e envia os
# XMLs para o CFI, que importa com a mesma dedup/classificacao.
#
# O PIN do cartao e pedido pelo middleware (SafeNet/Gemalto/etc) na primeira
# assinatura TLS — o script nunca ve nem guarda o PIN.
#
# Requisitos: Windows 10+, PowerShell 5.1+, cartao inserido, middleware ok.
# Uso: botao direito no arquivo > "Executar com o PowerShell"
#      (ou: powershell -ExecutionPolicy Bypass -File .\agente-a3-sae-nfce.ps1)
# ============================================================================

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Preenchidos automaticamente pelo CFI no momento do download do script:
$AppUrl = '__APP_URL__'
$FirebaseApiKey = '__API_KEY__'

$UrlListagem = 'https://nfce.fazenda.sp.gov.br/ws/NFCeListagemChaves.asmx'
$UrlDownload = 'https://nfce.fazenda.sp.gov.br/ws/NFCeDownloadXML.asmx'
$Ns = 'http://www.portalfiscal.inf.br/nfe'
$ThrottleMs = 400
$LoteEnvio = 50

Write-Host ''
Write-Host '=== CFI - Agente A3 - Captura de saida de NFC-e (SEFAZ-SP) ===' -ForegroundColor Cyan
Write-Host ''

# ─── 1. Selecao do certificado (cartao A3 aparece no repositorio do Windows) ─
$certs = @(Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date) })
if ($certs.Count -eq 0) {
    Write-Host 'Nenhum certificado com chave privada encontrado no Windows.' -ForegroundColor Red
    Write-Host 'Confira: cartao inserido, leitora ok e middleware do fornecedor instalado.'
    Read-Host 'ENTER para sair'
    exit 1
}
Write-Host 'Certificados disponiveis:'
for ($i = 0; $i -lt $certs.Count; $i++) {
    Write-Host ("  [{0}] {1}  (validade ate {2:dd/MM/yyyy})" -f $i, $certs[$i].Subject, $certs[$i].NotAfter)
}
$idx = Read-Host 'Numero do certificado do CLIENTE (e-CNPJ do cartao)'
$cert = $certs[[int]$idx]
Write-Host ("Usando: {0}" -f $cert.Subject) -ForegroundColor Green

# CNPJ: tenta extrair do subject (e-CNPJ tem ...:NNNNNNNNNNNNNN); confirma com o operador.
$cnpjSugerido = ''
if ($cert.Subject -match ':(\d{14})') { $cnpjSugerido = $Matches[1] }
$cnpj = Read-Host ("CNPJ do contribuinte (14 digitos)" + $(if ($cnpjSugerido) { " [ENTER = $cnpjSugerido]" } else { '' }))
if (-not $cnpj) { $cnpj = $cnpjSugerido }
$cnpj = $cnpj -replace '\D', ''
if ($cnpj.Length -ne 14) { Write-Host 'CNPJ invalido.' -ForegroundColor Red; Read-Host 'ENTER para sair'; exit 1 }

# ─── 2. Periodo ─────────────────────────────────────────────────────────────
$dtIniStr = Read-Host 'Data inicial (AAAA-MM-DD) [ENTER = 100 dias atras]'
$dtFimStr = Read-Host 'Data final   (AAAA-MM-DD) [ENTER = hoje]'
$dtFim = if ($dtFimStr) { [datetime]::ParseExact($dtFimStr, 'yyyy-MM-dd', $null).AddDays(1) } else { Get-Date }
$dtIni = if ($dtIniStr) { [datetime]::ParseExact($dtIniStr, 'yyyy-MM-dd', $null) } else { $dtFim.AddDays(-100) }
if ($dtIni -ge $dtFim) { Write-Host 'Periodo invalido.' -ForegroundColor Red; Read-Host 'ENTER para sair'; exit 1 }

# ─── 3. Login no CFI (para enviar os XMLs) ──────────────────────────────────
$podeEnviar = ($AppUrl -notlike '__APP*') -and ($FirebaseApiKey -notlike '__API*')
$idToken = $null
if ($podeEnviar) {
    Write-Host ''
    Write-Host 'Login no CFI (mesmo usuario e senha do app):'
    $email = Read-Host '  Email'
    $senhaSec = Read-Host '  Senha' -AsSecureString
    $senha = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($senhaSec))
    try {
        $login = Invoke-RestMethod -Method Post -UseBasicParsing `
            -Uri ("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={0}" -f $FirebaseApiKey) `
            -ContentType 'application/json' `
            -Body (@{ email = $email; password = $senha; returnSecureToken = $true } | ConvertTo-Json)
        $idToken = $login.idToken
        Write-Host '  Login ok.' -ForegroundColor Green
    } catch {
        Write-Host ("  Falha no login: {0}" -f $_.Exception.Message) -ForegroundColor Red
        Write-Host '  Os XMLs serao salvos em pasta local; importe depois pela aba Importacao Manual.'
    } finally { $senha = $null }
} else {
    Write-Host 'Script baixado sem configuracao do app — os XMLs serao salvos em pasta local.' -ForegroundColor Yellow
}

# ─── 4. Helpers SOAP (mesmos envelopes do servidor CFI) ─────────────────────
function Invoke-Sae([string]$Url, [string]$Operation, [string]$Method, [string]$Content) {
    $nsOp = "$Ns/wsdl/$Operation"
    $action = "$nsOp/$Method"
    $envelope = '<?xml version="1.0" encoding="utf-8"?>' +
        '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://www.w3.org/2003/05/soap-envelope">' +
        '<soap:Body>' + ('<nfeDadosMsg xmlns="{0}">{1}</nfeDadosMsg>' -f $nsOp, $Content) + '</soap:Body></soap:Envelope>'
    $resp = Invoke-WebRequest -Uri $Url -Method Post -Certificate $cert -UseBasicParsing `
        -ContentType ('application/soap+xml; charset=utf-8; action="{0}"' -f $action) `
        -Headers @{ SOAPAction = ('"{0}"' -f $action) } `
        -Body ([Text.Encoding]::UTF8.GetBytes($envelope)) -TimeoutSec 90
    return $resp.Content
}
function Get-Tag([string]$Body, [string]$Tag) {
    $m = [regex]::Match($Body, ('<{0}[^>]*>([^<]*)</{0}>' -f $Tag), 'IgnoreCase')
    if ($m.Success) { return $m.Groups[1].Value.Trim() } else { return $null }
}

# ─── 5. Listagem (janelas de <=100 dias, paginacao cStat 101) ───────────────
$chaves = New-Object System.Collections.Generic.List[string]
$wIni = $dtIni
while ($wIni -lt $dtFim) {
    $wFim = $wIni.AddDays(100); if ($wFim -gt $dtFim) { $wFim = $dtFim }
    $cursor = $wIni.ToString('yyyy-MM-ddTHH:mm')
    for ($pag = 0; $pag -lt 60; $pag++) {
        $conteudo = ('<nfceListagemChaves versao="1.00" xmlns="{0}"><tpAmb>1</tpAmb><dataHoraInicial>{1}</dataHoraInicial><dataHoraFinal>{2}</dataHoraFinal></nfceListagemChaves>' -f $Ns, $cursor, $wFim.ToString('yyyy-MM-ddTHH:mm'))
        Write-Host ("Listando {0} -> {1} ..." -f $cursor, $wFim.ToString('yyyy-MM-dd'))
        $body = Invoke-Sae $UrlListagem 'NFCeListagemChaves' 'nfceListagemChaves' $conteudo
        $cStat = Get-Tag $body 'cStat'
        if ($cStat -eq '107') { break }
        if ($cStat -ne '100' -and $cStat -ne '101') {
            Write-Host ("  SEFAZ cStat {0}: {1}" -f $cStat, (Get-Tag $body 'xMotivo')) -ForegroundColor Yellow
            break
        }
        foreach ($m in [regex]::Matches($body, '<chNFCe[^>]*>([0-9A-Za-z]{44})</chNFCe>', 'IgnoreCase')) {
            $chaves.Add($m.Groups[1].Value)
        }
        Write-Host ("  {0} chave(s) acumuladas" -f $chaves.Count)
        if ($cStat -eq '100') { break }
        $prox = (Get-Tag $body 'dhEmisUltNfce')
        if (-not $prox) { break }
        $prox = $prox.Substring(0, [Math]::Min(16, $prox.Length))
        if ($prox -eq $cursor) { break }
        $cursor = $prox
    }
    $wIni = $wFim.AddMinutes(1)
}
if ($chaves.Count -eq 0) {
    Write-Host 'Nenhuma NFC-e no periodo.' -ForegroundColor Yellow
    Read-Host 'ENTER para sair'
    exit 0
}
Write-Host ("Total: {0} chave(s). Baixando XMLs..." -f $chaves.Count) -ForegroundColor Cyan

# ─── 6. Download + salvamento local ─────────────────────────────────────────
$pasta = Join-Path (Get-Location) ("NFCe-Saida-{0}" -f $cnpj)
New-Item -ItemType Directory -Force -Path $pasta | Out-Null
$xmls = New-Object System.Collections.Generic.List[string]
$baixadas = 0; $falhas = 0
foreach ($ch in $chaves) {
    try {
        $conteudo = ('<nfceDownloadXML versao="1.00" xmlns="{0}"><tpAmb>1</tpAmb><chNFCe>{1}</chNFCe></nfceDownloadXML>' -f $Ns, $ch)
        $body = Invoke-Sae $UrlDownload 'NFCeDownloadXML' 'nfceDownloadXML' $conteudo
        $m = [regex]::Match($body, '<nfeProc[\s>][\s\S]*?</nfeProc>', 'IgnoreCase')
        if ($m.Success) {
            $xml = $m.Value
            [IO.File]::WriteAllText((Join-Path $pasta ("{0}.xml" -f $ch)), $xml, [Text.Encoding]::UTF8)
            $xmls.Add($xml)
            $baixadas++
            if ($baixadas % 25 -eq 0) { Write-Host ("  {0}/{1} baixadas..." -f $baixadas, $chaves.Count) }
        } else {
            $falhas++
            Write-Host ("  {0}: cStat {1} {2}" -f $ch.Substring(25, 9), (Get-Tag $body 'cStat'), (Get-Tag $body 'xMotivo')) -ForegroundColor Yellow
        }
    } catch { $falhas++; Write-Host ("  erro em {0}: {1}" -f $ch.Substring(25, 9), $_.Exception.Message) -ForegroundColor Yellow }
    Start-Sleep -Milliseconds $ThrottleMs
}
Write-Host ("Download: {0} ok, {1} falha(s). XMLs em: {2}" -f $baixadas, $falhas, $pasta) -ForegroundColor Cyan

# ─── 7. Envio ao CFI (mesmo importer do trajeto A1) ─────────────────────────
if ($idToken -and $xmls.Count -gt 0) {
    Write-Host 'Enviando ao CFI...'
    $imp = 0; $dup = 0; $att = 0; $err = 0
    for ($i = 0; $i -lt $xmls.Count; $i += $LoteEnvio) {
        $fim = [Math]::Min($i + $LoteEnvio, $xmls.Count)
        $lote = $xmls.GetRange($i, $fim - $i)
        try {
            $r = Invoke-RestMethod -Method Post -UseBasicParsing `
                -Uri ("{0}/api/admin/sae-nfce/importar-xmls" -f $AppUrl.TrimEnd('/')) `
                -ContentType 'application/json; charset=utf-8' `
                -Headers @{ Authorization = ("Bearer {0}" -f $idToken) } `
                -Body (@{ cnpj = $cnpj; xmls = $lote } | ConvertTo-Json -Depth 3 -Compress)
            $imp += $r.importadas; $dup += $r.duplicadas; $att += $r.atualizadas; $err += $r.erros
            Write-Host ("  lote {0}-{1}: {2} importadas, {3} duplicadas, {4} atualizadas, {5} erros" -f ($i + 1), $fim, $r.importadas, $r.duplicadas, $r.atualizadas, $r.erros)
        } catch {
            Write-Host ("  falha no envio do lote {0}-{1}: {2}" -f ($i + 1), $fim, $_.Exception.Message) -ForegroundColor Red
        }
    }
    Write-Host ''
    Write-Host ("=== CONCLUIDO: {0} importadas, {1} atualizadas, {2} duplicadas, {3} erros ===" -f $imp, $att, $dup, $err) -ForegroundColor Green
    Write-Host 'Confira no CFI: Central de Documentos Fiscais > XMLs NFe (Entrada/Saida).'
} elseif ($xmls.Count -gt 0) {
    Write-Host ''
    Write-Host ("XMLs salvos em {0} — importe pela aba Importacao Manual do CFI." -f $pasta) -ForegroundColor Yellow
}
Read-Host 'ENTER para sair'
