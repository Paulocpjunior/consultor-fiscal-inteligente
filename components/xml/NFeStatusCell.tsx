import React, { useState } from 'react';
import type { DocumentoFiscal, NFeEvento } from '../../types';

interface Props {
    doc: DocumentoFiscal;
}

const formatBR = (s: string | undefined): string => {
    if (!s) return '—';
    try {
        const d = new Date(s);
        if (Number.isNaN(d.getTime())) return s;
        return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    } catch { return s; }
};

const iconePorTipoDoc = (tipoDoc: string | undefined, tipo: string | undefined): string => {
    // Prioriza tipoDoc (do backend SEFAZ); fallback pra tipo (importação manual).
    const t = (tipoDoc || tipo || '').toLowerCase();
    if (t === 'cte' || t.startsWith('cte') || t === 'rescte') return '📦';
    if (t === 'mdfe' || t.startsWith('mdfe') || t === 'resmdfe') return '🚛';
    if (t === 'epec') return '⚠️';
    if (t === 'nfse' || t === 'nfs-e') return '🧾';
    if (t === 'nfce' || t === 'nfc-e') return '🛒';
    return '📄';  // default NFe
};

const eventoBadgeColor = (tipo: string): string => {
    switch (tipo) {
        case 'cancelamento': return 'bg-red-500/15 text-red-700 border-red-300 dark:text-red-300 dark:border-red-800';
        case 'cce':          return 'bg-amber-500/15 text-amber-700 border-amber-300 dark:text-amber-300 dark:border-amber-800';
        case 'manifestacao_ciencia':
        case 'manifestacao_confirmacao': return 'bg-blue-500/15 text-blue-700 border-blue-300 dark:text-blue-300 dark:border-blue-800';
        case 'manifestacao_desconhecimento':
        case 'manifestacao_nao_realizada': return 'bg-slate-500/15 text-slate-700 border-slate-300 dark:text-slate-300 dark:border-slate-700';
        default: return 'bg-purple-500/15 text-purple-700 border-purple-300 dark:text-purple-300 dark:border-purple-800';
    }
};

const NFeStatusCell: React.FC<Props> = ({ doc }) => {
    const [openModal, setOpenModal] = useState(false);

    const eventos: NFeEvento[] = doc.eventos || [];
    const isCancelado = doc.status === 'cancelado';
    const isPendente = doc.status === 'pendente' || doc.eventosBeforeNFe;
    const cces = eventos.filter(e => e.tipo === 'cce');
    const temEventos = eventos.length > 0;

    let badgeContent: React.ReactNode;
    let badgeClass: string;

    if (isCancelado) {
        badgeContent = <>🔴 Cancelada</>;
        badgeClass = 'bg-red-500/15 text-red-700 border-red-400 dark:text-red-300 dark:border-red-700';
    } else if (isPendente) {
        badgeContent = <>⏳ Pendente</>;
        badgeClass = 'bg-amber-500/15 text-amber-700 border-amber-400 dark:text-amber-300 dark:border-amber-700';
    } else if (cces.length > 0) {
        badgeContent = <>✏️ CC-e ({cces.length})</>;
        badgeClass = 'bg-amber-500/15 text-amber-700 border-amber-400 dark:text-amber-300 dark:border-amber-700';
    } else if (temEventos) {
        badgeContent = <>📌 Evento ({eventos.length})</>;
        badgeClass = 'bg-purple-500/15 text-purple-700 border-purple-400 dark:text-purple-300 dark:border-purple-700';
    } else if (doc.status === 'autorizado') {
        badgeContent = <>🟢 Vigente</>;
        badgeClass = 'bg-emerald-500/15 text-emerald-700 border-emerald-400 dark:text-emerald-300 dark:border-emerald-700';
    } else {
        badgeContent = <>{doc.status || '—'}</>;
        badgeClass = 'bg-slate-200 text-slate-600 border-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600';
    }

    const handleBadgeClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (temEventos) setOpenModal(true);
    };

    return (
        <>
            <button
                type="button"
                onClick={handleBadgeClick}
                disabled={!temEventos}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold transition ${badgeClass} ${temEventos ? 'cursor-pointer hover:scale-105' : 'cursor-default'}`}
                title={temEventos ? 'Clique para ver os eventos' : (`${(doc as any).tipoDoc || doc.tipo || 'documento fiscal'}`)}
            >
                <span aria-hidden="true">{iconePorTipoDoc((doc as any).tipoDoc, doc.tipo)}</span>
                <span>{badgeContent}</span>
            </button>

            {openModal && (
                <div
                    className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 overflow-y-auto"
                    onClick={(e) => { e.stopPropagation(); setOpenModal(false); }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl max-h-[80vh] overflow-hidden flex flex-col my-auto"
                    >
                        <div className="flex items-start justify-between mb-1">
                            <h3 className="text-base font-semibold text-white">Eventos da NF-e</h3>
                            <button
                                onClick={() => setOpenModal(false)}
                                className="text-slate-400 hover:text-white text-xl leading-none"
                            >×</button>
                        </div>
                        <p className="text-xs text-slate-400 mb-4">
                            NF-e nº <span className="font-mono text-slate-200">{doc.numero}/{doc.serie}</span>
                            {' · '}
                            <span className="font-mono text-slate-200">{doc.chave}</span>
                        </p>

                        <div className="overflow-y-auto flex-1 space-y-3">
                            {eventos
                                .slice()
                                .sort((a, b) => (a.dhEvento || '').localeCompare(b.dhEvento || ''))
                                .map((ev, idx) => (
                                <div key={idx} className="border border-slate-700 rounded-lg p-3 bg-slate-800/60">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className={`px-2 py-0.5 rounded border text-xs font-bold ${eventoBadgeColor(ev.tipo)}`}>
                                            {ev.descricao || ev.tipo}
                                        </span>
                                        <span className="text-xs text-slate-400">{formatBR(ev.dhEvento)}</span>
                                    </div>
                                    <div className="text-xs text-slate-300 space-y-1">
                                        {ev.nProt && <div>Protocolo: <span className="font-mono text-slate-200">{ev.nProt}</span></div>}
                                        {ev.cStat && <div>Status SEFAZ: <span className="font-mono">{ev.cStat}</span> {ev.xMotivo && <span className="text-slate-400">— {ev.xMotivo}</span>}</div>}
                                        {ev.xJust && (
                                            <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded">
                                                <div className="text-[10px] uppercase font-bold text-red-300 mb-1">Justificativa</div>
                                                <div className="text-red-200">{ev.xJust}</div>
                                            </div>
                                        )}
                                        {ev.xCorrecao && (
                                            <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded">
                                                <div className="text-[10px] uppercase font-bold text-amber-300 mb-1">Texto da Correção (CC-e)</div>
                                                <div className="text-amber-100 whitespace-pre-wrap">{ev.xCorrecao}</div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="flex justify-end pt-4 mt-2 border-t border-slate-800">
                            <button
                                onClick={() => setOpenModal(false)}
                                className="text-xs px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-white"
                            >Fechar</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default NFeStatusCell;
