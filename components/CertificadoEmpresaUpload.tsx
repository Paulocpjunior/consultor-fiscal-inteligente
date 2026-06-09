// ============================================================================
// components/CertificadoEmpresaUpload.tsx
// ----------------------------------------------------------------------------
// Upload de certificado A1 POR EMPRESA (uma empresa cliente especifica).
//
// Diferente de CertificadoDigitalUpload.tsx que cuida do cert do escritorio,
// este componente sobe um cert .pfx pra uma empresa especifica. Isso resolve
// o cStat 215: SEFAZ exige que o CNPJ do cert == CNPJ consultado.
//
// Fluxo:
//   1. Carrega info atual via GET /api/admin/cert-empresa/info/:empresaId
//   2. Drag-drop ou clique pra selecionar .pfx
//   3. Senha (mascarada por default)
//   4. Submit via POST /api/admin/cert-empresa/upload (multipart, Bearer)
//   5. Backend valida, criptografa, salva, retorna metadata
//   6. Opcional: testa cert contra SEFAZ via POST /api/admin/cert-empresa/test/:id
// ============================================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getAuth } from 'firebase/auth';

interface Props {
  empresaId: string;
  empresaNome: string;
  empresaCnpj: string;
  onChange?: () => void;  // callback quando cert e adicionado/removido
}

interface CertInfo {
  empresaId: string;
  cnpj: string;
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
  fingerprint: string;
  uploadedAt: string | null;
  uploadedBy: string;
  sizeBytes: number;
}

const formatDateBR = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';

const diasAteVencimento = (notAfter: string) => {
  const diff = new Date(notAfter).getTime() - Date.now();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
};

const validityColor = (dias: number) => {
  if (dias <= 0) return 'text-red-600 dark:text-red-400';
  if (dias < 30) return 'text-amber-600 dark:text-amber-400';
  if (dias < 90) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-emerald-600 dark:text-emerald-400';
};

const erroHttp = async (res: Response): Promise<string> => {
  try {
    const data = await res.json();
    if (data?.error) return data.error;
    if (data?.motivo) return data.motivo;
  } catch { /* resposta sem JSON */ }
  if (res.status === 429) {
    return 'Muitas requisições em pouco tempo. Aguarde alguns instantes e tente novamente.';
  }
  if (res.status === 403) {
    return 'Seu usuário não tem permissão para gerenciar o certificado desta empresa.';
  }
  return `HTTP ${res.status}`;
};

// CNPJ do escritorio (S&P). O cert dele NAO mora aqui (empresas_certificados)
// e sim no Secret Manager via tela Configuracoes > Certificado Digital. Subir
// por esta tela per-empresa cria um cert "fantasma" que a captura real,
// manifesto e o monitor de vencimento NAO enxergam — foi exatamente o gap
// reportado (cert novo subido aqui, monitor seguia mostrando o antigo vencido).
const CNPJ_ESCRITORIO = ((import.meta as any).env?.VITE_CNPJ_ESCRITORIO || '44388152000189').replace(/\D/g, '');

