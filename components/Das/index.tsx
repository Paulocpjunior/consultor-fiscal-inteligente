/**
 * components/Das/index.tsx
 * Dashboard "Central de DAS" — gestao global de DAS Simples Nacional.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { User, DasEmitido, DasResumo, DasStatusPagamento, SimplesNacionalEmpresa } from '../../types';
import {
    getResumoDas, listarDas, marcarDasPago, emitirDasAvulso,
    formatBRL, formatBarras, parseValorMoedaBr, statusBadgeClass, statusLabel,
} from '../../services/dasService';
import { getEmpresas as getEmpresasSimples } from '../../services/simplesNacionalService';
import CobrancaModal from './CobrancaModal';
import EnviosHistoricoModal from './EnviosHistoricoModal';

interface Props {
    currentUser: User | null;
    onShowToast?: (msg: string) => void;
}

const DasDashboard: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [resumo, setResumo] = useState<DasResumo | null>(null);
    const [docs, setDocs] = useState<DasEmitido[]>([]);
    const [empresas, setEmpresas] = useState<SimplesNacionalEmpresa[]>([]);
    const [loading, setLoading] = useState(false);
    const [filtroStatus, setFiltroStatus] = useState<DasStatusPagamento | ''>('');
    const [filtroEmpresa, setFiltroEmpresa] = useState('');
    const [selecionado, setSelecionado] = useState<DasEmitido | null>(null);
    const [cobrancaDas, setCobrancaDas] = useState<DasEmitido | null>(null);
    const [mostrarFormAvulso, setMostrarFormAvulso] = useState(false);
    // null = fechado; '' = aberto sem filtro; 'NNNNNNNNNNNNNN' = aberto filtrado por CNPJ
    const [historicoEnviosCnpj, setHistoricoEnviosCnpj] = useState<string | null>(null);

    // Form avulso
    const [novoEmpresaId, setNovoEmpresaId] = useState('');
    const [novoCompetencia, setNovoCompetencia] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const [novoValor, setNovoValor] = useState<string>('');
    const [novoDescricao, setNovoDescricao] = useState('');
    const [emitindo, setEmitindo] = useState(false);

    const carregar = async (overrides: { status?: DasStatusPagamento | ''; empresaId?: string } = {}) => {
        setLoading(true);
        try {
            const statusFiltro = overrides.status !== undefined ? overrides.status : filtroStatus;
            const empresaFiltro = overrides.empresaId !== undefined ? overrides.empresaId : filtroEmpresa;
            const [r, d, e] = await Promise.all([
                getResumoDas(currentUser),
                listarDas(currentUser, {
                    status: statusFiltro || undefined,
                    empresaId: empresaFiltro || undefined,
                }),
                getEmpresasSimples(currentUser),
            ]);
            setResumo(r);
            setDocs(d);
            setEmpresas(e);
            return { resumo: r, docs: d, empresas: e };
        } catch (err: any) {
            onShowToast?.(`Erro: ${err.message}`);
            return null;
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { carregar(); }, [filtroStatus, filtroEmpresa]);

    const valorEmCentavos = (valor: number): number => Math.round((Number(valor) || 0) * 100);
    const cnpjLimpo = (cnpj: string): string => String(cnpj || '').replace(/\D/g, '');

    const formatDataEnvio = (iso: string, curto = false): string => {
        try {
            const d = new Date(iso);
            return curto
                ? d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        } catch {
            return iso;
        }
    };

    const temDuplicidade = (doc: DasEmitido, lista: DasEmitido[] = docs): boolean => {
        const chaveCnpj = cnpjLimpo(doc.empresaCnpj);
        const chaveValor = valorEmCentavos(doc.valor);
        return lista.some(outro => (
            outro.id !== doc.id
            && cnpjLimpo(outro.empresaCnpj) === chaveCnpj
            && outro.competencia === doc.competencia
            && valorEmCentavos(outro.valor) === chaveValor
        ));
    };

    const encontrarConflitoAvulso = (existentes: DasEmitido[], valor: number): DasEmitido | null => {
        return existentes.find(doc => {
            const statusAtivo = doc.statusPagamento === 'pendente' || doc.statusPagamento === 'vencido';
            const valorIgual = valorEmCentavos(doc.valor) === valorEmCentavos(valor);
            if (doc.tipo === 'regular' && statusAtivo) return true;
            if (doc.tipo === 'regular' && valorIgual) return true;
            if (doc.tipo === 'avulso' && statusAtivo && valorIgual) return true;
            return false;
        }) || null;
    };

    const focarGuia = async (doc: DasEmitido, mensagem?: string) => {
        const status = doc.statusPagamento || 'pendente';
        setFiltroEmpresa(doc.empresaId);
        setFiltroStatus(status);
        setSelecionado(doc);
        await carregar({ empresaId: doc.empresaId, status });
        if (mensagem) onShowToast?.(mensagem);
    };

    const handleMarcarPago = async (doc: DasEmitido) => {
        try {
            await marcarDasPago(currentUser, doc.id);
            await carregar();
            setSelecionado(null);
            onShowToast?.('DAS marcado como pago');
        } catch (e: any) {
            onShowToast?.(`Erro: ${e.message}`);
        }
    };

    const handleEmitirAvulso = async () => {
        const empresa = empresas.find(e => e.id === novoEmpresaId);
        if (!empresa) return onShowToast?.('Selecione uma empresa');
        const valor = parseValorMoedaBr(novoValor);
        if (!valor || valor < 10) return onShowToast?.('Valor mínimo R$ 10,00');

        setEmitindo(true);
        try {
            const existentes = await listarDas(currentUser, {
                empresaId: empresa.id,
                competencia: novoCompetencia,
            });
            const conflito = encontrarConflitoAvulso(existentes, valor);
            if (conflito) {
                setMostrarFormAvulso(false);
                await focarGuia(
                    conflito,
                    `Ja existe DAS ${conflito.tipo} ${statusLabel(conflito.statusPagamento)} para esta competencia. Abri a guia existente.`
                );
                return;
            }

            const emitido = await emitirDasAvulso(currentUser, {
                empresaId: empresa.id,
                empresaCnpj: empresa.cnpj,
                empresaNome: empresa.nome,
                competencia: novoCompetencia,
                valor,
                descricao: novoDescricao,
            });
            setMostrarFormAvulso(false);
            setNovoEmpresaId('');
            setNovoValor('');
            setNovoDescricao('');
            await focarGuia(
                emitido,
                `DAS Avulso emitido e aberto em Painel DAS > ${statusLabel(emitido.statusPagamento)}.`
            );
        } catch (e: any) {
            onShowToast?.(`Erro: ${e.message}`);
        } finally {
            setEmitindo(false);
        }
    };

    const cards = useMemo(() => {
        if (!resumo) return [];
        return [
            { label: 'Total', valor: resumo.totalDas, cor: 'bg-slate-100 dark:bg-slate-700', clave: '' },
            { label: 'Pendentes', valor: resumo.pendentes, valorBRL: resumo.valorPendente, cor: 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300', clave: 'pendente' as DasStatusPagamento },
            { label: 'Vencidos', valor: resumo.vencidos, valorBRL: resumo.valorVencido, valorExtra: (resumo.valorMultaEstimada && resumo.valorMultaEstimada > 0) ? `+ ${formatBRL(resumo.valorMultaEstimada)} mora` : undefined, cor: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300', clave: 'vencido' as DasStatusPagamento },
            { label: 'Pagos', valor: resumo.pagos, valorBRL: resumo.valorPago, cor: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300', clave: 'pago' as DasStatusPagamento },
        ];
    }, [resumo]);

    const copiarBarras = (b: string) => {
        navigator.clipboard?.writeText(b).then(
            () => onShowToast?.('Codigo de barras copiado'),
            () => onShowToast?.('Falha ao copiar')
        );
    };

    const nomeArquivoDas = (doc: DasEmitido): string => {
        const cnpj = cnpjLimpo(doc.empresaCnpj) || 'empresa';
        return `das_${cnpj}_${doc.competencia}_${doc.tipo}.pdf`;
    };

    const pdfBlobFromBase64 = (base64: string): Blob => {
        const clean = base64.includes(',') ? base64.split(',').pop() || '' : base64;
        const byteChars = atob(clean);
        const bytes = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
            bytes[i] = byteChars.charCodeAt(i);
        }
        return new Blob([bytes], { type: 'application/pdf' });
    };

    const abrirPdfDas = (doc: DasEmitido) => {
        if (doc.pdfUrl) {
            window.open(doc.pdfUrl, '_blank', 'noopener');
            return;
        }
        if (!doc.pdfBase64) {
            onShowToast?.('PDF nao retornado pelo SERPRO para esta guia.');
            return;
        }
        const url = URL.createObjectURL(pdfBlobFromBase64(doc.pdfBase64));
        window.open(url, '_blank', 'noopener');
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    };

    const baixarPdfDas = (doc: DasEmitido) => {
        if (doc.pdfUrl) {
            window.open(doc.pdfUrl, '_blank', 'noopener');
            return;
        }
        if (!doc.pdfBase64) {
            onShowToast?.('PDF nao retornado pelo SERPRO para esta guia.');
            return;
        }
        const url = URL.createObjectURL(pdfBlobFromBase64(doc.pdfBase64));
        const a = document.createElement('a');
        a.href = url;
        a.download = nomeArquivoDas(doc);
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">💸 Central de DAS</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        DAS Simples Nacional — emissão regular e avulso, controle de pagamentos
                        {resumo && (
                            <span className={`ml-2 px-2 py-0.5 rounded text-xs font-bold ${resumo.mode === 'mock' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                {resumo.mode === 'mock' ? 'MODO TESTE' : 'PRODUÇÃO'}
                            </span>
                        )}
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setHistoricoEnviosCnpj('')}
                        className="btn-press px-4 py-2 bg-slate-700 text-white font-bold rounded-lg hover:bg-slate-800"
                    >
                        📨 Histórico de envios
                    </button>
                    <button
                        onClick={() => setMostrarFormAvulso(!mostrarFormAvulso)}
                        className="btn-press px-4 py-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700"
                    >
                        {mostrarFormAvulso ? '✕ Cancelar' : '+ Emitir DAS Avulso'}
                    </button>
                </div>
            </div>

            {/* Form de emissao avulsa */}
            {mostrarFormAvulso && (
                <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4 space-y-3">
                    <h3 className="font-bold text-emerald-800 dark:text-emerald-200">Emitir DAS Avulso</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <select
                            value={novoEmpresaId}
                            onChange={e => setNovoEmpresaId(e.target.value)}
                            className="px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                        >
                            <option value="">— Selecione a empresa —</option>
                            {empresas.map(e => (
                                <option key={e.id} value={e.id}>{e.nome} ({e.cnpj})</option>
                            ))}
                        </select>
                        <input
                            type="month"
                            value={novoCompetencia}
                            onChange={e => setNovoCompetencia(e.target.value)}
                            className="px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                        />
                        <input
                            type="text"
                            placeholder="Valor (ex: 1234,56)"
                            value={novoValor}
                            onChange={e => setNovoValor(e.target.value)}
                            className="px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                        />
                        <input
                            type="text"
                            placeholder="Descricao (opcional)"
                            value={novoDescricao}
                            onChange={e => setNovoDescricao(e.target.value)}
                            className="px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                        />
                    </div>
                    <button
                        onClick={handleEmitirAvulso}
                        disabled={emitindo || !novoEmpresaId || !novoValor}
                        className="btn-press px-4 py-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                    >
                        {emitindo ? '⏳ Emitindo...' : 'Emitir agora'}
                    </button>
                </div>
            )}

            {/* Cards de resumo */}
            {resumo && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {cards.map(c => (
                        <button
                            key={c.label}
                            onClick={() => setFiltroStatus(filtroStatus === c.clave ? '' : (c.clave as DasStatusPagamento))}
                            className={`text-left p-4 rounded-lg border-2 transition-all ${
                                c.clave && filtroStatus === c.clave
                                    ? 'border-sky-500 ' + c.cor
                                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-sky-300'
                            }`}
                        >
                            <div className="text-3xl font-bold">{c.valor}</div>
                            <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">{c.label}</div>
                            {c.valorBRL !== undefined && (
                                <div className="text-xs text-slate-500 mt-0.5">{formatBRL(c.valorBRL)}</div>
                            )}
                            {(c as any).valorExtra && (
                                <div className="text-[10px] text-red-600 dark:text-red-400 mt-0.5" title="Multa de mora + juros SELIC estimados — confirme no SERPRO antes de pagar.">
                                    {(c as any).valorExtra}
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            )}

            {/* Filtros */}
            <div className="flex flex-wrap items-center gap-3">
                <select
                    value={filtroEmpresa}
                    onChange={e => setFiltroEmpresa(e.target.value)}
                    className="px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
                >
                    <option value="">Todas as empresas</option>
                    {empresas.map(e => (
                        <option key={e.id} value={e.id}>{e.nome}</option>
                    ))}
                </select>
                {(filtroStatus || filtroEmpresa) && (
                    <button
                        onClick={() => { setFiltroStatus(''); setFiltroEmpresa(''); }}
                        className="text-xs text-slate-500 hover:text-slate-700 underline"
                    >
                        Limpar filtros ✕
                    </button>
                )}
            </div>

            {/* Tabela */}
            {loading ? (
                <div className="text-center py-12 text-slate-500">Carregando...</div>
            ) : docs.length === 0 ? (
                <div className="text-center py-12 text-slate-500">Nenhum DAS encontrado.</div>
            ) : (
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-900/50 text-left">
                            <tr>
                                <th className="px-4 py-2 font-medium">Empresa</th>
                                <th className="px-4 py-2 font-medium">Competência</th>
                                <th className="px-4 py-2 font-medium">Tipo</th>
                                <th className="px-4 py-2 font-medium text-right">Valor</th>
                                <th className="px-4 py-2 font-medium">Vencimento</th>
                                <th className="px-4 py-2 font-medium">Status</th>
                                <th className="px-4 py-2 font-medium">Envio</th>
                            </tr>
                        </thead>
                        <tbody>
                            {docs.map(d => (
                                <tr
                                    key={d.id}
                                    onClick={() => setSelecionado(d)}
                                    className="border-t border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50"
                                >
                                    <td className="px-4 py-2">{d.empresaNome}</td>
                                    <td className="px-4 py-2 font-mono text-xs">{d.competencia}</td>
                                    <td className="px-4 py-2">
                                        <span className="capitalize">{d.tipo}</span>
                                        {temDuplicidade(d) && (
                                            <span
                                                className="ml-2 px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 text-[10px] font-bold"
                                                title="Existe outra guia com mesma empresa, competencia e valor."
                                            >
                                                Duplicidade
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-2 text-right font-mono">
                                        {formatBRL(d.valor)}
                                        {d.statusPagamento === 'vencido' && d.multaEstimada && (
                                            <div
                                                className="text-[10px] text-red-600 dark:text-red-400 mt-0.5"
                                                title={`Multa de mora ${d.multaEstimada.multaPct.toFixed(2)}% + juros SELIC ${d.multaEstimada.jurosPct.toFixed(2)}% (${d.multaEstimada.dias} dias). Estimativa — confirme no SERPRO antes de pagar.`}
                                            >
                                                +{formatBRL(d.multaEstimada.multaValor + d.multaEstimada.jurosValor)} mora ⓘ
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-2 font-mono text-xs">{d.vencimento}</td>
                                    <td className="px-4 py-2">
                                        <span className={`px-2 py-0.5 rounded text-xs ${statusBadgeClass(d.statusPagamento)}`}>
                                            {statusLabel(d.statusPagamento)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2">
                                        {d.ultimoEnvioCliente ? (
                                            <span
                                                className="px-2 py-0.5 rounded bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 text-[10px] font-bold whitespace-nowrap"
                                                title={`Enviado para ${d.ultimoEnvioCliente.para} em ${formatDataEnvio(d.ultimoEnvioCliente.enviadoEm)}${d.ultimoEnvioCliente.enviadoPor ? ` por ${d.ultimoEnvioCliente.enviadoPor}` : ''}${d.ultimoEnvioCliente.anexouPdf ? ' (PDF anexado)' : ''}`}
                                            >
                                                ✉ Enviado {formatDataEnvio(d.ultimoEnvioCliente.enviadoEm, true)}
                                            </span>
                                        ) : (
                                            <span className="text-[10px] text-slate-400">—</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Modal detalhe */}
            {selecionado && (
                <div
                    className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[70]"
                    onClick={() => setSelecionado(null)}
                >
                    <div
                        className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                            <div className="flex items-center justify-between mb-2">
                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${statusBadgeClass(selecionado.statusPagamento)}`}>
                                    {statusLabel(selecionado.statusPagamento)}
                                </span>
                                <span className="text-xs text-slate-500 capitalize">{selecionado.tipo}</span>
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                                {selecionado.empresaNome}
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                CNPJ {selecionado.empresaCnpj} | Competência {selecionado.competencia}
                            </p>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/30 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                                Salvo em Painel DAS / {statusLabel(selecionado.statusPagamento)} · ID interno {selecionado.id}
                            </div>

                            {temDuplicidade(selecionado) && (
                                <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                                    Possivel duplicidade: existe outra guia com a mesma empresa, competencia e valor.
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <div className="text-xs text-slate-500">Valor</div>
                                    <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{formatBRL(selecionado.valor)}</div>
                                </div>
                                <div>
                                    <div className="text-xs text-slate-500">Vencimento</div>
                                    <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{selecionado.vencimento}</div>
                                </div>
                            </div>

                            <div>
                                <div className="text-xs text-slate-500 mb-1">Número do documento</div>
                                <div className="font-mono text-sm bg-slate-50 dark:bg-slate-900/40 px-3 py-2 rounded">
                                    {selecionado.numeroDocumento || 'Nao retornado pelo SERPRO'}
                                </div>
                            </div>

                            <div>
                                <div className="text-xs text-slate-500 mb-1">Código de barras (clique pra copiar)</div>
                                {selecionado.codigoBarras ? (
                                    <button
                                        onClick={() => copiarBarras(selecionado.codigoBarras)}
                                        className="w-full font-mono text-sm bg-slate-50 dark:bg-slate-900/40 px-3 py-2 rounded text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                                    >
                                        {formatBarras(selecionado.codigoBarras)}
                                    </button>
                                ) : (
                                    <div className="font-mono text-sm bg-slate-50 dark:bg-slate-900/40 px-3 py-2 rounded text-slate-500">
                                        Nao retornado pelo SERPRO
                                    </div>
                                )}
                            </div>

                            <div>
                                <div className="text-xs text-slate-500 mb-1">Guia em PDF</div>
                                {selecionado.pdfBase64 || selecionado.pdfUrl ? (
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            onClick={() => abrirPdfDas(selecionado)}
                                            className="btn-press px-3 py-2 bg-sky-600 text-white text-sm font-bold rounded-lg hover:bg-sky-700"
                                        >
                                            Abrir PDF
                                        </button>
                                        <button
                                            onClick={() => baixarPdfDas(selecionado)}
                                            className="btn-press px-3 py-2 bg-slate-700 text-white text-sm font-bold rounded-lg hover:bg-slate-800"
                                        >
                                            Baixar PDF
                                        </button>
                                    </div>
                                ) : (
                                    <div className="text-sm bg-slate-50 dark:bg-slate-900/40 px-3 py-2 rounded text-slate-500">
                                        PDF nao retornado pelo SERPRO. Use numero/codigo de barras quando disponivel ou consulte a guia no PGDAS-D.
                                    </div>
                                )}
                            </div>

                            {selecionado.descricao && (
                                <div>
                                    <div className="text-xs text-slate-500 mb-1">Descrição</div>
                                    <div className="text-sm">{selecionado.descricao}</div>
                                </div>
                            )}

                            <div>
                                <div className="text-xs text-slate-500 mb-1">Envio ao cliente</div>
                                {selecionado.ultimoEnvioCliente ? (
                                    <div className="rounded-lg border border-sky-200 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-900/20 px-3 py-2 text-xs text-sky-800 dark:text-sky-200 space-y-1">
                                        <div>
                                            ✉ Enviado para <strong className="font-mono">{selecionado.ultimoEnvioCliente.para}</strong> em {formatDataEnvio(selecionado.ultimoEnvioCliente.enviadoEm)}
                                            {selecionado.ultimoEnvioCliente.anexouPdf ? ' com PDF anexado' : ''}
                                            {selecionado.ultimoEnvioCliente.enviadoPor ? ` (por ${selecionado.ultimoEnvioCliente.enviadoPor})` : ''}.
                                            {selecionado.ultimoEnvioCliente.copiaPara && selecionado.ultimoEnvioCliente.copiaPara.length > 0 && (
                                                <> Cópia: <span className="font-mono">{selecionado.ultimoEnvioCliente.copiaPara.join(', ')}</span>.</>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => setHistoricoEnviosCnpj(cnpjLimpo(selecionado.empresaCnpj))}
                                            className="underline font-bold hover:text-sky-600"
                                        >
                                            Ver histórico completo desta empresa
                                        </button>
                                    </div>
                                ) : (
                                    <div className="text-sm bg-slate-50 dark:bg-slate-900/40 px-3 py-2 rounded text-slate-500">
                                        Ainda não enviado ao cliente por e-mail.
                                    </div>
                                )}
                            </div>

                            {selecionado.modeUsado === 'mock' && (
                                <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded">
                                    ⓘ DAS gerado em modo TESTE — código de barras fictício, não pague no banco.
                                    Pra produção real, ative DAS_MODE=serpro após contratar Integra Contador.
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                            <button
                                onClick={() => setSelecionado(null)}
                                className="btn-press px-4 py-2 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                            >
                                Fechar
                            </button>
                            <button
                                onClick={() => setCobrancaDas(selecionado)}
                                className="btn-press px-4 py-2 bg-sky-600 text-white font-bold rounded-lg hover:bg-sky-700"
                            >
                                Enviar ao cliente
                            </button>
                            {selecionado.statusPagamento !== 'pago' && (
                                <button
                                    onClick={() => handleMarcarPago(selecionado)}
                                    className="btn-press px-4 py-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700"
                                >
                                    ✓ Marcar como pago
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {cobrancaDas && (
                <CobrancaModal
                    dasInfo={cobrancaDas}
                    currentUser={currentUser}
                    onClose={() => setCobrancaDas(null)}
                    onShowToast={(m) => onShowToast?.(m)}
                    onEnviado={() => { carregar(); setSelecionado(null); }}
                />
            )}

            {historicoEnviosCnpj !== null && (
                <EnviosHistoricoModal
                    currentUser={currentUser}
                    empresas={empresas}
                    cnpjInicial={historicoEnviosCnpj || undefined}
                    onClose={() => setHistoricoEnviosCnpj(null)}
                    onShowToast={onShowToast}
                />
            )}
        </div>
    );
};

export default DasDashboard;
