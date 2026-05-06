// ============================================================================
// components/CertificadoDigitalUpload.tsx
// ----------------------------------------------------------------------------
// Componente de upload do certificado A1 ICP-Brasil para captura SEFAZ.
// Renderizado dentro da aba "Configurações" da Central de Documentos Fiscais.
//
// Fluxo:
//   1. Carrega status atual via GET /api/admin/sefaz/cert/status
//   2. Drag-drop ou clique para selecionar .pfx (max 5MB)
//   3. Senha (mascarada por default, com toggle mostrar)
//   4. Submit via POST /api/admin/sefaz/cert (multipart, Bearer token)
//   5. Backend valida, grava no Secret Manager, retorna metadados
//   6. UI atualiza status card
// ============================================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getAuth } from 'firebase/auth';

type CertStatus = {
  configured: boolean;
  cnpj?: string;
  cpfTitular?: string;
  titular?: string;
  cnCompleto?: string;
  tipo?: 'PJ' | 'PF' | 'desconhecido';
  fingerprint?: string;
  isICPBrasil?: boolean;
  issuer?: { cn?: string; o?: string };
  validade?: {
    inicio: string;
    fim: string;
    diasRestantes: number;
    expirado: boolean;
    proximoVencimento: boolean;
  };
  uploadedBy?: { uid: string; email: string };
  uploadedAt?: { _seconds: number } | string;
};

const formatDateBR = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';

