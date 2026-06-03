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
import { isFirebaseConfigured, auth } from '../../services/firebaseConfig';

interface SharePointLastSync {
    competencia?: string;
    totalNovos?: number;
    totalDup?: number;
    totalErros?: number;
    timestamp?: { _seconds: number };
}

// Mostra o estado REAL do auto-sync diário (separado do /health do proxy).
// Útil quando o card "Conexão SharePoint" fica vermelho ou amarelo: o auto-sync
// pode estar funcionando mesmo assim — ou pode ter parado por secret drift no
// Cloud Scheduler (commit b9c583b de 01/06 endureceu a auth e exigia atualizar
// o job manualmente; se a ação não foi feita, o cron das 08h pega 403).
const SharePointAutoSyncStatusLine: React.FC<{ lastSync: SharePointLastSync | null }> = ({ lastSync }) => {
    if (!lastSync) return null;
    const ts = lastSync.timestamp?._seconds ? lastSync.timestamp._seconds * 1000 : null;
    if (!ts) {
        return (
            <p className="text-[11px] mt-2 pt-2 border-t border-slate-200 dark:border-slate-700" style={{ color: 'var(--text-muted)' }}>
                Auto-sync diário: <span className="font-semibold text-amber-600 dark:text-amber-400">nunca rodou</span>
            </p>
        );
    }
    const ageH = (Date.now() - ts) / 3600_000;
    const fresh = ageH < 48;
    return (
        <p className="text-[11px] mt-2 pt-2 border-t border-slate-200 dark:border-slate-700" style={{ color: 'var(--text-muted)' }}>
            Auto-sync diário:
            {' '}
            <span className={`font-semibold ${fresh ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {fresh ? '✓' : '⚠'} {new Date(ts).toLocaleString('pt-BR')}
            </span>
            {' · '}
            {lastSync.totalNovos ?? 0} novos · {lastSync.totalDup ?? 0} dup · {lastSync.totalErros ?? 0} erros
            {' · comp '}{lastSync.competencia || '—'}
            {!fresh && (
                <>
                    {' '}— <span className="text-amber-700 dark:text-amber-300">parado há {Math.floor(ageH / 24)}d. Provável secret drift no Cloud Scheduler do job <code>sharepoint-auto-sync</code> (rotação 01/06 exigia atualização manual).</span>
                </>
            )}
        </p>
    );
};

interface Props {
    currentUser?: User | null;
    onShowToast?: (msg: string) => void;
    onImported?: () => void;
}

const MESES = ['01','02','03','04','05','06','07','08','09','10','11','12'];

const XmlSharePoint: React.FC<Props> = ({ currentUser, onShowToast, onImported }) => {
    const [health, setHealth] = useState<SharePointHealthStatus | null>(null);
    const [autoSyncLastSync, setAutoSyncLastSync] = useState<SharePointLastSync | null>(null);
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
        // Estado real do auto-sync diário, INDEPENDENTE do /health do proxy.
        // O proxy pode estar fora e o auto-sync ainda estar rodando (ou vice-versa).
        (async () => {
            try {
                const token = await auth?.currentUser?.getIdToken();
                if (!token) return;
                const r = await fetch('/api/admin/sharepoint/status', {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (r.ok) {
                    const d = await r.json();
                    setAutoSyncLastSync(d.lastSync || null);
                }
            } catch { /* silencia — só serve pra exibir status, não bloquear UI */ }
        })();
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
                    <div className="text-xs space-y-1" style={{ color: 'var(--danger, #ef4444)' }}>
                        <p className="font-semibold">✗ Proxy SharePoint indisponível.</p>
                        <p style={{ color: 'var(--text-muted)' }}>
                            O frontend chama <code>consultor-fiscal-proxy.us-west1.run.app/api/sharepoint/health</code> (deploy
                            separado deste app). Causas possíveis:
                        </p>
                        <ul className="list-disc ml-4 space-y-0.5" style={{ color: 'var(--text-muted)' }}>
                            <li>Serviço <code>consultor-fiscal-proxy</code> fora do ar no Cloud Run</li>
                            <li>Secrets <code>GRAPH_CLIENT_ID</code> / <code>GRAPH_TENANT_ID</code> / <code>GRAPH_CLIENT_SECRET</code> não setados no proxy</li>
                            <li>Token do app Microsoft Entra expirado/revogado</li>
                        </ul>
                        <p style={{ color: 'var(--text-muted)' }} className="pt-1">
                            Para diagnosticar: <code>gcloud run services describe consultor-fiscal-proxy --region=us-west1</code>
                            {' '}e checar os logs.
                        </p>
                    </div>
                )}
                <SharePointAutoSyncStatusLine lastSync={autoSyncLastSync} />
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
            {/* Auto-Sync Config (admin only) */}
            {currentUser?.role === 'admin' && (
                <AutoSyncConfig empresas={empresas} />
            )}
        </div>
    );
};

// ─── Auto-Sync Config Panel ─────────────────────────────────────────────────

interface AutoSyncStatus {
    lastSync: { competencia: string; totalNovos: number; totalDup: number; totalErros: number; timestamp?: { _seconds: number } } | null;
    empresasAutoSync: { id: string; nome: string; cnpj: string; grupo: string; empresaPasta: string }[];
}

const AutoSyncConfig: React.FC<{ empresas: EmpresaXmlOption[] }> = ({ empresas }) => {
    const [status, setStatus] = useState<AutoSyncStatus | null>(null);
    const [loadingStatus, setLoadingStatus] = useState(true);
    const [triggerRunning, setTriggerRunning] = useState(false);
    const [triggerResult, setTriggerResult] = useState<string | null>(null);

    const [configEmpresaId, setConfigEmpresaId] = useState('');
    const [configGrupo, setConfigGrupo] = useState('');
    const [configPasta, setConfigPasta] = useState('');
    const [configEnabled, setConfigEnabled] = useState(true);
    const [savingConfig, setSavingConfig] = useState(false);

    const getHeaders = async () => {
        const token = await auth?.currentUser?.getIdToken();
        return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
    };

    useEffect(() => {
        (async () => {
            try {
                const headers = await getHeaders();
                const resp = await fetch('/api/admin/sharepoint/status', { headers });
                if (resp.ok) setStatus(await resp.json());
            } catch { /* ignore */ }
            setLoadingStatus(false);
        })();
    }, []);

    const handleTriggerSync = async () => {
        setTriggerRunning(true);
        setTriggerResult(null);
        try {
            const headers = await getHeaders();
            const resp = await fetch('/api/admin/sharepoint/auto-sync', {
                method: 'POST', headers, body: JSON.stringify({}),
            });
            const data = await resp.json();
            if (resp.ok) {
                setTriggerResult(`Sync concluído: ${data.totalNovos} novos, ${data.totalDup} duplicados, ${data.totalErros} erros.`);
                const statusResp = await fetch('/api/admin/sharepoint/status', { headers });
                if (statusResp.ok) setStatus(await statusResp.json());
            } else {
                setTriggerResult(`Erro: ${data.error || resp.statusText}`);
            }
        } catch (err: any) {
            setTriggerResult(`Erro: ${err?.message || 'Falha'}`);
        } finally {
            setTriggerRunning(false);
        }
    };

    const handleSaveConfig = async () => {
        if (!configEmpresaId) return;
        setSavingConfig(true);
        try {
            const empresa = empresas.find(e => e.id === configEmpresaId);
            const collection = empresa?.fonte === 'simples' ? 'simples_empresas' : 'lucro_empresas';
            const headers = await getHeaders();
            const resp = await fetch('/api/admin/sharepoint/config', {
                method: 'POST', headers,
                body: JSON.stringify({
                    empresaId: configEmpresaId,
                    collection,
                    sharePointConfig: { grupo: configGrupo, empresaPasta: configPasta, autoSyncEnabled: configEnabled },
                }),
            });
            if (resp.ok) {
                const statusResp = await fetch('/api/admin/sharepoint/status', { headers });
                if (statusResp.ok) setStatus(await statusResp.json());
                setConfigEmpresaId('');
                setConfigGrupo('');
                setConfigPasta('');
            }
        } catch { /* ignore */ }
        setSavingConfig(false);
    };

    const lastTs = status?.lastSync?.timestamp?._seconds
        ? new Date(status.lastSync.timestamp._seconds * 1000).toLocaleString('pt-BR')
        : null;

    return (
        <div className="p-5 rounded-xl space-y-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                    Auto-Sync SharePoint
                </h3>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                    Cloud Scheduler
                </span>
            </div>

            {loadingStatus ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Carregando...</p>
            ) : (
                <>
                    {/* Last sync */}
                    {status?.lastSync && (
                        <div className="text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
                            <p>Última execução: <strong>{lastTs || '-'}</strong> — Competência: <strong>{status.lastSync.competencia}</strong></p>
                            <p>{status.lastSync.totalNovos} novos, {status.lastSync.totalDup} duplicados, {status.lastSync.totalErros} erros</p>
                        </div>
                    )}

                    {/* Empresas enabled */}
                    {status?.empresasAutoSync && status.empresasAutoSync.length > 0 && (
                        <div>
                            <p className="text-[10px] font-bold uppercase mb-1" style={{ color: 'var(--text-muted)' }}>Empresas com auto-sync</p>
                            <div className="space-y-1">
                                {status.empresasAutoSync.map(e => (
                                    <div key={e.id} className="flex items-center gap-2 text-xs py-0.5">
                                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                                        <span style={{ color: 'var(--text-primary)' }}>{e.nome}</span>
                                        <span style={{ color: 'var(--text-muted)' }}>({e.grupo}/{e.empresaPasta})</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Trigger manual sync */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleTriggerSync}
                            disabled={triggerRunning}
                            className="px-4 py-2 text-xs font-bold rounded-lg disabled:opacity-40"
                            style={{ background: 'var(--accent)', color: '#fff' }}
                        >
                            {triggerRunning ? 'Executando...' : 'Executar Sync Agora'}
                        </button>
                        {triggerResult && (
                            <span className="text-xs" style={{ color: triggerResult.startsWith('Erro') ? 'var(--danger)' : 'var(--success)' }}>
                                {triggerResult}
                            </span>
                        )}
                    </div>

                    {/* Add empresa config */}
                    <div className="border-t pt-3 mt-3" style={{ borderColor: 'var(--border-subtle)' }}>
                        <p className="text-[10px] font-bold uppercase mb-2" style={{ color: 'var(--text-muted)' }}>Adicionar empresa ao auto-sync</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <select value={configEmpresaId} onChange={e => setConfigEmpresaId(e.target.value)}
                                className="p-2 text-xs rounded-lg"
                                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
                                <option value="">Empresa</option>
                                {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                            </select>
                            <input value={configGrupo} onChange={e => setConfigGrupo(e.target.value)} placeholder="Grupo (pasta)"
                                className="p-2 text-xs rounded-lg"
                                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
                            <input value={configPasta} onChange={e => setConfigPasta(e.target.value)} placeholder="Empresa (pasta)"
                                className="p-2 text-xs rounded-lg"
                                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
                            <div className="flex items-center gap-2">
                                <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                                    <input type="checkbox" checked={configEnabled} onChange={e => setConfigEnabled(e.target.checked)} />
                                    Ativo
                                </label>
                                <button onClick={handleSaveConfig} disabled={savingConfig || !configEmpresaId}
                                    className="px-3 py-1.5 text-xs font-bold rounded-lg disabled:opacity-40"
                                    style={{ background: 'var(--accent)', color: '#fff' }}>
                                    {savingConfig ? '...' : 'Salvar'}
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default XmlSharePoint;
