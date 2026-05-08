/**
 * SpedFiscal — Aba de geração SPED Fiscal (EFD ICMS/IPI).
 *
 * Fase 1: Bloco 0 + Bloco 9 implementados, faz download do .txt.
 *
 * Roadmap:
 *   Fase 0: UI placeholder (entregue 07/05)
 *   Fase 1: Backend stub + UI funcional (07/05) + LOGICA REAL (08/05) ← AQUI
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
    extras?: { label: string; value: string }[];
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

            if (resp.status === 400) {
                const data = await resp.json();
                if (data.error === 'DADOS_FISCAIS_INCOMPLETOS') {
                    setMensagem({
                        tipo: 'warning',
                        titulo: 'Dados Fiscais incompletos',
                        detalhes: data.message,
                    });
                    return;
                }
                setMensagem({
                    tipo: 'error',
                    titulo: 'Erro de validação',
                    detalhes: data.message || data.error,
                });
                return;
            }

            if (!resp.ok) {
                let msg = `HTTP ${resp.status}`;
                try {
                    const data = await resp.json();
                    msg = data.message || data.error || msg;
                } catch {
                    /* nao eh JSON, mantem HTTP */
                }
                setMensagem({ tipo: 'error', titulo: 'Erro ao gerar SPED', detalhes: msg });
                return;
            }

            // ─── Download do arquivo ───
            const blob = await resp.blob();
            const filename = (() => {
                const cd = resp.headers.get('Content-Disposition') || '';
                const m = cd.match(/filename="([^"]+)"/);
                return m ? m[1] : 'SPED_Fiscal.txt';
            })();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // Stats e warnings (se vieram nos headers)
            let stats = null as null | { notas: number; itens: number; participantes: number; linhas: number };
            try {
                const raw = resp.headers.get('X-SPED-Stats');
                if (raw) stats = JSON.parse(decodeURIComponent(raw));
            } catch { /* ignora */ }

            let warnings: string[] = [];
            try {
                const raw = resp.headers.get('X-SPED-Warnings');
                if (raw) warnings = JSON.parse(decodeURIComponent(raw));
            } catch { /* ignora */ }

            const extras = stats ? [
                { label: 'Notas processadas', value: String(stats.notas) },
                { label: 'Itens únicos', value: String(stats.itens) },
                { label: 'Participantes', value: String(stats.participantes) },
                { label: 'Linhas no arquivo', value: String(stats.linhas) },
            ] : undefined;

            setMensagem({
                tipo: warnings.length ? 'warning' : 'success',
                titulo: warnings.length
                    ? `SPED gerado com avisos: ${filename}`
                    : `SPED gerado: ${filename}`,
                detalhes: warnings.length ? warnings.join(' — ') : 'Download concluído.',
                extras,
            });
            if (onShowToast && !warnings.length) {
                onShowToast(`SPED Fiscal "${filename}" gerado com sucesso!`);
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
                        style={{ background: 'rgba(91,127,255,0.18)', color: '#5B7FFF' }}
                    >
                        Fase 1 — Bloco 0 + 9
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
                        {mensagem.extras && (
                            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                                {mensagem.extras.map(e => (
                                    <div key={e.label} className="p-2 rounded" style={{ background: 'rgba(255,255,255,0.04)' }}>
                                        <p className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(200,208,255,0.5)' }}>
                                            {e.label}
                                        </p>
                                        <p className="text-sm font-bold" style={{ color: '#F5F6FF' }}>
                                            {e.value}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Aviso da fase atual */}
            <div
                className="p-4 rounded-xl"
                style={{
                    background: 'rgba(91,127,255,0.06)',
                    border: '1px solid rgba(91,127,255,0.2)',
                    borderLeft: '4px solid #5B7FFF',
                }}
            >
                <p className="text-xs font-bold" style={{ color: '#5B7FFF' }}>
                    🛠️ Fase 1 — Bloco 0 e 9 implementados
                </p>
                <p className="text-xs mt-1" style={{ color: 'rgba(200,208,255,0.7)' }}>
                    A geração inclui dados da empresa (registro 0000), endereço (0005),
                    contador (0100), participantes (0150), unidades (0190),
                    itens (0200) e bloco de controle (9001-9999).
                    <strong className="block mt-2">Pendente Fase 2:</strong>
                    Bloco C (mercadorias - notas item-a-item) e Bloco E (apuração ICMS/IPI).
                    Por enquanto, o SPED gerado <strong>NÃO</strong> deve ser entregue à PVA — use para validação visual.
                </p>
            </div>
        </div>
    );
};

export default SpedFiscal;