const formatCNPJ = (raw?: string) => {
  if (!raw || raw.length !== 14) return raw || '—';
  return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8, 12)}-${raw.slice(12)}`;
};

const formatCPF = (raw?: string) => {
  if (!raw || raw.length !== 11) return raw || '—';
  return `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6, 9)}-${raw.slice(9)}`;
};

const validityClasses = (dias?: number) => {
  if (dias === undefined) return 'text-slate-400';
  if (dias <= 0) return 'text-red-400';
  if (dias < 30) return 'text-amber-400';
  if (dias < 90) return 'text-yellow-400';
  return 'text-emerald-400';
};

const CertificadoDigitalUpload: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [status, setStatus] = useState<CertStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const getToken = useCallback(async () => {
    const user = getAuth().currentUser;
    if (!user) throw new Error('Sessão expirada — faça login novamente');
    return user.getIdToken();
  }, []);

  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/sefaz/cert/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStatus(data);
    } catch (e: any) {
      console.error('[fetchStatus]', e);
      setStatus({ configured: false });
    } finally {
      setLoadingStatus(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleFile = (f: File | null) => {
    setError(null);
    setSuccess(null);
    if (!f) return;
    if (!/\.(pfx|p12)$/i.test(f.name)) {
      setError('O arquivo deve ter extensão .pfx ou .p12');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError('Arquivo muito grande (máx 5MB)');
      return;
    }
    if (f.size < 100) {
      setError('Arquivo muito pequeno — provavelmente corrompido');
      return;
    }
    setFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    handleFile(e.dataTransfer.files?.[0] || null);
  };

  const handleSubmit = async () => {
    if (!file) {
      setError('Selecione o arquivo .pfx');
      return;
    }
    if (!password) {
      setError('Informe a senha do certificado');
      return;
    }
    setUploading(true);
    setError(null);
    setSuccess(null);
    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append('cert', file);
      formData.append('password', password);

      const res = await fetch('/api/admin/sefaz/cert', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Falha no upload (HTTP ${res.status})`);
        return;
      }
      setSuccess(`Certificado salvo. Titular: ${data.info.titular}`);
      setFile(null);
      setPassword('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      await fetchStatus();
    } catch (e: any) {
      setError(e.message || 'Erro de rede');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Desabilitar o certificado atual? A captura SEFAZ ficará indisponível até novo upload. (As versões anteriores no Secret Manager são preservadas para auditoria.)')) return;
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/sefaz/cert', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Falha ao desabilitar');
        return;
      }
      setSuccess('Certificado desabilitado.');
      await fetchStatus();
    } catch (e: any) {
      setError(e.message || 'Erro de rede');
    }
  };

  return (
    <div className="space-y-6">
      {/* --- STATUS CARD --- */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Certificado Digital A1 — Status</h3>
          {status?.configured && (
            <button
              onClick={handleDelete}
              className="text-xs text-red-400 hover:text-red-300 px-3 py-1 border border-red-500/30 rounded hover:bg-red-500/10 transition"
            >
              Desabilitar
            </button>
          )}
        </div>

        {loadingStatus ? (
          <div className="text-slate-400 text-sm">Carregando…</div>
        ) : !status?.configured ? (
          <div className="flex items-start gap-3 text-amber-300">
            <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd"/>
            </svg>
            <div>
              <div className="font-medium">Nenhum certificado configurado</div>
              <div className="text-sm text-amber-400/70">A captura SEFAZ continua aguardando — faça upload abaixo para habilitar.</div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <Field label="Tipo" value={status.tipo === 'PJ' ? 'Pessoa Jurídica' : status.tipo === 'PF' ? 'Pessoa Física' : status.tipo} />
            <Field
              label={status.tipo === 'PJ' ? 'CNPJ' : status.tipo === 'PF' ? 'CPF' : 'Identificador'}
              value={<span className="font-mono">{status.tipo === 'PJ' ? formatCNPJ(status.cnpj) : formatCPF(status.cpfTitular)}</span>}
            />
            <Field full label="Titular" value={status.titular} />
            <Field
              label="Válido até"
              value={
                <span className={validityClasses(status.validade?.diasRestantes)}>
                  {formatDateBR(status.validade?.fim)}
                  {status.validade && (
                    <span className="ml-2 text-xs opacity-80">
                      ({status.validade.expirado ? 'EXPIRADO' : `${status.validade.diasRestantes} dias`})
                    </span>
                  )}
                </span>
              }
            />
            <Field label="Emissor" value={status.issuer?.cn} mono small />
            <Field full label="Fingerprint SHA-1" value={<span className="font-mono text-xs break-all">{status.fingerprint}</span>} />
            {status.uploadedBy?.email && (
              <Field full label="Última atualização" value={status.uploadedBy.email} />
            )}
            {status.validade?.proximoVencimento && (
              <div className="md:col-span-2 mt-2 bg-amber-500/10 border border-amber-500/30 rounded p-3 text-amber-300 text-sm">
                ⚠ Certificado vence em {status.validade.diasRestantes} dias. Solicite renovação à AC com antecedência.
              </div>
            )}
            {status.validade?.expirado && (
              <div className="md:col-span-2 mt-2 bg-red-500/10 border border-red-500/30 rounded p-3 text-red-300 text-sm">
                ✗ Certificado EXPIRADO. Captura SEFAZ está suspensa até novo upload.
              </div>
            )}
          </div>
        )}
      </div>

      {/* --- UPLOAD CARD --- */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-1">
          {status?.configured ? 'Substituir certificado' : 'Configurar certificado'}
        </h3>
        <p className="text-xs text-slate-400 mb-4 leading-relaxed">
          O .pfx é enviado por HTTPS direto ao Google Secret Manager. Não fica no navegador,
          no Firestore nem em logs. A senha vai para um secret separado. Cada upload cria nova
          versão — versões antigas são preservadas para auditoria.
        </p>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition ${
            file ? 'border-emerald-500 bg-emerald-500/5' :
            dragActive ? 'border-blue-400 bg-blue-500/5' :
            'border-slate-600 hover:border-slate-500 hover:bg-slate-800/30'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pfx,.p12"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] || null)}
          />
          {file ? (
            <div>
              <svg className="w-10 h-10 mx-auto mb-2 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              <div className="text-emerald-400 font-medium">{file.name}</div>
              <div className="text-xs text-slate-500 mt-1">{(file.size / 1024).toFixed(1)} KB</div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setFile(null); }}
                className="mt-2 text-xs text-slate-400 hover:text-white underline"
              >
                Remover
              </button>
            </div>
          ) : (
            <div className="text-slate-400">
              <svg className="w-10 h-10 mx-auto mb-2 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 0115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
              </svg>
              <div>Arraste o arquivo .pfx aqui ou clique para selecionar</div>
              <div className="text-xs mt-1 opacity-70">Apenas certificados ICP-Brasil A1 (máx 5MB)</div>
            </div>
          )}
        </div>

        {/* Senha */}
        <div className="mt-4">
          <label className="block text-sm text-slate-300 mb-1">Senha do certificado</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && file && password) handleSubmit(); }}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white pr-20 focus:border-emerald-500 focus:outline-none"
              autoComplete="off"
              spellCheck={false}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white px-2 py-1"
            >
              {showPassword ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
        </div>

        {/* Mensagens */}
        {error && (
          <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded p-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {success && (
          <div className="mt-4 bg-emerald-500/10 border border-emerald-500/30 rounded p-3 text-sm text-emerald-300">
            ✓ {success}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={uploading || !file || !password}
          className="mt-4 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-slate-900 font-semibold px-5 py-2 rounded transition"
        >
          {uploading ? 'Enviando…' : status?.configured ? 'Substituir certificado' : 'Enviar certificado'}
        </button>
      </div>

      <div className="text-xs text-slate-500 leading-relaxed px-1">
        <strong className="text-slate-400">Boas práticas:</strong> use somente o certificado da SP Assessoria Contábil
        com procurações eletrônicas das empresas atendidas. Após upload, o .pfx pode ser arquivado offline —
        o sistema usa apenas a cópia no Secret Manager. Toda substituição é registrada em
        <code className="mx-1 text-slate-400">sefaz_certificados_historico</code>
        com UID, e-mail e timestamp.
      </div>
    </div>
  );
};

// Sub-componente helper
const Field: React.FC<{ label: string; value: React.ReactNode; full?: boolean; mono?: boolean; small?: boolean }> = ({
  label, value, full, mono, small,
}) => (
  <div className={full ? 'md:col-span-2' : ''}>
    <div className="text-slate-400 text-xs uppercase tracking-wide mb-0.5">{label}</div>
    <div className={`text-white ${mono ? 'font-mono' : ''} ${small ? 'text-xs' : ''}`}>
      {value || '—'}
    </div>
  </div>
);

export default CertificadoDigitalUpload;
