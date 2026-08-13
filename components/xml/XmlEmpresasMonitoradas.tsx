import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { User } from '../../types';
import { getEmpresasDisponiveis, type EmpresaXmlOption } from '../../services/xmlFiscalService';
import { isSefazCaptureAvailable } from '../../services/dfeCaptureService';
import { formatCnpjCpf } from '../../services/xmlParserService';

import SefazSyncButton from '../SefazSyncButton';
import CertificadoEmpresaUpload from '../CertificadoEmpresaUpload';

interface Props {
    currentUser: User;
}

const XmlEmpresasMonitoradas: React.FC<Props> = ({ currentUser }) => {
    const [empresas, setEmpresas] = useState<EmpresaXmlOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [certModalFor, setCertModalFor] = useState<EmpresaXmlOption | null>(null);
    const [busca, setBusca] = useState('');
    const [fonteFiltro, setFonteFiltro] = useState<'todas' | 'simples' | 'lucro'>('todas');

    useEffect(() => {
        let alive = true;
        getEmpresasDisponiveis(currentUser).then(list => {
            if (alive) { setEmpresas(list); setLoading(false); }
        });
        return () => { alive = false; };
    }, [currentUser]);

    const empresasFiltradas = useMemo(() => {
        const termo = busca.trim().toLowerCase();
        const termoCnpj = termo.replace(/\D/g, '');
        return empresas.filter(e => {
            if (fonteFiltro !== 'todas') {
                const ehSimples = String((e as any).fonte || '').toLowerCase().startsWith('simples');
                if (fonteFiltro === 'simples' && !ehSimples) return false;
                if (fonteFiltro === 'lucro' && ehSimples) return false;
            }
            if (!termo) return true;
            const nome = (e.nome || '').toLowerCase();
            const cnpj = (e.cnpj || '').replace(/\D/g, '');
            if (nome.includes(termo)) return true;
            if (termoCnpj && cnpj.includes(termoCnpj)) return true;
            return false;
        });
    }, [empresas, busca, fonteFiltro]);

    return (
        <div className="space-y-3">
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
                <p className="text-xs text-emerald-800 dark:text-emerald-300">
                    <strong>Captura SEFAZ ativa.</strong> Cron noturno automático às 02:00 BRT seg-sex.
                    Captura manual disponível das 07:00 às 20:00 BRT (botão verde abaixo).
                    Para NFe DistDFe, use A1 próprio, A1 de outra empresa da mesma raiz CNPJ, ou A3 pelo agente local.
                </p>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <input
                        type="text"
                        placeholder="🔎 Buscar por nome ou CNPJ…"
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        className="md:col-span-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    <select
                        value={fonteFiltro}
                        onChange={(e) => setFonteFiltro(e.target.value as any)}
                        className="bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-xs"
                    >
                        <option value="todas">Regime (todos)</option>
                        <option value="simples">Simples Nacional</option>
                        <option value="lucro">Lucro Presumido/Real</option>
                    </select>
                </div>
                {(busca || fonteFiltro !== 'todas') && (
                    <p className="text-[10px] text-slate-500 mt-2">
                        {empresasFiltradas.length} de {empresas.length} empresa(s) — <button onClick={() => { setBusca(''); setFonteFiltro('todas'); }} className="text-blue-600 hover:underline">limpar filtros</button>
                    </p>
                )}
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">Empresas elegíveis ({empresasFiltradas.length}{empresasFiltradas.length !== empresas.length ? ` de ${empresas.length}` : ''})</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">Lista oriunda dos cadastros de Simples Nacional e Lucro Presumido/Real.</p>
                </div>
                {loading ? <p className="text-center text-xs text-slate-400 py-6">Carregando...</p>
                : empresas.length === 0 ? <p className="text-center text-xs text-slate-400 py-6">Nenhuma empresa disponível para o seu perfil.</p>
                : empresasFiltradas.length === 0 ? <p className="text-center text-xs text-slate-400 py-6">Nenhuma empresa encontrada com o filtro atual.</p>
                : (
                    <div className="overflow-x-auto max-h-[520px]">
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-700 sticky top-0">
                            <tr>
                                <th className="px-3 py-2 text-left text-slate-500 font-bold">Empresa</th>
                                <th className="px-3 py-2 text-left text-slate-500 font-bold">CNPJ</th>
                                <th className="px-3 py-2 text-left text-slate-500 font-bold">Origem</th>
                                <th className="px-3 py-2 text-left text-slate-500 font-bold">Certificado</th>
                                <th className="px-3 py-2 text-left text-slate-500 font-bold">Captura SEFAZ</th>
                                <th className="px-3 py-2 text-left text-slate-500 font-bold">SharePoint</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {empresasFiltradas.map(e => (
                                <tr key={e.id}>
                                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{e.nome}</td>
                                    <td className="px-3 py-2 text-slate-500 font-mono">{formatCnpjCpf(e.cnpj)}</td>
                                    <td className="px-3 py-2 text-slate-500 capitalize">{e.fonte}</td>
                                    <td className="px-3 py-2">
                                        <button
                                            onClick={() => setCertModalFor(e)}
                                            className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline text-[11px]"
                                        >
                                            Gerenciar
                                        </button>
                                    </td>
                                    <td className="px-3 py-2"><SefazSyncButton empresa={e} currentUser={currentUser} /></td>
                                    <td className="px-3 py-2 text-slate-400">Pendente backend</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                )}
            </div>

            {/* Modal certificado — via portal no body pra escapar de ancestrais
                com transform/will-change/filter, que viram containing block de
                position:fixed e jogavam o modal pra fora da tela (top ~8700). */}
            {certModalFor && createPortal(
                <div
                    className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto"
                    onClick={() => setCertModalFor(null)}
                >
                    <div
                        className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto my-auto"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900 z-10">
                            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Certificado Digital A1</h3>
                            <button
                                onClick={() => setCertModalFor(null)}
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl leading-none"
                            >
                                ×
                            </button>
                        </div>
                        <div className="p-5">
                            <CertificadoEmpresaUpload
                                empresaId={certModalFor.id}
                                empresaNome={certModalFor.nome}
                                empresaCnpj={certModalFor.cnpj}
                                onChange={() => { /* hook futuro: atualizar indicador na tabela */ }}
                            />
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default XmlEmpresasMonitoradas;
