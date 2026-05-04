"""
cert_manager.py — Gestão de certificados digitais A1 da SEFAZ.

Responsabilidades:
- Carregar e validar arquivos .pfx/.p12 em memória.
- Extrair metadados (CNPJ titular via OID 2.16.76.1.3.3, validade, fingerprint).
- Persistir cert + senha em Google Secret Manager (recursos separados por CNPJ).
- Recuperar cert + senha sob demanda para chamadas SOAP.

NUNCA escreve em disco persistente. NUNCA loga conteúdo de chave/senha.
"""
from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Tuple

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.serialization import pkcs12

logger = logging.getLogger("cfi-sefaz.cert")

# OID brasileiro que carrega CPF/CNPJ do titular do cert ICP-Brasil.
OID_PESSOA_JURIDICA = "2.16.76.1.3.3"
OID_PESSOA_FISICA = "2.16.76.1.3.1"


@dataclass
class CertificadoCarregado:
    """Cert + chave privada já desencriptados, prontos para uso em SOAP."""
    cert_pem: bytes
    key_pem: bytes
    cnpj_titular: str
    nome_titular: str
    valido_de: str
    valido_ate: str
    fingerprint_sha256: str

    @property
    def expirado(self) -> bool:
        try:
            return datetime.fromisoformat(self.valido_ate.replace("Z", "+00:00")) < datetime.now(timezone.utc)
        except Exception:
            return False


def _extract_cnpj(cert: x509.Certificate) -> str:
    """
    Procura o CNPJ titular nas extensões. ICP-Brasil grava em
    SubjectAlternativeName.OtherName(OID=2.16.76.1.3.3). O conteúdo é uma
    string ASN.1 com 14 dígitos do CNPJ + outros dados (NIS, INSS, etc.).
    """
    try:
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    except x509.ExtensionNotFound:
        return ""

    for general_name in san:
        if isinstance(general_name, x509.OtherName):
            oid = general_name.type_id.dotted_string
            if oid == OID_PESSOA_JURIDICA:
                # Valor é DER ASN.1 — extrai dígitos numéricos do início.
                raw = general_name.value
                digits = re.sub(rb"[^0-9]", b"", raw).decode("ascii", errors="ignore")
                if len(digits) >= 14:
                    return digits[:14]
    return ""


def _extract_cn(cert: x509.Certificate) -> str:
    """Extract Common Name (CN) do subject — geralmente nome da empresa."""
    for attr in cert.subject:
        if attr.oid == x509.NameOID.COMMON_NAME:
            return str(attr.value)
    return ""


def carregar_pfx(pfx_bytes: bytes, senha: str) -> CertificadoCarregado:
    """
    Decrypta o .pfx com a senha e devolve cert + key em PEM, prontos para
    httpx/requests. Lança ValueError em qualquer erro (senha errada, arquivo
    corrompido, sem CNPJ no cert).
    """
    try:
        priv_key, cert, _additional = pkcs12.load_key_and_certificates(
            pfx_bytes,
            senha.encode("utf-8"),
        )
    except Exception as exc:
        raise ValueError(f"Falha ao decifrar .pfx: {exc.__class__.__name__}") from exc

    if cert is None or priv_key is None:
        raise ValueError(".pfx não contém certificado e chave privada válidos.")

    cnpj = _extract_cnpj(cert)
    if not cnpj:
        raise ValueError("Certificado não contém CNPJ titular (OID 2.16.76.1.3.3).")

    cert_pem = cert.public_bytes(serialization.Encoding.PEM)
    key_pem = priv_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )

    fingerprint = ":".join(f"{b:02x}" for b in cert.fingerprint(hashes.SHA256()))

    return CertificadoCarregado(
        cert_pem=cert_pem,
        key_pem=key_pem,
        cnpj_titular=cnpj,
        nome_titular=_extract_cn(cert),
        valido_de=cert.not_valid_before_utc.isoformat(),
        valido_ate=cert.not_valid_after_utc.isoformat(),
        fingerprint_sha256=fingerprint,
    )


# ─── Secret Manager ────────────────────────────────────────────────────────


def _secret_client():
    # Import preguiçoso para o modo MOCK rodar sem dependência GCP.
    from google.cloud import secretmanager
    return secretmanager.SecretManagerServiceClient()


def _pfx_secret_id(cnpj: str) -> str:
    return f"cert-pfx-{cnpj}"


def _senha_secret_id(cnpj: str) -> str:
    return f"cert-senha-{cnpj}"


def _criar_ou_atualizar_secret(client, project_id: str, secret_id: str, payload: bytes) -> str:
    """Cria o secret se não existir e adiciona uma nova versão com o payload."""
    parent = f"projects/{project_id}"
    secret_name = f"{parent}/secrets/{secret_id}"

    # Tenta criar; ignora se já existe.
    try:
        client.create_secret(
            request={
                "parent": parent,
                "secret_id": secret_id,
                "secret": {"replication": {"automatic": {}}},
            }
        )
    except Exception as exc:
        # AlreadyExists ou similar — segue para adicionar versão.
        if "AlreadyExists" not in str(type(exc).__name__) and "already exists" not in str(exc).lower():
            logger.warning("create_secret %s: %s", secret_id, exc)

    version = client.add_secret_version(
        request={"parent": secret_name, "payload": {"data": payload}}
    )
    return version.name


def salvar_certificado_em_secret_manager(
    project_id: str,
    cnpj: str,
    pfx_bytes: bytes,
    senha: str,
) -> Tuple[str, str]:
    """
    Salva pfx em `cert-pfx-{cnpj}` e senha em `cert-senha-{cnpj}`.
    Devolve os resource names das duas versões.
    """
    client = _secret_client()
    pfx_ref = _criar_ou_atualizar_secret(client, project_id, _pfx_secret_id(cnpj), pfx_bytes)
    senha_ref = _criar_ou_atualizar_secret(client, project_id, _senha_secret_id(cnpj), senha.encode("utf-8"))
    return pfx_ref, senha_ref


def recuperar_certificado(project_id: str, cnpj: str) -> Tuple[bytes, str]:
    """
    Lê pfx e senha do Secret Manager. Levanta KeyError se não houver cert
    cadastrado para o CNPJ.
    """
    client = _secret_client()
    try:
        pfx_resp = client.access_secret_version(
            request={"name": f"projects/{project_id}/secrets/{_pfx_secret_id(cnpj)}/versions/latest"}
        )
        senha_resp = client.access_secret_version(
            request={"name": f"projects/{project_id}/secrets/{_senha_secret_id(cnpj)}/versions/latest"}
        )
    except Exception as exc:
        raise KeyError(f"Certificado não encontrado para CNPJ {cnpj}: {exc}") from exc

    return pfx_resp.payload.data, senha_resp.payload.data.decode("utf-8")


def hash_payload(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()
