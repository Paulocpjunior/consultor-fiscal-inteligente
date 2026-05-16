/**
 * components/Prontidao/index.tsx
 *
 * Modulo Prontidao SERPRO — visao consolidada de certificado + procuracao
 * por empresa. Serve DCTFWeb, Caixa Postal, DAS — tudo que exige cert/procuracao.
 *
 * Fatia 1: certificado com dado real (empresas_certificados).
 *          procuracao = 'nao_testado' ate a Fatia 2 popular via chamadas SERPRO.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { User } from '../../types';
import {
    getProntidao,
    certBadge,
    procuracaoBadge,
    type ProntidaoEmpresa,
} from '../../services/prontidaoService';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

const ProntidaoDashboard: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [empresas, setEmpresas] = useState<ProntidaoEmpresa[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filtro, setFiltro] = useState('');

    const carregar = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const resp = await getProntidao(currentUser);
            setEmpresas(resp.empresas || []);
        } catch (e: any) {
            setError(e?.message || 'Falha ao carregar prontidao');
            onShowToast?.('Erro ao carregar Prontidao SERPRO');
        } finally {
            setLoading(false);
        }
    }, [currentUser, onShowToast]);

    useEffect(() => { carregar(); }, [carregar]);

    const listaFiltrada = useMemo(() => {
        const q = filtro.trim().toLowerCase();
        if (!q) return empresas;
        return empresas.filter(e =>
            (e.nome || '').toLowerCase().includes(q) ||
            (e.cnpj || '').toLowerCase().includes(q) ||
            (e.empresaId || '').toLowerCase().includes(q)
        );
    }, [empresas, filtro]);

    const resumo = useMemo(() => {
        let validos = 0, vencendo = 0, vencidos = 0;
        empresas.forEach(e => {
            if (e.cert.status === 'valido') validos++;
            else if (e.cert.status === 'vencendo') vencendo++;
            else if (e.cert.status === 'vencido') vencidos++;
        });
        return { validos, vencendo, vencidos, total: empresas.length };
    }, [empresas]);

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-semibold text-white">Prontidao SERPRO</h2>
                <p className="text-sm text-slate-400 mt-1">
                    Visao consolidada de certificado digital e procuracao e-CAC por empresa.
                    Necessario para DCTFWeb, Caixa Postal e DAS.
                </p>
            </div>

            {/* Cards resumo */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-xl bg-slate-800/60 p-4">
                    <div className="text-xs text-slate-400">Empresas com certificado</div>
                    <div className="text-2xl font-bold text-white">{resumo.total}</div>
                </div>
                <div className="rounded-xl bg-green-500/10 p-4">
                    <div className="text-xs text-green-300">Certificados validos</div>
                    <div className="text-2xl font-bold text-green-300">{resumo.validos}</div>
                </div>
                <div className="rounded-xl bg-yellow-500/10 p-4">
                    <div className="text-xs text-yellow-300">Vencendo (30 dias)</div>
                    <div className="text-2xl font-bold text-yellow-300">{resumo.vencendo}</div>
                </div>
                <div className="rounded-xl bg-red-500/10 p-4">
                    <div className="text-xs text-red-300">Vencidos</div>
                    <div className="text-2xl font-bold text-red-300">{resumo.vencidos}</div>
                </div>
            </div>

            {/* Barra de acoes */}
            <div className="flex items-center gap-3">
                <input
                    type="text"
                    value={filtro}
                    onChange={e => setFiltro(e.target.value)}
                    placeholder="Filtrar por nome ou CNPJ..."
                    className="flex-1 rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white"
                />
                <button
                    onClick={carregar}
                    disabled={loading}
                    className="rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm text-white disabled:opacity-50"
                >
                    {loading ? 'Carregando...' : 'Recarregar'}
                </button>
            </div>

            {error && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-300">
                    {error}
                </div>
            )}

            {/* Tabela */}
            <div className="rounded-xl border border-slate-700 overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-slate-800/80 text-slate-400">
                        <tr>
                            <th className="text-left px-4 py-3">Empresa</th>
                            <th className="text-left px-4 py-3">CNPJ</th>
                            <th className="text-left px-4 py-3">Certificado</th>
                            <th className="text-left px-4 py-3">Validade</th>
                            <th className="text-left px-4 py-3">Procuracao e-CAC</th>
                        </tr>
                    </thead>
                    <tbody>
                        {listaFiltrada.length === 0 && !loading && (
                            <tr>
                                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                                    Nenhuma empresa com certificado cadastrado.
                                </td>
                            </tr>
                        )}
                        {listaFiltrada.map(emp => {
                            const cb = certBadge(emp.cert.status);
                            const pb = procuracaoBadge(emp.procuracao.status);
                            return (
                                <tr key={emp.empresaId} className="border-t border-slate-800">
                                    <td className="px-4 py-3 text-white">
                                        {emp.nome || <span className="text-slate-500">Sem nome</span>}
                                    </td>
                                    <td className="px-4 py-3 text-slate-400 text-xs">
                                        {emp.cnpj || emp.empresaId}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`rounded-full px-2 py-0.5 text-xs ${cb.cls}`}>
                                            {cb.label}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-slate-300">
                                        {emp.cert.notAfter
                                            ? new Date(emp.cert.notAfter).toLocaleDateString('pt-BR')
                                            : '-'}
                                        {emp.cert.diasRestantes != null && (
                                            <span className="text-slate-500 ml-2">
                                                ({emp.cert.diasRestantes}d)
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`rounded-full px-2 py-0.5 text-xs ${pb.cls}`}>
                                            {pb.label}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <p className="text-xs text-slate-500">
                Procuracao e-CAC: o status sera preenchido automaticamente conforme as
                operacoes SERPRO forem executadas (Fatia 2). Por ora exibe "Nao testado".
            </p>
        </div>
    );
};

export default ProntidaoDashboard;
