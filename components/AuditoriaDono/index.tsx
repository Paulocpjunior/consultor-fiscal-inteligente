// ============================================================================
// 🔐 AUDITORIA DO DONO (Paulo, 16/08: "só eu devo ter acesso")
// ----------------------------------------------------------------------------
// Linha do tempo das ações que mexem com DINHEIRO, com obrigação declarada
// ou com PODER dentro do app: quem fez, quando, em qual cliente.
//
// O painel NÃO tem conta própria — lê as trilhas que as telas já gravam. E
// as RESSALVAS são parte do produto: trilha não lida aparece em vermelho, e
// trilha nova diz desde quando existe (senão o vazio vira "ninguém mexeu").
// ============================================================================
import React, { useEffect, useState } from 'react';
import { carregarAuditoria, RelatorioAuditoria, EventoAuditoria } from '../../services/auditoriaDonoService';
import { gerarRelatorioPdf } from '../../services/relatorioPdf';

const TOM_PESO: Record<string, string> = {
    critico: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
    alto: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
    medio: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
};

const FUSO = 'America/Sao_Paulo';
const dataHora = (iso: string | null) =>
    (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: FUSO }) : 'sem data gravada');

const AuditoriaDono: React.FC = () => {
    const [dados, setDados] = useState<RelatorioAuditoria | null>(null);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [de, setDe] = useState('');
    const [ate, setAte] = useState('');
    const [quem, setQuem] = useState('');

    const buscar = async () => {
        setCarregando(true);
        setErro(null);
        try {
            const r = await carregarAuditoria({
                // O filtro é por DIA no fuso de SP; o backend compara ISO.
                de: de ? `${de}T00:00:00-03:00` : undefined,
                ate: ate ? `${ate}T23:59:59-03:00` : undefined,
                quem: quem.trim() || undefined,
            });
            if (!r.ok) { setErro(r.error || 'Falha ao carregar a auditoria.'); return; }
            setDados(r);
        } finally { setCarregando(false); }
    };

    useEffect(() => { buscar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    const exportarPdf = async () => {
        if (!dados) return;
        await gerarRelatorioPdf({
            titulo: 'Auditoria — ações sensíveis',
            subtitulo: `${dados.periodo.de ? `de ${dados.periodo.de.slice(0, 10).split('-').reverse().join('/')}` : 'desde o início'}`
                + `${dados.periodo.ate ? ` até ${dados.periodo.ate.slice(0, 10).split('-').reverse().join('/')}` : ''}`
                + `${dados.periodo.quem ? ` · ${dados.periodo.quem}` : ''} · ${dados.total} evento(s)`,
            colunas: [
                { titulo: 'Quando', largura: 34 }, { titulo: 'Quem', largura: 50 },
                { titulo: 'Ação', largura: 48 }, { titulo: 'Cliente', largura: 50 },
                { titulo: 'Detalhe', largura: 95 },
            ],
            linhas: dados.eventos.map((e) => [
                dataHora(e.em), e.quem || '(não registrado)', e.rotulo, e.empresa || '—', e.descricao,
            ]),
            observacoes: [
                ...(dados.eventosMostrados < dados.total
                    ? [`Mostrando ${dados.eventosMostrados} de ${dados.total} eventos — o recorte é do relatório, não do período.`] : []),
                ...dados.ressalvas,
                `Gerado em ${new Date(dados.geradoEm).toLocaleString('pt-BR', { timeZone: FUSO })} por ${dados.geradoPor || '—'}.`,
            ],
            fileName: `auditoria-${new Date().toISOString().slice(0, 10)}.pdf`,
        });
    };

    return (
        <div className="max-w-[1400px] mx-auto animate-fade-in space-y-3">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">🔐 Auditoria — ações sensíveis</h2>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Quem fez o quê: guias enviadas, declarações transmitidas e permissões alteradas.
                            Painel restrito ao dono do escritório.
                        </p>
                    </div>
                    <div className="flex items-end gap-2 flex-wrap">
                        <label className="text-[10px] text-slate-400">De
                            <input type="date" value={de} onChange={(e) => setDe(e.target.value)}
                                className="block px-2 py-1 text-[12px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100" />
                        </label>
                        <label className="text-[10px] text-slate-400">Até
                            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)}
                                className="block px-2 py-1 text-[12px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100" />
                        </label>
                        <label className="text-[10px] text-slate-400">Quem (e-mail)
                            <input value={quem} onChange={(e) => setQuem(e.target.value)} placeholder="todos"
                                className="block px-2 py-1 text-[12px] rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100" />
                        </label>
                        <button onClick={buscar} disabled={carregando}
                            className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-[#0e3bfa] hover:bg-[#091d8d] text-white disabled:opacity-40">
                            {carregando ? '…' : '🔎 Filtrar'}
                        </button>
                        <button onClick={exportarPdf} disabled={!dados || !dados.total}
                            className="text-[12px] px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40">
                            📄 PDF
                        </button>
                    </div>
                </div>
            </div>

            {erro && (
                <div className="rounded-xl border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-3 text-[12px] text-red-700 dark:text-red-300">{erro}</div>
            )}

            {dados && (
                <>
                    {/* Ressalvas ANTES dos números: elas qualificam o total. */}
                    {(dados.naoLidas.length > 0 || dados.ressalvas.length > 0) && (
                        <div className={`rounded-xl border p-3 space-y-1 ${dados.naoLidas.length
                            ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20'
                            : 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20'}`}>
                            {dados.ressalvas.map((r, i) => (
                                <p key={i} className={`text-[11px] ${dados.naoLidas.length && i === 0
                                    ? 'text-red-700 dark:text-red-300 font-semibold' : 'text-amber-800 dark:text-amber-300'}`}>{r}</p>
                            ))}
                        </div>
                    )}

                    <div className="grid gap-3 md:grid-cols-[240px_minmax(0,1fr)]">
                        <div className="space-y-3">
                            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Total no período</p>
                                <p className="text-3xl font-black text-slate-800 dark:text-slate-100">{dados.total}</p>
                                {dados.semAutor > 0 && <p className="text-[10px] text-amber-700 dark:text-amber-400">{dados.semAutor} sem autor gravado</p>}
                            </div>
                            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Por pessoa</p>
                                {dados.porPessoa.length === 0 && <p className="text-[11px] text-slate-400">nenhum evento</p>}
                                {dados.porPessoa.map((p) => (
                                    <button key={p.quem} onClick={() => { setQuem(p.quem === '(não registrado)' ? '' : p.quem); }}
                                        className="w-full flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300 hover:text-[#0e3bfa] py-0.5">
                                        <span className="truncate">{p.quem.split('@')[0]}</span>
                                        <span className="font-bold shrink-0">{p.quantidade}</span>
                                    </button>
                                ))}
                            </div>
                            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Por tipo de ação</p>
                                {dados.porTrilha.map((t) => (
                                    <div key={t.trilha} className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300 py-0.5">
                                        <span className="truncate">{t.rotulo}</span>
                                        <span className="font-bold shrink-0">{t.quantidade}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
                            <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                                <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Linha do tempo</p>
                                {dados.eventosMostrados < dados.total && (
                                    <p className="text-[10px] text-slate-400">mostrando {dados.eventosMostrados} de {dados.total} — o PDF sai com o mesmo recorte</p>
                                )}
                            </div>
                            <div className="max-h-[60vh] overflow-y-auto">
                                {dados.eventos.length === 0 ? (
                                    <p className="p-4 text-[11px] text-slate-500 dark:text-slate-400">
                                        Nenhum evento no período. Isso NÃO prova que nada aconteceu — veja as ressalvas acima
                                        (trilha que só passou a ser gravada depois, ou que não pôde ser lida).
                                    </p>
                                ) : dados.eventos.map((e: EventoAuditoria) => (
                                    <div key={e.id} className="px-3 py-2 border-b border-slate-100 dark:border-slate-700/50 flex gap-2.5">
                                        <span className={`text-[9px] font-bold px-1.5 py-px rounded-full h-fit shrink-0 ${TOM_PESO[e.peso] || TOM_PESO.medio}`}>
                                            {e.rotulo}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[12px] text-slate-800 dark:text-slate-100 break-words">{e.descricao || '—'}</p>
                                            <p className="text-[10px] text-slate-400">
                                                {e.quem || '(autor não registrado)'} · {dataHora(e.em)}
                                                {e.empresa ? ` · ${e.empresa}` : ''}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default AuditoriaDono;
