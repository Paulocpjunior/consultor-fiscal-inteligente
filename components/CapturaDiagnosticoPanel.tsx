/**
 * CapturaDiagnosticoPanel.tsx
 *
 * Painel admin que mostra estado REAL dos trilhos de captura
 * (NFe DistDFe, NFSe SP, NFSe Nacional ADN, saída mod 55 pelo cofre de e-mail):
 *   - última execução do cron + duração + sucessos/falhas
 *   - total de empresas elegíveis + travadas (>7d sem sync)
 *   - docs capturados nos últimos 7d (NFe / NFSe SP / NFSe Nacional / saída cofre)
 *   - janela operacional atual
 *   - botão "Forçar captura agora" pra cada fonte
 *
 * Lê de /api/admin/sefaz/captura-diagnostico.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { avaliarSaudeCaptura, avaliarSaudeCofreSaida } from '../services/capturaSaude';
import {
    fetchCapturaDiagnostico,
    forcarCapturaAgora,
    capturaDirigidaAgora,
    type CapturaDiagnostico,
    type CapturaStatus,
    type CronLog,
} from '../services/capturaDiagnosticoService';
import type { User } from '../types';
import ConsultaNFePorChavePanel from './ConsultaNFePorChavePanel';
import ConferenciaChavesPanel from './ConferenciaChavesPanel';
import {
    manifestarPendentes, listarElegiveisManifestacao, manifestarUmaChave,
    resetarFalhasInfraManifestacao,
    type ManifestarPendentesResult, type TipoManifestacao,
    type ElegivelManifestacao,
} from '../services/manifestoService';
import { instrucoesMigracaoCofre } from '../services/cofreInstrucoes';
// 🚨 De quem é a falha — do serviço ou do cadastro de cada empresa (30/08).
import { deQuemEhAFalha } from '../services/falhaDeQuem';

interface Props {
    currentUser: User;
}

function formatRelativeBR(ms: number | null | undefined): string {
    if (!ms) return 'nunca';
    const diffMin = Math.floor((Date.now() - ms) / 60000);
    if (diffMin < 1) return 'agora';
    if (diffMin < 60) return `há ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `há ${diffH}h`;
    return `há ${Math.floor(diffH / 24)}d`;
}

// Cores por nível de saúde HONESTA (resultado, não recência) — vide
// services/capturaSaude.ts. "Rodou há pouco" sozinho nunca mais dá verde.
const COR_POR_NIVEL: Record<'ok' | 'atencao' | 'critico', string> = {
    ok: 'bg-green-100 text-green-800 border-green-300',
    atencao: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    critico: 'bg-red-100 text-red-800 border-red-300',
};
const EMOJI_POR_NIVEL: Record<'ok' | 'atencao' | 'critico', string> = {
    ok: '✅', atencao: '⚠️', critico: '🔴',
};

function isCronLog(x: any): x is CronLog {
    return x && typeof x === 'object' && 'executadoEmMs' in x;
}

const CardCaptura: React.FC<{
    titulo: string;
    status: CapturaStatus;
    fonte: 'sefazNfe' | 'nfseSp' | 'nfseNacional' | 'saidaCofre';
    isAdmin: boolean;
    onForcarOk: () => void;
}> = ({ titulo, status, fonte, isAdmin, onForcarOk }) => {
    const [forcando, setForcando] = useState(false);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [comunicadoCopiado, setComunicadoCopiado] = useState(false);

    const log = isCronLog(status.ultimoCron) ? status.ultimoCron : null;
    const ultimoMs = log?.executadoEmMs ?? null;
    const stateOk = status.state && 'total' in status.state;
    const stateTotal = stateOk ? (status.state as any).total : null;
    const stateTotalAtivas = stateOk ? (status.state as any).totalAtivas : null;
    const stateTravadas = stateOk ? (status.state as any).travadas : null;
    // bloqueadas = empresas sem A1 proprio/mesma raiz nem A3 local. Sao puladas
    // pelo cron (nao tentam capturar) — exibimos separado pra nao confundir
    // com "falhas" reais e pra contador ver o que precisa cadastrar.
    const stateBloqueadas = stateOk ? (status.state as any).bloqueadas : null;

    // Saúde HONESTA: mede resultado (docs capturados + taxa de sucesso), não
    // só "o cron rodou". Regressão do verde mentiroso da NFS-e SP (0/121 ✅).
    // Saída pelo cofre tem saúde própria (mede ADOÇÃO, não "o cron rodou"): a
    // SEFAZ nunca entrega a saída ao emissor, então 0 saída = clientes sem
    // configurar, não captura quebrada. Os demais trilhos usam o farol clássico.
    const saude = fonte === 'saidaCofre'
        ? avaliarSaudeCofreSaida({
            ultimoMs,
            saida7d: status.docsUltimos7d ?? null,
            entregando7d: status.entregando7d ?? null,
            monitoradas: status.monitoradasCofre ?? null,
            agoraMs: Date.now(),
        })
        : avaliarSaudeCaptura({
            ultimoMs,
            sucessos: log?.sucessos ?? null,
            falhas: log?.falhas ?? null,
            docsUltimos7d: status.docsUltimos7d ?? null,
            elegiveis: stateTotal ?? null,
            // NFSe Nacional: sinal do provedor. false = ADN confirma que não há doc
            // disponível → "0 capturado" é correto, não pinta vermelho de falha.
            movimentoDisponivel: status.movimentoDisponivel ?? null,
            // Cron seg-sex (pelo scheduler declarado): fim de semana não conta
            // como atraso — domingo 26/07 amarelou o painel inteiro à toa.
            cadenciaSegSex: /seg-sex/i.test(status.schedulerEsperado || ''),
            // Run morto no meio (SIGTERM do deploy ou auto-cura por idade):
            // nunca verde — não capturou nesta rodada.
            runInterrompido: log?.status === 'interrompido',
            agoraMs: Date.now(),
        });
    const cor = COR_POR_NIVEL[saude.nivel];

    const handleForcar = async () => {
        setForcando(true);
        setFeedback(null);
        try {
            const r = await forcarCapturaAgora(fonte);
            if (r.ok) {
                setFeedback('Captura iniciada em background. Aguarde alguns minutos.');
                setTimeout(onForcarOk, 5000);
            } else {
                setFeedback(`Erro: ${r.motivo || 'falha desconhecida'}`);
            }
        } catch (e: any) {
            setFeedback(`Erro: ${e.message}`);
        } finally {
            setForcando(false);
        }
    };

    return (
        <div className={`border-2 rounded-lg p-4 ${cor}`}>
            <div className="flex items-start justify-between mb-3">
                <div>
                    <h3 className="font-bold text-base">{titulo}</h3>
                    <p className="text-xs opacity-80 mt-1">{status.fonte}</p>
                </div>
                <span className="text-2xl" title={saude.motivo}>
                    {EMOJI_POR_NIVEL[saude.nivel]}
                </span>
            </div>

            {/* Execução 'iniciada'. Uma varredura real termina em ~1h. Passou muito
                disso e o heartbeat ainda diz 'iniciado' = a execução MORREU no meio
                (deploy troca a revisão do Cloud Run e mata o setImmediate; reinício
                de instância idem). O doc fica preso em 'iniciado' pra ninguém pensar
                que rodou. Aqui a gente para de mentir "rodando" e mostra a verdade:
                interrompida, clique Forçar pra reiniciar (é seguro — dedup). */}
            {log?.status === 'iniciado' && (() => {
                const iniciadoHaMin = ultimoMs ? Math.floor((Date.now() - ultimoMs) / 60000) : 0;
                const LIMITE_EM_ANDAMENTO_MIN = 90; // ~1h esperado + folga
                const provavelmenteMorta = iniciadoHaMin >= LIMITE_EM_ANDAMENTO_MIN;
                return provavelmenteMorta ? (
                    <div className="text-xs font-bold mb-2 bg-amber-100 text-amber-900 border border-amber-400 rounded px-2 py-1">
                        ⚠️ Execução iniciada {formatRelativeBR(ultimoMs)} e NÃO terminou — o normal é ~1h.
                        Provavelmente foi interrompida (deploy/reinício do servidor mata a varredura em
                        andamento). Os docs já capturados estão salvos. Clique <strong>“Forçar captura
                        agora”</strong> para reiniciar do zero (seguro: a importação deduplica).
                    </div>
                ) : (
                    <div className="text-xs font-bold mb-2 bg-sky-100 text-sky-800 border border-sky-300 rounded px-2 py-1">
                        ⏳ Execução EM ANDAMENTO (iniciada {formatRelativeBR(ultimoMs)}) — varredura completa
                        pode levar até ~1h (períodos por mês × empresas); o resultado aparece aqui ao terminar.
                    </div>
                );
            })()}
            {/* Run já CARIMBADO como interrompido (SIGTERM do deploy ou auto-cura
                por idade). Antes o doc ficava preso em 'iniciado' e o painel dizia
                "TRAVADO" pra sempre; agora o próprio log diz o que houve. */}
            {log?.status === 'interrompido' && (
                <div className="text-xs font-bold mb-2 bg-amber-100 text-amber-900 border border-amber-400 rounded px-2 py-1">
                    ⚠️ Execução iniciada {formatRelativeBR(ultimoMs)} foi <strong>interrompida</strong> (deploy/reinício
                    do servidor mata a varredura em andamento). Os docs já capturados estão salvos. Clique
                    <strong> “Forçar captura agora”</strong> para completar (seguro: a importação deduplica).
                </div>
            )}
            {/* Motivo do farol — sempre visível; é o que evita "verde mentiroso". */}
            <div className={`text-xs font-semibold mb-2 ${
                saude.nivel === 'critico' ? 'text-red-800' : saude.nivel === 'atencao' ? 'text-amber-800' : 'text-emerald-800'
            }`}>
                {saude.motivo}
            </div>

            <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                    <span className="opacity-80">Última execução:</span>
                    <span className="font-semibold">{formatRelativeBR(ultimoMs)}</span>
                </div>
                {log && (
                    <>
                        <div className="flex justify-between">
                            <span className="opacity-80">Sucessos / Falhas:</span>
                            <span className="font-mono">{log.sucessos ?? 0} / {log.falhas ?? 0}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="opacity-80">Novos docs (essa exec.):</span>
                            <span className="font-mono">{log.totalNovos ?? 0}</span>
                        </div>
                        {log.erroFatal && (
                            <div className="text-red-700 bg-red-50 p-2 rounded text-xs mt-1">
                                <strong>Erro fatal:</strong> {log.erroFatal}
                            </div>
                        )}
                    </>
                )}
                {/* Por que está falhando — agregado da última execução. Sem isto
                    o card dizia "0/121" e ninguém sabia a causa. */}
                {status.topFalhas?.top && status.topFalhas.top.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded p-2 text-xs space-y-1 overflow-hidden">
                        {/* 🚨 DE QUEM É A FALHA — a ação que faltava (30/08, ADN 0/42
                            com E999). Com 42 empresas em vermelho, a reação natural é
                            conferir cadastro das 42 à toa; quando TODAS erram igual, o
                            problema é do serviço, e dizer isso economiza o dia. */}
                        {(() => {
                            const v = deQuemEhAFalha({
                                sucessos: log?.sucessos ?? null,
                                falhas: log?.falhas ?? null,
                                motivos: status.topFalhas?.top,
                                canal: titulo,
                            });
                            if (v.origem !== 'servico') return null;
                            return (
                                <div className="bg-white/70 border border-red-300 rounded p-1.5 mb-1">
                                    <div className="font-bold text-red-900">{v.frase}</div>
                                    {v.acao && <div className="text-red-800 mt-0.5">{v.acao}</div>}
                                </div>
                            );
                        })()}
                        <div className="font-bold text-red-800">Principais motivos de falha:</div>
                        {status.topFalhas.top.map((f, i) => (
                            // break-all: motivo com JSON/token gigante estourava pra
                            // fora do card (print 26/07 — E2220 do ADN).
                            <div key={i} className="text-red-700 break-all">
                                <span className="font-mono font-bold">{f.quantidade}×</span> {f.motivo}
                            </div>
                        ))}
                    </div>
                )}
                <div className="flex justify-between border-t pt-2 mt-2">
                    <span className="opacity-80">{fonte === 'saidaCofre' ? 'Empresas monitoradas:' : 'Empresas elegíveis:'}</span>
                    <span className="font-mono">
                        {stateTotal ?? '—'}
                        {stateTotalAtivas !== null && stateTotalAtivas !== undefined && stateTotalAtivas !== stateTotal && (
                            <span className="opacity-70 ml-1">/ {stateTotalAtivas} ativas</span>
                        )}
                        {stateTravadas !== null && stateTravadas !== undefined && stateTravadas > 0 && (
                            <span className="text-red-700 ml-2">({stateTravadas} travadas &gt;7d)</span>
                        )}
                    </span>
                </div>
                {stateBloqueadas !== null && stateBloqueadas !== undefined && stateBloqueadas > 0 && (
                    <div className="flex justify-between">
                        <span className="opacity-80" title="Empresas sem A1 próprio/mesma raiz CNPJ ou A3 local — admin precisa configurar antes de capturar">
                            🔒 Bloqueadas por cadastro:
                        </span>
                        <span className="font-mono text-amber-700">{stateBloqueadas}</span>
                    </div>
                )}
                {/* POR QUE estão bloqueadas — sem isto o número era mudo (368
                    bloqueadas no Nacional e ninguém sabia a causa dominante). */}
                {stateOk && (status.state as any).bloqueiosPorMotivo && Object.keys((status.state as any).bloqueiosPorMotivo).length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs space-y-0.5">
                        <div className="font-bold text-amber-800">Motivos dos bloqueios:</div>
                        {Object.entries((status.state as any).bloqueiosPorMotivo as Record<string, number>)
                            .sort((a, b) => b[1] - a[1]).slice(0, 4)
                            .map(([motivo, qtd]) => (
                                <div key={motivo} className="text-amber-700">
                                    <span className="font-mono font-bold">{qtd}×</span> {motivo}
                                </div>
                            ))}
                    </div>
                )}
                {status.docsTotalHistorico !== undefined && status.docsTotalHistorico !== null && (() => {
                    // "0 histórico" só é vermelho de verdade quando NÃO sabemos que o
                    // provedor está vazio. Se o ADN confirma sem movimento, 0 é
                    // esperado (transição) — âmbar, não sangue.
                    const semMovimentoConfirmado = status.movimentoDisponivel === false;
                    const zero = status.docsTotalHistorico === 0;
                    const cor = zero ? (semMovimentoConfirmado ? 'text-amber-700' : 'text-red-700') : '';
                    return (
                        <div className="flex justify-between">
                            <span className="opacity-80" title="Se 0: esta fonte nunca capturou. Cruze com o cursor NSU abaixo — se o ADN confirma sem movimento, 0 é esperado; senão é elegibilidade/cron.">
                                Docs (histórico total):
                            </span>
                            <span className={`font-mono font-bold ${cor}`}>
                                {status.docsTotalHistorico}
                                {zero && (semMovimentoConfirmado ? ' — ADN sem movimento' : ' — nunca capturou')}
                            </span>
                        </div>
                    );
                })()}
                {stateOk && (status.state as any).elegiveisLista?.length > 0 && (
                    // max-h + scroll: com 28 elegíveis a lista esticava o card
                    // quilométrico e quebrava o grid dos 4 trilhos (25/07).
                    <div className="bg-white/50 border rounded p-2 text-xs space-y-1 max-h-72 overflow-y-auto">
                        <div className="font-bold opacity-80">Quem são as elegíveis (e o que o provedor diz):</div>
                        {((status.state as any).elegiveisLista as Array<{
                            nome: string; cnpj: string;
                            ultNSU?: number | null; maxNSU?: number | null; semMovimento?: boolean | null;
                        }>).map(e => {
                            // semMovimento: true = ADN confirma que não há nada (0 correto);
                            // false = há doc esperando e não capturamos (bug); null = nunca sincronizou.
                            const temNsu = e.maxNSU != null && e.ultNSU != null;
                            const veredito = e.semMovimento === true
                                ? { txt: '✓ ADN sem movimento (nada a capturar)', cls: 'text-emerald-700' }
                                : e.semMovimento === false
                                ? { txt: `⚠ ${(e.maxNSU ?? 0) - (e.ultNSU ?? 0)} doc(s) no ADN não capturados`, cls: 'text-red-700 font-bold' }
                                : { txt: '— ainda não sincronizou', cls: 'opacity-60' };
                            return (
                                <div key={e.cnpj} className="border-t first:border-t-0 pt-1 first:pt-0">
                                    <div className="font-mono text-[10px]">{e.cnpj} · {e.nome}</div>
                                    <div className="flex justify-between text-[10px]">
                                        <span className={veredito.cls}>{veredito.txt}</span>
                                        {temNsu && <span className="font-mono opacity-60">NSU {e.ultNSU}/{e.maxNSU}</span>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
                {/* Cofre de saída: mostra ADOÇÃO (quem entrega vs monitoradas) e
                    separa saída (o foco) de entrada. É o que responde "como está a
                    saída mod 55?" num olhar. */}
                {fonte === 'saidaCofre' && (() => {
                    // Adoção = QUALQUER trilho automático (cofre ∪ autXML). Antes o
                    // card só contava o cofre de e-mail — empresa entregando 100%
                    // via autXML aparecia como "não entrega" (Paulo, 30/07).
                    const totalEntregando = status.entregandoQualquer7d ?? status.entregando7d ?? null;
                    return (
                    <div className="bg-white/50 border rounded p-2 text-xs space-y-1">
                        <div className="flex justify-between">
                            <span className="opacity-80">Clientes entregando saída (7d):</span>
                            <span className={`font-mono font-bold ${(totalEntregando ?? 0) === 0 ? 'text-red-700' : ''}`}>
                                {totalEntregando ?? '—'} de {status.monitoradasCofre ?? '—'}
                            </span>
                        </div>
                        <div className="flex justify-between opacity-70 pl-2">
                            <span>· pelo cofre de e-mail:</span>
                            <span className="font-mono">{status.entregando7d ?? '—'}</span>
                        </div>
                        <div className="flex justify-between opacity-70 pl-2">
                            <span>· pelo autXML (DistDFe):</span>
                            <span className="font-mono">
                                {status.entregandoAutXml7d ?? '—'}
                                {(status.saidaAutXml7d ?? 0) > 0 && <span className="opacity-70"> ({status.saidaAutXml7d} nota{(status.saidaAutXml7d ?? 0) > 1 ? 's' : ''})</span>}
                            </span>
                        </div>
                        {status.jaEntregaram != null && (
                            <div className="flex justify-between opacity-70">
                                <span>Já entregaram pelo cofre alguma vez:</span>
                                <span className="font-mono">{status.jaEntregaram}</span>
                            </div>
                        )}
                        {status.entrada7dCofre != null && (
                            <div className="flex justify-between opacity-70">
                                <span>Entrada via cofre (7d):</span>
                                <span className="font-mono">{status.entrada7dCofre}</span>
                            </div>
                        )}
                        <div className="text-[10px] opacity-70 pt-1 border-t">
                            A saída entra por DOIS trilhos automáticos: cliente aponta o emissor pro cofre
                            (<span className="font-mono">xml@spassessoriacontabil.com.br</span>) OU põe o CNPJ
                            44.388.152/0001-89 no autXML da nota. Prova por empresa e lista de quem falta:
                            {' '}<strong>Cobertura de Saída</strong>.
                        </div>
                    </div>
                    );
                })()}
                <div className="flex justify-between">
                    <span className="opacity-80">{fonte === 'saidaCofre' ? 'Saída mod 55 importada <7d:' : 'Docs capturados <7d:'}</span>
                    <span className="font-mono font-bold">{status.docsUltimos7d ?? '—'}</span>
                </div>
                <div className="text-xs opacity-70 pt-2 border-t mt-2">
                    <div>📅 {status.schedulerEsperado}</div>
                </div>
            </div>

            {/* Comunicado do mod 55 DIRETO no card do problema — o texto vivia
                enterrado na aba Importação Manual → Checklist do Cofre e o
                Paulo não o achava (24/07). Copia genérico; a versão com o nome
                da empresa continua no Checklist (botão 📋 Instruções). */}
            {fonte === 'saidaCofre' && (
                <div className="mt-3 pt-3 border-t">
                    <button
                        onClick={() => {
                            navigator.clipboard.writeText(instrucoesMigracaoCofre());
                            setComunicadoCopiado(true);
                            setTimeout(() => setComunicadoCopiado(false), 2500);
                        }}
                        className="w-full px-3 py-2 bg-sky-600 text-white rounded text-sm font-medium hover:bg-sky-700 transition"
                        title="Copia o texto pronto pra enviar ao cliente (configurar o cofre no emissor). Versão com o nome da empresa: Importação Manual → Checklist do Cofre."
                    >
                        {comunicadoCopiado ? '✓ Comunicado copiado!' : '📋 Copiar comunicado ao cliente'}
                    </button>
                </div>
            )}
            {isAdmin && (
                <div className="mt-3 pt-3 border-t">
                    <button
                        onClick={handleForcar}
                        disabled={forcando}
                        className="w-full px-3 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                        {forcando ? '⏳ Disparando…' : '▶ Forçar captura agora'}
                    </button>
                    {feedback && (
                        <p className="text-xs mt-2 opacity-90">{feedback}</p>
                    )}
                </div>
            )}
        </div>
    );
};

const CapturaDiagnosticoPanel: React.FC<Props> = ({ currentUser }) => {
    const [data, setData] = useState<CapturaDiagnostico | null>(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const isAdmin = currentUser.role === 'admin';
    // Guard contra setState apos unmount
    const aliveRef = useRef(true);

    const load = useCallback(async () => {
        setLoading(true);
        setErro(null);
        try {
            const d = await fetchCapturaDiagnostico();
            if (aliveRef.current) setData(d);
        } catch (e: any) {
            if (aliveRef.current) setErro(e.message || 'Falha ao carregar diagnóstico');
        } finally {
            if (aliveRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        aliveRef.current = true;
        load();
        const interval = setInterval(load, 60000); // refresh a cada 1min
        return () => {
            aliveRef.current = false;
            clearInterval(interval);
        };
    }, [load]);

    if (loading && !data) {
        return <div className="p-6 text-center text-gray-500">Carregando diagnóstico de captura…</div>;
    }
    if (erro) {
        return (
            <div className="p-6 border border-red-300 bg-red-50 rounded">
                <p className="text-red-700 font-semibold">Erro ao carregar: {erro}</p>
                <button onClick={load} className="mt-2 px-3 py-1 bg-red-600 text-white rounded text-sm">Tentar de novo</button>
            </div>
        );
    }
    if (!data) return null;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                        🛰️ Diagnóstico de Captura Automática
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        Estado real dos trilhos de captura (NFe, NFSe SP, NFSe Nacional e saída mod 55 pelo cofre) que alimentam os XMLs e NFSe dos clientes.
                    </p>
                </div>
                <button
                    onClick={load}
                    className="px-3 py-1.5 text-sm bg-gray-200 hover:bg-gray-300 rounded transition"
                >
                    ↻ Atualizar
                </button>
            </div>

            <div className={`p-3 rounded border ${data.janela.dentro ? 'bg-green-50 border-green-300 text-green-800' : 'bg-yellow-50 border-yellow-300 text-yellow-800'}`}>
                <div className="text-sm">
                    <strong>Janela operacional:</strong> {data.janela.agoraBRT} BRT —{' '}
                    {data.janela.dentro ? '✅ dentro (captura manual permitida)' : `⏸️ fora (${data.janela.motivo || 'horário restrito'})`}
                </div>
                <div className="text-xs opacity-80 mt-1">
                    Cron noturno (02h/03h/04h) roda 24/7, não bloqueia por janela.
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <CardCaptura
                    titulo="NFe — Entrada/Saída"
                    status={data.capturas.sefazNfe}
                    fonte="sefazNfe"
                    isAdmin={isAdmin}
                    onForcarOk={load}
                />
                <CardCaptura
                    titulo="NFSe SP — Tomados+Prestados"
                    status={data.capturas.nfseSp}
                    fonte="nfseSp"
                    isAdmin={isAdmin}
                    onForcarOk={load}
                />
                <CardCaptura
                    titulo="NFSe Nacional ADN"
                    status={data.capturas.nfseNacional}
                    fonte="nfseNacional"
                    isAdmin={isAdmin}
                    onForcarOk={load}
                />
                {/* 4º trilho: SAÍDA mod 55 pelo cofre de e-mail. Opcional pra não
                    quebrar se o backend ainda não enviar o card (deploy defasado). */}
                {data.capturas.saidaCofre && (
                    <CardCaptura
                        titulo="Saída mod 55 — Cofre de e-mail"
                        status={data.capturas.saidaCofre}
                        fonte="saidaCofre"
                        isAdmin={isAdmin}
                        onForcarOk={load}
                    />
                )}
            </div>

            <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 p-3 bg-gray-50 dark:bg-gray-800 rounded">
                <strong>Como ler:</strong> o farol mede RESULTADO, não só execução: 🔴 = falhando tudo, 0 docs em 7d com empresas elegíveis, ou parado &gt;72h · 🟡 = mais falha que sucesso ou execução atrasada · 🟢 = executando E capturando.
                Empresas <strong>travadas &gt;7d</strong> são as que não tiveram nova captura — verifique cert, autorização ou flag de captura.
                No card de <strong>Saída mod 55 (cofre)</strong> o farol mede ADOÇÃO: 🔴 = nenhuma saída entrou (clientes ainda não apontaram o emissor pro cofre) · 🟡 = entra saída, mas menos da metade dos clientes migrou · 🟢 = maioria entregando.
            </div>

            {isAdmin && <ConsultaNFePorChavePanel />}
            {isAdmin && <ConferenciaChavesPanel />}
            {isAdmin && <ManifestarPendentesCard />}
            {isAdmin && <FilaManifestacaoCard />}
            {isAdmin && <CapturaDirigidaCard />}
        </div>
    );
};

// Botao admin pra disparar manifestacao em lote dos resNFe pendentes na base.
// Auto-manifestacao (PR #35) cobre NOVOS imports. Esse botao cobre o HISTORICO
// que ja estava como resumo antes do PR #35 — usuario clica uma vez (ou
// algumas, em batches de 100) e a base e atualizada com procNFe completos.
const ManifestarPendentesCard: React.FC = () => {
    const [rodando, setRodando] = React.useState(false);
    const [resultado, setResultado] = React.useState<ManifestarPendentesResult | null>(null);
    const [limit, setLimit] = React.useState(100);
    const [tipo, setTipo] = React.useState<TipoManifestacao>('ciencia');

    const handleRun = async (dryRun: boolean) => {
        setRodando(true);
        setResultado(null);
        try {
            const r = await manifestarPendentes({ tipo, limit, dryRun });
            setResultado(r);
        } catch (e: any) {
            setResultado({ erro: e.message || 'erro' });
        } finally {
            setRodando(false);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-2">
                📨 Manifestar resNFe pendentes (libera procNFe completo)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                Dispara <strong>Manifestação do Destinatário</strong> em lote pros resNFe já capturados na base.
                SEFAZ libera o <strong>procNFe completo</strong> (com itens, totais, natOp) na próxima DistDFe.
                Novas capturas já fazem isso automaticamente (PR #35) — esse botão cobre o histórico.
            </p>
            <div className="flex flex-wrap gap-2 items-end mb-3">
                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase">Tipo</label>
                    <select
                        value={tipo}
                        onChange={(e) => setTipo(e.target.value as TipoManifestacao)}
                        className="px-2 py-1 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded"
                    >
                        <option value="ciencia">Ciência (210210) — recomendado</option>
                        <option value="confirmacao">Confirmação (210200) — implica concordância</option>
                    </select>
                </div>
                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase">Lote (max 500)</label>
                    <input
                        type="number" min={1} max={500}
                        value={limit}
                        onChange={(e) => setLimit(Math.min(500, Math.max(1, parseInt(e.target.value) || 100)))}
                        className="w-20 px-2 py-1 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded"
                    />
                </div>
                <button
                    onClick={() => handleRun(true)}
                    disabled={rodando}
                    className="px-3 py-1.5 text-xs font-semibold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 rounded"
                    title="Lista quantos seriam manifestados, sem enviar à SEFAZ"
                >
                    👀 Dry-run (preview)
                </button>
                <button
                    onClick={() => handleRun(false)}
                    disabled={rodando}
                    className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded"
                >
                    {rodando ? '⏳ Manifestando…' : `📨 Manifestar até ${limit} pendentes`}
                </button>
            </div>

            {resultado && (
                <div className={`mt-2 p-3 rounded border text-xs ${
                    resultado.erro
                        ? 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-700 dark:text-red-400'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-300'
                }`}>
                    {resultado.erro ? (
                        <span><strong>Erro:</strong> {resultado.erro}</span>
                    ) : (
                        <div className="space-y-1">
                            <div className="font-semibold">
                                {resultado.dryRun ? '[DRY-RUN] ' : ''}
                                Total: {resultado.total ?? 0} ·
                                Sucessos: <strong>{resultado.sucessos ?? 0}</strong> ·
                                Falhas: <strong className={resultado.falhas ? 'text-red-700 dark:text-red-400' : ''}>{resultado.falhas ?? 0}</strong> ·
                                Puladas: {resultado.puladas ?? 0}
                            </div>
                            {resultado.detalhes && resultado.detalhes.length > 0 && (
                                <details className="text-[11px]">
                                    <summary className="cursor-pointer hover:underline">Ver detalhes ({resultado.detalhes.length})</summary>
                                    <div className="mt-1 max-h-[200px] overflow-y-auto space-y-1 font-mono">
                                        {resultado.detalhes.map((d, i) => (
                                            <div key={i} className="flex gap-2">
                                                <span className={d.status === 'ok' ? 'text-emerald-700' : 'text-red-600'}>{d.status}</span>
                                                <span className="text-slate-500">{d.chave?.slice(0, 12)}…</span>
                                                <span className="text-slate-700 dark:text-slate-300">{d.motivo || ''}</span>
                                            </div>
                                        ))}
                                    </div>
                                </details>
                            )}
                            {(resultado.total || 0) >= limit && (
                                <div className="text-amber-700 dark:text-amber-400 text-[11px]">
                                    ⚠ Lote completo — pode haver mais pendentes. Clica de novo pra processar o próximo batch.
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 A FILA DA MANIFESTAÇÃO — três rotas que existiam sem botão
//
// Varredura de 21/08 (autorizada pelo Paulo no mesmo dia): `manifest-elegiveis`,
// `manifest-one` e `manifest-reset-falhas-infra` existiam no backend e nenhuma
// tela as chamava. O lote já tinha botão; o que faltava era **ver a fila** e
// **agir numa chave** — que é justamente o que se quer quando UMA nota trava.
//
// ⚠️ Manifestação é IRREVERSÍVEL na SEFAZ: a linha pede confirmação antes, e o
// tipo aparece na pergunta.
// ═══════════════════════════════════════════════════════════════════════════
export const FilaManifestacaoCard: React.FC = () => {
    const [carregando, setCarregando] = useState(false);
    const [itens, setItens] = useState<ElegivelManifestacao[] | null>(null);
    const [total, setTotal] = useState(0);
    const [erro, setErro] = useState<string | null>(null);
    const [tipo, setTipo] = useState<TipoManifestacao>('ciencia');
    const [emAndamento, setEmAndamento] = useState<string | null>(null);
    const [resultadoPorChave, setResultadoPorChave] = useState<Record<string, string>>({});
    const [resetando, setResetando] = useState(false);
    const [resetInfo, setResetInfo] = useState<string | null>(null);

    const carregar = async () => {
        setCarregando(true); setErro(null);
        try {
            const r = await listarElegiveisManifestacao({ limit: 50 });
            if (r.erro) { setErro(r.erro); setItens(null); return; }
            setItens(r.itens || []);
            setTotal(r.total ?? (r.itens || []).length);
        } catch (e: any) {
            setErro(e.message || 'erro');
        } finally {
            setCarregando(false);
        }
    };

    const manifestarUma = async (it: ElegivelManifestacao) => {
        const cnpj = String(it.empresaCnpj || '').replace(/\D/g, '');
        if (!cnpj) {
            setResultadoPorChave(p => ({ ...p, [it.chave]: 'sem CNPJ do destinatário no documento' }));
            return;
        }
        const ok = window.confirm(
            `Manifestar ${tipo.toUpperCase()} na nota ${it.chave.slice(25, 34)} de ${it.empresaNome || cnpj}?\n\n`
            + 'A manifestação é IRREVERSÍVEL na SEFAZ.',
        );
        if (!ok) return;
        setEmAndamento(it.chave);
        try {
            const r = await manifestarUmaChave({ chNFe: it.chave, cnpjDestinatario: cnpj, tipo });
            setResultadoPorChave(p => ({
                ...p,
                [it.chave]: r.erro ? `✕ ${r.erro}` : `✓ ${r.status || r.cStat || 'enviada'} ${r.xMotivo || ''}`.trim(),
            }));
        } catch (e: any) {
            setResultadoPorChave(p => ({ ...p, [it.chave]: `✕ ${e.message || 'erro'}` }));
        } finally {
            setEmAndamento(null);
        }
    };

    const destravarInfra = async () => {
        setResetando(true); setResetInfo(null);
        try {
            const r = await resetarFalhasInfraManifestacao();
            setResetInfo(r.erro
                ? `Erro: ${r.erro}`
                : `${r.resetados ?? 0} chave(s) voltaram ao lote (de ${r.candidatos ?? 0} com falha). `
                  + 'Só as que pararam por rede/timeout — recusa da SEFAZ por mérito continua fora.');
            if (!r.erro) carregar();
        } catch (e: any) {
            setResetInfo(`Erro: ${e.message || 'erro'}`);
        } finally {
            setResetando(false);
        }
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-2">
                🔎 Fila da manifestação — quem está esperando, e agir numa chave
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                O lote acima consome esta fila. Aqui dá para <strong>ver quem está nela</strong> e
                manifestar <strong>uma nota específica</strong> — que é o que se quer quando uma nota
                trava e o lote não a alcança.
            </p>
            <div className="flex flex-wrap gap-2 items-end mb-3">
                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase">Tipo</label>
                    <select
                        value={tipo}
                        onChange={(e) => setTipo(e.target.value as TipoManifestacao)}
                        className="px-2 py-1 text-xs bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded"
                    >
                        <option value="ciencia">Ciência (210210) — recomendado</option>
                        <option value="confirmacao">Confirmação (210200) — implica concordância</option>
                    </select>
                </div>
                <button
                    onClick={carregar}
                    disabled={carregando}
                    className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded"
                >
                    {carregando ? '⏳ Carregando…' : '🔎 Ver fila'}
                </button>
                <button
                    onClick={destravarInfra}
                    disabled={resetando}
                    className="px-3 py-1.5 text-xs font-semibold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 rounded"
                    title="Devolve ao lote as chaves que pararam por rede/timeout — recusa da SEFAZ por mérito continua fora"
                >
                    {resetando ? '⏳ Destravando…' : '🔧 Destravar falhas de infraestrutura'}
                </button>
            </div>

            {resetInfo && (
                <div className="mb-3 p-2 rounded border text-xs bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                    {resetInfo}
                </div>
            )}

            {erro && (
                <div className="p-3 rounded border text-xs bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-700 dark:text-red-400">
                    <strong>Erro:</strong> {erro}
                </div>
            )}

            {itens && !erro && (
                itens.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Nenhuma chave elegível agora. Isso <strong>não</strong> quer dizer que não há resumo
                        pendente: chave em cooldown ou com falhas seguidas fica de fora da fila até o
                        🔧 acima devolvê-la.
                    </p>
                ) : (
                    <div className="space-y-1">
                        <div className="text-xs text-slate-600 dark:text-slate-300 mb-1">
                            {itens.length} de {total} na fila
                            {total > itens.length && ' (mostrando as primeiras)'}
                        </div>
                        <div className="max-h-[280px] overflow-y-auto space-y-1">
                            {itens.map((it) => (
                                <div key={it.chave} className="flex flex-wrap items-center gap-2 text-[11px] border-b border-slate-100 dark:border-slate-700 pb-1">
                                    <span className="font-mono text-slate-500">nº {it.chave.slice(25, 34)}</span>
                                    <span className="text-slate-700 dark:text-slate-300 flex-1 min-w-[140px] truncate">
                                        {it.empresaNome || it.empresaCnpj || '—'}
                                    </span>
                                    <span className="text-slate-500">{(it.dhEmi || '').slice(0, 10)}</span>
                                    <button
                                        onClick={() => manifestarUma(it)}
                                        disabled={emAndamento === it.chave}
                                        className="px-2 py-1 font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded"
                                    >
                                        {emAndamento === it.chave ? '⏳' : '📨 Manifestar'}
                                    </button>
                                    {resultadoPorChave[it.chave] && (
                                        <span className={`basis-full ${resultadoPorChave[it.chave].startsWith('✓')
                                            ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                            {resultadoPorChave[it.chave]}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )
            )}
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════════════════
// 🎯 CAPTURA DIRIGIDA — a última das sete rotas órfãs
//
// `/sync-targeted` existia e só o CRON a alcançava. Sem ela, forçar a captura
// de um punhado de empresas (as 🎯 prioritárias da Cobertura de Saída, a fila
// de migração) significava disparar a carteira INTEIRA — que é o botão do lado.
//
// ⚠️ TRÊS COISAS QUE A TELA DIZ, e nenhuma é enfeite:
//  · **90s entre empresas** é o respiro que evita o cStat **656** da SEFAZ
//    (limite DELA). Por isso a estimativa de tempo aparece ANTES do clique.
//  · **A rodada corre em background** — o botão devolve "começou", nunca
//    "capturou". Confundir os dois é o "deploy verde = capturou nota" de 22/07.
//  · **Para no 656**: insistir contra o rate-limit da SEFAZ piora, não melhora.
// ═══════════════════════════════════════════════════════════════════════════
export const CapturaDirigidaCard: React.FC = () => {
    const [texto, setTexto] = useState('');
    const [enviando, setEnviando] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [erro, setErro] = useState<string | null>(null);

    // Aceita colagem de qualquer forma (vírgula, ponto-e-vírgula, quebra de
    // linha, com ou sem máscara) — quem cola vem de uma lista, não digita.
    const cnpjs = texto.split(/[\s,;]+/)
        .map(s => s.replace(/\D/g, ''))
        .filter(s => s.length === 14);
    const unicos = Array.from(new Set(cnpjs));
    const minutos = unicos.length > 1 ? Math.ceil((unicos.length - 1) * 90 / 60) : 0;

    const disparar = async () => {
        setErro(null); setMsg(null);
        if (!unicos.length) {
            setErro('Cole ao menos um CNPJ de 14 dígitos.');
            return;
        }
        if (!window.confirm(
            `Forçar captura em ${unicos.length} empresa(s)?\n\n`
            + `A rodada leva cerca de ${minutos} min (90s de respiro entre empresas, `
            + `para não bater no limite 656 da SEFAZ) e corre em segundo plano.`,
        )) return;
        setEnviando(true);
        try {
            const r = await capturaDirigidaAgora(unicos);
            if (!r.ok) { setErro(r.motivo || 'falha ao iniciar'); return; }
            setMsg(
                `✓ Rodada INICIADA para ${r.cnpjs ?? unicos.length} empresa(s) — cerca de `
                + `${r.minutosEstimados ?? minutos} min. Ela corre em segundo plano: isto diz que `
                + `COMEÇOU, não que capturou. O resultado aparece na Saúde dos crons`
                + `${r.logId ? ` (rodada ${r.logId})` : ''}.`,
            );
        } catch (e: any) {
            setErro(e?.message || 'erro');
        } finally {
            setEnviando(false);
        }
    };

    return (
        <div className="mt-4 p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <h4 className="font-bold text-sm text-slate-800 dark:text-slate-100">🎯 Captura dirigida</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-2">
                Força a captura numa <strong>lista</strong> de empresas, sem disparar a carteira inteira.
                Cole os CNPJs (vírgula, ponto-e-vírgula ou um por linha). Máximo de 30 por rodada.
            </p>
            <textarea
                value={texto}
                onChange={e => setTexto(e.target.value)}
                rows={3}
                placeholder="31.947.349/0001-69, 44388152000189"
                className="w-full text-xs p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
            />
            <div className="flex items-center gap-2 flex-wrap mt-2">
                <button
                    onClick={disparar}
                    disabled={enviando}
                    className="btn-press px-3 py-1.5 bg-sky-600 text-white rounded text-xs font-bold hover:bg-sky-700 disabled:opacity-50 whitespace-nowrap"
                >
                    {enviando ? 'Iniciando...' : '🎯 Forçar captura nesta lista'}
                </button>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                    {unicos.length
                        ? `${unicos.length} CNPJ(s) reconhecido(s) · ~${minutos} min`
                        : 'nenhum CNPJ de 14 dígitos reconhecido ainda'}
                </span>
            </div>
            {erro && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">⛔ {erro}</p>
            )}
            {msg && (
                <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">{msg}</p>
            )}
            <p className="mt-2 text-[11px] text-slate-400">
                A rodada PARA no primeiro cStat 656 (limite da SEFAZ) — insistir contra o rate-limit piora.
            </p>
        </div>
    );
};

export default CapturaDiagnosticoPanel;
