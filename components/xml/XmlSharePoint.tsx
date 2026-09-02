import React, { useEffect, useState } from 'react';
import type { User } from '../../types';
import {
    checkSharePointHealth,
    syncSharePointFolder,
    buildFolderPath,
    explorarPasta,
    listarSitesSharePoint,
    type SharePointHealthStatus,
    type SharePointSyncResult,
    type SharePointNivel,
    type SharePointSite,
} from '../../services/sharePointXmlService';
import { importXmlManual, getEmpresasDisponiveis, type EmpresaXmlOption } from '../../services/xmlFiscalService';
import { isFirebaseConfigured, auth } from '../../services/firebaseConfig';
import EmpresaSearchSelect from './EmpresaSearchSelect';
// 🚨 O veredito da conexão sai do RESULTADO da última rodada, não de
// `configured` (que só diz que as variáveis estão preenchidas). Ver o print de
// 28/08: verde em cima, 57 erros de token embaixo.
import { vereditoConexaoSharePoint } from '../../services/sharepointConexaoVeredito';

interface SharePointLastSync {
    competencia?: string;
    totalNovos?: number;
    totalDup?: number;
    totalErros?: number;
    empresasComConfigIncompleta?: number;
    erroFatal?: string | null;
    timestamp?: { _seconds: number };
    /** Resultado por empresa — carrega o MOTIVO dos erros (errosDetalhe/erro). */
    results?: {
        empresaId?: string; empresaNome?: string;
        novos?: number; duplicados?: number; erros?: number;
        erro?: string; errosDetalhe?: string[]; configIncompleta?: boolean;
    }[];
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
    // Rodou recente ≠ funcionou: um run com erroFatal (proxy fora) ou com
    // erros por empresa não pode aparecer verde — era assim que a falha do
    // SharePoint passava despercebida até alguém entrar manualmente na aba.
    const temErroFatal = !!lastSync.erroFatal;
    const temErros = (lastSync.totalErros ?? 0) > 0;
    const cor = temErroFatal ? 'text-red-600 dark:text-red-400'
        : (!fresh || temErros) ? 'text-amber-600 dark:text-amber-400'
        : 'text-emerald-600 dark:text-emerald-400';
    const icone = temErroFatal ? '✗' : (!fresh || temErros) ? '⚠' : '✓';
    return (
        <p className="text-[11px] mt-2 pt-2 border-t border-slate-200 dark:border-slate-700" style={{ color: 'var(--text-muted)' }}>
            Auto-sync diário:
            {' '}
            <span className={`font-semibold ${cor}`}>
                {icone} {new Date(ts).toLocaleString('pt-BR')}
            </span>
            {' · '}
            {lastSync.totalNovos ?? 0} novos · {lastSync.totalDup ?? 0} dup · {lastSync.totalErros ?? 0} erros
            {' · comp '}{lastSync.competencia || '—'}
            {temErroFatal && (
                <>
                    {' '}— <span className="text-red-700 dark:text-red-300 font-semibold">FALHOU: {lastSync.erroFatal}</span>
                </>
            )}
            {!temErroFatal && (lastSync.empresasComConfigIncompleta ?? 0) > 0 && (
                <>
                    {' '}— <span className="text-amber-700 dark:text-amber-300">{lastSync.empresasComConfigIncompleta} empresa(s) com grupo/pasta não preenchidos (nada sincronizado para elas)</span>
                </>
            )}
            {/* Motivo dominante dos erros JUNTO da contagem (farol honesto) —
                "9 erros" sem porquê obrigava a caçar no log (25/07). */}
            {!temErroFatal && temErros && (() => {
                const comErro = (lastSync.results || []).filter((r: any) => r.erro || (r.errosDetalhe || []).length > 0);
                if (comErro.length === 0) return null;
                const r0: any = comErro[0];
                const motivo = r0.erro || (r0.errosDetalhe || [])[0] || '';
                return (
                    <>
                        {' '}— <span className="text-red-700 dark:text-red-300">{r0.empresaNome || '—'}: {motivo}{comErro.length > 1 ? ` (+${comErro.length - 1} empresa(s) com erro — detalhe no card Auto-Sync abaixo)` : ''}</span>
                    </>
                );
            })()}
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
    // 🔎 Explorador — responde "a árvore está em qual site?" sem ninguém navegar.
    const [nivel, setNivel] = useState<SharePointNivel | null>(null);
    const [sites, setSites] = useState<SharePointSite[] | null>(null);
    const [explorando, setExplorando] = useState(false);
    const [erroExplorar, setErroExplorar] = useState<string | null>(null);
    const [buscaSite, setBuscaSite] = useState('');

    // 🚨 A BUSCA DO GRAPH DEVOLVE TUDO — inclusive `/contentstorage/...`, que é
    // armazenamento PESSOAL (OneDrive), e as entradas "Designer"/"Pages"/"My
    // workspace" que a Microsoft cria sozinha. Numa lista de centenas, achar o
    // site do escritório a olho é impossível: sobra ruído e a pessoa desiste.
    // ⚠️ Filtrar é recorte, e recorte se DIZ — o contador abaixo mostra
    // quantas ficaram de fora, senão isto vira "meu site não existe".
    const sitesDeEquipe = (sites || []).filter(s => s.caminho.startsWith('/sites/'))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const sitesVisiveis = (() => {
        const q = buscaSite.trim().toLowerCase();
        const casam = q ? sitesDeEquipe.filter(s => `${s.nome} ${s.caminho}`.toLowerCase().includes(q)) : sitesDeEquipe;
        return casam.slice(0, 60);
    })();
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

    // Campos obrigatorios faltando (so no modo guiado) — sinaliza ao colaborador
    // o que impede a pasta de ser encontrada.
    const faltando = useCustom ? [] : ([
        !grupo.trim() && 'Grupo',
        !empresaPasta.trim() && 'Empresa (pasta)',
        !ano.trim() && 'Ano',
    ].filter(Boolean) as string[]);

    // `sitePath` vazio = o site que o proxy resolve hoje. Passar outro deixa
    // CONFERIR o vizinho sem mexer na configuração — que é justamente a dúvida
    // de 02/09 (a árvore está em ClientesSP2 ou no site do link?).
    const [siteExplorado, setSiteExplorado] = useState('');
    const explorar = async (caminho: string, sitePath?: string) => {
        const alvo = sitePath !== undefined ? sitePath : siteExplorado;
        setExplorando(true);
        setErroExplorar(null);
        setSites(null);
        setSiteExplorado(alvo);
        try {
            setNivel(await explorarPasta(caminho, alvo));
        } catch (e: any) {
            // ⚠️ A mensagem do Graph vai INTEIRA: ela já carrega o site em que
            // procurou, e é esse o dado que responde a pergunta.
            setErroExplorar(e?.message || 'Falha ao ler a pasta.');
            setNivel(null);
        } finally {
            setExplorando(false);
        }
    };

    const carregarSites = async () => {
        setExplorando(true);
        setErroExplorar(null);
        setNivel(null);
        try {
            setSites(await listarSitesSharePoint());
        } catch (e: any) {
            setErroExplorar(e?.message || 'Falha ao listar sites.');
            setSites(null);
        } finally {
            setExplorando(false);
        }
    };

    const handleSync = async () => {
        if (!folderPath.trim()) {
            setErro('Preencha o caminho da pasta.');
            return;
        }
        // ⚠️ Rede E botão: o botão fica apagado, mas a recusa vive aqui porque
        // é ela que NOMEIA o campo. Mandar o caminho com pedaço vazio produz
        // um "a pasta não existe" do SharePoint sobre uma pasta que existe.
        if (faltando.length > 0) {
            setErro(`Falta preencher: ${faltando.join(', ')}. Sem isso o caminho sai com pedaços vazios `
                + '(Empresas//DEPARTAMENTO FISCAL/…) e o SharePoint responde que a pasta não existe — '
                + 'o problema não é a pasta.');
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
                {/* 🚨 O VEREDITO SAI DO RESULTADO, NÃO DE `configured` (28/08).
                    `configured` responde "as variáveis estão preenchidas?" — e
                    no print do Paulo elas estavam, com 57 erros de
                    `AADSTS90002: Tenant not found` logo abaixo. Verde em cima,
                    verdade embaixo: duas leituras do mesmo fato no mesmo card,
                    com a mentira na posição do veredito. */}
                {(() => {
                    const v = vereditoConexaoSharePoint({ health, lastSync: autoSyncLastSync });
                    if (v.cor === 'erro' && health && !health.configured) return null;  // o bloco detalhado abaixo
                    const cores: Record<string, string> = {
                        ok: 'var(--success, #22c55e)',
                        atencao: 'var(--warning, #f59e0b)',
                        erro: 'var(--danger, #ef4444)',
                        indeterminado: 'var(--text-muted)',
                    };
                    return (
                        <div className="text-xs space-y-1" style={{ color: cores[v.cor] }}>
                            <p className={v.cor === 'ok' ? '' : 'font-semibold'}>
                                {v.titulo}
                                {v.cor === 'ok' && health?.sharepointHost
                                    && ` · ${health.sharepointHost} · ${health.sitePath}`}
                            </p>
                            {v.detalhe && (
                                <p className="font-mono text-[11px] break-all" style={{ color: 'var(--text-muted)' }}>
                                    {v.detalhe}
                                </p>
                            )}
                            {v.acao && <p style={{ color: 'var(--text-muted)' }}>→ {v.acao}</p>}
                        </div>
                    );
                })()}
                {health === null ? null : health.configured ? null : (
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

            {/* Guia de caminho — onde os colaboradores devem consultar */}
            <div className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                <h3 className="text-sm font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                    📁 Onde consultar os XMLs no SharePoint
                </h3>
                <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                    Os XMLs ficam sempre nesta estrutura de pastas. Preencha os campos abaixo <strong>exatamente como
                    aparece no SharePoint</strong> (respeitando maiúsculas e acentos):
                </p>
                <div className="text-xs font-mono p-2.5 rounded break-all"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
                    Empresas / <b style={{ color: 'var(--accent)' }}>GRUPO</b> / DEPARTAMENTO FISCAL / <b style={{ color: 'var(--accent)' }}>ANO</b> / <b style={{ color: 'var(--accent)' }}>MÊS</b>-<b style={{ color: 'var(--accent)' }}>ANO</b> / <b style={{ color: 'var(--accent)' }}>EMPRESA</b> / XML <b style={{ color: 'var(--accent)' }}>SAÍDA</b>
                </div>
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                    Exemplo: <code>Empresas/Grupo Flanacar/DEPARTAMENTO FISCAL/2026/07-2026/CMM/XML SAÍDA</code>
                    {' '}— para notas recebidas, troque o fim por <code>XML ENTRADA</code>.
                </p>

                {/* 🔎 "A ÁRVORE ESTÁ EM QUAL SITE?" — o app responde, ninguém navega.
                    02/09: o erro passou a dizer onde procurou (404 em /sites/ClientesSP2)
                    e sobrou uma pergunta factual. Mandar uma pessoa navegar no SharePoint
                    para responder é o que este dia inteiro ensinou a não fazer. */}
                <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <div className="flex flex-wrap items-center gap-2">
                        {/* 🐛 Ele ficava preso no ÚLTIMO site aberto: quem clicasse num site
                            da lista e depois aqui via o MESMO site de novo, achando que
                            estava vendo a biblioteca do proxy — e não havia caminho de
                            volta. "Esta biblioteca" é a que o proxy usa; o `''` volta a ela. */}
                        <button
                            type="button"
                            onClick={() => void explorar('', '')}
                            disabled={explorando}
                            className="px-3 py-1.5 text-[11px] font-bold rounded-lg btn-press whitespace-nowrap disabled:opacity-40"
                            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                        >
                            {explorando ? 'Lendo…' : '🔎 O que existe nesta biblioteca?'}
                        </button>
                        <button
                            type="button"
                            onClick={() => void carregarSites()}
                            disabled={explorando}
                            className="px-3 py-1.5 text-[11px] font-bold rounded-lg btn-press whitespace-nowrap disabled:opacity-40"
                            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                        >
                            🏢 Quais sites o app enxerga?
                        </button>
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                            Só lê nomes de pasta — não baixa, não grava.
                        </span>
                    </div>

                    {erroExplorar && (
                        <p className="text-[11px] mt-2 break-all" style={{ color: 'var(--danger, #ef4444)' }}>{erroExplorar}</p>
                    )}

                    {sites && (
                        <div className="mt-2 text-[11px]" style={{ color: 'var(--text-primary)' }}>
                            {sites.length === 0 ? (
                                <p style={{ color: 'var(--text-muted)' }}>
                                    Nenhum site retornado — pode ser falta da permissão Sites.Read.All no app do Azure.
                                </p>
                            ) : (
                                <>
                                    <p className="mb-1.5" style={{ color: 'var(--text-muted)' }}>
                                        Clique num site para abrir a árvore dele. O caminho <code>/sites/…</code> é o que
                                        vai na variável <code>SHAREPOINT_SITE_PATH</code> do proxy.
                                    </p>
                                    <input
                                        value={buscaSite}
                                        onChange={e => setBuscaSite(e.target.value)}
                                        placeholder="Filtrar por nome ou caminho — ex.: fiscal"
                                        className="w-full mb-2 p-2 text-xs rounded-lg outline-none"
                                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                                    />
                                    {/* ⚠️ RECORTE SEMPRE DIZ "X de N" (régua do farol honesto,
                                        30/07): a busca do Graph devolve centenas de entradas e
                                        cortar calado faria a pessoa concluir que o site dela não
                                        existe. */}
                                    <p className="mb-1" style={{ color: 'var(--text-muted)' }}>
                                        Mostrando {sitesVisiveis.length} de {sitesDeEquipe.length} site(s) de equipe
                                        {sites.length > sitesDeEquipe.length
                                            && ` — ${sites.length - sitesDeEquipe.length} entrada(s) de armazenamento pessoal ficaram de fora`}
                                    </p>
                                    <div className="flex flex-col gap-0.5" style={{ maxHeight: 260, overflowY: 'auto' }}>
                                        {sitesVisiveis.map(s => {
                                            const emUso = health?.sitePath && s.caminho.toLowerCase() === health.sitePath.toLowerCase();
                                            return (
                                                <button
                                                    key={s.id}
                                                    type="button"
                                                    onClick={() => void explorar('', s.caminho)}
                                                    className="text-left px-2 py-1 rounded btn-press font-mono"
                                                    style={{
                                                        background: 'var(--bg-card)',
                                                        border: `1px solid ${emUso ? 'var(--accent)' : 'var(--border-default)'}`,
                                                        color: 'var(--text-primary)',
                                                    }}
                                                >
                                                    {s.nome} — <b style={{ color: 'var(--accent)' }}>{s.caminho}</b>
                                                    {emUso && <span style={{ color: 'var(--accent)' }}> · é o que o proxy usa hoje</span>}
                                                </button>
                                            );
                                        })}
                                        {sitesVisiveis.length === 0 && (
                                            <p style={{ color: 'var(--text-muted)' }}>Nenhum site com esse texto.</p>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {nivel && (
                        <div className="mt-2 text-[11px]">
                            <p className="font-mono mb-1" style={{ color: 'var(--text-muted)' }}>
                                {nivel.site} → /{nivel.caminho || '(raiz)'}
                            </p>
                            {nivel.pastas.length === 0 && nivel.arquivos === 0 && (
                                <p style={{ color: 'var(--text-muted)' }}>Nada aqui dentro.</p>
                            )}
                            <div className="flex flex-wrap gap-1.5">
                                {nivel.caminho && (
                                    <button
                                        type="button"
                                        onClick={() => void explorar(nivel.caminho.split('/').slice(0, -1).join('/'))}
                                        className="px-2 py-1 rounded btn-press"
                                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}
                                    >↑ voltar</button>
                                )}
                                {nivel.pastas.map(p => (
                                    <button
                                        key={p.nome}
                                        type="button"
                                        onClick={() => void explorar(nivel.caminho ? `${nivel.caminho}/${p.nome}` : p.nome)}
                                        className="px-2 py-1 rounded btn-press font-mono"
                                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                                    >📁 {p.nome}</button>
                                ))}
                            </div>
                            {/* ⚠️ A contagem de ARQUIVOS vai junto: pasta com 0 subpastas
                                e 300 arquivos é o FIM da árvore, e sem esse número ela se
                                lê como pasta vazia. */}
                            {nivel.arquivos > 0 && (
                                <p className="mt-1.5" style={{ color: 'var(--text-muted)' }}>
                                    …e {nivel.arquivos} arquivo(s) neste nível.
                                </p>
                            )}
                        </div>
                    )}
                </div>
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
                            Caminho ou link da pasta no SharePoint
                        </label>
                        <input
                            value={customPath}
                            onChange={e => setCustomPath(e.target.value)}
                            placeholder="Cole o link da pasta (Copiar link no SharePoint) ou digite Empresas/Grupo X/…/XML SAÍDA"
                            className="w-full mt-1 p-2.5 text-xs rounded-lg outline-none"
                            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                        />
                        {/* 🚨 O link e o caminho procuram em lugares DIFERENTES, e a
                            pessoa precisa saber disso ANTES de clicar: o caminho é
                            resolvido no site que o proxy conhece, e o link carrega o
                            site dele junto. Foi essa diferença que produziu "pasta não
                            existe" sobre um link de outro site. */}
                        <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                            {customPath.trim().startsWith('http')
                                ? '🔗 É um LINK — ele leva o site e a biblioteca junto, então vale para qualquer site do SharePoint. Tem que ser o link da PASTA, não de um arquivo.'
                                : '📁 É um CAMINHO — ele é procurado a partir da raiz da biblioteca do site que o proxy consulta. Se a pasta for de outro site, cole o LINK dela.'}
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="p-3 rounded-lg" style={{ background: 'var(--bg-card)', border: `1px solid ${faltando.length ? 'rgba(239,68,68,0.4)' : 'var(--border-default)'}` }}>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Caminho que será consultado</span>
                                <button type="button" onClick={() => { navigator.clipboard?.writeText(folderPath); onShowToast?.('Caminho copiado.'); }}
                                    className="text-[11px] px-2 py-0.5 rounded" style={{ border: '1px solid var(--border-default)', color: 'var(--text-muted)' }}>
                                    Copiar
                                </button>
                            </div>
                            <code className="block mt-1 text-sm break-all" style={{ color: faltando.length ? 'var(--danger, #ef4444)' : 'var(--accent)' }}>
                                {folderPath}
                            </code>
                            {faltando.length > 0 && (
                                <p className="text-[11px] mt-1" style={{ color: 'var(--danger, #ef4444)' }}>
                                    ⚠ Falta preencher: <strong>{faltando.join(', ')}</strong>. Sem isso a pasta não é encontrada no SharePoint.
                                </p>
                            )}
                        </div>
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
                                <EmpresaSearchSelect
                            empresas={empresas}
                            value={empresaId}
                            onChange={setEmpresaId}
                            placeholder="Selecione — código, nome ou CNPJ"
                        />
                            </div>
                        </div>
                    </>
                )}

                {/* 🚨 O BOTÃO DISPARAVA COM CAMPO OBRIGATÓRIO VAZIO — e o app
                    JÁ SABIA quais faltavam (o aviso vermelho logo acima). O
                    caminho saía com segmentos vazios
                    ("Empresas//DEPARTAMENTO FISCAL/…//XML SAÍDA") e o Graph
                    respondia `itemNotFound`, que manda procurar a PASTA no
                    SharePoint — a primeira parada errada, sobre uma pasta que
                    pode estar perfeita. Botão apagado DIZ o que falta (a régua
                    de 20/08: "parece desabilitado" e "está desabilitado" são a
                    mesma coisa para quem usa). */}
                <button
                    onClick={handleSync}
                    disabled={loading || !health?.configured || faltando.length > 0}
                    title={
                        faltando.length > 0
                            ? `Falta preencher: ${faltando.join(', ')} — sem isso o caminho sai com pedaços vazios e o SharePoint responde que a pasta não existe.`
                            : !health?.configured ? 'O proxy do SharePoint não está configurado.' : undefined
                    }
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
    lastSync: {
        competencia: string; totalNovos: number; totalDup: number; totalErros: number;
        empresasComConfigIncompleta?: number; erroFatal?: string | null;
        timestamp?: { _seconds: number };
        /** Resultado por empresa do último run — carrega o MOTIVO dos erros
         *  (errosDetalhe/erro), que o card escondia atrás do "N erros". */
        results?: {
            empresaId?: string; empresaNome?: string;
            novos?: number; duplicados?: number; erros?: number;
            erro?: string; errosDetalhe?: string[]; configIncompleta?: boolean;
        }[];
    } | null;
    empresasAutoSync: { id: string; nome: string; cnpj: string; grupo: string; empresaPasta: string }[];
    /** Gap que trava a cópia no SharePoint (XMLs + IMPOSTOS): quem ainda
     *  não tem grupo+pasta preenchidos. */
    empresasSemConfig?: { id: string; nome: string; cnpj: string; fonte: 'simples' | 'lucro' }[];
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
            // fonte: catálogo de opções OU a lista de pendentes (empresa que só
            // aparece lá também precisa salvar na coleção certa — Simples ia
            // parar em lucro_empresas sem este fallback).
            const empresa = empresas.find(e => e.id === configEmpresaId)
                || status?.empresasSemConfig?.find(e => e.id === configEmpresaId);
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
                            <p style={{ color: status.lastSync.totalErros > 0 ? 'var(--danger, #ef4444)' : undefined }}>
                                {status.lastSync.totalNovos} novos, {status.lastSync.totalDup} duplicados, {status.lastSync.totalErros} erros
                            </p>
                            {/* Farol honesto: erro sempre com o MOTIVO ao lado. O card
                                dizia "9 erros" e escondia o porquê — os motivos já
                                vinham no log (results[].errosDetalhe), só não eram
                                renderizados (25/07). */}
                            {status.lastSync.totalErros > 0 && (status.lastSync.results || []).some(r => r.erro || (r.errosDetalhe || []).length > 0) && (
                                <div className="mt-1 space-y-0.5">
                                    {(status.lastSync.results || [])
                                        .filter(r => r.erro || (r.errosDetalhe || []).length > 0)
                                        .slice(0, 6)
                                        .map((r, i) => (
                                            <p key={i} className="text-[10px]" style={{ color: 'var(--danger, #ef4444)' }}>
                                                • {r.empresaNome || r.empresaId || '—'}: {r.erro || (r.errosDetalhe || []).join(' · ')}
                                            </p>
                                        ))}
                                </div>
                            )}
                            {status.lastSync.erroFatal && (
                                <p className="font-semibold" style={{ color: 'var(--danger, #ef4444)' }}>
                                    ✗ Última execução FALHOU: {status.lastSync.erroFatal}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Empresas enabled */}
                    {status?.empresasAutoSync && status.empresasAutoSync.length > 0 && (
                        <div>
                            <p className="text-[10px] font-bold uppercase mb-1" style={{ color: 'var(--text-muted)' }}>Empresas com auto-sync</p>
                            <div className="space-y-1">
                                {status.empresasAutoSync.map(e => {
                                    // Bolinha verde só com grupo E pasta preenchidos —
                                    // sem eles o sync pula a empresa e nada é baixado.
                                    const cfgOk = !!(e.grupo || '').trim() && !!(e.empresaPasta || '').trim();
                                    return (
                                    <div key={e.id} className="flex items-center gap-2 text-xs py-0.5">
                                        <span className={`w-2 h-2 rounded-full ${cfgOk ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                        <span style={{ color: 'var(--text-primary)' }}>{e.nome}</span>
                                        <span style={{ color: 'var(--text-muted)' }}>({e.grupo}/{e.empresaPasta})</span>
                                        {!cfgOk && (
                                            <span className="font-semibold" style={{ color: 'var(--danger, #ef4444)' }}>
                                                ⚠ grupo/pasta não preenchidos — nada é sincronizado
                                            </span>
                                        )}
                                    </div>
                                    );
                                })}
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

                    {/* Pendentes de configuração — a lista de trabalho do gap
                        semConfig: sem grupo+pasta nada sobe pro SharePoint
                        (nem XML do arquivo, nem imposto da ordem técnica).
                        "Preencher" pré-seleciona a empresa no formulário. */}
                    {(status?.empresasSemConfig?.length || 0) > 0 && (
                        <div className="border-t pt-3 mt-3" style={{ borderColor: 'var(--border-subtle)' }}>
                            <div className="flex items-center justify-between mb-1">
                                <p className="text-[10px] font-bold uppercase" style={{ color: 'var(--danger, #ef4444)' }}>
                                    ⚠ {status!.empresasSemConfig!.length} empresa(s) SEM pasta configurada — nada sobe pro SharePoint
                                </p>
                                <button
                                    onClick={() => {
                                        const txt = status!.empresasSemConfig!
                                            .map(e => `${e.cnpj}\t${e.nome}\t${e.fonte === 'simples' ? 'Simples' : 'Lucro'}`)
                                            .join('\n');
                                        navigator.clipboard.writeText(`CNPJ\tEmpresa\tRegime\n${txt}`);
                                    }}
                                    className="text-[10px] underline"
                                    style={{ color: 'var(--text-muted)' }}
                                    title="Copia a lista (CNPJ / nome / regime) pra colar no Excel"
                                >
                                    📋 Copiar lista
                                </button>
                            </div>
                            <div className="max-h-48 overflow-y-auto space-y-0.5">
                                {status!.empresasSemConfig!.map(e => {
                                    // Cadastro sem nome E sem CNPJ é lixo (não dá nem pra
                                    // achar a pasta no SharePoint) — em vez de "Preencher",
                                    // aponta a exclusão no painel do regime (25/07: a lista
                                    // revelou 2 vazios e um "(deletar)" literal).
                                    const vazio = !e.cnpj && (!e.nome || e.nome === '—');
                                    return (
                                    <div key={e.id} className="flex items-center gap-2 text-xs py-0.5">
                                        <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                                        <span className="font-mono" style={{ color: 'var(--text-muted)' }}>
                                            {e.cnpj.length === 14 ? e.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : e.cnpj || '—'}
                                        </span>
                                        <span className="truncate" style={{ color: 'var(--text-primary)' }}>{e.nome}</span>
                                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{e.fonte === 'simples' ? 'Simples' : 'Lucro'}</span>
                                        {vazio ? (
                                            <span className="ml-auto text-[10px] font-bold shrink-0 text-amber-600" title="Cadastro sem nome e sem CNPJ — não tem o que preencher; exclua no painel do regime (🗑️ admin).">
                                                ⚠ cadastro vazio — excluir no painel
                                            </span>
                                        ) : (
                                            <button
                                                onClick={() => { setConfigEmpresaId(e.id); setConfigGrupo(''); setConfigPasta(''); }}
                                                className="ml-auto text-[10px] font-bold underline shrink-0"
                                                style={{ color: 'var(--accent)' }}
                                            >
                                                Preencher ↓
                                            </button>
                                        )}
                                    </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Add empresa config */}
                    <div className="border-t pt-3 mt-3" style={{ borderColor: 'var(--border-subtle)' }}>
                        <p className="text-[10px] font-bold uppercase mb-2" style={{ color: 'var(--text-muted)' }}>Adicionar empresa ao auto-sync</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <EmpresaSearchSelect
                            empresas={empresas}
                            value={configEmpresaId}
                            onChange={setConfigEmpresaId}
                            placeholder="Empresa — código, nome ou CNPJ"
                        />
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
