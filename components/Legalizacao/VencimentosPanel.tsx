/**
 * VencimentosPanel (Legalização) — lista completa dos vencimentos monitorados
 * (Jotform: certidões/certificados/parcelamentos + processos com vencimento),
 * com filtros por categoria, farol e busca por empresa/CNPJ.
 * Leitura direta do Firestore (client SDK, rules read-only).
 */
import React, { useEffect, useMemo, useState } from 'react';
import LoadingSpinner from '../LoadingSpinner';
import type { User } from '../../types';
import {
    listarVencimentos,
    listarProcessos,
    type VencimentoLegalizacao,
} from '../../services/legalizacaoService';
import {
    CATEGORIA_LABEL, NIVEL_META, classificarVencimento, diasAteVencimento,
    fmtCnpj, fmtDataBr,
    type CategoriaVencimento, type NivelVencimento,
} from '../../services/legalizacaoLogic';

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

interface Linha extends VencimentoLegalizacao {
    diasRestantes: number | null;
    nivel: NivelVencimento;
}

const VencimentosPanel: React.FC<Props> = ({ onShowToast }) => {
    const [linhas, setLinhas] = useState<Linha[] | null>(null);
    const [categoria, setCategoria] = useState<'todas' | CategoriaVencimento>('todas');
    const [nivel, setNivel] = useState<'todos' | NivelVencimento>('todos');
    const [busca, setBusca] = useState('');

    useEffect(() => {
        let ativo = true;
        (async () => {
            try {
                const [vencs, procs] = await Promise.all([listarVencimentos(), listarProcessos()]);
                const doJotform: VencimentoLegalizacao[] = vencs;
                const deProcessos: VencimentoLegalizacao[] = procs
                    .filter(p => p.dataVencimento && !['concluido', 'cancelado'].includes(p.status))
                    .map(p => ({
                        id: p.id,
                        origem: 'processo' as const,
                        categoria: p.tipo === 'procuracao' ? 'procuracao'
                            : p.tipo === 'certificado_digital' ? 'certificado'
                            : p.tipo === 'certidao' ? 'certidao' : 'processo',
                        tipoDetalhe: p.titulo,
                        empresaNome: p.empresaNome,
                        cnpj: p.cnpj ?? null,
                        emailCliente: p.emailCliente ?? null,
                        dataVencimento: p.dataVencimento ?? null,
                        responsavel: p.responsavelNome ?? null,
                    }));
                const todas = [...doJotform, ...deProcessos].map(v => {
                    const dias = diasAteVencimento(v.dataVencimento);
                    return { ...v, diasRestantes: dias, nivel: classificarVencimento(dias) };
                });
                todas.sort((a, b) => (a.diasRestantes ?? 99999) - (b.diasRestantes ?? 99999));
                if (ativo) setLinhas(todas);
            } catch (e) {
                onShowToast?.(`Erro ao carregar vencimentos: ${e instanceof Error ? e.message : e}`);
                if (ativo) setLinhas([]);
            }
        })();
        return () => { ativo = false; };
    }, [onShowToast]);

    const filtradas = useMemo(() => {
        if (!linhas) return [];
        const q = busca.trim().toLowerCase();
        return linhas.filter(l =>
            (categoria === 'todas' || l.categoria === categoria)
            && (nivel === 'todos' || l.nivel === nivel)
            && (!q
                || l.empresaNome?.toLowerCase().includes(q)
                || String(l.cnpj || '').includes(q.replace(/\D/g, '') || '§')
                || String(l.tipoDetalhe || '').toLowerCase().includes(q))
        );
    }, [linhas, categoria, nivel, busca]);

    if (!linhas) return <LoadingSpinner />;

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap gap-2 items-center rounded-lg p-3" style={{ background: 'var(--bg-card)' }}>
                <input
                    value={busca}
                    onChange={e => setBusca(e.target.value)}
                    placeholder="Buscar empresa, CNPJ ou documento…"
                    className="px-3 py-1.5 text-xs rounded-md flex-1 min-w-[200px]"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                />
                <select
                    value={categoria}
                    onChange={e => setCategoria(e.target.value as typeof categoria)}
                    className="px-2 py-1.5 text-xs rounded-md"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                >
                    <option value="todas">Todas as categorias</option>
                    {(Object.keys(CATEGORIA_LABEL) as CategoriaVencimento[]).map(c => (
                        <option key={c} value={c}>{CATEGORIA_LABEL[c]}</option>
                    ))}
                </select>
                <select
                    value={nivel}
                    onChange={e => setNivel(e.target.value as typeof nivel)}
                    className="px-2 py-1.5 text-xs rounded-md"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                >
                    <option value="todos">Todos os faróis</option>
                    {(Object.keys(NIVEL_META) as NivelVencimento[]).map(n => (
                        <option key={n} value={n}>{NIVEL_META[n].emoji} {NIVEL_META[n].label}</option>
                    ))}
                </select>
                <span className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
                    {filtradas.length} de {linhas.length}
                </span>
            </div>

            <div className="rounded-lg overflow-x-auto" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)' }}>
                <table className="w-full text-xs" style={{ color: 'var(--text-primary)' }}>
                    <thead>
                        <tr className="text-left" style={{ color: 'var(--text-muted)' }}>
                            <th className="p-2">Farol</th>
                            <th className="p-2">Empresa</th>
                            <th className="p-2">Categoria / Documento</th>
                            <th className="p-2">Vencimento</th>
                            <th className="p-2">Prazo</th>
                            <th className="p-2">E-mail do cliente</th>
                            <th className="p-2">Origem</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtradas.length === 0 && (
                            <tr><td colSpan={7} className="p-4 text-center" style={{ color: 'var(--text-muted)' }}>
                                Nenhum item com esses filtros.
                            </td></tr>
                        )}
                        {filtradas.map(l => {
                            const meta = NIVEL_META[l.nivel];
                            return (
                                <tr key={`${l.origem}_${l.id}`} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                                    <td className="p-2">{meta.emoji}</td>
                                    <td className="p-2 font-semibold">
                                        {l.empresaNome}
                                        <div className="font-normal" style={{ color: 'var(--text-muted)' }}>{fmtCnpj(l.cnpj)}</div>
                                    </td>
                                    <td className="p-2">{CATEGORIA_LABEL[l.categoria] ?? l.categoria}{l.tipoDetalhe ? ` — ${l.tipoDetalhe}` : ''}</td>
                                    <td className="p-2">{fmtDataBr(l.dataVencimento)}</td>
                                    <td className="p-2 font-bold" style={{ color: meta.cssVar }}>
                                        {l.diasRestantes === null ? '—'
                                            : l.diasRestantes < 0 ? `vencido há ${Math.abs(l.diasRestantes)}d`
                                            : l.diasRestantes === 0 ? 'HOJE' : `${l.diasRestantes}d`}
                                    </td>
                                    <td className="p-2">{l.emailCliente || <span style={{ color: 'var(--warning)' }}>sem e-mail ⚠️</span>}</td>
                                    <td className="p-2" style={{ color: 'var(--text-muted)' }}>{l.origem === 'jotform' ? 'Jotform' : 'Processo'}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default VencimentosPanel;
