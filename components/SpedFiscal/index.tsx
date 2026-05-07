/**
 * SpedFiscal — Aba de geração SPED Fiscal (EFD ICMS/IPI).
 *
 * Fase atual: ESQUELETO (UI funcional + backend stub que retorna 501).
 *
 * Roadmap:
 *   Fase 0 (entregue): UI placeholder com roadmap visual
 *   Fase 1 (em desenvolvimento): Bloco 0 + Bloco 9 + UI de seleção/geração
 *   Fase 2: Bloco C (mercadorias)
 *   Fase 3: Bloco E (apuração ICMS/IPI)
 *   Fase 4: Validação na PVA + histórico Firestore
 *
 * Layout alvo: Guia Prático 3.2.2 / Leiaute 020 (vigente 01/01/2026).
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { User } from '../../types';
import { getEmpresasDisponiveis, type EmpresaXmlOption } from '../../services/xmlFiscalService';
import { auth } from '../../services/firebaseConfig';
import { formatCnpjCpf } from '../../services/xmlParserService';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

type Escopo = 'mensal' | 'trimestral';

interface MensagemRetorno {
    tipo: 'info' | 'warning' | 'error' | 'success';
    titulo: string;
    detalhes?: string;
}

function getCompetenciaAtual(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getTrimestreFromCompetencia(comp: string): { inicio: string; fim: string } {
    const [ano, mes] = comp.split('-').map(Number);
    const trimestre = Math.floor((mes - 1) / 3);
    const mesInicio = trimestre * 3 + 1;
    const mesFim = mesInicio + 2;
    const fmt = (m: number) => `${ano}-${String(m).padStart(2, '0')}`;
    return { inicio: fmt(mesInicio), fim: fmt(mesFim) };
}

const SpedFiscal: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [empresas, setEmpresas] = useState<EmpresaXmlOption[]>([]);
    const [loadingEmpresas, setLoadingEmpresas] = useState(true);
    const [empresaId, setEmpresaId] = useState<string>('');
    const [competencia, setCompetencia] = useState<string>(getCompetenciaAtual());
    const [escopo, setEscopo] = useState<Escopo>('mensal');
    const [gerando, setGerando] = useState(false);
    const [mensagem, setMensagem] = useState<MensagemRetorno | null>(null);

    // Carrega lista de empresas elegíveis
    useEffect(() => {
        let alive = true;
        if (!currentUser) { setLoadingEmpresas(false); return; }
        getEmpresasDisponiveis(currentUser).then(list => {
            if (alive) {
                setEmpresas(list);
                setLoadingEmpresas(false);
                if (list.length > 0 && !empresaId) setEmpresaId(list[0].id);
            }
        });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser]);

    const empresaSelecionada = useMemo(
        () => empresas.find(e => e.id === empresaId),
        [empresas, empresaId],
    );

    const isSimples = empresaSelecionada?.fonte === 'simples';

    const handleGerar = async () => {
        if (!empresaId) {
            setMensagem({ tipo: 'error', titulo: 'Selecione uma empresa.' });
            return;
        }

        setGerando(true);
        setMensagem(null);

        try {
            const token = await auth?.currentUser?.getIdToken();
            if (!token) throw new Error('Sessão expirada. Faça login novamente.');

            const body: Record<string, string> = { empresaId };
            if (escopo === 'mensal') {
                body.competencia = competencia;
            } else {
                const { inicio, fim } = getTrimestreFromCompetencia(competencia);
                body.competenciaInicio = inicio;
                body.competenciaFim = fim;
            }

            const resp = await fetch('/api/admin/sped-fiscal/gerar', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });

            const data = await resp.json();

            if (resp.status === 501) {
                // Esperado nesta fase
                setMensagem({
                    tipo: 'info',
                    titulo: data.error || 'Fase 1 em desenvolvimento',
                    detalhes: data.message,
                });
            } else if (!resp.ok) {
                setMensagem({
                    tipo: 'error',
                    titulo: 'Erro ao gerar SPED',
                    detalhes: data.error || `HTTP ${resp.status}`,
                });
            } else {
                // Quando a Fase 1 estiver pronta, baixar o txt aqui.
                setMensagem({
                    tipo: 'success',
                    titulo: 'SPED gerado com sucesso',
                    detalhes: `${(data.txt || '').length} caracteres no arquivo.`,
                });
            }
        } catch (err: any) {
            setMensagem({
                tipo: 'error',
                titulo: 'Erro de comunicação',
                detalhes: err?.message || 'Falha desconhecida',
            });
        } finally {
            setGerando(false);
        }
    };

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
                            EFD ICMS/IPI — Guia Prático 3.2.2 / Leiaute 020
                        </p>
                    </div>
                    <span
                        className="text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full"
                        style={{ background: 'rgba(201,161,74,0.18)', color: '#C9A14A' }}
                    >
                        BETA — Fase 1 em desenvolvimento
                    </span>
                </div>
            </div>

            {/* Lista de empresas elegíveis */}
            <div
                className="p-5 rounded-xl"
                style={{ background: 'rgba(8,0,122,0.08)', border: '1px solid rgba(200,208,255,0.08)' }}
            >
                <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'rgba(200,208,255,0.6)' }}>
                    1. Empresa
                </h3>
                {loadingEmpresas ? (
                    <p className="text-xs" style={{ color: 'rgba(200,208,255,0.4)' }}>Carregando empresas...</p>
                ) : empresas.length === 0 ? (
                    <p className="text-xs" style={{ color: 'rgba(200,208,255,0.4)' }}>Nenhuma empresa cadastrada.</p>
                ) : (
                    <select
                        value={empresaId}
                        onChange={e => { setEmpresaId(e.target.value); setMensagem(null); }}
                        className="w-full p-3 text-sm rounded-lg outline-none"
                        style={{
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(200,208,255,0.1)',
                            color: '#F5F6FF',
                        }}
                    >
                        {empresas.map(e => (
                            <option key={e.id} value={e.id}>
                                {e.nome} — {formatCnpjCpf(e.cnpj)} ({e.fonte})
                            </option>
                        ))}
                    </select>
                )}

                {/* Aviso pra Simples Nacional */}
                {isSimples && (
                    <div
                        className="mt-3 p-3 rounded-lg flex items-start gap-3"
                        style={{
                            background: 'rgba(201,161,74,0.1)',
                            border: '1px solid rgba(201,161,74,0.3)',
                            borderLeft: '4px solid #C9A14A',
                        }}
                    >
                        <div className="flex-1">
                            <p className="text-xs font-bold" style={{ color: '#C9A14A' }}>
                                ⚠ Verificar obrigatoriedade
                            </p>
                            <p className="text-xs mt-1" style={{ color: 'rgba(200,208,255,0.7)' }}>
                                Empresas do Simples Nacional geralmente <strong>não entregam SPED Fiscal</strong>.
                                Casos específicos exigem entrega (substituição tributária, ICMS-ST, importação,
                                ME/EPP impedida do Simples). Confirme com o contador antes de gerar.
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Período */}
            <div
                className="p-5 rounded-xl"
                style={{ background: 'rgba(8,0,122,0.08)', border: '1px solid rgba(200,208,255,0.08)' }}
            >
                <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'rgba(200,208,255,0.6)' }}>
                    2. Período
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="text-xs uppercase font-medium block mb-2" style={{ color: 'rgba(200,208,255,0.5)' }}>
                            Escopo
                        </label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setEscopo('mensal')}
                                className="flex-1 py-2 text-sm rounded-lg transition-colors"
                                style={{
                                    background: escopo === 'mensal' ? 'rgba(20,0,255,0.2)' : 'rgba(255,255,255,0.04)',
                                    border: `1px solid ${escopo === 'mensal' ? 'rgba(20,0,255,0.45)' : 'rgba(200,208,255,0.1)'}`,
                                    color: escopo === 'mensal' ? '#F5F6FF' : 'rgba(200,208,255,0.5)',
                                }}
                            >
                                Mensal
                            </button>
                            <button
                                onClick={() => setEscopo('trimestral')}
                                className="flex-1 py-2 text-sm rounded-lg transition-colors"
                                style={{
                                    background: escopo === 'trimestral' ? 'rgba(20,0,255,0.2)' : 'rgba(255,255,255,0.04)',
                                    border: `1px solid ${escopo === 'trimestral' ? 'rgba(20,0,255,0.45)' : 'rgba(200,208,255,0.1)'}`,
                                    color: escopo === 'trimestral' ? '#F5F6FF' : 'rgba(200,208,255,0.5)',
                                }}
                            >
                                Trimestral
                            </button>
                        </div>
                    </div>
                    <div>
                        <label className="text-xs uppercase font-medium block mb-2" style={{ color: 'rgba(200,208,255,0.5)' }}>
                            Competência {escopo === 'trimestral' ? '(qualquer mês do trimestre)' : ''}
                        </label>
                        <input
                            type="month"
                            value={competencia}
                            onChange={e => { setCompetencia(e.target.value); setMensagem(null); }}
                            className="w-full p-2.5 text-sm rounded-lg outline-none"
                            style={{
                                background: 'rgba(255,255,255,0.04)',
                                border: '1px solid rgba(200,208,255,0.1)',
                                color: '#F5F6FF',
                            }}
                        />
                        {escopo === 'trimestral' && (
                            <p className="text-[11px] mt-1.5" style={{ color: 'rgba(200,208,255,0.4)' }}>
                                {(() => {
                                    const { inicio, fim } = getTrimestreFromCompetencia(competencia);
                                    return `Trimestre selecionado: ${inicio} a ${fim}`;
                                })()}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Botão Gerar */}
            <div className="flex justify-center">
                <button
                    onClick={handleGerar}
                    disabled={gerando || !empresaId}
                    className="btn-press px-8 py-4 text-white font-bold text-base rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: '#1400FF', minWidth: '280px' }}
                >
                    {gerando ? (
                        <span className="flex items-center justify-center gap-3">
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Gerando...
                        </span>
                    ) : 'Gerar SPED Fiscal'}
                </button>
            </div>

            {/* Mensagem de retorno */}
            {mensagem && (
                <div
                    className="p-4 rounded-xl flex items-start gap-3 animate-fade-in"
                    style={{
                        background:
                            mensagem.tipo === 'success' ? 'rgba(34,197,94,0.1)' :
                            mensagem.tipo === 'error' ? 'rgba(239,68,68,0.1)' :
                            mensagem.tipo === 'warning' ? 'rgba(201,161,74,0.1)' :
                            'rgba(91,127,255,0.1)',
                        border: `1px solid ${
                            mensagem.tipo === 'success' ? 'rgba(34,197,94,0.3)' :
                            mensagem.tipo === 'error' ? 'rgba(239,68,68,0.3)' :
                            mensagem.tipo === 'warning' ? 'rgba(201,161,74,0.3)' :
                            'rgba(91,127,255,0.3)'
                        }`,
                        borderLeft: `4px solid ${
                            mensagem.tipo === 'success' ? '#22C55E' :
                            mensagem.tipo === 'error' ? '#EF4444' :
                            mensagem.tipo === 'warning' ? '#C9A14A' :
                            '#5B7FFF'
                        }`,
                    }}
                >
                    <div className="flex-1">
                        <p className="text-sm font-bold" style={{
                            color: mensagem.tipo === 'success' ? '#22C55E' :
                                   mensagem.tipo === 'error' ? '#EF4444' :
                                   mensagem.tipo === 'warning' ? '#C9A14A' :
                                   '#5B7FFF',
                        }}>
                            {mensagem.titulo}
                        </p>
                        {mensagem.detalhes && (
                            <p className="text-xs mt-1.5" style={{ color: 'rgba(200,208,255,0.7)' }}>
                                {mensagem.detalhes}
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* Aviso da fase atual */}
            <div
                className="p-4 rounded-xl"
                style={{
                    background: 'rgba(201,161,74,0.06)',
                    border: '1px solid rgba(201,161,74,0.2)',
                    borderLeft: '4px solid #C9A14A',
                }}
            >
                <p className="text-xs font-bold" style={{ color: '#C9A14A' }}>
                    🛠️ Fase 1 em construção
                </p>
                <p className="text-xs mt-1" style={{ color: 'rgba(200,208,255,0.7)' }}>
                    A interface está pronta. A geração do arquivo .txt (Blocos 0 e 9) será implementada
                    na próxima sessão. Hoje, ao clicar "Gerar SPED Fiscal", o backend retorna a mensagem
                    "Fase 1 em desenvolvimento" — comportamento esperado.
                </p>
                {currentUser?.email && (
                    <p className="text-[11px] mt-2 italic" style={{ color: 'rgba(200,208,255,0.4)' }}>
                        Logado como {currentUser.email}
                    </p>
                )}
            </div>
        </div>
    );
};

export default SpedFiscal;
