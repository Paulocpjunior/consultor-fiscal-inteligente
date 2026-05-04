"""
sefaz_client.py — Cliente SOAP para consulta de protocolo de NF-e.

Implementa apenas NfeConsultaProtocolo4 (chave única → cStat atual).
Para consulta em lote usa-se NFeDistribuicaoDFe; ficou para depois.

Política:
- mTLS via httpx + tempfile (cert/key carregados em /tmp do Cloud Run, que é
  tmpfs/RAM — nunca toca disco persistente).
- Assinatura XMLDsig via signxml.
- Mapeia cStat para status do domínio (regular / cancelada / denegada / inutilizada).
"""
from __future__ import annotations

import logging
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from xml.etree import ElementTree as ET

import httpx
from lxml import etree
from signxml import SignatureMethod, XMLSigner

logger = logging.getLogger("cfi-sefaz.client")

# ─── URLs de produção da SEFAZ por UF (NfeConsultaProtocolo4) ──────────────
# Maioria dos estados usa SVRS (Sefaz Virtual RS). Apenas alguns têm endpoint próprio.
SVRS_URL = "https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx"

UF_URLS = {
    "SP": "https://nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx",
    "MG": "https://nfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4",
    "RS": "https://nfe.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
    "PR": "https://nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4?wsdl",
    "MT": "https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4",
    "MS": "https://nfe.fazenda.ms.gov.br/ws/NFeConsultaProtocolo4",
    "BA": "https://nfe.sefaz.ba.gov.br/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx",
    "GO": "https://nfe.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4?wsdl",
    "PE": "https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeConsultaProtocolo4",
    # Estados que usam SVRS:
    "AC": SVRS_URL, "AL": SVRS_URL, "AM": SVRS_URL, "AP": SVRS_URL,
    "CE": SVRS_URL, "DF": SVRS_URL, "ES": SVRS_URL, "MA": SVRS_URL,
    "PA": SVRS_URL, "PB": SVRS_URL, "PI": SVRS_URL, "RJ": SVRS_URL,
    "RN": SVRS_URL, "RO": SVRS_URL, "RR": SVRS_URL, "SC": SVRS_URL,
    "SE": SVRS_URL, "TO": SVRS_URL,
}

# cUF → UF
CUF_TO_UF = {
    11: "RO", 12: "AC", 13: "AM", 14: "RR", 15: "PA", 16: "AP", 17: "TO",
    21: "MA", 22: "PI", 23: "CE", 24: "RN", 25: "PB", 26: "PE", 27: "AL",
    28: "SE", 29: "BA", 31: "MG", 32: "ES", 33: "RJ", 35: "SP",
    41: "PR", 42: "SC", 43: "RS", 50: "MS", 51: "MT", 52: "GO", 53: "DF",
}

NS_NFE = "http://www.portalfiscal.inf.br/nfe"
NS_SOAP = "http://www.w3.org/2003/05/soap-envelope"


@dataclass
class ConsultaResult:
    chave: str
    cStat: str
    xMotivo: str
    status: str  # regular | cancelada | denegada | inutilizada | desconhecido
    consultado_em: str
    cancelada_em: Optional[str] = None


def _classificar_cstat(cstat: str) -> str:
    if cstat == "100":
        return "regular"
    if cstat in ("101", "151", "135", "155"):
        return "cancelada"
    if cstat in ("110", "301", "302"):
        return "denegada"
    if cstat in ("102",):
        return "inutilizada"
    return "desconhecido"


def _extrair_uf(chave: str) -> str:
    """Os 2 primeiros dígitos da chave de 44 são o cUF."""
    if len(chave) < 44:
        raise ValueError(f"Chave inválida (esperado 44 dígitos): {len(chave)}")
    cuf = int(chave[:2])
    uf = CUF_TO_UF.get(cuf)
    if not uf:
        raise ValueError(f"cUF {cuf} desconhecido na chave {chave}")
    return uf


