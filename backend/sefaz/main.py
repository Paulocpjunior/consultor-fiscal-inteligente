"""
cfi-sefaz-proxy — backend de consulta SEFAZ para a Central de Documentos Fiscais.

Responsabilidade:
- Cadastrar certificados digitais A1 (.pfx) no Google Secret Manager.
- Consultar status de NF-es na SEFAZ (cancelada / denegada / regular) usando
  o certificado da empresa titular da chave.
- NUNCA persistir o .pfx em disco; ele vai direto do request para o Secret
  Manager e é descartado da memória após a chamada.

Status atual: SCAFFOLD COM MOCKS. A integração real com SEFAZ está em TODO
e será implementada no próximo passo, quando houver cert A1 de teste.
"""
from __future__ import annotations

import logging
import os
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

# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="CFI SEFAZ Proxy",
    description="Backend seguro para consulta SEFAZ a partir da Central de Documentos Fiscais.",
    version="0.1.0",
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
    """
    Valida Firebase ID token enviado pelo front. Em modo mock, aceita qualquer
    token não vazio e retorna um dict fake.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Authorization header ausente ou inválido.")

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Token vazio.")

    if USE_MOCKS:
        return {"uid": "mock-user", "email": "mock@example.com", "admin": True}

    # TODO: implementar com firebase_admin.auth.verify_id_token(token)
    # quando sair de mocks.
    raise HTTPException(status_code=501, detail="Verificação real ainda não implementada.")


# ─── Schemas ──────────────────────────────────────────────────────────────────


class HealthResponse(BaseModel):
    ok: bool
    timestamp: str
    mode: Literal["mock", "real"]
    version: str


class CertificadoMetadata(BaseModel):
    cnpjTitular: str = Field(..., description="CNPJ extraído do certificado (apenas dígitos).")
    nomeTitular: str
    validoAte: str  # ISO date
    fingerprint: str
    cadastradoEm: str  # ISO datetime
    backendRef: str = Field(..., description="ID lógico no backend (path no Secret Manager).")


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
    chaves: List[str] = Field(..., max_length=50, description="Até 50 chaves por chamada.")
    cnpjTitular: str = Field(..., description="CNPJ da empresa cuja cert assina a consulta.")


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
    senha: str = Form(..., description="Senha do certificado."),
    cnpj: str = Form(..., description="CNPJ esperado da empresa titular."),
    user: dict = Depends(verify_firebase_token),
) -> CertificadoUploadResponse:
    """
    Recebe o .pfx + senha do front, valida que o CNPJ titular bate, extrai
    metadados e salva no Secret Manager. NUNCA grava em disco.
    """
    if not user.get("admin"):
        raise HTTPException(status_code=403, detail="Apenas administradores podem cadastrar certificados.")

    pfx_bytes = await pfx.read()
    if len(pfx_bytes) > 1 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Arquivo .pfx maior que 1 MB.")

    if USE_MOCKS:
        # Mock: assume que tudo bate, devolve metadados sintéticos.
        ref = f"projects/{PROJECT_ID}/secrets/cert-pfx-{cnpj}/versions/1"
        meta = CertificadoMetadata(
            cnpjTitular=cnpj,
            nomeTitular=f"EMPRESA MOCK {cnpj}",
            validoAte="2027-12-31",
            fingerprint="ab:cd:ef:" + "00:" * 13,
            cadastradoEm=datetime.now(timezone.utc).isoformat(),
            backendRef=ref,
        )
        logger.info("MOCK: cert cadastrado para CNPJ %s (size=%d)", cnpj, len(pfx_bytes))
        # IMPORTANTE: descartamos pfx_bytes da memória — Python GC cuida.
        del pfx_bytes
        return CertificadoUploadResponse(ok=True, certificado=meta)

    # TODO real:
    #  1. Carregar .pfx com cryptography.hazmat.primitives.serialization.pkcs12
    #     (load_key_and_certificates) usando a `senha`.
    #  2. Extrair Subject CN, validade, CNPJ titular do extension OID 2.16.76.1.3.3.
    #  3. Confirmar que cnpj recebido bate com o do certificado.
    #  4. Salvar pfx_bytes em google.cloud.secretmanager.SecretManagerServiceClient
    #     no path projects/{PROJECT_ID}/secrets/cert-pfx-{cnpj}.
    #  5. Salvar senha em secret separado cert-senha-{cnpj}.
    #  6. del pfx_bytes; del senha.
    raise HTTPException(status_code=501, detail="Cadastro real ainda não implementado.")


@app.post("/api/sefaz/consulta-status", response_model=ConsultaStatusResponse)
async def consulta_status(
    payload: ConsultaStatusRequest,
    user: dict = Depends(verify_firebase_token),
) -> ConsultaStatusResponse:
    """
    Para cada chave: consulta SEFAZ usando o certificado registrado para
    `cnpjTitular`, devolve cStat e xMotivo atuais.

    Mock: 90% retorna 'regular' (cStat 100), 10% retorna 'cancelada' (cStat 101),
    para o front conseguir testar a UI.
    """
    if not payload.chaves:
        raise HTTPException(status_code=400, detail="Lista de chaves vazia.")

    if USE_MOCKS:
        import hashlib

        resultados: List[ConsultaStatusItem] = []
        agora = datetime.now(timezone.utc).isoformat()
        for chave in payload.chaves:
            # Determinístico: hash da chave decide o status. Útil para testes
            # estáveis (mesma chave sempre devolve mesmo status no mock).
            h = int(hashlib.sha256(chave.encode()).hexdigest(), 16) % 100
            if h < 10:
                resultados.append(ConsultaStatusItem(
                    chave=chave,
                    cStat="101",
                    xMotivo="MOCK: Cancelamento de NF-e homologado",
                    status="cancelada",
                    consultadoEm=agora,
                    canceladaEm=agora,
                ))
            elif h < 12:
                resultados.append(ConsultaStatusItem(
                    chave=chave,
                    cStat="110",
                    xMotivo="MOCK: Uso denegado",
                    status="denegada",
                    consultadoEm=agora,
                ))
            else:
                resultados.append(ConsultaStatusItem(
                    chave=chave,
                    cStat="100",
                    xMotivo="MOCK: Autorizado o uso da NF-e",
                    status="regular",
                    consultadoEm=agora,
                ))
        return ConsultaStatusResponse(ok=True, resultados=resultados)

    # TODO real:
    #  1. Recuperar cert .pfx + senha do Secret Manager para payload.cnpjTitular.
    #  2. Para cada chave, extrair UF (posições 1-2 da chave de 44 dígitos).
    #  3. Montar SOAP NfeConsultaProtocolo com signxml (assinatura XMLDsig).
    #  4. Enviar via httpx async para a URL da UF (tabela hardcoded por UF).
    #  5. Parsear retorno, extrair cStat / xMotivo / dhRecbto.
    #  6. Aplicar mapeamento cStat → status (mesmo do front em xmlParserService).
    #  7. Retornar lista. Cache em Firestore com TTL de 24h em camada superior.
    raise HTTPException(status_code=501, detail="Consulta real ainda não implementada.")


@app.get("/")
def root() -> dict:
    return {
        "service": "cfi-sefaz-proxy",
        "status": "alive",
        "mode": "mock" if USE_MOCKS else "real",
        "endpoints": [
            "GET  /api/health",
            "POST /api/certificados",
            "POST /api/sefaz/consulta-status",
        ],
    }
