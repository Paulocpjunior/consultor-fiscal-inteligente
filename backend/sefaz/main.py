"""
cfi-sefaz-proxy — backend de consulta SEFAZ para a Central de Documentos Fiscais.

USE_MOCKS=true → modo de demonstração (status determinístico por hash).
USE_MOCKS=false → integração real:
  - /api/certificados: parseia .pfx, valida CNPJ titular, persiste em Secret Manager.
  - /api/sefaz/consulta-status: recupera cert do Secret Manager, monta SOAP,
    consulta NfeConsultaProtocolo4 da SEFAZ da UF da chave, retorna cStat + status.

Segurança:
- .pfx NUNCA toca disco persistente (apenas tmpfs durante a chamada SOAP).
- Senha trafega via form-data, vai direto para Secret Manager, não é logada.
- Firebase ID token obrigatório em todos os endpoints (exceto /api/health).
- /api/certificados exige role=admin no Firestore users/{uid}.
"""
from __future__ import annotations

import logging
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cfi-sefaz")

# ─── Config ───────────────────────────────────────────────────────────────────

PROJECT_ID = os.getenv("GCP_PROJECT_ID", "consultorfiscalapp")
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS",
        "https://consultor-fiscal-inteligente-631239634290.us-central1.run.app",
    ).split(",")
    if o.strip()
]
USE_MOCKS = os.getenv("USE_MOCKS", "true").lower() in ("1", "true", "yes")

# Inicializa Firebase Admin uma única vez (preguiçoso, só quando real).
_firebase_initialized = False


def _init_firebase_admin():
    global _firebase_initialized
    if _firebase_initialized:
        return
    import firebase_admin
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    _firebase_initialized = True


# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="CFI SEFAZ Proxy",
    description="Backend seguro para consulta SEFAZ a partir da Central de Documentos Fiscais.",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    allow_credentials=False,
)


# ─── Auth helper ──────────────────────────────────────────────────────────────


