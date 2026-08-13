/**
 * components/DCTFWeb/TrimestraisDoMesPanel.tsx
 *
 * Painel "Trimestrais do mês": lista as empresas da carteira com declaração
 * DCTFWeb transmitida (ATIVA) da competência que fecha o trimestre cujo
 * IRPJ/CSLL vence NESTE mês (abr/jul/out/jan). Read-only por padrão — os
 * débitos trimestrais de cada empresa são carregados sob demanda (1 chamada
 * SERPRO), e a emissão das guias é sempre por ação explícita do usuário.
 */
import React, { useEffect, useState } from 'react';
import type {
    User, DctfwebTrimestraisMesResult, DctfwebTrimestralCandidata,
    DctfwebDebitosTrimestraisResult, DctfwebDarfsSeparadosResult,
} from '../../types';
import {
    listarTrimestraisMes, listarDebitosTrimestrais, gerarDarfsSeparados,
    downloadPdfFromBase64, openPdfFromBase64,
} from '../../services/dctfwebService';

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

const TRIM_LABEL = ['', '1º', '2º', '3º', '4º'];
// Códigos de IRPJ/CSLL trimestrais (Presumido e Real).
const TRIMESTRAIS = ['2089', '0220', '2372', '6012'];

function fmtBr(iso?: string | null): string {
    return iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : (iso || '—');
}
function fmtCnpj(c: string): string {
    const d = String(c).replace(/\D/g, '').padStart(14, '0');
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

const LinhaEmpresa: React.FC<{
    user: User;
    cand: DctfwebTrimestralCandidata;
    onShowToast?: (m: string) => void;
}> = ({ user, cand, onShowToast }) => {
    const [debitos, setDebitos] = useState<DctfwebDebitosTrimestraisResult | null>(null);
    const [emitido, setEmitido] = useState<DctfwebDarfsSeparadosResult | null>(null);
    const [quotas, setQuotas] = useState<1 | 2 | 3>(1);
    const [loading, setLoading] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    const carregar = async () => {
        setLoading(true); setErro(null);
        try {
            setDebitos(await listarDebitosTrimestrais(user, {
                empresaCnpj: cand.empresaCnpj, anoPA: cand.anoPA, mesPA: cand.mesPA,
                categoria: cand.categoria as any,
            }));
        } catch (e: any) { setErro(e.message); }
        finally { setLoading(false); }
    };

    const emitir = async () => {
        if (!confirm(`Emitir as guias trimestrais de ${fmtCnpj(cand.empresaCnpj)}?\n\nAção real no SERPRO (1 DARF por tributo${quotas > 1 ? `, em ${quotas} quotas` : ''}).`)) return;
        setLoading(true); setErro(null);
        try {
            const r = await gerarDarfsSeparados(user, {
                empresaCnpj: cand.empresaCnpj, anoPA: cand.anoPA, mesPA: cand.mesPA,
                categoria: cand.categoria as any, quotasTrimestrais: quotas,
                // Emite SÓ IRPJ/CSLL trimestrais — sem cobrar PIS/COFINS aqui.
                apenasCodigos: TRIMESTRAIS,
            });
            setEmitido(r);
            onShowToast?.(`${r.guias.length} guia(s) emitida(s) para ${fmtCnpj(cand.empresaCnpj)}.`);
        } catch (e: any) { setErro(e.message); }
        finally { setLoading(false); }
    };

    // O backend já emitiu SÓ trimestrais (apenasCodigos), então mostramos todas
    // as guias retornadas — nenhuma cobrança fica escondida.
    const guiasTrim = emitido?.guias || [];

    return (
        <div className="border dark:border-slate-700 rounded-lg p-3" style={{ borderColor: 'var(--border)' }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <p className="font-mono text-sm">{fmtCnpj(cand.empresaCnpj)}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        Declaração {String(cand.mesPA).padStart(2, '0')}/{cand.anoPA} · transmitida
                    </p>
                </div>
                {!debitos && !emitido && (
                    <button onClick={carregar} disabled={loading}
                        className="text-xs px-3 py-1.5 bg-sky-600 text-white rounded hover:bg-sky-700 disabled:opacity-50">
                        {loading ? 'Carregando…' : 'Carregar débitos trimestrais'}
                    </button>
                )}
            </div>

            {erro && <p className="mt-2 text-xs text-rose-700 bg-rose-50 border dark:border-slate-700 border-rose-200 rounded p-2">{erro}</p>}

            {debitos && !emitido && (
                debitos.lido && debitos.trimestrais.length > 0 ? (
                    <div className="mt-3 space-y-2">
                        <div className="text-sm space-y-1">
                            {debitos.trimestrais.map((d, i) => (
                                <div key={i} className="flex justify-between">
                                    <span><span className="font-mono text-xs text-slate-500 dark:text-slate-400 mr-2">{d.codigo}-{d.extensao}</span>{d.descricao}</span>
                                    <span className="font-semibold">R$ {d.valor.toFixed(2)}</span>
                                </div>
                            ))}
                            <div className="flex justify-between border-t pt-1 font-semibold">
                                <span>Total trimestral · vence {fmtBr(debitos.vencimento)}</span>
                                <span>R$ {debitos.totalTrimestral.toFixed(2)}</span>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <label className="text-xs flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                                Quotas:
                                <select value={quotas} onChange={e => setQuotas(Number(e.target.value) as 1 | 2 | 3)}
                                    className="border dark:border-slate-700 rounded px-2 py-1 text-xs">
                                    <option value={1}>Única</option>
                                    <option value={2}>2</option>
                                    <option value={3}>3</option>
                                </select>
                            </label>
                            <button onClick={emitir} disabled={loading}
                                className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">
                                {loading ? 'Emitindo…' : 'Emitir guias'}
                            </button>
                            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                Quotas só ≥ R$ 2.000 (mín. R$ 1.000/quota)
                            </span>
                        </div>
                    </div>
                ) : (
                    <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {debitos.lido ? 'Sem débitos trimestrais (IRPJ/CSLL) nesta declaração.' : `Não foi possível ler: ${debitos.motivo || ''}`}
                    </p>
                )
            )}

            {emitido && (
                <div className="mt-3 space-y-2">
                    {guiasTrim.length === 0 && <p className="text-xs text-amber-700 dark:text-amber-300">Nenhuma guia trimestral emitida.</p>}
                    {guiasTrim.map((g, i) => (
                        <div key={i} className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 dark:bg-slate-900/50 rounded p-2 text-sm">
                            <span>
                                <span className="font-mono text-xs text-slate-500 dark:text-slate-400 mr-2">{g.codigo}-{g.extensao}</span>
                                {g.descricao}
                                {g.cota != null && <span className="ml-2 text-xs px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 rounded">cota {g.cota}/{g.totalCotas}</span>}
                                <span className="ml-2 font-semibold">R$ {g.valor.toFixed(2)}</span>
                                <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">vence {fmtBr(g.vencimento)}</span>
                            </span>
                            {g.pdfBase64 ? (
                                <span className="flex gap-2">
                                    <button onClick={() => openPdfFromBase64(g.pdfBase64)} className="text-xs px-2 py-1 bg-slate-700 text-white rounded hover:bg-slate-800">Abrir PDF</button>
                                    <button onClick={() => downloadPdfFromBase64(g.pdfBase64, `darf_${g.codigo}${g.extensao}${g.cota != null ? `_q${g.cota}` : ''}_${cand.empresaCnpj}_${cand.anoPA}${String(cand.mesPA).padStart(2, '0')}.pdf`)} className="text-xs px-2 py-1 bg-sky-600 text-white rounded hover:bg-sky-700">Baixar</button>
                                </span>
                            ) : (
                                <span className="text-xs text-rose-700">Sem PDF{(g.mensagens || []).filter(m => m?.texto).map(m => ` — ${m.texto}`).join('')}</span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const TrimestraisDoMesPanel: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [data, setData] = useState<DctfwebTrimestraisMesResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            setLoading(true); setErro(null);
            try { setData(await listarTrimestraisMes(currentUser)); }
            catch (e: any) { setErro(e.message); }
            finally { setLoading(false); }
        })();
    }, [currentUser]);

    if (loading) return <p className="text-sm p-4" style={{ color: 'var(--text-muted)' }}>Carregando…</p>;
    if (erro) return <p className="text-sm p-4 text-rose-700">{erro}</p>;
    if (!data) return null;

    if (!data.aplicavel) {
        return (
            <div className="p-4 rounded-lg" style={{ background: 'var(--bg-card)' }}>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {data.motivo || 'Nenhum trimestre de IRPJ/CSLL vence neste mês.'} Os trimestrais vencem em abril, julho, outubro e janeiro.
                </p>
            </div>
        );
    }

    const candidatas = data.candidatas || [];
    return (
        <div className="space-y-4">
            <div className="p-4 rounded-lg" style={{ background: 'var(--bg-card)' }}>
                <h3 className="text-base font-bold">📅 Trimestrais vencendo este mês</h3>
                <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                    IRPJ/CSLL do <strong>{TRIM_LABEL[data.trimestre || 0]} trimestre/{data.competenciaAno}</strong> —
                    vencimento <strong>{fmtBr(data.vencimento)}</strong>. Débitos aparecem na declaração de{' '}
                    {String(data.competenciaMes).padStart(2, '0')}/{data.competenciaAno}.
                    Carregue os débitos de cada empresa e emita as guias (nada é emitido sozinho).
                </p>
            </div>

            {candidatas.length === 0 ? (
                <p className="text-sm p-4" style={{ color: 'var(--text-muted)' }}>
                    Nenhuma declaração transmitida da competência {String(data.competenciaMes).padStart(2, '0')}/{data.competenciaAno} na sua carteira.
                    Transmita a DCTFWeb dessas empresas primeiro.
                </p>
            ) : (
                <div className="space-y-2">
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{candidatas.length} empresa(s) com declaração transmitida:</p>
                    {candidatas.map((c) => (
                        <LinhaEmpresa key={`${c.empresaCnpj}_${c.anoPA}${c.mesPA}`} user={currentUser} cand={c} onShowToast={onShowToast} />
                    ))}
                </div>
            )}
        </div>
    );
};

export default TrimestraisDoMesPanel;
