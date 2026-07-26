/**
 * PainelPanel (Legalização) — farol de vencimentos por categoria + próximos
 * 30 dias. Farol HONESTO: sync com erro ou cron com falha de e-mail aparece
 * com o motivo dominante ao lado, nunca verde "de fachada".
 */
import React, { useCallback, useEffect, useState } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import type { User } from '../../types';
import {
    getResumoLegalizacao,
    dispararCronAgora,
    type ResumoLegalizacao,
} from '../../services/legalizacaoService';
import { CATEGORIA_LABEL, NIVEL_META, fmtCnpj, type CategoriaVencimento, type NivelVencimento } from '../../services/legalizacaoLogic';

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

const ORDEM_CATEGORIAS: CategoriaVencimento[] = ['certificado', 'certidao', 'parcelamento', 'procuracao', 'processo'];

const PainelPanel: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [resumo, setResumo] = useState<ResumoLegalizacao | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [carregando, setCarregando] = useState(true);
    const [sincronizando, setSincronizando] = useState(false);

    const carregar = useCallback(async () => {
        setCarregando(true);
        setErro(null);
        try {
            setResumo(await getResumoLegalizacao());
        } catch (e) {
            setErro(`Não foi possível carregar o resumo (${e instanceof Error ? e.message : e}). Recarregue a página; se persistir, avise o administrador.`);
        } finally {
            setCarregando(false);
        }
    }, []);

    useEffect(() => { void carregar(); }, [carregar]);

    const sincronizar = async () => {
        setSincronizando(true);
        try {
            const r = await dispararCronAgora();
            onShowToast?.(r.ok
                ? 'Sync Jotform + alertas disparados em background — recarregue o painel em ~1 minuto.'
                : `Falha ao disparar: ${r.motivo}`);
        } finally {
            setSincronizando(false);
        }
    };

    if (carregando) return <LoadingSpinner />;
    if (erro) {
        return (
            <div className="p-4 rounded-lg text-sm" style={{ background: 'var(--bg-card)', color: 'var(--danger)' }}>
                {erro}
            </div>
        );
    }
    if (!resumo) return null;

    const semItens = resumo.totalItens === 0;

    return (
        <div className="space-y-4">
            <div className="rounded-xl p-5 text-white" style={{ background: 'linear-gradient(135deg, #be185d, #9d174d)' }}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="text-lg font-bold m-0">🏛️ Departamento de Legalização</h2>
                        <p className="text-xs opacity-90 m-0 mt-1">
                            {resumo.totalItens} itens monitorados (formulários Jotform + processos com vencimento)
                        </p>
                    </div>
                    {currentUser.role === 'admin' && (
                        <button
                            onClick={() => void sincronizar()}
                            disabled={sincronizando}
                            className="px-3 py-1.5 text-xs font-bold rounded-md btn-press"
                            style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}
                        >
                            {sincronizando ? 'Disparando…' : '🔄 Sincronizar Jotform agora'}
                        </button>
                    )}
                </div>
            </div>

            {/* Farol honesto da integração */}
            {!resumo.jotformConfigured && (
                <div className="p-3 rounded-lg text-xs font-semibold" style={{ background: 'var(--warning-soft)', color: 'var(--text-primary)' }}>
                    ⚠️ Integração Jotform ainda não configurada (JOTFORM_API_KEY) — os dados abaixo podem estar vazios.
                    Peça ao administrador para cadastrar o secret (aba Integração Jotform).
                </div>
            )}
            {resumo.ultimaSync && !resumo.ultimaSync.ok && (
                <div className="p-3 rounded-lg text-xs font-semibold" style={{ background: 'var(--warning-soft)', color: 'var(--text-primary)' }}>
                    ⚠️ Última sincronização FALHOU: {resumo.ultimaSync.erros.join(' · ') || 'motivo não informado'}
                </div>
            )}
            {resumo.ultimoCron && resumo.ultimoCron.falhasEmail > 0 && (
                <div className="p-3 rounded-lg text-xs font-semibold" style={{ background: 'var(--warning-soft)', color: 'var(--text-primary)' }}>
                    ⚠️ Último cron: {resumo.ultimoCron.falhasEmail} alerta(s) de e-mail falharam
                    {resumo.ultimoCron.motivoDominante ? ` — ${resumo.ultimoCron.motivoDominante}` : ''}.
                </div>
            )}

            {/* Cards por categoria */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {ORDEM_CATEGORIAS.filter(cat => resumo.farol[cat]).map(cat => {
                    const f = resumo.farol[cat];
                    return (
                        <div key={cat} className="rounded-lg p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                            <div className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>{CATEGORIA_LABEL[cat]}</div>
                            <div className="text-2xl font-extrabold mt-1" style={{ color: 'var(--text-primary)' }}>{f.total}</div>
                            <div className="flex flex-wrap gap-1 mt-2 text-[10px] font-bold">
                                {f.vencido > 0 && <span className="px-2 py-0.5 rounded-full" style={{ background: 'var(--danger)', color: '#fff' }}>🔴 {f.vencido} vencidos</span>}
                                {f.critico > 0 && <span className="px-2 py-0.5 rounded-full" style={{ background: 'var(--warning-soft)', color: 'var(--text-primary)' }}>🟠 {f.critico} ≤7d</span>}
                                {f.atencao > 0 && <span className="px-2 py-0.5 rounded-full" style={{ background: 'var(--warning-soft)', color: 'var(--text-primary)' }}>🟡 {f.atencao} ≤30d</span>}
                                <span className="px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-soft)', color: 'var(--text-primary)' }}>🟢 {f.ok} em dia</span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Próximos vencimentos */}
            <div className="rounded-lg p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                <h3 className="text-sm font-bold m-0 mb-3" style={{ color: 'var(--text-primary)' }}>
                    ⏰ Próximos vencimentos (janela -7 a +30 dias)
                </h3>
                {semItens && (
                    <p className="text-xs m-0" style={{ color: 'var(--text-muted)' }}>
                        Nenhum item monitorado ainda. Rode a sincronização do Jotform (admin) ou cadastre processos com vencimento.
                    </p>
                )}
                {!semItens && resumo.proximos.length === 0 && (
                    <p className="text-xs m-0" style={{ color: 'var(--text-muted)' }}>Nada vencendo na janela — tudo em dia. 🎉</p>
                )}
                {resumo.proximos.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs" style={{ color: 'var(--text-primary)' }}>
                            <thead>
                                <tr className="text-left" style={{ color: 'var(--text-muted)' }}>
                                    <th className="py-1 pr-3">Farol</th>
                                    <th className="py-1 pr-3">Empresa</th>
                                    <th className="py-1 pr-3">Documento</th>
                                    <th className="py-1 pr-3">Vencimento</th>
                                    <th className="py-1">Prazo</th>
                                </tr>
                            </thead>
                            <tbody>
                                {resumo.proximos.map(p => {
                                    const meta = NIVEL_META[(p.nivel as NivelVencimento)] ?? NIVEL_META.sem_data;
                                    return (
                                        <tr key={p.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                                            <td className="py-1.5 pr-3">{meta.emoji}</td>
                                            <td className="py-1.5 pr-3 font-semibold">{p.empresaNome}<div className="font-normal" style={{ color: 'var(--text-muted)' }}>{fmtCnpj(p.cnpj)}</div></td>
                                            <td className="py-1.5 pr-3">{CATEGORIA_LABEL[(p.categoria as CategoriaVencimento)] ?? p.categoria}{p.tipoDetalhe ? ` — ${p.tipoDetalhe}` : ''}</td>
                                            <td className="py-1.5 pr-3">{p.dataVencimentoFmt}</td>
                                            <td className="py-1.5 font-bold" style={{ color: meta.cssVar }}>
                                                {p.diasRestantes < 0 ? `vencido há ${Math.abs(p.diasRestantes)}d` : p.diasRestantes === 0 ? 'HOJE' : `${p.diasRestantes}d`}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PainelPanel;