def verify_firebase_token(authorization: Optional[str] = Header(default=None)) -> dict:
    """Valida Firebase ID token. Em mock, aceita qualquer token não vazio."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Authorization header ausente ou inválido.")

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Token vazio.")

    if USE_MOCKS:
        return {"uid": "mock-user", "email": "mock@example.com", "admin": True}

    _init_firebase_admin()
    from firebase_admin import auth as fb_auth, firestore as fb_firestore

    try:
        decoded = fb_auth.verify_id_token(token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Token inválido: {exc}") from exc

    uid = decoded.get("uid")
    email = (decoded.get("email") or "").lower()

    # Master admin por email + role no Firestore.
    is_master = email == "junior@spassessoriacontabil.com.br"
    is_admin = is_master
    if not is_master:
        try:
            db = fb_firestore.client()
            user_doc = db.collection("users").document(uid).get()
            if user_doc.exists:
                is_admin = (user_doc.to_dict() or {}).get("role") == "admin"
        except Exception as exc:
            logger.warning("Falha ao ler users/%s para checar role: %s", uid, exc)

    return {"uid": uid, "email": email, "admin": is_admin}


def require_admin(user: dict = Depends(verify_firebase_token)) -> dict:
    if not user.get("admin"):
        raise HTTPException(status_code=403, detail="Apenas administradores.")
    return user


# ─── Schemas ──────────────────────────────────────────────────────────────────


class HealthResponse(BaseModel):
    ok: bool
    timestamp: str
    mode: Literal["mock", "real"]
    version: str


class CertificadoMetadata(BaseModel):
    cnpjTitular: str
    nomeTitular: str
    validoDe: str
    validoAte: str
    fingerprint: str
    cadastradoEm: str
    backendRef: str


class CertificadoUploadResponse(BaseModel):
    ok: bool
    certificado: CertificadoMetadata


class ConsultaStatusItem(BaseModel):
    chave: str
    cStat: str
    xMotivo: str
    status: Literal["regular", "cancelada", "denegada", "inutilizada", "desconhecido"]
    consultadoEm: str
    canceladaEm: Optional[str] = None


class ConsultaStatusRequest(BaseModel):
    chaves: List[str] = Field(..., max_length=50)
    cnpjTitular: str


class ConsultaStatusResponse(BaseModel):
    ok: bool
    resultados: List[ConsultaStatusItem]


# ─── Endpoints ────────────────────────────────────────────────────────────────


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        ok=True,
        timestamp=datetime.now(timezone.utc).isoformat(),
        mode="mock" if USE_MOCKS else "real",
        version=app.version,
    )


@app.post(
    "/api/certificados",
    response_model=CertificadoUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_certificado(
    pfx: UploadFile = File(..., description=".pfx ou .p12 do certificado A1."),
    senha: str = Form(...),
    cnpj: str = Form(..., description="CNPJ esperado (apenas dígitos)."),
    user: dict = Depends(require_admin),
) -> CertificadoUploadResponse:
    pfx_bytes = await pfx.read()
    if len(pfx_bytes) > 1 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Arquivo .pfx maior que 1 MB.")
    if not pfx_bytes:
        raise HTTPException(status_code=400, detail="Arquivo vazio.")

    cnpj_digits = "".join(c for c in cnpj if c.isdigit())
    if len(cnpj_digits) != 14:
        raise HTTPException(status_code=400, detail="CNPJ deve ter 14 dígitos.")

    if USE_MOCKS:
        ref = f"projects/{PROJECT_ID}/secrets/cert-pfx-{cnpj_digits}/versions/1"
        meta = CertificadoMetadata(
            cnpjTitular=cnpj_digits,
            nomeTitular=f"EMPRESA MOCK {cnpj_digits}",
            validoDe="2025-01-01T00:00:00+00:00",
            validoAte="2026-12-31T23:59:59+00:00",
            fingerprint="ab:cd:ef:" + "00:" * 13,
            cadastradoEm=datetime.now(timezone.utc).isoformat(),
            backendRef=ref,
        )
        del pfx_bytes
        return CertificadoUploadResponse(ok=True, certificado=meta)

    # ── Caminho real ──
    from cert_manager import (
        carregar_pfx,
        salvar_certificado_em_secret_manager,
    )

    try:
        carregado = carregar_pfx(pfx_bytes, senha)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if carregado.cnpj_titular != cnpj_digits:
        raise HTTPException(
            status_code=400,
            detail=f"CNPJ no certificado ({carregado.cnpj_titular}) não bate com o informado ({cnpj_digits}).",
        )

    if carregado.expirado:
        raise HTTPException(status_code=400, detail="Certificado expirado.")

    try:
        pfx_ref, _senha_ref = salvar_certificado_em_secret_manager(
            PROJECT_ID, cnpj_digits, pfx_bytes, senha,
        )
    except Exception as exc:
        logger.exception("Falha ao salvar cert no Secret Manager: %s", exc)
        raise HTTPException(status_code=500, detail="Falha ao persistir certificado.") from exc

    # Limpa do RAM o mais cedo possível.
    del pfx_bytes
    del senha

    return CertificadoUploadResponse(
        ok=True,
        certificado=CertificadoMetadata(
            cnpjTitular=carregado.cnpj_titular,
            nomeTitular=carregado.nome_titular,
            validoDe=carregado.valido_de,
            validoAte=carregado.valido_ate,
            fingerprint=carregado.fingerprint_sha256,
            cadastradoEm=datetime.now(timezone.utc).isoformat(),
            backendRef=pfx_ref,
        ),
    )


@app.post("/api/sefaz/consulta-status", response_model=ConsultaStatusResponse)
async def consulta_status(
    payload: ConsultaStatusRequest,
    user: dict = Depends(verify_firebase_token),
) -> ConsultaStatusResponse:
    if not payload.chaves:
        raise HTTPException(status_code=400, detail="Lista de chaves vazia.")

    cnpj_digits = "".join(c for c in payload.cnpjTitular if c.isdigit())

    if USE_MOCKS:
        import hashlib

        resultados: List[ConsultaStatusItem] = []
        agora = datetime.now(timezone.utc).isoformat()
        for chave in payload.chaves:
            h = int(hashlib.sha256(chave.encode()).hexdigest(), 16) % 100
            if h < 10:
                resultados.append(ConsultaStatusItem(
                    chave=chave, cStat="101", xMotivo="MOCK: Cancelamento de NF-e homologado",
                    status="cancelada", consultadoEm=agora, canceladaEm=agora,
                ))
            elif h < 12:
                resultados.append(ConsultaStatusItem(
                    chave=chave, cStat="110", xMotivo="MOCK: Uso denegado",
                    status="denegada", consultadoEm=agora,
                ))
            else:
                resultados.append(ConsultaStatusItem(
                    chave=chave, cStat="100", xMotivo="MOCK: Autorizado o uso da NF-e",
                    status="regular", consultadoEm=agora,
                ))
        return ConsultaStatusResponse(ok=True, resultados=resultados)

    # ── Caminho real ──
    from cert_manager import carregar_pfx, recuperar_certificado
    from sefaz_client import consultar_protocolo

    try:
        pfx_bytes, senha = recuperar_certificado(PROJECT_ID, cnpj_digits)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        carregado = carregar_pfx(pfx_bytes, senha)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=f"Certificado armazenado inválido: {exc}") from exc

    # Paraleliza consultas (5 workers — SEFAZ aceita; rate limits começam acima).
    resultados: List[ConsultaStatusItem] = []

    def _consulta_uma(chave: str) -> ConsultaStatusItem:
        try:
            r = consultar_protocolo(chave, carregado.cert_pem, carregado.key_pem)
            return ConsultaStatusItem(
                chave=r.chave, cStat=r.cStat, xMotivo=r.xMotivo,
                status=r.status, consultadoEm=r.consultado_em, canceladaEm=r.cancelada_em,
            )
        except Exception as exc:
            logger.warning("consulta %s falhou: %s", chave[-10:], exc)
            return ConsultaStatusItem(
                chave=chave, cStat="?", xMotivo=f"Falha: {exc.__class__.__name__}",
                status="desconhecido",
                consultadoEm=datetime.now(timezone.utc).isoformat(),
            )

    with ThreadPoolExecutor(max_workers=5) as pool:
        resultados = list(pool.map(_consulta_uma, payload.chaves))

    return ConsultaStatusResponse(ok=True, resultados=resultados)


@app.get("/")
def root() -> dict:
    return {
        "service": "cfi-sefaz-proxy",
        "status": "alive",
        "mode": "mock" if USE_MOCKS else "real",
        "version": app.version,
        "endpoints": [
            "GET  /api/health",
            "POST /api/certificados",
            "POST /api/sefaz/consulta-status",
        ],
    }
