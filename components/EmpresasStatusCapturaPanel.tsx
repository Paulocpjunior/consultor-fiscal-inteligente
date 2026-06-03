/**
 * EmpresasStatusCapturaPanel.tsx
 *
 * Tabela de TODAS as empresas com status de captura:
 *   - cert A1/A3/escritório/nenhum, validade, vencimento próximo
 *   - procuração e-CAC ativa
 *   - CCM SP autorizado
 *   - NFSe Nacional habilitada
 *   - se cada uma das 3 capturas (NFe / NFSe SP / NFSe Nacional) está OK ou bloqueada
 *
 * Filtros: por status (bloqueada, OK, cert vencendo) e busca por nome/CNPJ.
 * Admin pode togglar flags (procuração, NFSe Nacional, captura SEFAZ) inline.
 * Botão "Exportar CSV" pra usar como to-do list operacional.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
    fetchEmpresasStatusCaptura,
    toggleEmpresaFlag,
    autoPreencherUf,
    exportarEmpresasCsv,
    type EmpresaStatusCaptura,
    type EmpresaStatusResumo,
    type FlagCampo,
} from '../services/empresaStatusCapturaService';
import { captureFromSefaz } from '../services/dfeCaptureService';
import type { User } from '../types';

interface Props {
    currentUser: User;
}

type FiltroTipo = 'todas' | 'bloqueadas' | 'sem-uf' | 'sem-cert' | 'cert-vencendo' | 'sem-procuracao' | 'sem-ccmsp' | 'nfse-nac-inativa' | 'sem-responsavel' | 'ok-tudo';

function formatCnpj(s: string) {
    return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function formatDate(iso: string | null) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleDateString('pt-BR');
    } catch { return iso; }
}

function diasAteVencimento(iso: string | null): number | null {
    if (!iso) return null;
    try {
        return Math.floor((new Date(iso).getTime() - Date.now()) / 86400000);
    } catch { return null; }
}

const Pill: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
        ok ? 'bg-green-100 text-green-800 border border-green-300' : 'bg-red-100 text-red-800 border border-red-300'
    }`}>
        {ok ? '✓' : '✗'} {label}
    </span>
);

const EmpresasStatusCapturaPanel: React.FC<Props> = ({ currentUser }) => {
    const [data, setData] = useState<{ resumo: EmpresaStatusResumo; empresas: EmpresaStatusCaptura[] } | null>(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [filtro, setFiltro] = useState<FiltroTipo>('bloqueadas');
    const [busca, setBusca] = useState('');
    const [togglingCnpj, setTogglingCnpj] = useState<string | null>(null);
    const [autoUfRunning, setAutoUfRunning] = useState(false);
    const [capturandoCnpj, setCapturandoCnpj] = useState<string | null>(null);
    const [ultimaCaptura, setUltimaCaptura] = useState<Record<string, { ok: boolean; msg: string }>>({});
    const isAdmin = currentUser.role === 'admin';

    const handleCaptureOne = async (emp: EmpresaStatusCaptura) => {
        if (!isAdmin) return;
        setCapturandoCnpj(emp.cnpj);
        try {
            const r = await captureFromSefaz({
                empresa: { id: emp.id, cnpj: emp.cnpj } as any,
            });
            setUltimaCaptura(prev => ({
                ...prev,
                [emp.cnpj]: {
                    ok: r.sucesso,
                    msg: r.sucesso
                        ? `✓ ${r.motivo}`
                        : (r.foraDeJanela ? `⏰ ${r.motivo}` :
                           r.rateLimited ? `🚦 ${r.motivo}` :
                           `✗ ${r.motivo}`),
                },
            }));
        } catch (e: any) {
            setUltimaCaptura(prev => ({
                ...prev,
                [emp.cnpj]: { ok: false, msg: `✗ ${e.message || 'erro'}` },
            }));
        } finally {
            setCapturandoCnpj(null);
        }
    };

    const handleAutoUf = async () => {
        if (!isAdmin) return;
        if (!confirm(`Auto-preencher UF de ${data?.resumo.semUf || 0} empresas via BrasilAPI? Roda em background, leva ~1-3 min.`)) return;
        setAutoUfRunning(true);
        try {
            const r = await autoPreencherUf();
            if (r.ok) {
                alert('Auto-preenchimento iniciado em background. Aguarde 1-3 min e clique em "Atualizar" pra ver o resultado.');
                setTimeout(load, 60000);
            } else {
                alert(`Erro: ${r.error}`);
            }
        } finally {
            setAutoUfRunning(false);
        }
    };

    const load = useCallback(async () => {
        setLoading(true);
        setErro(null);
        try {
            const d = await fetchEmpresasStatusCaptura();
            setData(d);
        } catch (e: any) {
            setErro(e.message || 'Falha ao carregar');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const empresasFiltradas = useMemo(() => {
        if (!data) return [];
        const buscaLow = busca.toLowerCase().replace(/\D/g, '');
        const buscaTxt = busca.toLowerCase();
        return data.empresas.filter(e => {
            if (busca) {
                if (buscaLow && e.cnpj.includes(buscaLow)) {} // match
                else if (buscaTxt && e.nome.toLowerCase().includes(buscaTxt)) {} // match
                else return false;
            }
            switch (filtro) {
                case 'bloqueadas': return e.motivosBloqueio.length > 0;
                case 'sem-uf': return !e.uf;
                case 'sem-cert': return e.tipoCert === 'nenhum';
                case 'cert-vencendo': {
                    const d = diasAteVencimento(e.certVenceEm);
                    return d !== null && d < 30;
                }
                case 'sem-procuracao': return !e.procuracaoEcacAtiva;
                case 'sem-ccmsp': return !e.nfseSpAutorizado;
                case 'nfse-nac-inativa': return !e.nfseNacionalDfeAtivo;
                case 'sem-responsavel': return !e.responsaveis || e.responsaveis.length === 0;
                case 'ok-tudo': return e.capturaNfeOk && e.capturaNfseSpOk && e.capturaNfseNacionalOk;
                case 'todas':
                default: return true;
            }
        });
    }, [data, filtro, busca]);

    const handleToggle = async (cnpj: string, campo: FlagCampo, valorAtual: boolean) => {
        if (!isAdmin) return;
        setTogglingCnpj(cnpj + '-' + campo);
        try {
            const r = await toggleEmpresaFlag(cnpj, campo, !valorAtual);
            if (r.ok) await load();
            else alert(`Erro: ${r.error}`);
        } finally {
            setTogglingCnpj(null);
        }
    };

    const handleExportCsv = () => {
        if (!data) return;
        const csv = exportarEmpresasCsv(empresasFiltradas);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `empresas-status-captura-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (loading && !data) return <div className="p-6 text-center text-gray-500">Carregando…</div>;
    if (erro) return (
        <div className="p-6 border border-red-300 bg-red-50 rounded">
            <p className="text-red-700 font-semibold">Erro: {erro}</p>
            <button onClick={load} className="mt-2 px-3 py-1 bg-red-600 text-white rounded text-sm">Tentar de novo</button>
        </div>
    );
    if (!data) return null;

    const r = data.resumo;

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">📋 Status de Captura por Empresa</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    Identifica empresas bloqueadas por cert A1/A3, procuração e-CAC ou autorização NFSe.
                </p>
            </div>

            {/* Resumo */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-blue-50 border border-blue-300 rounded-lg p-3">
                    <div className="text-xs text-blue-700 font-semibold">Total empresas</div>
                    <div className="text-2xl font-bold text-blue-900">{r.total}</div>
                </div>
                <div className="bg-green-50 border border-green-300 rounded-lg p-3">
                    <div className="text-xs text-green-700 font-semibold">Captura NFe OK</div>
                    <div className="text-2xl font-bold text-green-900">{r.capturaNfeOk}</div>
                    <div className="text-xs text-red-700">{r.capturaNfeBloqueada} bloqueadas</div>
                </div>
                <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-3">
                    <div className="text-xs text-yellow-700 font-semibold">Cert vencendo &lt;30d / Expirado</div>
                    <div className="text-2xl font-bold text-yellow-900">{r.certVenceEm30d} / {r.certExpirado}</div>
                </div>
                <div className="bg-purple-50 border border-purple-300 rounded-lg p-3">
                    <div className="text-xs text-purple-700 font-semibold">Sem cert + sem procuração</div>
                    <div className="text-2xl font-bold text-purple-900">{r.semCertNenhum}</div>
                </div>
                <div className="bg-orange-50 border border-orange-300 rounded-lg p-3">
                    <div className="text-xs text-orange-700 font-semibold">Sem UF cadastrada</div>
                    <div className="text-2xl font-bold text-orange-900">{r.semUf}</div>
                    {isAdmin && r.semUf > 0 && (
                        <button
                            onClick={handleAutoUf}
                            disabled={autoUfRunning}
                            className="mt-1 text-[10px] px-2 py-0.5 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
                            title="Busca a UF de cada CNPJ na BrasilAPI e preenche em massa"
                        >
                            {autoUfRunning ? '⏳ rodando…' : '🔧 Auto-preencher via BrasilAPI'}
                        </button>
                    )}
                    {!isAdmin && <div className="text-xs text-orange-600">bloqueia captura NFe</div>}
                </div>
                <div className="bg-gray-50 border border-gray-300 rounded-lg p-3">
                    <div className="text-xs text-gray-700 font-semibold">Cert A1 próprio</div>
                    <div className="text-2xl font-bold text-gray-900">{r.comCertA1}</div>
                </div>
                <div className="bg-gray-50 border border-gray-300 rounded-lg p-3">
                    <div className="text-xs text-gray-700 font-semibold">Cert A3</div>
                    <div className="text-2xl font-bold text-gray-900">{r.comCertA3}</div>
                </div>
                <div className="bg-gray-50 border border-gray-300 rounded-lg p-3">
                    <div className="text-xs text-gray-700 font-semibold">Procuração e-CAC ativa</div>
                    <div className="text-2xl font-bold text-gray-900">{r.comProcuracaoEcac}</div>
                    <div className="text-xs text-red-700">{r.semProcuracaoEcac} sem</div>
                </div>
                <div className="bg-gray-50 border border-gray-300 rounded-lg p-3">
                    <div className="text-xs text-gray-700 font-semibold">NFSe SP autorizado / Nacional ativo</div>
                    <div className="text-lg font-bold text-gray-900">{r.ccmSpAutorizado} / {r.nfseNacionalAtivo}</div>
                </div>
            </div>

            {/* Filtros */}
            <div className="flex flex-wrap gap-2 items-center bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
                <select value={filtro} onChange={e => setFiltro(e.target.value as FiltroTipo)} className="px-3 py-1.5 text-sm border rounded bg-white">
                    <option value="bloqueadas">🚨 Bloqueadas (qualquer motivo)</option>
                    <option value="sem-uf">Sem UF cadastrada (dadosFiscais.uf)</option>
                    <option value="sem-cert">Sem certificado A1/A3</option>
                    <option value="cert-vencendo">Certificado vence em &lt;30d</option>
                    <option value="sem-procuracao">Sem procuração e-CAC</option>
                    <option value="sem-ccmsp">Sem autorização NFSe SP</option>
                    <option value="nfse-nac-inativa">NFSe Nacional desativada</option>
                    <option value="sem-responsavel">👤 Sem responsável na carteira</option>
                    <option value="ok-tudo">✅ Tudo OK</option>
                    <option value="todas">Todas</option>
                </select>
                <input
                    type="text" placeholder="Buscar por nome ou CNPJ…"
                    value={busca} onChange={e => setBusca(e.target.value)}
                    className="px-3 py-1.5 text-sm border rounded bg-white min-w-[240px]"
                />
                <span className="text-sm text-gray-600 ml-2">
                    {empresasFiltradas.length} de {data.empresas.length}
                </span>
                <div className="ml-auto flex gap-2">
                    <button onClick={load} className="px-3 py-1.5 text-sm bg-gray-200 hover:bg-gray-300 rounded">↻ Atualizar</button>
                    <button onClick={handleExportCsv} className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700">⬇ Exportar CSV</button>
                </div>
            </div>

            {/* Tabela */}
            <div className="overflow-x-auto border rounded-lg">
                <table className="min-w-full text-xs">
                    <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
                        <tr>
                            <th className="px-2 py-2 text-left">CNPJ</th>
                            <th className="px-2 py-2 text-left">Razão Social</th>
                            <th className="px-2 py-2 text-left">Responsável</th>
                            <th className="px-2 py-2 text-center">Cert</th>
                            <th className="px-2 py-2 text-center">Procuração e-CAC</th>
                            <th className="px-2 py-2 text-center">NFSe SP</th>
                            <th className="px-2 py-2 text-center">NFSe Nacional</th>
                            <th className="px-2 py-2 text-center">Capturas</th>
                            <th className="px-2 py-2 text-left">Motivos Bloqueio</th>
                            {isAdmin && <th className="px-2 py-2 text-center">Ações</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {empresasFiltradas.map(e => {
                            const dias = diasAteVencimento(e.certVenceEm);
                            const certCor =
                                e.tipoCert === 'nenhum' ? 'bg-red-100 text-red-800 border-red-300' :
                                !e.certValido ? 'bg-red-100 text-red-800 border-red-300' :
                                dias !== null && dias < 30 ? 'bg-yellow-100 text-yellow-800 border-yellow-300' :
                                'bg-green-100 text-green-800 border-green-300';
                            return (
                                <tr key={e.cnpj} className="border-t hover:bg-gray-50 dark:hover:bg-gray-700">
                                    <td className="px-2 py-1.5 font-mono">{formatCnpj(e.cnpj)}</td>
                                    <td className="px-2 py-1.5">
                                        <div className="font-semibold">{e.nome}</div>
                                        <div className="text-[10px] text-gray-500">{e.regime}</div>
                                    </td>
                                    <td className="px-2 py-1.5">
                                        {(e.responsaveis && e.responsaveis.length > 0) ? (
                                            <div className="flex flex-col gap-0.5">
                                                {e.responsaveis.map((r, i) => (
                                                    <div key={i} className="text-[11px]">
                                                        <span className="font-medium">{r.nome}</span>
                                                        {r.papel === 'backup' && <span className="ml-1 text-[9px] text-gray-500 uppercase">backup</span>}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold">⚠ sem responsável</span>
                                        )}
                                    </td>
                                    <td className="px-2 py-1.5 text-center">
                                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${certCor}`}>
                                            {e.tipoCert === 'nenhum' ? '✗ sem cert' :
                                             e.tipoCert === 'escritorio' ? 'escritório' :
                                             e.tipoCert}
                                        </span>
                                        {e.certVenceEm && (
                                            <div className="text-[10px] text-gray-500 mt-1">
                                                vence {formatDate(e.certVenceEm)}
                                                {dias !== null && dias < 30 && dias >= 0 && <span className="text-yellow-700"> ({dias}d)</span>}
                                                {dias !== null && dias < 0 && <span className="text-red-700"> (vencido)</span>}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-2 py-1.5 text-center">
                                        {isAdmin ? (
                                            <button
                                                disabled={togglingCnpj === e.cnpj + '-procuracaoEcacAtiva'}
                                                onClick={() => handleToggle(e.cnpj, 'procuracaoEcacAtiva', e.procuracaoEcacAtiva)}
                                                className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                                    e.procuracaoEcacAtiva ? 'bg-green-100 text-green-800 border-green-300' : 'bg-red-100 text-red-800 border-red-300'
                                                } hover:opacity-80 disabled:opacity-50`}
                                            >
                                                {togglingCnpj === e.cnpj + '-procuracaoEcacAtiva' ? '…' : e.procuracaoEcacAtiva ? '✓ ativa' : '✗ inativa'}
                                            </button>
                                        ) : (
                                            <Pill ok={e.procuracaoEcacAtiva} label={e.procuracaoEcacAtiva ? 'ativa' : 'inativa'} />
                                        )}
                                    </td>
                                    <td className="px-2 py-1.5 text-center">
                                        <Pill ok={e.nfseSpAutorizado} label={e.nfseSpAutorizado ? 'autorizado' : 'pendente'} />
                                        {e.ccmSp && <div className="text-[10px] text-gray-500 mt-1">CCM: {e.ccmSp}</div>}
                                    </td>
                                    <td className="px-2 py-1.5 text-center">
                                        {isAdmin ? (
                                            <button
                                                disabled={togglingCnpj === e.cnpj + '-nfseNacionalDfeAtivo'}
                                                onClick={() => handleToggle(e.cnpj, 'nfseNacionalDfeAtivo', e.nfseNacionalDfeAtivo)}
                                                className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                                    e.nfseNacionalDfeAtivo ? 'bg-green-100 text-green-800 border-green-300' : 'bg-gray-100 text-gray-700 border-gray-300'
                                                } hover:opacity-80 disabled:opacity-50`}
                                            >
                                                {togglingCnpj === e.cnpj + '-nfseNacionalDfeAtivo' ? '…' : e.nfseNacionalDfeAtivo ? '✓ ativa' : '✗ inativa'}
                                            </button>
                                        ) : (
                                            <Pill ok={e.nfseNacionalDfeAtivo} label={e.nfseNacionalDfeAtivo ? 'ativa' : 'inativa'} />
                                        )}
                                    </td>
                                    <td className="px-2 py-1.5 text-center">
                                        <div className="flex flex-col gap-1 items-center">
                                            <Pill ok={e.capturaNfeOk} label="NFe" />
                                            <Pill ok={e.capturaNfseSpOk} label="NFSe SP" />
                                            <Pill ok={e.capturaNfseNacionalOk} label="NFSe Nac" />
                                        </div>
                                    </td>
                                    <td className="px-2 py-1.5">
                                        {e.motivosBloqueio.length === 0 ? (
                                            <span className="text-green-700 text-xs">✓ Tudo OK</span>
                                        ) : (
                                            <ul className="text-[10px] text-red-700 space-y-0.5">
                                                {e.motivosBloqueio.map((m, i) => <li key={i}>• {m}</li>)}
                                            </ul>
                                        )}
                                    </td>
                                    {isAdmin && (
                                        <td className="px-2 py-1.5 text-center align-top">
                                            <button
                                                onClick={() => handleCaptureOne(e)}
                                                disabled={capturandoCnpj === e.cnpj}
                                                className="px-2 py-1 text-[10px] font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded transition-colors whitespace-nowrap"
                                                title="Dispara /sync-one — NFe DistDFe só pra essa empresa, mostra o resultado aqui mesmo"
                                            >
                                                {capturandoCnpj === e.cnpj ? '⏳…' : '▶ Capturar'}
                                            </button>
                                            {ultimaCaptura[e.cnpj] && (
                                                <div className={`mt-1 text-[10px] font-mono break-words ${
                                                    ultimaCaptura[e.cnpj].ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                                                }`}>
                                                    {ultimaCaptura[e.cnpj].msg}
                                                </div>
                                            )}
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {empresasFiltradas.length === 0 && (
                    <div className="p-6 text-center text-gray-500 text-sm">Nenhuma empresa com esse filtro.</div>
                )}
            </div>

            {isAdmin && (
                <div className="text-xs text-gray-500 mt-2 p-3 bg-gray-50 rounded">
                    💡 Você é admin — pode ligar/desligar <strong>Procuração e-CAC</strong> e <strong>NFSe Nacional</strong> clicando nos botões.
                    Pra subir certificado A1, vá em <strong>Empresas Monitoradas → coluna Certificado</strong>.
                </div>
            )}
        </div>
    );
};

export default EmpresasStatusCapturaPanel;
