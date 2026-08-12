/**
 * EFD-Reinf × DCTFWeb — conferência de retenções.
 *
 * Fluxo: admin sobe os XMLs de eventos EFD-Reinf → o backend parseia/consolida
 * as retenções → busca a retenção REAL consolidada na DCTFWeb (CONSXMLDECLARACAO)
 * → cruza por família (INSS/IRRF/CSRF). Honesto: se a DCTFWeb não pôde ser lida,
 * mostra aviso em vez de divergência falsa.
 *
 * O motor é puro (services/efdReinfConference.ts) e calibrado contra arquivos
 * reais (R-2010 e XMLSaida DCTFWeb): o INSS retido bate à centavo.
 */
import React, { useState } from 'react';
import { conferirReinfDctfweb, conferirIrrfR4010, type ConferenciaReinfCompleta, type IrrfR4010Resposta } from '../../services/efdReinfConferenceService';

interface Props {
    onShowToast?: (msg: string) => void;
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const sevCor: Record<string, string> = {
    ok: 'var(--success)',
    baixa: 'var(--warning)',
    media: '#ea580c',
    alta: 'var(--danger)',
};
const statusLabel: Record<string, string> = {
    ok: 'OK',
    divergente: 'Divergente',
    'sem-dctfweb': 'Reinf declarou, DCTFWeb não tem',
    'sem-reinf': 'DCTFWeb tem, sem evento Reinf',
};

const ConferirReinfDctfweb: React.FC<Props> = ({ onShowToast }) => {
    const [arquivos, setArquivos] = useState<File[]>([]);
    const [cnpjOverride, setCnpjOverride] = useState('');
    const [loading, setLoading] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [data, setData] = useState<ConferenciaReinfCompleta | null>(null);
    // R-4010 (IRRF de pessoa física) — cruzamento próprio, com fonte própria.
    const [irrf, setIrrf] = useState<IrrfR4010Resposta | null>(null);
    const [conjuntoCompleto, setConjuntoCompleto] = useState(false);
    const [avisoIrrf, setAvisoIrrf] = useState<string | null>(null);

    const handleArquivos = (files: FileList | null) => {
        if (!files) return;
        const xmls = Array.from(files).filter(f => /\.xml$/i.test(f.name));
        setArquivos(prev => {
            const nomes = new Set(prev.map(p => p.name + p.size));
            return [...prev, ...xmls.filter(f => !nomes.has(f.name + f.size))];
        });
        setData(null);
        setErro(null);
    };

    const removerArquivo = (i: number) => {
        setArquivos(prev => prev.filter((_, idx) => idx !== i));
        setData(null);
    };

    const handleConferir = async () => {
        if (!arquivos.length) { setErro('Selecione ao menos 1 XML de evento EFD-Reinf.'); return; }
        setLoading(true); setErro(null); setData(null);
        try {
            const xmls = await Promise.all(arquivos.map(f => f.text()));
            const r = await conferirReinfDctfweb(xmls, cnpjOverride || undefined);
            setData(r);

            // ── R-4010 × IRRF de PF da DCTFWeb ──────────────────────────────
            // Só roda quando há evento R-4010 no lote: cruzar sem fonte do lado
            // da Reinf produziria "a DCTFWeb tem e a Reinf não", que é falso.
            setIrrf(null); setAvisoIrrf(null);
            const temR4010 = r.eventos?.some((e: any) => e.codigo === 'R-4010');
            const cnpj14 = (cnpjOverride || '').replace(/\D/g, '');
            const comp = r.consolidacaoReinf?.competencia || '';
            if (temR4010) {
                if (cnpj14.length !== 14) {
                    setAvisoIrrf('Há eventos R-4010 no lote, mas o cruzamento do IRRF de pessoa física precisa do '
                        + 'CNPJ completo do estabelecimento (14 dígitos) — o evento traz só a raiz. Informe no campo acima.');
                } else if (!/^\d{4}-\d{2}$/.test(comp)) {
                    setAvisoIrrf('Não deu pra determinar a competência dos eventos — sem ela não dá pra consultar a DCTFWeb.');
                } else {
                    try {
                        setIrrf(await conferirIrrfR4010({
                            xmls, empresaCnpj: cnpj14,
                            anoPA: Number(comp.slice(0, 4)), mesPA: Number(comp.slice(5, 7)),
                            conjuntoCompleto,
                        }));
                    } catch (e: any) {
                        setAvisoIrrf(`IRRF de PF: ${e?.message || 'falha ao cruzar'}`);
                    }
                }
            }
            if (onShowToast) {
                onShowToast(r.dctfwebLido
                    ? (r.resultado?.temDivergencia ? 'Conferência concluída — há divergências' : 'Conferência concluída — sem divergências')
                    : 'Eventos lidos — DCTFWeb não pôde ser lida');
            }
        } catch (e: any) {
            setErro(e?.message || 'Falha na conferência');
        } finally {
            setLoading(false);
        }
    };

    const card: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div className="p-6 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--accent-soft), var(--bg-elevated))', border: '1px solid var(--border-default)' }}>
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>EFD-Reinf × DCTFWeb</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Confere as retenções declaradas na EFD-Reinf contra o débito consolidado na DCTFWeb.
                    A Reinf alimenta a DCTFWeb — evento não transmitido vira recolhimento a menor.
                </p>
                <span className="inline-block mt-3 text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                    INSS (R-2010/2020) · IRRF PJ (R-4020) · CSRF (R-4020) · IRRF PF (R-4010)
                </span>
            </div>

            {/* 1. Upload */}
            <div className="p-5 rounded-xl" style={card}>
                <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-secondary)' }}>
                    1. Eventos EFD-Reinf (XML)
                </h3>
                <label
                    className="flex flex-col items-center justify-center gap-2 p-6 rounded-lg cursor-pointer border-2 border-dashed transition-colors"
                    style={{ borderColor: 'var(--border-default)', background: 'var(--bg-card)' }}
                >
                    <span className="text-3xl">📄</span>
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        Clique para selecionar (ou arraste) os XMLs
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        R-2010, R-4020, R-4099… da mesma empresa e competência
                    </span>
                    <input type="file" accept=".xml" multiple className="hidden" onChange={e => handleArquivos(e.target.files)} />
                </label>