const CertificadoEmpresaUpload: React.FC<Props> = ({ empresaId, empresaNome, empresaCnpj, onChange }) => {
  const ehEscritorio = empresaCnpj.replace(/\D/g, '') === CNPJ_ESCRITORIO;
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [info, setInfo] = useState<CertInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; cStat?: string; xMotivo?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const getToken = useCallback(async () => {
    const user = getAuth().currentUser;
    if (!user) throw new Error('Sessao expirada — faca login novamente');
    return user.getIdToken();
  }, []);

  const fetchInfo = useCallback(async () => {
    setLoadingInfo(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/cert-empresa/info/${empresaId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // Backend novo retorna 200 com { exists: false } quando nao ha cert.
      // 404 mantido pra compatibilidade durante a janela de deploy.
      if (res.status === 404) {
        setInfo(null);
      } else if (!res.ok) {
        throw new Error(await erroHttp(res));
      } else {
        const data = await res.json();
        setInfo(data?.exists === false ? null : data);
      }
    } catch (e: any) {
      setError(e.message || 'Falha ao carregar info do cert');
    } finally {
      setLoadingInfo(false);
    }
  }, [empresaId, getToken]);

  useEffect(() => {
    fetchInfo();
  }, [fetchInfo]);

  const handleFile = (f: File | null) => {
    setError(null);
    setSuccess(null);
    setTestResult(null);
    if (!f) { setFile(null); return; }
    if (!/\.(pfx|p12)$/i.test(f.name)) {
      setError('Arquivo deve ser .pfx ou .p12');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError('Arquivo maior que 5MB');
      return;
    }
    setFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    handleFile(e.dataTransfer.files?.[0] || null);
  };

  const handleUpload = async () => {
    if (!file) { setError('Selecione um arquivo'); return; }
    if (!password) { setError('Digite a senha do certificado'); return; }
    setUploading(true);
    setError(null);
    setSuccess(null);
    try {
      const token = await getToken();
      const form = new FormData();
      form.append('cert', file);
      form.append('password', password);
      form.append('empresaId', empresaId);

      const res = await fetch('/api/admin/cert-empresa/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setSuccess(`Certificado enviado. CNPJ ${data.cnpj || '?'} valido ate ${formatDateBR(data.notAfter)}`);
      setFile(null);
      setPassword('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      await fetchInfo();
      onChange?.();
    } catch (e: any) {
      setError(e.message || 'Falha no upload');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Remover o certificado de ${empresaNome}? Captura SEFAZ voltara a usar o cert do escritorio (fallback) e pode falhar.`)) return;
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/cert-empresa/${empresaId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await erroHttp(res));
      setInfo(null);
      setSuccess('Certificado removido');
      onChange?.();
    } catch (e: any) {
      setError(e.message || 'Falha ao remover');
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/cert-empresa/test/${empresaId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.motivo || (await erroHttp(res)));
      setTestResult({ ok: !!data.ok, cStat: data.cStat, xMotivo: data.xMotivo });
    } catch (e: any) {
      setError(e.message || 'Falha no teste');
    } finally {
      setTesting(false);
    }
  };

  const cnpjCertBate = info?.cnpj && info.cnpj.replace(/\D/g, '') === empresaCnpj.replace(/\D/g, '');
  const dias = info ? diasAteVencimento(info.notAfter) : 0;

  // Bloqueio do escritorio: o cert da S&P vive no Secret Manager, nao aqui.
  // Subir por esta tela nao afeta captura/manifesto/monitor — e armadilha.
  if (ehEscritorio) {
    return (
      <div className="space-y-4">
        <div className="text-xs text-slate-500 dark:text-slate-400">
          <strong>Empresa:</strong> {empresaNome} ({empresaCnpj})
        </div>
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-800 rounded-lg p-4 text-sm text-amber-800 dark:text-amber-200 space-y-2">
          <p className="font-bold">⚠ Esta é a S&P (escritório) — não suba o certificado aqui.</p>
          <p>
            O certificado do escritório é gerenciado no <strong>Secret Manager</strong>, não nesta
            tela per-empresa. Subir aqui cria um cert que a <strong>captura real</strong>,
            o <strong>manifesto</strong> e o <strong>monitor de vencimento</strong> NÃO enxergam.
          </p>
          <p>
            Use a aba <strong>Central de Documentos Fiscais → Configurações → Certificado Digital</strong>
            {' '}(ou Saúde Geral → Certificado do escritório) para enviar o .pfx da S&P. Lá ele vai pro
            Secret Manager e atualiza tudo: captura, manifesto e o monitor.
          </p>
          {info && (
            <p className="text-xs pt-1 border-t border-amber-200 dark:border-amber-800">
              Há um cert per-empresa cadastrado aqui (vence {formatDateBR(info.notAfter)}). Pode
              <button onClick={handleDelete} className="mx-1 underline font-semibold hover:text-amber-900 dark:hover:text-amber-100">
                removê-lo
              </button>
              para evitar confusão — ele não é usado pela captura do escritório.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-slate-500 dark:text-slate-400">
        <strong>Empresa:</strong> {empresaNome} ({empresaCnpj})
      </div>

      {/* Status atual */}
      {loadingInfo ? (
        <p className="text-xs text-slate-400">Carregando...</p>
      ) : info ? (
        <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200">Certificado atual</h4>
            <button
              onClick={handleDelete}
              className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 underline"
            >
              Remover
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-slate-500">CNPJ no cert:</span> <span className="font-mono">{info.cnpj || '—'}</span></div>
            <div><span className="text-slate-500">Validade:</span> <span className={validityColor(dias)}>{formatDateBR(info.notAfter)} ({dias} dias)</span></div>
            <div className="col-span-2"><span className="text-slate-500">Subject:</span> <span className="text-slate-600 dark:text-slate-300">{info.subject}</span></div>
            <div className="col-span-2"><span className="text-slate-500">Issuer:</span> <span className="text-slate-600 dark:text-slate-300">{info.issuer}</span></div>
            <div><span className="text-slate-500">Subido por:</span> {info.uploadedBy}</div>
            <div><span className="text-slate-500">Em:</span> {formatDateBR(info.uploadedAt)}</div>
          </div>
          {!cnpjCertBate && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-2 text-xs text-amber-800 dark:text-amber-300">
              <strong>Atencao:</strong> CNPJ do cert ({info.cnpj}) nao bate com CNPJ da empresa ({empresaCnpj.replace(/\D/g, '')}). SEFAZ vai rejeitar.
            </div>
          )}
          <button
            onClick={handleTest}
            disabled={testing}
            className="text-xs px-3 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded disabled:opacity-50"
          >
            {testing ? 'Testando...' : 'Testar contra SEFAZ'}
          </button>
          {testResult && (
            <div className={`text-xs p-2 rounded ${testResult.ok ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300' : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300'}`}>
              {testResult.ok ? '✓ ' : '✗ '} cStat={testResult.cStat} — {testResult.xMotivo}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300">
          Nenhum certificado especifico cadastrado. Captura SEFAZ usa o cert do escritorio (fallback, geralmente falha).
        </div>
      )}

      {/* Upload */}
      <div className="space-y-3">
        <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200">
          {info ? 'Substituir certificado' : 'Enviar certificado A1'}
        </h4>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition ${
            dragActive ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-300 dark:border-slate-600 hover:border-slate-400'
          }`}
        >
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {file ? <span className="font-mono">{file.name} ({(file.size / 1024).toFixed(1)} KB)</span> : 'Clique ou arraste o .pfx aqui'}
          </p>
          <p className="text-[10px] text-slate-400 mt-1">Maximo 5MB. Aceita .pfx e .p12</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pfx,.p12"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0] || null)}
        />

        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="Senha do certificado"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 pr-16 border border-slate-300 dark:border-slate-600 rounded text-sm bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            {showPassword ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>

        <button
          onClick={handleUpload}
          disabled={uploading || !file || !password}
          className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white text-sm font-medium rounded transition"
        >
          {uploading ? 'Enviando...' : 'Enviar certificado'}
        </button>
      </div>

      {/* Feedback */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-2 text-xs text-red-800 dark:text-red-300">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded p-2 text-xs text-emerald-800 dark:text-emerald-300">
          {success}
        </div>
      )}
    </div>
  );
};

export default CertificadoEmpresaUpload;
