#!/usr/bin/env python3
# ============================================================================
# scripts/sbc-agente-saida.py — o agente do click-to-call, DENTRO da VM do SBC
# ----------------------------------------------------------------------------
# O colaborador clica em [☎️ Ligar] no SP Connect; o app grava um PEDIDO; este
# agente pergunta ao app (GET /sbc/pedidos, com segredo) se há pedido novo,
# escreve um CALL FILE para o Asterisk (que toca o RAMAL do colaborador e, ao
# atender, disca o cliente pela perna Meta) e devolve ao app o que o CDR disse.
#
# POR QUE ASSIM (docs/sbc-whatsapp-hitphone.md, "SAÍDA — botão na conversa"):
#  · a VM não expõe porta nova: quem fala é o agente, para fora, por HTTPS;
#  · call file é o jeito mais simples e provado de originar sem AMI/ARI;
#  · a resposta "atendeu?" vem do CDR (Master.csv) pela conta = id do pedido —
#    não é deduzida. Sem linha no CDR dentro da espera, é FALHA nomeada.
#
# Só biblioteca padrão (urllib/json/subprocess) — a VM não tem pip.
# Instalado por scripts/setup-sbc-whatsapp.sh como serviço systemd
# `sbc-agente-saida`, rodando como usuário `asterisk`. Config em
# /etc/sbc-agente.env: CFI_URL e SBC_SHARED_SECRET (e opcionais abaixo).
# ============================================================================
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request

VERSAO = "1.0.0"
ENV_FILE = os.environ.get("SBC_AGENTE_ENV", "/etc/sbc-agente.env")
SPOOL = os.environ.get("SBC_SPOOL", "/var/spool/asterisk/outgoing")
CDR_CSV = os.environ.get("SBC_CDR_CSV", "/var/log/asterisk/cdr-csv/Master.csv")
INTERVALO_S = float(os.environ.get("SBC_INTERVALO_S", "2"))
# Espera do ramal (40 s) + do cliente (60 s) + folga: depois disso, sem CDR, é falha.
ESPERA_CDR_S = int(os.environ.get("SBC_ESPERA_CDR_S", "130"))
CONTEXTO_SAIDA = "saida-whatsapp"
ENDPOINT_HIT = "hit"
ESPERA_RAMAL_S = 40


def log(msg):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


