FROM python:3.12-slim AS base

# Dependências de sistema para lxml/cryptography (compilação otimizada).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       gcc libxml2-dev libxslt1-dev libssl-dev libffi-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instala deps em camada separada para cache.
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Copia código.
COPY main.py .

# Cloud Run injeta PORT; uvicorn precisa escutar em 0.0.0.0.
ENV PORT=8080
EXPOSE 8080

# 1 worker é suficiente para Cloud Run (autoscaling cuida do resto).
# Não logar acesso para reduzir custo de Cloud Logging.
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT} --workers 1 --no-access-log
