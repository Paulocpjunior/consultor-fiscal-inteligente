import React, { useEffect, useState } from 'react';
import type { User } from '../../types';
import {
    checkSharePointHealth,
    syncSharePointFolder,
    buildFolderPath,
    type SharePointHealthStatus,
    type SharePointSyncResult,
} from '../../services/sharePointXmlService';
import { importXmlManual, getEmpresasDisponiveis, type EmpresaXmlOption } from '../../services/xmlFiscalService';
import { isFirebaseConfigured } from '../../services/firebaseConfig';

interface Props {
    currentUser?: User | null;
    onShowToast?: (msg: string) => void;
    onImported?: () => void;
}

const MESES = ['01','02','03','04','05','06','07','08','09','10','11','12'];

const XmlSharePoint: React.FC<Props> = ({ currentUser, onShowToast, onImported }) => {
    const [health, setHealth] = useState<SharePointHealthStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const [syncResult, setSyncResult] = useState<SharePointSyncResult | null>(null);
    const [importProgress, setImportProgress] = useState<string | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [empresas, setEmpresas] = useState<EmpresaXmlOption[]>([]);
    const [empresaId, setEmpresaId] = useState('');

    const [grupo, setGrupo] = useState('');
    const [empresaPasta, setEmpresaPasta] = useState('');
    const [ano, setAno] = useState(String(new Date().getFullYear()));
    const [mes, setMes] = useState(String(new Date().getMonth() + 1).padStart(2, '0'));
    const [direcao, setDirecao] = useState<'SAÍDA' | 'ENTRADA'>('SAÍDA');
    const [customPath, setCustomPath] = useState('');
    const [useCustom, setUseCustom] = useState(false);

    const empresaSelecionada = empresas.find(e => e.id === empresaId);

    useEffect(() => {
        checkSharePointHealth().then(setHealth);
        if (currentUser) {
            getEmpresasDisponiveis(currentUser).then(setEmpresas);
        }
    }, [currentUser]);

    const folderPath = useCustom
        ? customPath
        : buildFolderPath(grupo, ano, mes, empresaPasta, direcao);

    const handleSync = async () => {
        if (!folderPath.trim()) {
            setErro('Preencha o caminho da pasta.');
            return;
        }
        setLoading(true);
        setErro(null);
        setSyncResult(null);
        setImportProgress(null);

        try {
            const result = await syncSharePointFolder(folderPath);
            setSyncResult(result);

            if (result.downloaded > 0 && empresaSelecionada && currentUser && isFirebaseConfigured) {
                setImportProgress(`Gravando ${result.downloaded} XMLs no Firestore...`);
                let ok = 0, dup = 0, errs = 0;
                for (const file of result.files) {
                    if (!file.content) continue;
                    try {
                        const blob = new Blob([file.content], { type: 'application/xml' });
                        const xmlFile = new File([blob], file.name, { type: 'application/xml' });
                        const r = await importXmlManual({
                            file: xmlFile,
                            empresa: { id: empresaSelecionada.id, nome: empresaSelecionada.nome, cnpj: empresaSelecionada.cnpj },
                            user: currentUser,
                            origem: 'sharepoint',
                        });
                        if (r.status === 'ok') ok++;
                        else if (r.status === 'duplicado') dup++;
                        else errs++;
                    } catch {
                        errs++;
                    }
                }
                setImportProgress(`Concluído: ${ok} novos, ${dup} duplicados, ${errs} erros.`);
                onShowToast?.(`SharePoint: ${ok} novos, ${dup} duplicados, ${errs} erros.`);
                if (ok > 0) onImported?.();
            } else {
                onShowToast?.(`SharePoint: ${result.found} encontrados, ${result.downloaded} baixados, ${result.errors} erros.`);
            }
        } catch (err: any) {
            setErro(err?.message || 'Erro ao sincronizar.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-4">
            {/* Status */}
            <div
                className="p-4 rounded-xl"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
            >
                <h3 className="text-sm font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                    Conexão SharePoint
                </h3>
                {health === null ? (
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Verificando...</p>
                ) : health.configured ? (
                    <p className="text-xs" style={{ color: 'var(--success, #22c55e)' }}>
                        ✓ Conectado · {health.sharepointHost} · {health.sitePath}
                    </p>
                ) : (
                    <p className="text-xs" style={{ color: 'var(--danger, #ef4444)' }}>
                        ✗ Credenciais não configuradas no proxy backend.
                    </p>
                )}
            </div>

            {/* Formulário */}
            <div
                className="p-5 rounded-xl space-y-4"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
            >
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                        Sincronizar XMLs
                    </h3>
                    <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                        <input
                            type="checkbox"
                            checked={useCustom}
                            onChange={e => setUseCustom(e.target.checked)}
                        />
                        Caminho personalizado
                    </label>
                </div>

                {useCustom ? (
                    <div>
                        <label className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>
                            Caminho no SharePoint
                        </label>
                        <input
                            value={customPath}
                            onChange={e => setCustomPath(e.target.value)}
                            placeholder="Empresas/Grupo X/DEPARTAMENTO FISCAL/2026/05-2026/EMPRESA/XML SAÍDA"
                            className="w-full mt-1 p-2.5 text-xs rounded-lg outline-none"
                            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                        />
                    </div>
                ) : (
                    <>
                        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                            Caminho: <code style={{ color: 'var(--accent)' }}>{folderPath || '...'}</code>
                        </p>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            <div>
                                <label className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Grupo</label>
                                <input value={grupo} onChange={e => setGrupo(e.target.value)} placeholder="Grupo Flanacar"
                                    className="w-full mt-1 p-2 text-xs rounded-lg outline-none"
                                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Empresa (pasta)</label>
                                <input value={empresaPasta} onChange={e => setEmpresaPasta(e.target.value)} placeholder="CMM"
                                    className="w-full mt-1 p-2 text-xs rounded-lg outline-none"
                                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Ano</label>
                                <input value={ano} onChange={e => setAno(e.target.value)} placeholder="2026"
                                    className="w-full mt-1 p-2 text-xs rounded-lg outline-none"
                                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Mês</label>
                                <select value={mes} onChange={e => setMes(e.target.value)}
                                    className="w-full mt-1 p-2 text-xs rounded-lg outline-none"
                                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
                                    {MESES.map(m => <option key={m} value={m}>{m}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Direção</label>
                                <select value={direcao} onChange={e => setDirecao(e.target.value as any)}
                                    className="w-full mt-1 p-2 text-xs rounded-lg outline-none"
                                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
                                    <option value="SAÍDA">XML SAÍDA</option>
                                    <option value="ENTRADA">XML ENTRADA</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Empresa (Firestore)</label>
                                <select value={empresaId} onChange={e => setEmpresaId(e.target.value)}
                                    className="w-full mt-1 p-2 text-xs rounded-lg outline-none"
                                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
                                    <option value="">— Selecione —</option>
                                    {empresas.map(e => <option key={e.id} value={e.id}>{e.nome} ({e.cnpj})</option>)}
                                </select>
                            </div>
                        </div>
                    </>
                )}

                <button
                    onClick={handleSync}
                    disabled={loading || !health?.configured}
                    className="px-5 py-2.5 text-sm font-bold rounded-lg transition-colors disabled:opacity-40"
                    style={{ background: 'var(--accent)', color: '#fff' }}
                >
                    {loading ? 'Sincronizando...' : 'Sincronizar agora'}
                </button>
            </div>

            {/* Erro */}
            {erro && (
                <div className="p-3 rounded-xl text-xs" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--danger, #ef4444)' }}>
                    {erro}
                </div>
            )}

            {/* Progresso de importação */}
            {importProgress && (
                <div className="p-3 rounded-xl text-xs" style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', color: 'var(--accent)' }}>
                    {importProgress}
                </div>
            )}

            {/* Resultado */}
            {syncResult && (
                <div className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                    <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>Resultado</h3>
                    <div className="grid grid-cols-3 gap-3 text-sm mb-3">
                        <div><span style={{ color: 'var(--text-muted)' }}>Encontrados:</span> <strong>{syncResult.found}</strong></div>
                        <div><span style={{ color: 'var(--text-muted)' }}>Baixados:</span> <strong>{syncResult.downloaded}</strong></div>
                        <div><span style={{ color: 'var(--text-muted)' }}>Erros:</span> <strong>{syncResult.errors}</strong></div>
                    </div>
                    {syncResult.files.length > 0 && (
                        <div className="max-h-48 overflow-y-auto space-y-1">
                            {syncResult.files.slice(0, 50).map((f, i) => (
                                <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                                    <span className={`w-2 h-2 rounded-full ${f.error ? 'bg-red-500' : 'bg-emerald-500'}`} />
                                    <span className="truncate flex-1" style={{ color: 'var(--text-secondary)' }}>{f.name}</span>
                                    {f.error && <span className="text-red-500 truncate max-w-[40%]">{f.error}</span>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default XmlSharePoint;