                {arquivos.length > 0 && (
                    <ul className="mt-3 space-y-1">
                        {arquivos.map((f, i) => (
                            <li key={f.name + i} className="flex items-center justify-between text-xs px-3 py-2 rounded" style={{ background: 'var(--bg-card)' }}>
                                <span className="font-mono truncate" style={{ color: 'var(--text-secondary)' }}>{f.name}</span>
                                <button onClick={() => removerArquivo(i)} className="ml-2 text-slate-400 hover:text-red-500" title="Remover">×</button>
                            </li>
                        ))}
                    </ul>
                )}

                <div className="mt-4">
                    <label className="text-xs uppercase font-medium block mb-2" style={{ color: 'var(--text-muted)' }}>
                        CNPJ (opcional — por padrão usa o contribuinte do evento)
                    </label>
                    <input
                        type="text" value={cnpjOverride} onChange={e => setCnpjOverride(e.target.value)}
                        placeholder="só se quiser forçar outro CNPJ"
                        className="w-full p-2.5 text-sm rounded-lg outline-none"
                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
                    />
                </div>

                {/* COMPLETUDE É AFIRMAÇÃO DE QUEM CLICA, não dedução do app:
                    "não achei divergência no que subi" ≠ "a competência está
                    completa". Sem esta marcação o IRRF de PF nunca fica verde. */}
                <label className="flex items-start gap-2 mt-4 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                    <input
                        type="checkbox" checked={conjuntoCompleto}
                        onChange={e => setConjuntoCompleto(e.target.checked)}
                        className="mt-0.5"
                    />
                    <span>
                        Subi <strong>TODOS</strong> os eventos R-4010 desta competência.
                        Sem isso o cruzamento do IRRF de pessoa física não dá verde — ele só enxerga o que foi subido.
                    </span>
                </label>
            </div>

            <div className="flex justify-center">
                <button
                    onClick={handleConferir}
                    disabled={loading || !arquivos.length}
                    className="btn-press px-8 py-4 text-white font-bold text-base rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'var(--accent)', minWidth: '280px' }}
                >
                    {loading
                        ? <span className="flex items-center justify-center gap-3"><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />Conferindo…</span>
                        : 'Conferir Reinf × DCTFWeb'}
                </button>
            </div>

            {erro && (
                <div className="p-3 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--danger)' }}>
                    {erro}
                </div>
            )}

            {avisoIrrf && (
                <div className="p-3 rounded-xl text-sm" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: 'var(--warning)' }}>
                    {avisoIrrf}
                </div>
            )}

            {irrf && <ResultadoIrrfPf r={irrf} />}

            {data && <Resultado data={data} />}
        </div>
    );
};

/**
 * R-4010 × IRRF de PESSOA FÍSICA da DCTFWeb.
 *
 * Fica ANTES da conferência por família de propósito: é a conta que não existia
 * (o e-CAC mostrava beneficiário a beneficiário e o CFI não cruzava nada), e é a
 * que tem risco de recolhimento a menor.
 */