def _montar_consulta_xml(chave: str) -> bytes:
    """Monta <consSitNFe> sem assinatura (NfeConsultaProtocolo4 não exige)."""
    consulta = etree.Element(f"{{{NS_NFE}}}consSitNFe", versao="4.00")
    etree.SubElement(consulta, f"{{{NS_NFE}}}tpAmb").text = "1"  # 1=produção
    etree.SubElement(consulta, f"{{{NS_NFE}}}xServ").text = "CONSULTAR"
    etree.SubElement(consulta, f"{{{NS_NFE}}}chNFe").text = chave
    return etree.tostring(consulta, xml_declaration=True, encoding="UTF-8")


def _envelopar_soap(consulta_xml: bytes, uf: str) -> bytes:
    """Envelopa <consSitNFe> num envelope SOAP 1.2 conforme SEFAZ exige."""
    cuf = next(k for k, v in CUF_TO_UF.items() if v == uf)
    envelope = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<soap:Envelope xmlns:soap="{NS_SOAP}">'
        '<soap:Header>'
        f'<nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">'
        f'<cUF>{cuf}</cUF><versaoDados>4.00</versaoDados>'
        '</nfeCabecMsg>'
        '</soap:Header>'
        '<soap:Body>'
        f'<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">'
        f'{consulta_xml.decode("utf-8")}'
        '</nfeDadosMsg>'
        '</soap:Body>'
        '</soap:Envelope>'
    )
    return envelope.encode("utf-8")


def _extrair_resposta(soap_response: bytes, chave: str) -> ConsultaResult:
    """Parseia a resposta SOAP e extrai cStat / xMotivo."""
    root = etree.fromstring(soap_response)
    # Busca recursiva pelos campos — SEFAZ é generosa com namespaces.
    ns = {"nfe": NS_NFE}
    cstat_el = root.find(".//nfe:cStat", ns)
    motivo_el = root.find(".//nfe:xMotivo", ns)
    dh_recbto_el = root.find(".//nfe:dhRecbto", ns)

    cstat = (cstat_el.text or "").strip() if cstat_el is not None else ""
    motivo = (motivo_el.text or "").strip() if motivo_el is not None else ""

    cancelada_em = None
    if cstat in ("101", "151") and dh_recbto_el is not None:
        cancelada_em = (dh_recbto_el.text or "").strip()

    return ConsultaResult(
        chave=chave,
        cStat=cstat or "?",
        xMotivo=motivo,
        status=_classificar_cstat(cstat),
        consultado_em=datetime.now(timezone.utc).isoformat(),
        cancelada_em=cancelada_em,
    )


def consultar_protocolo(chave: str, cert_pem: bytes, key_pem: bytes, timeout: float = 20.0) -> ConsultaResult:
    """
    Consulta NfeConsultaProtocolo4 para uma única chave.
    Levanta ValueError em chave inválida ou UF desconhecida.
    Levanta httpx.HTTPError em erro de rede.
    """
    uf = _extrair_uf(chave)
    url = UF_URLS.get(uf)
    if not url:
        raise ValueError(f"UF {uf} sem URL configurada.")

    consulta_xml = _montar_consulta_xml(chave)
    soap_body = _envelopar_soap(consulta_xml, uf)

    # mTLS: httpx aceita cert/key como tupla de paths. Usamos tempfile que
    # vive em /tmp (tmpfs no Cloud Run) e é deletado ao sair do `with`.
    with tempfile.NamedTemporaryFile(suffix=".pem", delete=True) as cert_f, \
         tempfile.NamedTemporaryFile(suffix=".pem", delete=True) as key_f:
        cert_f.write(cert_pem); cert_f.flush()
        key_f.write(key_pem); key_f.flush()

        headers = {
            "Content-Type": "application/soap+xml; charset=utf-8",
            "SOAPAction": "http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4/nfeConsultaNF",
        }

        with httpx.Client(verify=True, cert=(cert_f.name, key_f.name), timeout=timeout) as client:
            resp = client.post(url, content=soap_body, headers=headers)
            resp.raise_for_status()
            return _extrair_resposta(resp.content, chave)
