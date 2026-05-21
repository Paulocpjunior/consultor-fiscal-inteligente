/**
 * components/NfseNacional/TomadasTab.tsx
 * Aba "Tomadas" — lista NFSe recebidas pelos clientes (captura via Sefin/ADN).
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { User, NfseTomada, NfseTomadaResumo } from '../../types';
import {
    listarNfseTomadas, resumoNfseTomadas, sincronizarNfseTomadaEmpresa,
    getNfseTomadaStatus,
    formatBRL, formatChave,
    modoBadgeClass, manifestacaoBadgeClass,
} from '../../services/nfseTomadaService';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

const TomadasTab: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [docs, setDocs] = useState<NfseTomada[]>([]);
    const [resumo, setResumo] = useState<NfseTomadaResumo | null>(null);
    const [modo, setModo] = useState<string>('—');
    const [loading, setLoading] = useState(false);
    const [sincronizando, setSincronizando] = useState(false);
    const [filtroEmpresa, setFiltroEmpresa] = useState('');
    const [filtroPeriodo, setFiltroPeriodo] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [empresaParaSincronizar, setEmpresaParaSincronizar] = useState({ id: '', cnpj: '' });

    const carregar = async () => {
        setLoading(true);
        try {
            const [status, list, res] = await Promise.all([
                getNfseTomadaStatus(),
                listarNfseTomadas(currentUser, {
                    empresaId: filtroEmpresa || undefined,
                    periodo: filtroPeriodo || undefined,
                    limit: 200,
                }),
                resumoNfseTomadas(currentUser, {
                    empresaId: filtroEmpresa || undefined,
                    periodo: filtroPeriodo || undefined,
                }),
            ]);
            setModo(status.mode);
            setDocs(list);
            setResumo(res);
        } catch (e: any) {
            onShowToast?.(`Erro: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { carregar(); }, [filtroEmpresa, filtroPeriodo]);

    const handleSincronizar = async () => {
        if (!empresaParaSincronizar.id || !empresaParaSincronizar.cnpj) {
            onShowToast?.('Informe empresaId e CNPJ tomador');
            return;
        }
        setSincronizando(true);
        try {
            const r = await sincronizarNfseTomadaEmpresa(
                currentUser,
                empresaParaSincronizar.id,
                empresaParaSincronizar.cnpj,
            );
            onShowToast?.(
                `Sincronizado: ${r.totalNovas} novas, ${r.totalDuplicadas} duplicadas` +
                (r.ultimoErro ? ` (erro: ${r.ultimoErro})` : '')
            );
            await carregar();
        } catch (e: any) {
            onShowToast?.(`Erro: ${e.message}`);
        } finally {
            setSincronizando(false);
        }
    };

    const totaisRetencoes = useMemo(() => {
        return docs.reduce((acc, d) => {
            const r = d.retencoes || {};
            return {
                irrf: acc.irrf + (r.irrf || 0),
                csll: acc.csll + (r.csll || 0),
                pis:  acc.pis  + (r.pis  || 0),
                cofins: acc.cofins + (r.cofins || 0),
                inss: acc.inss + (r.inss || 0),
            };
        }, { irrf: 0, csll: 0, pis: 0, cofins: 0, inss: 0 });
    }, [docs]);

    return (
        <div className="p-4">
            {/* Header com modo */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold dark:text-white">NFSe Tomadas (capturadas via Sefin/ADN)</h2>
                    <span className={`px-3 py-1 text-xs rounded-full font-semibold ${modoBadgeClass(modo)}`}>
                        {modo.toUpperCase()}
                    </span>
                </div>
                <button
                    onClick={carregar}
                    disabled={loading}
                    className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                    {loading ? '⟳ Carregando...' : '↻ Atualizar'}
                </button>
            </div>

            {/* Resumo */}
            {resumo && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                    <Card titulo="Total NFSe" valor={String(resumo.total)} />
                    <Card titulo="Valor Bruto" valor={formatBRL(resumo.valorBruto)} />
                    <Card titulo="Valor Líquido" valor={formatBRL(resumo.valorLiquido)} />
                    <Card titulo="Com Retenção" valor={String(resumo.comRetencao)} />
                    <Card titulo="Pendente Manifestação" valor={String(resumo.pendentesManifestacao)} />
                </div>
            )}

            {/* Box de sincronização manual */}
            <div className="bg-yellow-50 dark:bg-slate-800 border border-yellow-200 dark:border-slate-700 rounded p-4 mb-4">
                <h3 className="font-semibold mb-2 dark:text-white">
                    Sincronizar UMA empresa agora (manual)
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
                    Captura NFSe tomadas via API Sefin/ADN para a empresa.
                    Empresa precisa ter certificado A1 carregado.
                </p>
                <div className="flex gap-2">
                    <input
                        placeholder="empresaId (Firestore doc id)"
                        value={empresaParaSincronizar.id}
                        onChange={(e) => setEmpresaParaSincronizar(s => ({ ...s, id: e.target.value }))}
                        className="flex-1 px-3 py-1.5 border rounded text-sm dark:bg-slate-700 dark:text-white"
                    />
                    <input
                        placeholder="CNPJ tomador (só dígitos)"
                        value={empresaParaSincronizar.cnpj}
                        onChange={(e) => setEmpresaParaSincronizar(s => ({ ...s, cnpj: e.target.value.replace(/\D/g, '') }))}
                        maxLength={14}
                        className="px-3 py-1.5 border rounded text-sm dark:bg-slate-700 dark:text-white"
                    />
                    <button
                        onClick={handleSincronizar}
                        disabled={sincronizando}
                        className="px-4 py-1.5 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700 disabled:opacity-50"
                    >
                        {sincronizando ? '⟳ Sincronizando...' : '⟱ Sincronizar'}
                    </button>
                </div>
            </div>

            {/* Filtros */}
            <div className="flex gap-2 mb-3">
                <input
                    placeholder="Filtrar empresaId"
                    value={filtroEmpresa}
                    onChange={(e) => setFiltroEmpresa(e.target.value)}
                    className="flex-1 px-3 py-1.5 border rounded text-sm dark:bg-slate-700 dark:text-white"
                />
                <input
                    type="month"
                    value={filtroPeriodo}
                    onChange={(e) => setFiltroPeriodo(e.target.value)}
                    className="px-3 py-1.5 border rounded text-sm dark:bg-slate-700 dark:text-white"
                />
            </div>

            {/* Tabela */}
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-slate-100 dark:bg-slate-700">
                        <tr>
                            <th className="text-left p-2 dark:text-white">Data</th>
                            <th className="text-left p-2 dark:text-white">Prestador</th>
                            <th className="text-left p-2 dark:text-white">Descrição</th>
                            <th className="text-right p-2 dark:text-white">Valor</th>
                            <th className="text-right p-2 dark:text-white">ISS</th>
                            <th className="text-left p-2 dark:text-white">Manifestação</th>
                            <th className="text-left p-2 dark:text-white">SharePoint</th>
                        </tr>
                    </thead>
                    <tbody>
                        {docs.length === 0 && !loading && (
                            <tr><td colSpan={7} className="text-center p-6 text-slate-500 dark:text-slate-400">
                                Nenhuma NFSe tomada no filtro. Sincronize uma empresa para começar.
                            </td></tr>
                        )}
                        {docs.map(d => (
                            <tr key={d.id} className="border-b dark:border-slate-700">
                                <td className="p-2 dark:text-white">{d.dataEmissao?.slice(0, 10)}</td>
                                <td className="p-2 dark:text-white">
                                    <div className="font-medium">{d.prestador?.nome || '—'}</div>
                                    <div className="text-xs text-slate-500">{d.prestador?.cnpj || d.prestador?.cpf}</div>
                                </td>
                                <td className="p-2 dark:text-white max-w-xs truncate" title={d.servico?.descricao}>
                                    {d.servico?.descricao || '—'}
                                </td>
                                <td className="p-2 text-right dark:text-white">{formatBRL(d.valorBruto)}</td>
                                <td className="p-2 text-right dark:text-white">{formatBRL(d.servico?.issValor || 0)}</td>
                                <td className="p-2">
                                    <span className={`px-2 py-0.5 text-xs rounded ${manifestacaoBadgeClass(d.manifestacao)}`}>
                                        {d.manifestacao}
                                    </span>
                                </td>
                                <td className="p-2">
                                    {d.sharepointUrl ? (
                                        <a href={d.sharepointUrl} target="_blank" rel="noreferrer"
                                           className="text-blue-600 hover:underline text-xs">
                                            Abrir XML
                                        </a>
                                    ) : <span className="text-slate-400 text-xs">—</span>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Totais retenções */}
            {docs.length > 0 && (
                <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-800 rounded text-sm">
                    <strong className="dark:text-white">Totais de retenções no período: </strong>
                    <span className="text-slate-700 dark:text-slate-300">
                        IRRF {formatBRL(totaisRetencoes.irrf)} •
                        CSLL {formatBRL(totaisRetencoes.csll)} •
                        PIS {formatBRL(totaisRetencoes.pis)} •
                        COFINS {formatBRL(totaisRetencoes.cofins)} •
                        INSS {formatBRL(totaisRetencoes.inss)}
                    </span>
                </div>
            )}
        </div>
    );
};

const Card: React.FC<{ titulo: string; valor: string }> = ({ titulo, valor }) => (
    <div className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded p-3">
        <div className="text-xs text-slate-500 dark:text-slate-400">{titulo}</div>
        <div className="text-lg font-bold dark:text-white">{valor}</div>
    </div>
);

export default TomadasTab;