function ResultadoIrrfPf({ r }: { r: IrrfR4010Resposta }) {
    const card: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };
    const cor = r.cruzamento.severidade === 'ok' ? 'var(--success)'
        : r.cruzamento.severidade === 'alta' ? 'var(--danger)' : 'var(--warning)';

    return (
        <div className="p-5 rounded-xl space-y-4" style={{ ...card, borderLeft: `4px solid ${cor}` }}>
            <div>
                <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    IRRF de pessoa física — R-4010 × DCTFWeb · competência {r.competencia}
                </h3>
                <p className="text-sm mt-2" style={{ color: cor }}><strong>{r.cruzamento.mensagem}</strong></p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{r.cruzamento.acao}</p>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
                {([
                    ['Reinf (R-4010)', brl(r.cruzamento.totalReinf)],
                    ['DCTFWeb (IRRF de PF)', r.cruzamento.totalDctfweb == null ? 'não lida' : brl(r.cruzamento.totalDctfweb)],
                    ['Diferença', r.cruzamento.diferenca == null ? '—' : brl(r.cruzamento.diferenca)],
                ] as const).map(([rot, val]) => (
                    <div key={rot} className="p-3 rounded-lg" style={{ background: 'var(--bg-card)' }}>
                        <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{rot}</div>
                        <div className="font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{val}</div>
                    </div>
                ))}
            </div>

            {!!r.reinf.beneficiarios.length && (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead><tr style={{ color: 'var(--text-muted)' }} className="text-left">
                            <th className="py-1">Beneficiário (CPF)</th><th>Nome</th>
                            <th className="text-right">Rendimento</th><th className="text-right">IRRF</th>
                        </tr></thead>
                        <tbody>
                            {r.reinf.beneficiarios.map(b => (
                                <tr key={b.beneficiario} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                                    <td className="py-1 font-mono" style={{ color: 'var(--text-primary)' }}>
                                        {b.beneficiario}{b.retificado && <span title="valeu o evento retificador"> ↻</span>}
                                    </td>
                                    <td style={{ color: 'var(--text-secondary)' }}>{b.nome || '—'}</td>
                                    <td className="text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{brl(b.bruto)}</td>
                                    <td className="text-right font-mono" style={{ color: 'var(--text-primary)' }}>{brl(b.irrf)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {!!r.dctfweb.pf.length && (
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <strong>Linhas da DCTFWeb contadas como IRRF de PF:</strong>{' '}
                    {r.dctfweb.pf.map(d => `${d.codigo}-${d.extensao} ${brl(d.valor)}`).join(' · ')}
                </div>
            )}

            {/* Linha que o app não soube classificar NÃO some: ela fica fora da
                conta e nomeada, senão a diferença mente. */}
            {!!r.dctfweb.naoClassificado.length && (
                <div className="p-3 rounded-lg text-xs" style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--warning)' }}>
                    <strong>Fora da conta — origem não classificada:</strong>
                    <ul className="mt-1 ml-4 list-disc">
                        {r.dctfweb.naoClassificado.map((d, i) => (
                            <li key={i}>{d.codigo} · {d.descricao} · {brl(d.valor)} — {d.motivo}</li>
                        ))}
                    </ul>
                </div>
            )}

            {!!r.cruzamento.ressalvas.length && (
                <ul className="text-[11px] ml-4 list-disc" style={{ color: 'var(--text-muted)' }}>
                    {r.cruzamento.ressalvas.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
            )}
        </div>
    );
}

function Resultado({ data }: { data: ConferenciaReinfCompleta }) {
    const cons = data.consolidacaoReinf;
    const card: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };

    return (
        <>
            {/* Eventos lidos */}
            <div className="p-5 rounded-xl" style={card}>
                <h3 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>
                    Eventos lidos ({cons.qtdEventos}) · competência {cons.competencia || '—'} · contribuinte {cons.contribuinte || '—'}
                </h3>
                <div className="space-y-1">
                    {data.eventos.map((ev, i) => (
                        <div key={i} className="flex items-center justify-between text-xs px-3 py-2 rounded" style={{ background: 'var(--bg-card)' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>
                                <b>{ev.codigo || ev.schemaToken || 'evento'}</b>
                                {ev.tipoRetorno === 'retencao' && ev.totais?.inssRetPrinc > 0 && <> · INSS {brl(ev.totais.inssRetPrinc)}</>}
                                {ev.tipoRetorno === 'fechamento' && ev.fechamento && <> · fechRet={ev.fechamento.fechRet}</>}
                            </span>
                            <span>
                                {ev.validacao?.valido === false
                                    ? <span style={{ color: 'var(--danger)' }}>⚠ {ev.validacao.erros[0]}</span>
                                    : ev.validacao?.avisos?.length
                                        ? <span style={{ color: 'var(--warning)' }}>aviso: {ev.validacao.avisos[0]}</span>
                                        : <span style={{ color: 'var(--success)' }}>✓</span>}
                            </span>
                        </div>
                    ))}
                </div>
                {cons.alertas.length > 0 && (
                    <div className="mt-3 p-3 rounded-lg text-xs" style={{ background: 'var(--warning-soft)', border: '1px solid var(--warning-soft-border)', color: 'var(--text-secondary)' }}>
                        {cons.alertas.map((a, i) => <p key={i}>⚠ {a}</p>)}
                    </div>
                )}
            </div>

            {/* DCTFWeb não lida — honesto */}
            {!data.dctfwebLido && (
                <div className="p-4 rounded-xl text-sm" style={{ background: 'var(--warning-soft)', border: '1px solid var(--warning-soft-border)', borderLeft: '4px solid var(--warning)' }}>
                    <p className="font-bold" style={{ color: 'var(--warning)' }}>DCTFWeb não pôde ser lida para esta competência.</p>
                    <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{data.motivoDctfweb}</p>
                    <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                        As retenções da Reinf estão abaixo; a comparação aparece quando a DCTFWeb retornar a declaração.
                    </p>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                        {(['INSS', 'IRRF', 'CSRF'] as const).map(f => (
                            <div key={f} className="p-2 rounded" style={{ background: 'var(--bg-card)' }}>
                                <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{f} (Reinf)</p>
                                <p className="text-sm font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{brl(data.retencoesReinf[f])}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Cruzamento */}
            {data.dctfwebLido && data.resultado && (
                <div className="p-5 rounded-xl" style={card}>
                    <div className="flex gap-2 mb-3 text-xs flex-wrap">
                        <span className="px-2 py-1 rounded" style={{ background: 'var(--bg-card)' }}>Reinf: <b>{brl(data.resultado.totalReinf)}</b></span>
                        <span className="px-2 py-1 rounded" style={{ background: 'var(--bg-card)' }}>DCTFWeb: <b>{brl(data.resultado.totalDctfweb)}</b></span>
                        {!data.resultado.temDivergencia
                            ? <span className="px-2 py-1 rounded" style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--success)' }}>✓ Sem divergências</span>
                            : <span className="px-2 py-1 rounded" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)' }}>
                                {data.resultado.resumo.alta} alta · {data.resultado.resumo.media} média · {data.resultado.resumo.baixa} baixa
                              </span>}
                    </div>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-default)' }}>
                                <th className="py-2">Família</th>
                                <th className="py-2 text-right">Reinf</th>
                                <th className="py-2 text-right">DCTFWeb</th>
                                <th className="py-2 text-right">Diferença</th>
                                <th className="py-2 text-center">Situação</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.resultado.divergencias.map(d => (
                                <tr key={d.familia} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                    <td className="py-2 font-medium" style={{ color: 'var(--text-primary)' }}>{d.familia}</td>
                                    <td className="py-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{brl(d.valorReinf)}</td>
                                    <td className="py-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{brl(d.valorDctfweb)}</td>
                                    <td className="py-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>
                                        {d.diferenca === 0 ? '—' : brl(d.diferenca)}
                                        {d.diferencaPct !== 0 && <span className="text-[10px] ml-1" style={{ color: 'var(--text-muted)' }}>({d.diferencaPct}%)</span>}
                                    </td>
                                    <td className="py-2 text-center">
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ color: '#fff', background: sevCor[d.severidade] }}>
                                            {statusLabel[d.status] || d.status}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {data.camposUsadosDctfweb.length > 0 && (
                        <div className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                            <b>Débitos de retenção lidos na DCTFWeb</b> (transparência):
                            <ul className="mt-1 space-y-0.5">
                                {data.camposUsadosDctfweb.map((c, i) => (
                                    <li key={i} className="font-mono">{c.codReceita} · {c.familia} · {brl(c.valor)}{c.ctCnpj ? ` · prestador ${c.ctCnpj}` : ''}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <p className="mt-4 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        INSS = retenção previdenciária (R-2010/2020 ↔ DCTFWeb cod 1162). IRRF/CSRF da Reinf
                        populam quando os eventos R-4020 forem incluídos. Tolerância de R$ 0,02.
                    </p>
                </div>
            )}
        </>
    );
}

export default ConferirReinfDctfweb;
