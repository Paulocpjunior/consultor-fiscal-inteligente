/**
 * components/NfpProCloud/DashboardTab.tsx
 *
 * Aba Dashboard do "Consulta Situacao Fiscal" -- mostra KPIs em cards
 * (debitos abertos, certidoes negativas, obrigacoes pendentes, acoes em
 * andamento, plano de acao alta, parcelamentos ativos) + botao de export
 * pra PDF de relatorio fiscal Big4.
 *
 * Mostra banner amarelo quando SERPRO ta em modo DRY_RUN (mock).
 */
import React from 'react';
import type { NfpAnaliseEmpresa } from '../../types';
import { DashCard, formatCurrency, btnStyleSave } from './_common';

interface Props {
    analise: NfpAnaliseEmpresa | null;
    exportingPdf: boolean;
    onExportPdf: () => void;
}

const DashboardTab: React.FC<Props> = ({ analise, exportingPdf, onExportPdf }) => {
    if (!analise) {
        return <p style={{ color: 'var(--text-muted)' }}>Selecione uma empresa e inicie uma análise na aba "Análise".</p>;
    }

    const debitosAbertos = analise.debitos.filter(d => d.status === 'aberto');
    const certNeg = analise.certidoes.filter(c => c.status === 'negativa').length;
    const certPos = analise.certidoes.filter(c => c.status === 'positiva').length;
    const certPEN = analise.certidoes.filter(c => c.status === 'positiva_efeitos_negativa').length;
    const certIndisp = analise.certidoes.filter(c => c.status === 'indisponivel' || c.status === 'nao_consultada').length;
    const obrigPend = analise.obrigacoes.filter(o => o.status === 'pendente' || o.status === 'atrasada').length;
    const acoesAtivas = analise.acoes.filter(a => a.status === 'em_andamento').length;
    const planoAlta = analise.planoAcao.filter(p => p.gravidade === 'alta' && p.status !== 'concluida').length;

    return (
        <div>
            {(analise as any)?._serproMock && (
                <div style={{
                    padding: '10px 16px', marginBottom: '1rem', borderRadius: '8px',
                    background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)',
                    color: 'var(--warning)', fontSize: '0.85rem', fontWeight: 600,
                }}>
                    DADOS SIMULADOS — SERPRO em modo teste (DRY_RUN). Os valores exibidos nao correspondem a situacao real da empresa.
                </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                <button
                    onClick={onExportPdf}
                    disabled={exportingPdf}
                    style={{
                        ...btnStyleSave,
                        opacity: exportingPdf ? 0.6 : 1,
                        cursor: exportingPdf ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                    }}
                >
                    {exportingPdf ? 'Gerando PDF...' : 'Exportar Relatorio PDF'}
                </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
                <DashCard title="Débitos Abertos" value={String(debitosAbertos.length)} sub={formatCurrency(debitosAbertos.reduce((s, d) => s + (d.valorAtualizado || d.valorOriginal), 0))} color="var(--danger)" />
                <DashCard title="Certidões Negativas" value={`${certNeg}/${analise.certidoes.length}`} sub={certPos > 0 ? `${certPos} positiva(s)` : certIndisp > 0 ? `${certIndisp} indisponivel(is)` : certPEN > 0 ? `${certPEN} PEN` : 'Sem impedimentos'} color={certPos > 0 ? 'var(--danger)' : certIndisp > 0 ? 'var(--text-muted)' : 'var(--success)'} />
                <DashCard title="Obrigações Pendentes" value={String(obrigPend)} sub={`de ${analise.obrigacoes.length} totais`} color={obrigPend > 0 ? 'var(--warning)' : 'var(--success)'} />
                <DashCard title="Ações em Andamento" value={String(acoesAtivas)} sub={`de ${analise.acoes.length} totais`} color={acoesAtivas > 0 ? 'var(--warning)' : 'var(--success)'} />
                <DashCard title="Plano de Ação (Alta)" value={String(planoAlta)} sub={`de ${analise.planoAcao.length} itens`} color={planoAlta > 0 ? 'var(--danger)' : 'var(--success)'} />
                <DashCard title="Parcelamentos Ativos" value={String(analise.parcelamentos.filter(p => p.status === 'ativo').length)} sub={formatCurrency(analise.parcelamentos.filter(p => p.status === 'ativo').reduce((s, p) => s + p.valorTotal, 0))} color="var(--accent)" />
            </div>
        </div>
    );
};

export default DashboardTab;
