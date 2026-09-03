import React, { useState } from 'react';
import { getView } from '../../services/xmlDocumentoView';
import type { DocumentoFiscal, User } from '../../types';
import { formatCnpjCpf, formatCurrency, formatDate } from '../../services/xmlParserService';
import { procedenciaDoDocumento, hashCurto, dataLegivel } from '../../services/documentoProcedencia';
// 🚨 A SAÍDA PARA A NOTA QUE ENTROU NA EMPRESA ERRADA (03/09, Paulo: *"lancei
// uma nota da J.P. PISSATO na empresa SILVIO FREIRE … como resolver?"*). Não
// tinha como: `deleteDocumento` existia e NENHUMA tela o chamava.
import { explicarRetirada, MIN_MOTIVO_RETIRADA } from '../../services/documentoRetirada';
import { tirarDocumentoDaEmpresa } from '../../services/xmlFiscalService';

interface Props {
    documento: DocumentoFiscal;
    onClose: () => void;
    currentUser?: User | null;
    /** Avisado quando a nota sai — a lista tem de recarregar. */
    onRetirado?: () => void;
    onShowToast?: (msg: string) => void;
}

const XmlDocumentoDetalhe: React.FC<Props> = ({ documento: d, onClose, currentUser, onRetirado, onShowToast }) => {
    const [abrirRetirada, setAbrirRetirada] = useState(false);
    const [motivo, setMotivo] = useState('');
    const [tirando, setTirando] = useState(false);
    const [erroRetirada, setErroRetirada] = useState<string | null>(null);
    const jaRetirada = explicarRetirada(d as any);

    const tirar = async () => {
        setTirando(true); setErroRetirada(null);
        try {
            const r = await tirarDocumentoDaEmpresa(d.id, motivo, currentUser || null);
            if (!r.ok) { setErroRetirada(r.mensagem); return; }
            onShowToast?.(r.mensagem);
            setAbrirRetirada(false);
            setMotivo('');
            onRetirado?.();
            onClose();
        } catch (e: any) {
            setErroRetirada(e?.message || 'Falha ao tirar a nota.');
        } finally {
            setTirando(false);
        }
    };

    // Por que campos como chave e hash podem faltar. A NFS-e do portal entra
    // por CSV/TXT: sem arquivo XML, sem hash, sem chave de 44 dígitos — e
    // tratar isso como defeito foi o que derrubou a tela (07/08).
    const procedencia = procedenciaDoDocumento(d);
    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="bg-emerald-50 dark:bg-emerald-900/20 p-4 border-b border-slate-200 dark:border-slate-700">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="font-bold text-emerald-800 dark:text-emerald-300">
                            {d.tipo} Nº {d.numero} — Série {d.serie}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                            {d.natOp} • Emissão: {formatDate(d.dhEmi)} • Status: {d.status} • {d.direcao}
                        </p>
                        {procedencia.temChave && (
                            <p className="text-[10px] text-slate-400 mt-0.5 font-mono">Chave: {d.chave}</p>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {d.storageUrl && (
                            <a href={d.storageUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-700 dark:text-emerald-300 underline">
                                Baixar XML
                            </a>
                        )}
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            <div className="p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Emitente</p>
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{getView(d).emitente.nome || '—'}</p>
                        {getView(d).emitente.fantasia && <p className="text-xs text-slate-500">{getView(d).emitente.fantasia}</p>}
                        <p className="text-xs text-slate-500 mt-1">CNPJ: {formatCnpjCpf(getView(d).emitente.cnpj)}</p>
                        <p className="text-xs text-slate-500">IE: {getView(d).emitente.ie || '-'}</p>
                        <p className="text-xs text-slate-500">{getView(d).emitente.municipio || '—'}/{getView(d).emitente.uf}</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Destinatário</p>
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{getView(d).destinatario.nome || '—'}</p>
                        <p className="text-xs text-slate-500 mt-1">CNPJ/CPF: {formatCnpjCpf(getView(d).destinatario.cnpj)}</p>
                        <p className="text-xs text-slate-500">IE: {getView(d).destinatario.ie || '-'}</p>
                        <p className="text-xs text-slate-500">{getView(d).destinatario.municipio || '—'}/{getView(d).destinatario.uf}</p>
                    </div>
                </div>

                {getView(d).resumoOnly ? (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-3">
                        <p className="text-xs font-bold text-amber-700 dark:text-amber-300">Resumo SEFAZ</p>
                        <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80 mt-1">
                            Este documento veio como resumo (resNFe) da SEFAZ. O XML completo (procNFe) ainda não foi baixado, então itens e detalhes de impostos não estão disponíveis.
                        </p>
                    </div>
                ) : (
                <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Resumo de Impostos</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                            { label: 'Valor Produtos', value: getView(d).valores.produtos },
                            { label: 'Valor NF', value: getView(d).valores.total },
                            { label: 'BC ICMS', value: getView(d).valores.bc },
                            { label: 'ICMS', value: getView(d).valores.icms },
                            { label: 'BC ICMS ST', value: getView(d).valores.bcST },
                            { label: 'ICMS ST', value: getView(d).valores.icmsST },
                            { label: 'IPI', value: getView(d).valores.ipi },
                            { label: 'PIS', value: getView(d).valores.pis },
                            { label: 'COFINS', value: getView(d).valores.cofins },
                            { label: 'Frete', value: getView(d).valores.frete },
                            { label: 'Desconto', value: getView(d).valores.desconto },
                            { label: 'Outros', value: getView(d).valores.outros },
                        ].map(item => (
                            <div key={item.label} className="bg-slate-50 dark:bg-slate-700/30 rounded-lg p-2 text-center">
                                <p className="text-[10px] text-slate-500 dark:text-slate-400">{item.label}</p>
                                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{formatCurrency(item.value)}</p>
                            </div>
                        ))}
                    </div>
                </div>
                )}

                <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                        Itens ({(d as any).itens?.length || 0})
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700 max-h-[360px]">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 dark:bg-slate-700 sticky top-0">
                                <tr>
                                    <th className="px-2 py-2 text-left">#</th>
                                    <th className="px-2 py-2 text-left">Produto</th>
                                    <th className="px-2 py-2 text-center">NCM</th>
                                    <th className="px-2 py-2 text-center">CFOP</th>
                                    <th className="px-2 py-2 text-center">CST</th>
                                    <th className="px-2 py-2 text-right">Qtd</th>
                                    <th className="px-2 py-2 text-right">Vl. Unit.</th>
                                    <th className="px-2 py-2 text-right">Vl. Total</th>
                                    <th className="px-2 py-2 text-right">ICMS</th>
                                    <th className="px-2 py-2 text-right">IPI</th>
                                    <th className="px-2 py-2 text-right">PIS</th>
                                    <th className="px-2 py-2 text-right">COFINS</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                {((d as any).itens || []).map((p: any, i: number) => (
                                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                                        <td className="px-2 py-1.5 text-slate-400">{p.nItem}</td>
                                        <td className="px-2 py-1.5 max-w-[200px] truncate" title={p.xProd}>{p.xProd}</td>
                                        <td className="px-2 py-1.5 text-center text-slate-500">{p.ncm}</td>
                                        <td className="px-2 py-1.5 text-center text-slate-500">{p.cfop}</td>
                                        <td className="px-2 py-1.5 text-center text-slate-500">{p.cst}</td>
                                        <td className="px-2 py-1.5 text-right text-slate-500">{typeof p.qCom === 'number' ? p.qCom.toLocaleString('pt-BR') : '—'} {p.uCom || ''}</td>
                                        <td className="px-2 py-1.5 text-right text-slate-500">{formatCurrency(p.vUnCom)}</td>
                                        <td className="px-2 py-1.5 text-right font-bold">{formatCurrency(p.vProd)}</td>
                                        <td className="px-2 py-1.5 text-right text-blue-600">{formatCurrency(p.vICMS)}</td>
                                        <td className="px-2 py-1.5 text-right text-amber-600">{formatCurrency(p.vIPI)}</td>
                                        <td className="px-2 py-1.5 text-right text-orange-600">{formatCurrency(p.vPIS)}</td>
                                        <td className="px-2 py-1.5 text-right text-orange-600">{formatCurrency(p.vCOFINS)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {d.infAdic && (
                    <div className="bg-yellow-50 dark:bg-yellow-900/10 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Informações Adicionais</p>
                        <p className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{d.infAdic}</p>
                    </div>
                )}

                <div className="text-[10px] text-slate-400 grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                    <div><span className="font-bold">Origem:</span> {d.origem}</div>
                    <div><span className="font-bold">Importado por:</span> {d.importadoPorEmail || d.importadoPor}</div>
                    <div><span className="font-bold">Em:</span> {dataLegivel(d.importadoEm) || '—'}</div>
                    <div className="truncate" title={d.xmlHash}>
                        <span className="font-bold">Hash:</span> {hashCurto(d.xmlHash) || '—'}
                    </div>
                </div>
                {/* Campo vazio SEM explicação faz procurar problema que não existe.
                    A NFS-e do portal entra por CSV/TXT: não tem XML, hash nem chave
                    de 44 dígitos — e isso é a natureza dela, não falha de captura. */}
                {procedencia.explicacao && (
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 pt-1 leading-snug">
                        ℹ {procedencia.explicacao}
                    </p>
                )}

                {/* ═══ A NOTA ENTROU NA EMPRESA ERRADA ═══════════════════════
                    03/09, Paulo: *"lancei uma nota da J.P. PISSATO na empresa
                    SILVIO FREIRE … como resolver?"* — e não tinha como. A nota
                    INFLA o livro de quem não a tomou e SOME do livro de quem
                    tomou, sem nenhum validador acusar: o documento é legítimo
                    e o cadastro das duas empresas está certo. */}
                {jaRetirada ? (
                    <div className="mt-3 rounded-md border border-slate-300 bg-slate-100 dark:bg-slate-700/50 p-3">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-300">🚫 Nota tirada desta empresa</p>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">{jaRetirada}</p>
                    </div>
                ) : !abrirRetirada ? (
                    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                        <button
                            onClick={() => setAbrirRetirada(true)}
                            className="text-xs rounded-md border border-red-300 text-red-700 dark:text-red-300 px-3 py-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 btn-press whitespace-nowrap"
                            title="Para quando a nota foi importada na empresa errada. Ela sai do livro DESTA empresa; o documento não é apagado."
                        >
                            🚫 Esta nota não é desta empresa
                        </button>
                    </div>
                ) : (
                    <div className="mt-3 rounded-md border border-red-300 bg-red-50 dark:bg-red-900/20 p-3">
                        <p className="text-xs font-bold text-red-800 dark:text-red-300">
                            Tirar a nota {d.numero} de {d.empresaNome || 'esta empresa'}
                        </p>
                        {/* 🚨 A LINHA QUE IMPEDE O LIVRO A MENOS: tirar daqui NÃO
                            põe na empresa certa. Sem isto, quem tira acha que
                            resolveu e a nota fica faltando nas DUAS. */}
                        <p className="text-[11px] text-red-800 dark:text-red-300 mt-1 leading-snug">
                            Ela sai do livro desta empresa (lista, competência, Livro de Serviços e SPED).
                            <strong> Isto NÃO a move para a empresa certa</strong> — importe-a lá depois, senão
                            ela fica faltando nas duas. O documento <strong>não é apagado</strong>: fica
                            registrado com o motivo e com quem tirou, e dá para voltar atrás.
                        </p>
                        <textarea
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            rows={2}
                            placeholder='Por que ela sai daqui? Ex.: "nota é da J.P. PISSATO, importada aqui por engano"'
                            className="mt-2 w-full rounded border border-red-300 bg-white dark:bg-slate-800 p-2 text-xs"
                        />
                        <p className="text-[10px] text-red-700 dark:text-red-400 mt-0.5">
                            {motivo.trim().length}/{MIN_MOTIVO_RETIRADA} caracteres — daqui a um mês ninguém
                            lembra por que a nota saiu.
                        </p>
                        {erroRetirada && (
                            <p className="mt-2 text-[11px] font-semibold text-red-800 dark:text-red-300">{erroRetirada}</p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <button
                                onClick={tirar}
                                disabled={tirando || motivo.trim().length < MIN_MOTIVO_RETIRADA}
                                className="text-xs rounded-md bg-red-600 text-white px-3 py-1.5 font-semibold hover:bg-red-700 disabled:opacity-50 btn-press whitespace-nowrap"
                                title={motivo.trim().length < MIN_MOTIVO_RETIRADA
                                    ? `Escreva o motivo (mínimo ${MIN_MOTIVO_RETIRADA} caracteres)`
                                    : 'Tira a nota do livro desta empresa'}
                            >
                                {tirando ? 'Tirando…' : 'Confirmar — tirar do livro desta empresa'}
                            </button>
                            <button
                                onClick={() => { setAbrirRetirada(false); setErroRetirada(null); }}
                                className="text-xs rounded-md border border-slate-300 px-3 py-1.5 btn-press whitespace-nowrap"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default XmlDocumentoDetalhe;
