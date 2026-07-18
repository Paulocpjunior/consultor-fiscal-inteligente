/**
 * XmlNfseSpCapturadas.tsx
 *
 * Lista das NFSe SP capturadas via cron noturno (CSV portal SP).
 * Mostra serviços tomados (recebidas) + serviços prestados (emitidas) por
 * empresa, com filtros e exportação.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { getAuth } from 'firebase/auth';
import type { User } from '../../types';
import {
    listarNfseSpCapturadas,
    resumoNfseSpCapturadas,
    type NfseSpCapturada,
} from '../../services/nfseSpCapturadasService';
import { fetchCronLogs, type CronLogItem } from '../../services/capturaDiagnosticoService';

interface Props {
    currentUser: User | null;
    refreshKey?: number;
}

const fmtBRL = (n?: number) =>
    typeof n === 'number'
        ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : '—';
const fmtData = (iso?: string) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return iso; }
};
const fmtCnpj = (s?: string) => (s || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

const XmlNfseSpCapturadas: React.FC<Props> = ({ currentUser, refreshKey }) => {
    const [notas, setNotas] = useState<NfseSpCapturada[]>([]);
    const [resumo, setResumo] = useState<any>(null);
    const [ultimoCron, setUltimoCron] = useState<CronLogItem | null | 'erro'>(null);
    const [loading, setLoading] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [direcao, setDirecao] = useState<'todas' | 'saida' | 'entrada'>('todas');
    const [busca, setBusca] = useState('');
    const [cnpjFiltro, setCnpjFiltro] = useState('');
    const [dataInicio, setDataInicio] = useState('');
    const [dataFim, setDataFim] = useState('');
    const [corrigindo, setCorrigindo] = useState(false);
    const [msgCorrecao, setMsgCorrecao] = useState<string | null>(null);
    const isAdmin = currentUser?.role === 'admin';

    const corrigirDirecoes = async () => {
        if (!confirm('Corrigir direção de TODAS as NFSe importadas? Pode levar 1-2 min. Ok?')) return;
        setCorrigindo(true);
        setMsgCorrecao(null);
        try {
            const token = await getAuth().currentUser?.getIdToken();
            const r = await fetch('/api/admin/sefaz/nfsesp-corrigir-direcoes', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: '{}',
            });
            const d = await r.json();
            if (r.ok) {
                setMsgCorrecao('✅ Correção iniciada. Aguarde 1-2 min e clique Atualizar.');
                setTimeout(carregar, 90000);
            } else {
                setMsgCorrecao(`❌ ${d.erro || 'Falha'}`);
            }
        } catch (e: any) {
            setMsgCorrecao(`❌ ${e.message}`);
        } finally {
            setCorrigindo(false);
        }
    };

    const carregar = async () => {
        if (!currentUser) return;
        setLoading(true);
        setErro(null);
        try {
            const [lista, r, cronLogs] = await Promise.all([
                listarNfseSpCapturadas({
                    direcao,
                    empresaCnpj: cnpjFiltro.replace(/\D/g, '') || undefined,
                    dataInicio: dataInicio || undefined,
                    dataFim: dataFim || undefined,
                    limite: 5000,
                }),
                resumoNfseSpCapturadas(),
                fetchCronLogs('nfsesp_cron_logs', 1).catch(() => [] as CronLogItem[]),
            ]);
            setNotas(lista);
            setResumo(r);
            setUltimoCron(cronLogs[0] || 'erro');
        } catch (e: any) {
            setErro(e.message || 'Falha ao carregar NFSe');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [refreshKey, direcao]);

    // Calcula direção EFETIVA por nota com base no CNPJ do filtro.
    // Sem filtro de CNPJ → usa direção do doc (pra resumo de escritório).
    const cnpjPivot = cnpjFiltro.replace(/\D/g, '');
    const calcDirecaoEfetiva = (n: NfseSpCapturada): 'saida' | 'entrada' => {
        if (cnpjPivot.length !== 14) return (n.direcao as any) || 'entrada';
        const cnpjP = (n.prestadorCnpj || '').replace(/\D/g, '');
        return cnpjP === cnpjPivot ? 'saida' : 'entrada';
    };

    const filtradas = useMemo(() => {
        let lista = notas;
        if (busca) {
            const b = busca.toLowerCase();
            lista = lista.filter(n =>
                (n.numero || '').includes(b) ||
                (n.prestadorNome || '').toLowerCase().includes(b) ||
                (n.tomadorNome || '').toLowerCase().includes(b) ||
                (n.descricao || '').toLowerCase().includes(b)
            );
        }
        return lista;
    }, [notas, busca]);

    const exportarCsv = () => {
        const headers = ['Direção', 'Número', 'Data', 'Prestador CNPJ', 'Prestador Nome', 'Tomador CNPJ', 'Tomador Nome', 'Valor Serviços', 'ISS', 'Cód Serviço', 'Discriminação'];
        const rows = filtradas.map(n => [
            calcDirecaoEfetiva(n) === 'saida' ? 'Emitida' : 'Recebida',
            n.numero,
            fmtData(n.dhEmi),
            fmtCnpj(n.prestadorCnpj),
            (n.prestadorNome || '').replace(/"/g, '""'),
            fmtCnpj(n.tomadorCnpj),
            (n.tomadorNome || '').replace(/"/g, '""'),
            (n.valorServicos || 0).toFixed(2).replace('.', ','),
            (n.issDevido || 0).toFixed(2).replace('.', ','),
            n.codigoServico || '',
            (n.descricao || '').replace(/"/g, '""'),
        ].map(c => `"${c}"`).join(';'));
        const csv = [headers.join(';'), ...rows].join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nfse-sp-capturadas-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-4">
            <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-4 rounded-lg text-white">
                <h3 className="font-bold">📋 NFSe SP capturadas (tomados + prestados)</h3>
                <p className="text-xs text-indigo-100 mt-1">
                    Notas baixadas automaticamente do portal nfe.prefeitura.sp.gov.br via cron noturno (cert A1).
                </p>
            </div>

            {resumo && (
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                    <div className="bg-white border rounded p-3">
                        <div className="text-xs text-gray-500">Total NFs</div>
                        <div className="text-2xl font-bold">{resumo.total}</div>
                    </div>
                    <div className="bg-green-50 border border-green-200 rounded p-3">
                        <div className="text-xs text-green-700">📤 Emitidas (prestados)</div>
                        <div className="text-2xl font-bold text-green-800">{resumo.emitidas}</div>
                        <div className="text-xs text-green-600">{fmtBRL(resumo.valorEmitidasTotal)}</div>
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded p-3">
                        <div className="text-xs text-blue-700">📥 Recebidas (tomados)</div>
                        <div className="text-2xl font-bold text-blue-800">{resumo.recebidas}</div>
                        <div className="text-xs text-blue-600">{fmtBRL(resumo.valorRecebidasTotal)}</div>
                    </div>
                    <div className="bg-purple-50 border border-purple-200 rounded p-3">
                        <div className="text-xs text-purple-700">Empresas únicas</div>
                        <div className="text-2xl font-bold text-purple-800">{resumo.empresasUnicas}</div>
                    </div>
                    <div className="bg-gray-50 border border-gray-200 rounded p-3" title="Data de emissão da nota mais recente já capturada (não é a hora do cron — pode haver dias sem notas novas)">
                        <div className="text-xs text-gray-700">Última nota</div>
                        <div className="text-sm font-bold text-gray-800">{fmtData(resumo.ultimaCaptura)}</div>
                        <div className="text-[10px] text-gray-500">data de emissão</div>
                    </div>
                    {(() => {
                        const cron = ultimoCron;
                        if (cron === null) {
                            return (
                                <div className="bg-gray-50 border border-gray-200 rounded p-3">
                                    <div className="text-xs text-gray-700">Último cron</div>
                                    <div className="text-sm font-bold text-gray-400">…</div>
                                </div>
                            );
                        }
                        if (cron === 'erro' || !cron || !cron.executadoEmMs) {
                            return (
                                <div className="bg-red-50 border border-red-200 rounded p-3" title="Nenhum log de execução do cron encontrado em nfsesp_cron_logs. Cron pode estar desabilitado no Cloud Scheduler ou retornando 403 (secret drift).">
                                    <div className="text-xs text-red-700">Último cron</div>
                                    <div className="text-sm font-bold text-red-800">sem registro</div>
                                </div>
                            );
                        }
                        const dt = new Date(cron.executadoEmMs);
                        const erro = !!cron.erroFatal;
                        const semNovas = !erro && (cron.totalNovos ?? 0) === 0;
                        const cor = erro
                            ? 'bg-red-50 border-red-200 text-red-800'
                            : semNovas
                                ? 'bg-amber-50 border-amber-200 text-amber-800'
                                : 'bg-emerald-50 border-emerald-200 text-emerald-800';
                        const tituloCor = erro ? 'text-red-700' : semNovas ? 'text-amber-700' : 'text-emerald-700';
                        return (
                            <div className={`border rounded p-3 ${cor}`} title={erro ? `Falha: ${cron.erroFatal}` : `Login: ${cron.metodoLogin || '—'} · ${cron.processadas ?? 0} empresas processadas`}>
                                <div className={`text-xs ${tituloCor}`}>Último cron</div>
                                <div className="text-sm font-bold">{dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                                <div className="text-[10px]">
                                    {erro ? '❌ erro fatal' : semNovas ? `⚠ 0 novas (${cron.processadas ?? 0} empresas)` : `✓ ${cron.totalNovos} novas`}
                                </div>
                            </div>
                        );
                    })()}
                </div>
            )}

            <div className="flex flex-wrap gap-2 items-end bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
                <div>
                    <label className="text-xs font-semibold block">Direção</label>
                    <select
                        value={direcao}
                        onChange={(e) => setDirecao(e.target.value as any)}
                        className="px-2 py-1 text-sm border border-slate-300 rounded bg-white text-slate-900"
                    >
                        <option value="todas">Todas</option>
                        <option value="saida">📤 Emitidas (prestados)</option>
                        <option value="entrada">📥 Recebidas (tomados)</option>
                    </select>
                </div>
                <div>
                    <label className="text-xs font-semibold block">CNPJ empresa</label>
                    <input
                        type="text"
                        value={cnpjFiltro}
                        onChange={(e) => setCnpjFiltro(e.target.value)}
                        placeholder="44.388.152/0001-89"
                        className="px-2 py-1 text-sm border border-slate-300 rounded bg-white text-slate-900 placeholder-slate-400 w-44"
                    />
                </div>
                <div>
                    <label className="text-xs font-semibold block">Data início</label>
                    <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="px-2 py-1 text-sm border border-slate-300 rounded bg-white text-slate-900" />
                </div>
                <div>
                    <label className="text-xs font-semibold block">Data fim</label>
                    <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="px-2 py-1 text-sm border border-slate-300 rounded bg-white text-slate-900" />
                </div>
                <div>
                    <label className="text-xs font-semibold block">Buscar</label>
                    <input
                        type="text"
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        placeholder="número, prestador, tomador, descrição"
                        className="px-2 py-1 text-sm border border-slate-300 rounded bg-white text-slate-900 placeholder-slate-400 w-72"
                    />
                </div>
                <button onClick={carregar} className="px-3 py-1.5 text-sm bg-gray-200 hover:bg-gray-300 rounded">↻ Atualizar</button>
                <button onClick={exportarCsv} className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700">⬇ Exportar CSV</button>
                {isAdmin && (
                    <button
                        onClick={corrigirDirecoes}
                        disabled={corrigindo}
                        className="px-3 py-1.5 text-sm bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
                        title="Recalcula direção (emitida/recebida) pelos CNPJs reais — corrige notas marcadas erradas"
                    >
                        {corrigindo ? '⏳ Corrigindo…' : '🔧 Corrigir direções'}
                    </button>
                )}
                <span className="text-sm text-gray-600 ml-auto">
                    {filtradas.length} de {notas.length} carregadas
                </span>
            </div>

            {loading && <p className="text-sm text-gray-500">Carregando…</p>}
            {msgCorrecao && (
                <div className="p-3 bg-orange-50 border border-orange-300 rounded text-orange-800 text-sm">
                    {msgCorrecao}
                </div>
            )}
            {erro && (
                <div className="p-3 bg-red-50 border border-red-300 rounded text-red-700 text-sm">
                    {erro}
                </div>
            )}

            {!loading && !erro && (
                <div className="overflow-x-auto border rounded">
                    <table className="min-w-full text-xs">
                        <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
                            <tr>
                                <th className="px-2 py-2 text-center">Dir</th>
                                <th className="px-2 py-2 text-left">Nº NFSe</th>
                                <th className="px-2 py-2 text-left">Data</th>
                                <th className="px-2 py-2 text-left">Prestador</th>
                                <th className="px-2 py-2 text-left">Tomador</th>
                                <th className="px-2 py-2 text-right">Valor</th>
                                <th className="px-2 py-2 text-right">ISS</th>
                                <th className="px-2 py-2 text-left">Discriminação</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtradas.map(n => {
                                const dirEf = calcDirecaoEfetiva(n);
                                return (
                                <tr key={n.id} className="border-t hover:bg-gray-50 dark:hover:bg-gray-700">
                                    <td className="px-2 py-1.5 text-center">
                                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${dirEf === 'saida' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                                            {dirEf === 'saida' ? '📤 EM' : '📥 RC'}
                                        </span>
                                    </td>
                                    <td className="px-2 py-1.5 font-mono">{n.numero}</td>
                                    <td className="px-2 py-1.5">{fmtData(n.dhEmi)}</td>
                                    <td className="px-2 py-1.5">
                                        <div className="font-semibold">{n.prestadorNome}</div>
                                        <div className="text-[10px] text-gray-500">{fmtCnpj(n.prestadorCnpj)}</div>
                                    </td>
                                    <td className="px-2 py-1.5">
                                        <div className="font-semibold">{n.tomadorNome}</div>
                                        <div className="text-[10px] text-gray-500">{fmtCnpj(n.tomadorCnpj)}</div>
                                    </td>
                                    <td className="px-2 py-1.5 text-right font-mono font-semibold">{fmtBRL(n.valorServicos)}</td>
                                    <td className="px-2 py-1.5 text-right font-mono text-gray-600">{fmtBRL(n.issDevido)}</td>
                                    <td className="px-2 py-1.5 max-w-md truncate" title={n.descricao}>{n.descricao || '—'}</td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {filtradas.length === 0 && (
                        <div className="p-6 text-center text-gray-500 text-sm">
                            Nenhuma NFSe encontrada com esses filtros. Aguarde o cron noturno terminar a captura.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default XmlNfseSpCapturadas;
