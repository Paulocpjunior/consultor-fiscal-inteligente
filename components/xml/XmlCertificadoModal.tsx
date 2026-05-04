import React, { useState } from 'react';
import { auth } from '../../services/firebaseConfig';
import { isSefazCaptureAvailable } from '../../services/dfeCaptureService';

const BACKEND_URL = (import.meta.env.VITE_SEFAZ_BACKEND_URL || '').replace(/\/+$/, '');

interface Props {
    empresaCnpj: string;
    empresaNome: string;
    onClose: () => void;
    onSuccess?: (cert: { cnpjTitular: string; nomeTitular: string; validoAte: string; fingerprint: string }) => void;
}

const XmlCertificadoModal: React.FC<Props> = ({ empresaCnpj, empresaNome, onClose, onSuccess }) => {
    const [pfxFile, setPfxFile] = useState<File | null>(null);
    const [senha, setSenha] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [sucesso, setSucesso] = useState<string | null>(null);

    const cnpjDigits = (empresaCnpj || '').replace(/\D/g, '');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErro(null);
        setSucesso(null);

        if (!pfxFile) { setErro('Selecione o arquivo .pfx ou .p12.'); return; }
        if (pfxFile.size > 1024 * 1024) { setErro('Arquivo maior que 1 MB. Verifique se é o cert correto.'); return; }
        if (!senha) { setErro('Informe a senha do certificado.'); return; }
        if (!isSefazCaptureAvailable()) {
            setErro('Backend SEFAZ não configurado neste ambiente (VITE_SEFAZ_BACKEND_URL ausente).');
            return;
        }
        if (!auth?.currentUser) { setErro('Usuário não autenticado.'); return; }

        setEnviando(true);
        try {
            const token = await auth.currentUser.getIdToken();
            const formData = new FormData();
            formData.append('pfx', pfxFile);
            formData.append('senha', senha);
            formData.append('cnpj', cnpjDigits);

            const resp = await fetch(`${BACKEND_URL}/api/certificados`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
            });

            if (!resp.ok) {
                let detail = '';
                try { const j = await resp.json(); detail = j.detail || JSON.stringify(j); }
                catch { detail = await resp.text(); }
                setErro(`Backend rejeitou (${resp.status}): ${detail.slice(0, 300)}`);
                return;
            }

            const data = await resp.json();
            setSucesso(`Certificado de ${data.certificado.nomeTitular} cadastrado. Válido até ${new Date(data.certificado.validoAte).toLocaleDateString('pt-BR')}.`);
            onSuccess?.(data.certificado);
            // Limpa imediatamente da memória do JS o que pudermos.
            setPfxFile(null);
            setSenha('');
        } catch (err: any) {
            setErro(`Falha de rede: ${err?.message || err}`);
        } finally {
            setEnviando(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl max-w-lg w-full p-6 space-y-4 shadow-xl">
                <div className="flex justify-between items-start">
                    <div>
                        <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200">Cadastrar Certificado A1</h3>
                        <p className="text-xs text-slate-500 mt-1">{empresaNome} — CNPJ {empresaCnpj}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                    <p><strong>O arquivo .pfx vai direto ao backend seguro</strong> e é guardado em Google Secret Manager.</p>
                    <p>O navegador descarta o arquivo da memória após o upload. Nem o front nem o repositório veem o conteúdo.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                    <div>
                        <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                            Arquivo .pfx ou .p12
                        </label>
                        <input
                            type="file"
                            accept=".pfx,.p12,application/x-pkcs12"
                            onChange={(e) => setPfxFile(e.target.files?.[0] ?? null)}
                            className="w-full text-xs text-slate-700 dark:text-slate-200"
                            disabled={enviando}
                        />
                        {pfxFile && (
                            <p className="text-[10px] text-slate-500 mt-1">{pfxFile.name} — {(pfxFile.size / 1024).toFixed(1)} KB</p>
                        )}
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                            Senha do certificado
                        </label>
                        <input
                            type="password"
                            autoComplete="off"
                            value={senha}
                            onChange={(e) => setSenha(e.target.value)}
                            className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-xs"
                            disabled={enviando}
                        />
                    </div>

                    {erro && (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-2 text-xs text-red-700 dark:text-red-300 whitespace-pre-wrap">
                            {erro}
                        </div>
                    )}
                    {sucesso && (
                        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded p-2 text-xs text-emerald-700 dark:text-emerald-300">
                            ✅ {sucesso}
                        </div>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                        <button type="button" onClick={onClose} disabled={enviando}
                            className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded">
                            {sucesso ? 'Fechar' : 'Cancelar'}
                        </button>
                        {!sucesso && (
                            <button type="submit" disabled={enviando || !pfxFile || !senha}
                                className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
                                {enviando ? 'Enviando...' : 'Cadastrar'}
                            </button>
                        )}
                    </div>
                </form>
            </div>
        </div>
    );
};

export default XmlCertificadoModal;
