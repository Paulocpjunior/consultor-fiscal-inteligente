/**
 * AbrasfAdapterPanel — painel BETA do adapter ABRASF v2.
 *
 * Cobre municipios que ainda NAO migraram para o Padrao Nacional (NFSe DFe).
 * Caminho B da estrategia: 1 cliente SOAP generico falando ABRASF v2.02-2.04
 * que serve a maioria das prefeituras grandes.
 *
 * Limites desta v1:
 *   - Sem assinatura XML-DSig automatica (algumas cidades exigem)
 *   - 3 municipios suportados na inicial (Barueri, Santos, Curitiba)
 *   - Sem cron - sync manual sob demanda
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
    getMunicipios, getStatus, syncTodas,
    type MunicipioAbrasf, type AbrasfStatus,
} from '../../services/abrasfAdapterService';

interface Props {
    onShowToast?: (msg: string) => void;
}

const AbrasfAdapterPanel: React.FC<Props> = ({ onShowToast }) => {
    const [municipios, setMunicipios] = useState<MunicipioAbrasf[]>([]);
    const [status, setStatus] = useState<AbrasfStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [sincronizando, setSincronizando] = useState(false);
    const [dataInicial, setDataInicial] = useState(() => {
        const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10);
    });
    const [dataFinal, setDataFinal] = useState(() => new Date().toISOString().slice(0, 10));

    const carregar = useCallback(async () => {
        setLoading(true); setErro(null);
        try {
            const [muns, st] = await Promise.all([getMunicipios(), getStatus()]);
            setMunicipios(muns);
            setStatus(st);
        } catch (e: any) {
            setErro(e?.message || 'Falha ao carregar');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { carregar(); }, [carregar]);

    const handleSyncTodas = async () => {
        setSincronizando(true);
        try {
            const r = await syncTodas(dataInicial, dataFinal);
            onShowToast?.(
                `Sync ABRASF: ${r.processadas}/${r.totalEmpresas} OK`
                + (r.falhas ? ` · ${r.falhas} falha(s)` : '')
            );
            await carregar();
        } catch (e: any) {
            onShowToast?.(`Erro: ${e?.message || 'falha'}`);
        } finally {
            setSincronizando(false);
        }
    };

    if (loading) return <div className="p-6 text-center text-slate-500">Carregando…</div>;
    if (erro) return <div className="p-6 text-center text-red-600">Erro: {erro}</div>;
    if (!status) return null;

    return (
        <div className="space-y-4">
            {/* Aviso BETA */}
            <div className="p-4 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700">
                <div className="flex items-start gap-3">
                    <div className="text-2xl">🧪</div>
                    <div className="text-sm">
                        <p className="font-bold text-amber-800 dark:text-amber-200">Adapter ABRASF v2 — BETA</p>
                        <p className="mt-1 text-amber-700 dark:text-amber-300">
                            Captura NFS-e em municípios que <b>ainda não migraram</b> para o Padrão Nacional.
                            Use o painel <b>Cobertura ADN</b> sempre que possível — só caia neste adapter para
                            cidades que ainda não aderiram. Algumas prefeituras exigem assinatura XML-DSig
                            (em desenvolvimento) — empresas dessas cidades vão receber erro de assinatura.
                        </p>
                    </div>
                </div>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card label="Municípios suportados" valor={String(status.municipiosSuportados)} />
                <Card label="Empresas elegíveis" valor={String(status.empresasElegiveis)} />
                <Card label="Habilitadas" valor={String(status.empresasHabilitadas)} cor="emerald" />
                <Card label="A habilitar" valor={String(status.empresasElegiveis - status.empresasHabilitadas)} cor="amber" />
            </div>

            {/* Municípios suportados */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800 font-bold text-sm">
                    📍 Municípios suportados pelo adapter
                </div>
                <table className="w-full text-sm">
                    <thead className="bg-slate-100 dark:bg-slate-800/70 text-xs text-slate-600">
                        <tr>
                            <th className="px-3 py-2 text-left">UF</th>
                            <th className="px-3 py-2 text-left">Município</th>
                            <th className="px-3 py-2 text-left">IBGE</th>
                            <th className="px-3 py-2 text-left">Versão ABRASF</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {municipios.map(m => (
                            <tr key={m.codIBGE}>
                                <td className="px-3 py-2 font-bold">{m.uf}</td>
                                <td className="px-3 py-2">{m.nome}</td>
                                <td className="px-3 py-2 text-xs text-slate-500">{m.codIBGE}</td>
                                <td className="px-3 py-2 text-xs"><code>{m.versao}</code></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Sync manual */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h3 className="font-bold text-sm">Sincronizar empresas habilitadas</h3>
                <div className="flex flex-wrap gap-3 items-end">
                    <div>
                        <label className="block text-xs text-slate-500 mb-1">Data inicial</label>
                        <input type="date" value={dataInicial} onChange={e => setDataInicial(e.target.value)}
                            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm" />
                    </div>
                    <div>
                        <label className="block text-xs text-slate-500 mb-1">Data final</label>
                        <input type="date" value={dataFinal} onChange={e => setDataFinal(e.target.value)}
                            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm" />
                    </div>
                    <button onClick={handleSyncTodas} disabled={sincronizando}
                        className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold rounded-lg disabled:opacity-50">
                        {sincronizando ? 'Sincronizando…' : 'Sync TODAS'}
                    </button>
                </div>
            </div>

            {/* Últimas sincronizações */}
            {status.ultimasSincronizacoes.length > 0 && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800 font-bold text-sm">
                        🕐 Últimas sincronizações
                    </div>
                    <table className="w-full text-sm">
                        <thead className="bg-slate-100 dark:bg-slate-800/70 text-xs text-slate-600">
                            <tr>
                                <th className="px-3 py-2 text-left">Empresa</th>
                                <th className="px-3 py-2 text-left">Município</th>
                                <th className="px-3 py-2 text-left">Período</th>
                                <th className="px-3 py-2 text-left">Quando</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {status.ultimasSincronizacoes.map(s => (
                                <tr key={s.empresaId}>
                                    <td className="px-3 py-2 text-xs">{s.empresaCnpj}</td>
                                    <td className="px-3 py-2 text-xs text-slate-500">{s.codMunIBGE}</td>
                                    <td className="px-3 py-2 text-xs">
                                        {s.ultimoPeriodo ? `${s.ultimoPeriodo.dataInicial} → ${s.ultimoPeriodo.dataFinal}` : '—'}
                                    </td>
                                    <td className="px-3 py-2 text-xs text-slate-500">
                                        {s.ultimaSync ? new Date(s.ultimaSync).toLocaleString('pt-BR') : '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <p className="text-xs text-slate-500">
                💡 Para habilitar uma empresa: <code>POST /api/admin/abrasf/toggle/[empresaId]</code> com{' '}
                <code>{`{ ativo: true }`}</code>. UI completa de habilitação por empresa virá em iteração seguinte.
            </p>
        </div>
    );
};

const Card: React.FC<{ label: string; valor: string; cor?: 'emerald' | 'amber' | 'red' }> = ({ label, valor, cor }) => {
    const corCls = cor === 'emerald' ? 'text-emerald-600' : cor === 'amber' ? 'text-amber-600' : cor === 'red' ? 'text-red-600' : 'text-slate-800 dark:text-slate-100';
    return (
        <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <div className="text-xs text-slate-500 mb-1">{label}</div>
            <div className={`text-xl font-bold ${corCls}`}>{valor}</div>
        </div>
    );
};

export default AbrasfAdapterPanel;
