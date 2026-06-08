/**
 * SpedFiscal — Aba de geração SPED Fiscal (EFD ICMS/IPI) e SPED Contribuições
 * (EFD PIS/COFINS).
 *
 * SPED Fiscal - Blocos: 0, B(vazio), C(NF-e/NFC-e), D(CT-e), E(apuração ICMS),
 * G/H/K(vazios), 1(vazio), 9(contagem).
 *
 * SPED Contribuições - Blocos: 0, A(NFSe), C(NF-e PIS/COFINS), D(CTe),
 * F(vazio), M(apuração PIS/COFINS), 1, 9.
 *
 * Layout alvo Fiscal: Guia Prático 3.2.2 / Leiaute 020 (vigente 01/01/2026).
 * Layout alvo Contrib: Guia Prático 1.35, versão 006 (vigente 2026).
 */
import React, { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import type { User } from '../../types';
import { getEmpresasDisponiveis, type EmpresaXmlOption } from '../../services/xmlFiscalService';
import { auth } from '../../services/firebaseConfig';
import { formatCnpjCpf } from '../../services/xmlParserService';

const AnaliseConferencia = lazy(() => import('./AnaliseConferencia'));
const EditarViaExcel = lazy(() => import('./EditarViaExcel'));
const CruzarObrigacoes = lazy(() => import('./CruzarObrigacoes'));
const CruzarComCapturadas = lazy(() => import('./CruzarComCapturadas'));
const ConciliarFaturamento = lazy(() => import('./ConciliarFaturamento'));

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

import MensagemBlock, { type MensagemRetorno } from './MensagemBlock';

type Escopo = 'mensal' | 'trimestral';

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

type SpedTab = 'gerar' | 'analisar' | 'contribuicoes' | 'editar' | 'cruzar' | 'cruzar-xml' | 'conciliar';

// MensagemBlock vive em ./MensagemBlock.tsx (reutilizado pelas abas).

const SpedFiscal: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [spedTab, setSpedTab] = useState<SpedTab>('gerar');
    const [empresas, setEmpresas] = useState<EmpresaXmlOption[]>([]);
    const [loadingEmpresas, setLoadingEmpresas] = useState(true);
    const [empresaId, setEmpresaId] = useState<string>('');
    const [competencia, setCompetencia] = useState<string>(getCompetenciaAtual());
    const [escopo, setEscopo] = useState<Escopo>('mensal');
    const [gerando, setGerando] = useState(false);
    const [mensagem, setMensagem] = useState<MensagemRetorno | null>(null);
    // Contribuições state
    const [gerandoContrib, setGerandoContrib] = useState(false);
    const [mensagemContrib, setMensagemContrib] = useState<MensagemRetorno | null>(null);
    const [competenciaContrib, setCompetenciaContrib] = useState<string>(getCompetenciaAtual());

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

            // Download do arquivo
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

    const handleGerarContrib = async () => {
        if (!empresaId) {
            setMensagemContrib({ tipo: 'error', titulo: 'Selecione uma empresa.' });
            return;
        }

        setGerandoContrib(true);
        setMensagemContrib(null);

        try {
            const token = await auth?.currentUser?.getIdToken();
            if (!token) throw new Error('Sessão expirada. Faça login novamente.');

            const body = { empresaId, competencia: competenciaContrib };

            const resp = await fetch('/api/admin/sped-contrib/gerar', {
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
                    setMensagemContrib({
                        tipo: 'warning',
                        titulo: 'Dados Fiscais incompletos',
                        detalhes: data.message,
                    });
                    return;
                }
                setMensagemContrib({
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
                } catch { /* nao eh JSON */ }
                setMensagemContrib({ tipo: 'error', titulo: 'Erro ao gerar SPED Contribuições', detalhes: msg });
                return;
            }

            const blob = await resp.blob();
            const filename = (() => {
                const cd = resp.headers.get('Content-Disposition') || '';
                const m = cd.match(/filename="([^"]+)"/);
                return m ? m[1] : 'SPED_Contribuicoes.txt';
            })();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            let stats = null as null | { notas: number; itens: number; participantes: number; linhas: number; regimeApuracao?: string };
            try {
                const raw = resp.headers.get('X-SPED-Stats');
                if (raw) stats = JSON.parse(decodeURIComponent(raw));
            } catch { /* ignora */ }

            let warnings: string[] = [];
            try {
                const raw = resp.headers.get('X-SPED-Warnings');
                if (raw) warnings = JSON.parse(decodeURIComponent(raw));
            } catch { /* ignora */ }

            const regimeLabel = stats?.regimeApuracao === '1' ? 'Não-cumulativo'
                : stats?.regimeApuracao === '3' ? 'Ambos' : 'Cumulativo';

            const extras = stats ? [
                { label: 'Notas processadas', value: String(stats.notas) },
                { label: 'Itens únicos', value: String(stats.itens) },
                { label: 'Participantes', value: String(stats.participantes) },
                { label: 'Linhas no arquivo', value: String(stats.linhas) },
                { label: 'Regime PIS/COFINS', value: regimeLabel },
            ] : undefined;

            setMensagemContrib({
                tipo: warnings.length ? 'warning' : 'success',
                titulo: warnings.length
                    ? `SPED Contribuições gerado com avisos: ${filename}`
                    : `SPED Contribuições gerado: ${filename}`,
                detalhes: warnings.length ? warnings.join(' — ') : 'Download concluído.',
                extras,
            });
            if (onShowToast && !warnings.length) {
                onShowToast(`SPED Contribuições "${filename}" gerado com sucesso!`);
            }
        } catch (err: any) {
            setMensagemContrib({
                tipo: 'error',
                titulo: 'Erro de comunicação',
                detalhes: err?.message || 'Falha desconhecida',
            });
        } finally {
            setGerandoContrib(false);
        }
    };

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div
                className="p-6 rounded-xl"
                style={{
                    background: 'linear-gradient(135deg, var(--accent-soft), var(--bg-elevated))',
                    border: '1px solid var(--border-default)',
                }}
            >
                <div className="flex items-start justify-between flex-wrap gap-4">
                    <div>
                        <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                            {spedTab === 'contribuicoes' ? 'SPED Contribuições' : 'SPED Fiscal'}
                        </h2>
                        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                            {spedTab === 'contribuicoes'
                                ? 'EFD PIS/COFINS — Guia Prático 1.35 / Versão 006'
                                : 'EFD ICMS/IPI — Guia Prático 3.2.2 / Leiaute 020'}
                        </p>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        <button
                            onClick={() => setSpedTab('gerar')}
                            className="px-4 py-2 text-xs font-bold rounded-lg transition-colors"
                            style={{
                                background: spedTab === 'gerar' ? 'var(--accent)' : 'var(--bg-card)',
                                color: spedTab === 'gerar' ? '#fff' : 'var(--text-muted)',
                                border: `1px solid ${spedTab === 'gerar' ? 'var(--accent)' : 'var(--border-default)'}`,
                            }}
                        >
                            Gerar SPED Fiscal
                        </button>
                        <button
                            onClick={() => setSpedTab('contribuicoes')}
                            className="px-4 py-2 text-xs font-bold rounded-lg transition-colors"
                            style={{
                                background: spedTab === 'contribuicoes' ? 'var(--accent)' : 'var(--bg-card)',
                                color: spedTab === 'contribuicoes' ? '#fff' : 'var(--text-muted)',
                                border: `1px solid ${spedTab === 'contribuicoes' ? 'var(--accent)' : 'var(--border-default)'}`,
                            }}
                        >
                            SPED Contribuições
                        </button>
                        <button
                            onClick={() => setSpedTab('analisar')}
                            className="px-4 py-2 text-xs font-bold rounded-lg transition-colors"
                            style={{
                                background: spedTab === 'analisar' ? 'var(--accent)' : 'var(--bg-card)',
                                color: spedTab === 'analisar' ? '#fff' : 'var(--text-muted)',
                                border: `1px solid ${spedTab === 'analisar' ? 'var(--accent)' : 'var(--border-default)'}`,
                            }}
                        >
                            Importar e Analisar
                        </button>
                        <button
                            onClick={() => setSpedTab('editar')}
                            className="px-4 py-2 text-xs font-bold rounded-lg transition-colors"
                            style={{
                                background: spedTab === 'editar' ? 'var(--accent)' : 'var(--bg-card)',
                                color: spedTab === 'editar' ? '#fff' : 'var(--text-muted)',
                                border: `1px solid ${spedTab === 'editar' ? 'var(--accent)' : 'var(--border-default)'}`,
                            }}
                        >
                            Editar via Excel
                        </button>
                        <button
                            onClick={() => setSpedTab('cruzar')}
                            className="px-4 py-2 text-xs font-bold rounded-lg transition-colors"
                            style={{
                                background: spedTab === 'cruzar' ? 'var(--accent)' : 'var(--bg-card)',
                                color: spedTab === 'cruzar' ? '#fff' : 'var(--text-muted)',
                                border: `1px solid ${spedTab === 'cruzar' ? 'var(--accent)' : 'var(--border-default)'}`,
                            }}
                        >
                            Cruzar obrigações
                        </button>
                        <button
                            onClick={() => setSpedTab('cruzar-xml')}
                            className="px-4 py-2 text-xs font-bold rounded-lg transition-colors"
                            style={{
                                background: spedTab === 'cruzar-xml' ? 'var(--accent)' : 'var(--bg-card)',
                                color: spedTab === 'cruzar-xml' ? '#fff' : 'var(--text-muted)',
                                border: `1px solid ${spedTab === 'cruzar-xml' ? 'var(--accent)' : 'var(--border-default)'}`,
                            }}
                        >
                            SPED × Capturadas
                        </button>
                        <button
                            onClick={() => setSpedTab('conciliar')}
                            className="px-4 py-2 text-xs font-bold rounded-lg transition-colors"
                            style={{
                                background: spedTab === 'conciliar' ? 'var(--accent)' : 'var(--bg-card)',
                                color: spedTab === 'conciliar' ? '#fff' : 'var(--text-muted)',
                                border: `1px solid ${spedTab === 'conciliar' ? 'var(--accent)' : 'var(--border-default)'}`,
                            }}
                        >
                            SPED × Declarado
                        </button>
                    </div>
                    <span
                        className="text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full"
                        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                        {spedTab === 'contribuicoes'
                            ? 'Blocos 0 + A + C + D + F + M + 1 + 9'
                            : 'Blocos 0 + C + D + E + 9'}
                    </span>
                </div>
            </div>

            {spedTab === 'analisar' && (
                <Suspense fallback={<p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>Carregando...</p>}>
                    <AnaliseConferencia currentUser={currentUser} onShowToast={onShowToast} />
                </Suspense>
            )}

            {spedTab === 'editar' && (
                <Suspense fallback={<p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>Carregando...</p>}>
                    <EditarViaExcel />
                </Suspense>
            )}

            {spedTab === 'cruzar' && (
                <Suspense fallback={<p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>Carregando...</p>}>
                    <CruzarObrigacoes />
                </Suspense>
            )}

            {spedTab === 'cruzar-xml' && (
                <Suspense fallback={<p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>Carregando...</p>}>
                    <CruzarComCapturadas currentUser={currentUser} />
                </Suspense>
            )}

            {spedTab === 'conciliar' && (
                <Suspense fallback={<p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>Carregando...</p>}>
                    <ConciliarFaturamento currentUser={currentUser} />
                </Suspense>
            )}

            {/* ═══ SPED FISCAL (EFD ICMS/IPI) ═══ */}
            {spedTab === 'gerar' && <>
            <div
                className="p-5 rounded-xl"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
            >
                <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-secondary)' }}>
                    1. Empresa
                </h3>
                {loadingEmpresas ? (
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Carregando empresas...</p>
                ) : empresas.length === 0 ? (
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Nenhuma empresa cadastrada.</p>
                ) : (
                    <select
                        value={empresaId}
                        onChange={e => { setEmpresaId(e.target.value); setMensagem(null); }}
                        className="w-full p-3 text-sm rounded-lg outline-none"
                        style={{
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border-default)',
                            color: 'var(--text-primary)',
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
                            background: 'var(--warning-soft)',
                            border: '1px solid var(--warning-soft-border)',
                            borderLeft: '4px solid var(--warning)',
                        }}
                    >
                        <div className="flex-1">
                            <p className="text-xs font-bold" style={{ color: 'var(--warning)' }}>
                                ⚠ Verificar obrigatoriedade
                            </p>
                            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                                Empresas do Simples Nacional geralmente <strong>não entregam SPED Fiscal</strong>.
                                Casos específicos exigem entrega (substituição tributária, ICMS-ST, importação,
                                ME/EPP impedida do Simples). Confirme com o contador antes de gerar.
                            </p>
                        </div>
                    </div>
                )}
            </div>

            <div
                className="p-5 rounded-xl"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
            >
                <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-secondary)' }}>
                    2. Período
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="text-xs uppercase font-medium block mb-2" style={{ color: 'var(--text-muted)' }}>
                            Escopo
                        </label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setEscopo('mensal')}
                                className="flex-1 py-2 text-sm rounded-lg transition-colors"
                                style={{
                                    background: escopo === 'mensal' ? 'var(--accent-soft-border)' : 'var(--bg-card)',
                                    border: `1px solid ${escopo === 'mensal' ? 'var(--accent-soft-border)' : 'var(--border-default)'}`,
                                    color: escopo === 'mensal' ? 'var(--text-primary)' : 'var(--text-muted)',
                                }}
                            >
                                Mensal
                            </button>
                            <button
                                onClick={() => setEscopo('trimestral')}
                                className="flex-1 py-2 text-sm rounded-lg transition-colors"
                                style={{
                                    background: escopo === 'trimestral' ? 'var(--accent-soft-border)' : 'var(--bg-card)',
                                    border: `1px solid ${escopo === 'trimestral' ? 'var(--accent-soft-border)' : 'var(--border-default)'}`,
                                    color: escopo === 'trimestral' ? 'var(--text-primary)' : 'var(--text-muted)',
                                }}
                            >
                                Trimestral
                            </button>
                        </div>
                    </div>
                    <div>
                        <label className="text-xs uppercase font-medium block mb-2" style={{ color: 'var(--text-muted)' }}>
                            Competência {escopo === 'trimestral' ? '(qualquer mês do trimestre)' : ''}
                        </label>
                        <input
                            type="month"
                            value={competencia}
                            onChange={e => { setCompetencia(e.target.value); setMensagem(null); }}
                            className="w-full p-2.5 text-sm rounded-lg outline-none"
                            style={{
                                background: 'var(--bg-card)',
                                border: '1px solid var(--border-default)',
                                color: 'var(--text-primary)',
                            }}
                        />
                        {escopo === 'trimestral' && (
                            <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                                {(() => {
                                    const { inicio, fim } = getTrimestreFromCompetencia(competencia);
                                    return `Trimestre selecionado: ${inicio} a ${fim}`;
                                })()}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex justify-center">
                <button
                    onClick={handleGerar}
                    disabled={gerando || !empresaId}
                    className="btn-press px-8 py-4 text-white font-bold text-base rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'var(--accent)', minWidth: '280px' }}
                >
                    {gerando ? (
                        <span className="flex items-center justify-center gap-3">
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Gerando...
                        </span>
                    ) : 'Gerar SPED Fiscal'}
                </button>
            </div>

            {mensagem && <MensagemBlock mensagem={mensagem} />}

            <div
                className="p-4 rounded-xl"
                style={{
                    background: 'var(--accent-soft)',
                    border: '1px solid var(--accent-soft)',
                    borderLeft: '4px solid var(--accent)',
                }}
            >
                <p className="text-xs font-bold" style={{ color: 'var(--accent)' }}>
                    EFD ICMS/IPI — blocos implementados
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    A geração inclui: bloco 0 (empresa, contador, participantes,
                    unidades, itens), bloco C (mercadorias — C100/C170/C190 nota
                    item-a-item), bloco D (CT-e), bloco E (apuração de ICMS — débitos,
                    créditos, saldo e GARE/E116 para Lucro; e de IPI — E200/E210 quando
                    há atividade), bloco H (inventário) e bloco 9 (controle).
                    Simples Nacional sai com apuração zerada (paga via DAS), conforme regra.
                </p>
                <p className="text-xs mt-3 font-bold" style={{ color: '#b45309' }}>
                    ⚠ Antes de transmitir à Receita pela primeira vez:
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    este SPED ainda <strong>não foi validado linha-a-linha contra o PVA da Receita
                    em ambiente real</strong>. Para cada empresa nova, baixe o arquivo aqui,
                    abra no PVA oficial (Programa Validador e Assinador EFD ICMS/IPI) e
                    confira a apuração contra um período já transmitido manualmente.
                    Só transmita pelo app após essa conferência cruzada.
                </p>
            </div>
            </>}

            {/* ═══ SPED CONTRIBUIÇÕES (EFD PIS/COFINS) ═══ */}
            {spedTab === 'contribuicoes' && <>
            <div
                className="p-5 rounded-xl"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
            >
                <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-secondary)' }}>
                    1. Empresa
                </h3>
                {loadingEmpresas ? (
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Carregando empresas...</p>
                ) : empresas.length === 0 ? (
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Nenhuma empresa cadastrada.</p>
                ) : (
                    <select
                        value={empresaId}
                        onChange={e => { setEmpresaId(e.target.value); setMensagemContrib(null); }}
                        className="w-full p-3 text-sm rounded-lg outline-none"
                        style={{
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border-default)',
                            color: 'var(--text-primary)',
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
                            background: 'var(--warning-soft)',
                            border: '1px solid var(--warning-soft-border)',
                            borderLeft: '4px solid var(--warning)',
                        }}
                    >
                        <div className="flex-1">
                            <p className="text-xs font-bold" style={{ color: 'var(--warning)' }}>
                                ⚠ Verificar obrigatoriedade
                            </p>
                            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                                Empresas do Simples Nacional geralmente <strong>não entregam EFD Contribuições</strong>.
                                Obrigatório apenas para Lucro Presumido (cumulativo) e Lucro Real (não-cumulativo).
                            </p>
                        </div>
                    </div>
                )}
            </div>

            <div
                className="p-5 rounded-xl"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
            >
                <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-secondary)' }}>
                    2. Competência (Mensal)
                </h3>
                <div>
                    <label className="text-xs uppercase font-medium block mb-2" style={{ color: 'var(--text-muted)' }}>
                        Mês/Ano
                    </label>
                    <input
                        type="month"
                        value={competenciaContrib}
                        onChange={e => { setCompetenciaContrib(e.target.value); setMensagemContrib(null); }}
                        className="w-full p-2.5 text-sm rounded-lg outline-none"
                        style={{
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border-default)',
                            color: 'var(--text-primary)',
                        }}
                    />
                </div>

                <div className="mt-4 p-3 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <strong>Regime de apuração:</strong> determinado automaticamente pelo tipo da empresa.
                        Lucro Presumido = cumulativo (PIS 0,65% / COFINS 3%).
                        Lucro Real = não-cumulativo (PIS 1,65% / COFINS 7,6%).
                    </p>
                </div>
            </div>

            <div className="flex justify-center">
                <button
                    onClick={handleGerarContrib}
                    disabled={gerandoContrib || !empresaId}
                    className="btn-press px-8 py-4 text-white font-bold text-base rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'var(--accent)', minWidth: '280px' }}
                >
                    {gerandoContrib ? (
                        <span className="flex items-center justify-center gap-3">
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Gerando...
                        </span>
                    ) : 'Gerar SPED Contribuições'}
                </button>
            </div>

            {mensagemContrib && <MensagemBlock mensagem={mensagemContrib} />}

            <div
                className="p-4 rounded-xl"
                style={{
                    background: 'var(--accent-soft)',
                    border: '1px solid var(--accent-soft)',
                    borderLeft: '4px solid var(--accent)',
                }}
            >
                <p className="text-xs font-bold" style={{ color: 'var(--accent)' }}>
                    EFD Contribuições — Blocos implementados
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    <strong>Bloco 0:</strong> Abertura, contabilista, regime (0110), estabelecimentos, participantes, itens.{' '}
                    <strong>Bloco A:</strong> NFSe (serviços).{' '}
                    <strong>Bloco C:</strong> NF-e com CST PIS/COFINS e alíquotas por item.{' '}
                    <strong>Bloco D:</strong> CT-e (transporte).{' '}
                    <strong>Bloco F:</strong> Estrutura mínima.{' '}
                    <strong>Bloco M:</strong> Apuração PIS/COFINS (créditos não-cumulativo, contribuição devida).{' '}
                    <strong>Bloco 1:</strong> Complemento.{' '}
                    <strong>Bloco 9:</strong> Controle e encerramento.
                </p>
            </div>
            </>}
        </div>
    );
};

export default SpedFiscal;
