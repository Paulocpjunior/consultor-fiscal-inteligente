/**
 * SpedFiscal — Aba de geração SPED Fiscal (EFD ICMS/IPI).
 *
 * Fase 0 (atual): UI placeholder com roadmap das fases.
 * Fase 1: Bloco 0 (abertura) + Bloco 9 (encerramento) — esqueleto do .txt
 * Fase 2: Bloco C (mercadorias) — usa XMLs ja capturados pelo cron SEFAZ
 * Fase 3: Bloco E (apuração ICMS/IPI) — totalizadores obrigatorios
 * Fase 4: Validação automática + import na PVA
 *
 * Identidade visual: navy #020026 + dourado #C9A14A (SP Contabil)
 */
import React from 'react';
import type { User } from '../../types';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

interface FaseInfo {
    numero: number;
    titulo: string;
    descricao: string;
    status: 'em_construcao' | 'planejado' | 'futuro';
}

const FASES: FaseInfo[] = [
    {
        numero: 0,
        titulo: 'Aba + estrutura',
        descricao: 'Componente, navegação, layout. Sem geração de arquivo.',
        status: 'em_construcao',
    },
    {
        numero: 1,
        titulo: 'Bloco 0 + Bloco 9',
        descricao: 'Abertura, identificação do estabelecimento e encerramento. Esqueleto do .txt.',
        status: 'planejado',
    },
    {
        numero: 2,
        titulo: 'Bloco C — Mercadorias',
        descricao: 'C100 (notas), C170 (itens), C190 (analítico ICMS). Usa XMLs já capturados pelo cron SEFAZ.',
        status: 'planejado',
    },
    {
        numero: 3,
        titulo: 'Bloco E — Apuração ICMS/IPI',
        descricao: 'E100, E110 (apuração mensal), E116 (recolhimento). Totalizadores obrigatórios.',
        status: 'planejado',
    },
    {
        numero: 4,
        titulo: 'Validação na PVA',
        descricao: 'Testes com Programa Validador SEFAZ. Geração de SPED importável de verdade.',
        status: 'futuro',
    },
];

const StatusBadge: React.FC<{ status: FaseInfo['status'] }> = ({ status }) => {
    const cfg = {
        em_construcao: { bg: 'rgba(201,161,74,0.15)', color: '#C9A14A', label: 'EM CONSTRUÇÃO' },
        planejado: { bg: 'rgba(91,127,255,0.15)', color: '#5B7FFF', label: 'PLANEJADO' },
        futuro: { bg: 'rgba(200,208,255,0.08)', color: 'rgba(200,208,255,0.5)', label: 'FUTURO' },
    }[status];
    return (
        <span
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
            style={{ background: cfg.bg, color: cfg.color }}
        >
            {cfg.label}
        </span>
    );
};

const SpedFiscal: React.FC<Props> = ({ currentUser }) => {
    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div
                className="p-6 rounded-xl"
                style={{
                    background: 'linear-gradient(135deg, rgba(20,0,255,0.12), rgba(8,0,122,0.08))',
                    border: '1px solid rgba(200,208,255,0.12)',
                }}
            >
                <div className="flex items-start justify-between flex-wrap gap-4">
                    <div>
                        <h2 className="text-2xl font-bold" style={{ color: '#F5F6FF' }}>
                            SPED Fiscal
                        </h2>
                        <p className="text-sm mt-1" style={{ color: 'rgba(200,208,255,0.6)' }}>
                            EFD ICMS/IPI — Escrituração Fiscal Digital
                        </p>
                        <p className="text-xs mt-3" style={{ color: 'rgba(200,208,255,0.45)' }}>
                            Geração do arquivo .txt mensal exigido pela SEFAZ. Cobre Lucro Presumido,
                            Lucro Real e Simples Nacional (quando aplicável).
                        </p>
                    </div>
                    <span
                        className="text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full"
                        style={{ background: 'rgba(201,161,74,0.18)', color: '#C9A14A' }}
                    >
                        BETA — Em desenvolvimento
                    </span>
                </div>
            </div>

            {/* Banner de aviso */}
            <div
                className="p-4 rounded-xl flex items-start gap-3"
                style={{
                    background: 'rgba(201,161,74,0.08)',
                    border: '1px solid rgba(201,161,74,0.25)',
                    borderLeft: '4px solid #C9A14A',
                }}
            >
                <div className="flex-1">
                    <p className="text-sm font-bold" style={{ color: '#C9A14A' }}>
                        Esta aba está em construção
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'rgba(200,208,255,0.7)' }}>
                        A geração do SPED Fiscal está sendo entregue em fases. Cada fase incremental
                        adiciona blocos do layout oficial. Veja o roadmap abaixo. Funcionalidades de
                        outras abas (Importa XML, Análise SAGE) continuam funcionando normalmente.
                    </p>
                </div>
            </div>

            {/* Roadmap das fases */}
            <div>
                <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'rgba(200,208,255,0.6)' }}>
                    Roadmap de entrega
                </h3>
                <div className="space-y-3">
                    {FASES.map((fase) => (
                        <div
                            key={fase.numero}
                            className="p-4 rounded-xl"
                            style={{
                                background: 'rgba(8,0,122,0.08)',
                                border: '1px solid rgba(200,208,255,0.08)',
                                opacity: fase.status === 'futuro' ? 0.55 : 1,
                            }}
                        >
                            <div className="flex items-start gap-4">
                                <div
                                    className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm"
                                    style={{
                                        background: fase.status === 'em_construcao' ? '#C9A14A' : 'rgba(20,0,255,0.2)',
                                        color: fase.status === 'em_construcao' ? '#020026' : '#5B7FFF',
                                    }}
                                >
                                    {fase.numero}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h4 className="text-sm font-bold" style={{ color: '#F5F6FF' }}>
                                            Fase {fase.numero} — {fase.titulo}
                                        </h4>
                                        <StatusBadge status={fase.status} />
                                    </div>
                                    <p className="text-xs mt-1.5" style={{ color: 'rgba(200,208,255,0.6)' }}>
                                        {fase.descricao}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Placeholder pra Fase 1: lista de empresas */}
            <div>
                <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'rgba(200,208,255,0.6)' }}>
                    Empresas elegíveis (disponível na Fase 1)
                </h3>
                <div
                    className="p-8 rounded-xl text-center"
                    style={{
                        background: 'rgba(8,0,122,0.08)',
                        border: '1px dashed rgba(200,208,255,0.15)',
                    }}
                >
                    <p className="text-sm" style={{ color: 'rgba(200,208,255,0.5)' }}>
                        Quando a Fase 1 for entregue, esta seção listará as empresas cadastradas no app,
                        com seleção de competência (mês/ano) e botão para gerar o SPED.
                    </p>
                    {currentUser?.email && (
                        <p className="text-xs mt-3" style={{ color: 'rgba(200,208,255,0.35)' }}>
                            Logado como {currentUser.email}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SpedFiscal;