def ler_env(caminho):
    cfg = {}
    try:
        with open(caminho, "r", encoding="utf-8") as f:
            for linha in f:
                linha = linha.strip()
                if not linha or linha.startswith("#") or "=" not in linha:
                    continue
                k, v = linha.split("=", 1)
                cfg[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        return None
    return cfg


def http(metodo, url, segredo, corpo=None):
    dados = None
    cab = {
        "x-sbc-secret": segredo,
        "x-sbc-agente-versao": VERSAO,
        "x-sbc-agente-host": socket.gethostname()[:80],
        "Accept": "application/json",
    }
    if corpo is not None:
        dados = json.dumps(corpo).encode("utf-8")
        cab["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=dados, method=metodo, headers=cab)
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8") or "{}")


def montar_call_file(ramal, numero, pedido_id, nome):
    # Mesmas linhas que sefaz-backend/whatsapp-click-to-call.js monta (e prova).
    import re
    if not re.fullmatch(r"\d{2,6}", ramal or ""):
        raise ValueError("ramal invalido: %r" % (ramal,))
    if not re.fullmatch(r"\d{10,15}", numero or ""):
        raise ValueError("numero invalido: %r" % (numero,))
    if not re.fullmatch(r"[A-Za-z0-9_]{6,80}", pedido_id or ""):
        raise ValueError("pedido invalido: %r" % (pedido_id,))
    nome_limpo = re.sub(r"[^\w .-]", "", nome or "", flags=re.UNICODE).strip()[:30]
    rotulo = ("WhatsApp " + nome_limpo) if nome_limpo else ("WhatsApp " + numero)
    linhas = [
        "Channel: PJSIP/%s@%s" % (ramal, ENDPOINT_HIT),
        'CallerID: "%s" <%s>' % (rotulo, numero),
        "MaxRetries: 0",
        "RetryTime: 0",
        "WaitTime: %d" % ESPERA_RAMAL_S,
        "Context: %s" % CONTEXTO_SAIDA,
        "Extension: %s" % numero,
        "Priority: 1",
        "Account: %s" % pedido_id,
        "Set: PEDIDO=%s" % pedido_id,
        "Archive: no",
        "",
    ]
    return "\n".join(linhas)


def escrever_call_file(conteudo, pedido_id):
    # Escreve fora do spool e MOVE: o Asterisk lê o arquivo assim que ele
    # aparece, e um arquivo pela metade viraria ligação pela metade.
    tmp = os.path.join(os.path.dirname(SPOOL.rstrip("/")), "tmp", pedido_id + ".call")
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(conteudo)
    destino = os.path.join(SPOOL, pedido_id + ".call")
    os.replace(tmp, destino)
    return destino


def ler_cdr_do_pedido(pedido_id):
    # Última linha do Master.csv com accountcode == pedido (campo 0, entre aspas).
    peso = {"ANSWERED": 4, "BUSY": 3, "NO ANSWER": 2, "FAILED": 1, "CONGESTION": 1}
    melhor = None
    try:
        with open(CDR_CSV, "r", encoding="utf-8", errors="replace") as f:
            for linha in f:
                if not linha.startswith('"' + pedido_id + '"'):
                    continue
                campos = ler_linha_csv(linha.rstrip("\r\n"))
                if len(campos) < 15:
                    continue
                cdr = {
                    "dstchannel": campos[6],
                    "lastdata": campos[8],
                    "billsec": int(campos[13] or 0) if (campos[13] or "0").isdigit() else 0,
                    "disposition": (campos[14] or "").strip().upper(),
                }
                if melhor is None or peso.get(cdr["disposition"], 0) > peso.get(melhor["disposition"], 0):
                    melhor = cdr
    except FileNotFoundError:
        return None
    return melhor


def ler_linha_csv(linha):
    campos, atual, dentro = [], "", False
    i = 0
    while i < len(linha):
        ch = linha[i]
        if ch == '"':
            if dentro and i + 1 < len(linha) and linha[i + 1] == '"':
                atual += '"'
                i += 1
            else:
                dentro = not dentro
        elif ch == "," and not dentro:
            campos.append(atual)
            atual = ""
        else:
            atual += ch
        i += 1
    campos.append(atual)
    return campos


def traduzir(cdr):
    # Mesma tradução de traduzirResultado() no núcleo JS.
    if cdr is None:
        return ("falhou", None, None,
                "O tronco não registrou a ligação (nenhuma linha no CDR com este pedido) — o ramal existe? o Asterisk está de pé?")
    d = cdr["disposition"]
    perna = bool(cdr["dstchannel"])
    if d == "ANSWERED":
        if perna:
            return ("atendida", d, cdr["billsec"], "Cliente atendeu — %ds de conversa." % cdr["billsec"])
        return ("falhou", d, cdr["billsec"],
                "O ramal atendeu, mas a perna do cliente não foi discada — confira META_SIP_DESTINO no SBC (saída bloqueada?).")
    if d == "BUSY":
        return ("ocupado", d, 0, "O cliente estava ocupado (ou recusou no WhatsApp)." if perna else "O ramal estava ocupado.")
    if d == "NO ANSWER":
        return ("nao-atendida", d, 0, "O cliente não atendeu no WhatsApp." if perna else "O ramal não atendeu — a ligação nem saiu para o cliente.")
    extra = " (%s)" % cdr["lastdata"] if cdr.get("lastdata") else ""
    return ("falhou", d, 0, "O tronco devolveu %s%s — o log do Asterisk (asterisk -rvvv) diz em que perna parou." % (d or "sem disposição", extra))


def acompanhar(pedido_id, base, segredo, em_andamento):
    # Chamado a cada volta do laço: quando o CDR aparecer (ou a espera vencer),
    # devolve o resultado ao app e tira o pedido da lista.
    inicio = em_andamento[pedido_id]
    cdr = ler_cdr_do_pedido(pedido_id)
    if cdr is None and time.time() - inicio < ESPERA_CDR_S:
        return
    status, disp, billsec, detalhe = traduzir(cdr)
    try:
        http("POST", "%s/api/admin/whatsapp/sbc/pedidos/%s/resultado" % (base, pedido_id), segredo,
             {"status": status, "disposicao": disp, "billsec": billsec, "detalhe": detalhe})
        log("pedido %s: %s — %s" % (pedido_id, status, detalhe))
        del em_andamento[pedido_id]
    except Exception as e:  # noqa: BLE001 — rede caiu: tenta na próxima volta
        log("pedido %s: não consegui devolver o resultado (%s); tento de novo" % (pedido_id, e))


def main():
    cfg = ler_env(ENV_FILE)
    if not cfg or not cfg.get("CFI_URL") or not cfg.get("SBC_SHARED_SECRET"):
        log("sem %s (CFI_URL e SBC_SHARED_SECRET) — o agente fica parado. Rode o setup-sbc-whatsapp.sh com SBC_SHARED_SECRET." % ENV_FILE)
        # Dorme em vez de sair: o systemd reiniciaria em laço e encheria o log.
        while True:
            time.sleep(60)
    base = cfg["CFI_URL"].rstrip("/")
    segredo = cfg["SBC_SHARED_SECRET"]
    log("agente %s de pé — app=%s spool=%s cdr=%s" % (VERSAO, base, SPOOL, CDR_CSV))
    em_andamento = {}
    falhas_seguidas = 0
    while True:
        try:
            r = http("GET", base + "/api/admin/whatsapp/sbc/pedidos", segredo)
            falhas_seguidas = 0
            for p in r.get("pedidos") or []:
                pid = p.get("id")
                try:
                    conteudo = montar_call_file(p.get("ramal"), p.get("numero"), pid, p.get("nomeContato"))
                    caminho = escrever_call_file(conteudo, pid)
                    em_andamento[pid] = time.time()
                    log("pedido %s: call file em %s (ramal %s → %s, por %s)" % (pid, caminho, p.get("ramal"), p.get("numero"), p.get("solicitadoPor")))
                except Exception as e:  # noqa: BLE001
                    log("pedido %s: NÃO consegui escrever o call file: %s" % (pid, e))
                    try:
                        http("POST", "%s/api/admin/whatsapp/sbc/pedidos/%s/resultado" % (base, pid), segredo,
                             {"status": "falhou", "detalhe": "O agente da VM não conseguiu criar o call file: %s" % e})
                    except Exception as e2:  # noqa: BLE001
                        log("pedido %s: e nem devolver a falha: %s" % (pid, e2))
            for pid in list(em_andamento.keys()):
                acompanhar(pid, base, segredo, em_andamento)
        except urllib.error.HTTPError as e:
            falhas_seguidas += 1
            if e.code in (401, 503):
                log("o app recusou o agente (HTTP %d): segredo diferente do SBC_SHARED_SECRET do Cloud Run, ou não configurado lá" % e.code)
            elif falhas_seguidas in (1, 10, 100):
                log("HTTP %d ao pedir a fila (%d seguidas)" % (e.code, falhas_seguidas))
        except Exception as e:  # noqa: BLE001
            falhas_seguidas += 1
            if falhas_seguidas in (1, 10, 100):
                log("sem resposta do app (%s) — %d falha(s) seguidas" % (e, falhas_seguidas))
        time.sleep(INTERVALO_S if falhas_seguidas < 10 else 15)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
