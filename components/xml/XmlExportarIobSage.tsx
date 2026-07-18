import React, { useEffect, useMemo, useState } from 'react';
import type { User, DocumentoFiscal } from '../../types';
import { listDocumentos, getEmpresasDisponiveis, type EmpresaXmlOption } from '../../services/xmlFiscalService';
import { exportarParaIobSage, downloadBlob } from '../../services/iobSageExportService';
import { formatCurrency } from '../../services/xmlParserService';
import EmpresaSearchSelect from './EmpresaSearchSelect';

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

/**
 * Exportar IOB SAGE — SOB DEMANDA.
 *
 * Antes: ao abrir a aba, varria a base inteira (~20 mil docs) só para montar
 * os filtros — lento e desnecessário. Agora abre EM BRANCO: o colaborador
 * define competência (obrigatória — vai como filtro no servidor), empresa e
 * direção, e clica Buscar. Só então os documentos do recorte são carregados.
 */
const XmlExportarIobSage: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [empresas, setEmpresas] = useState<EmpresaXmlOption[]>([]);
    const [docs, setDocs] = useState<DocumentoFiscal[]>([]);
    const [buscou, setBuscou] = useState(false);
    const [loading, setLoading] = useState(false);
    const [empresaId, setEmpresaId] = useState<string>('');
    const [competencia, setCompetencia] = useState<string>('');
    const [direcao, setDirecao] = useState<'entrada' | 'saida' | ''>('');
    const [numeroEmpresaEfiscal, setNumeroEmpresaEfiscal] = useState<number>(1);
    const [exporting, setExporting] = useState(false);

    // Catálogo de empresas (leve) para o seletor pesquisável — não carrega docs.
    useEffect(() => {
        let alive = true;
        getEmpresasDisponiveis(currentUser).then(list => { if (alive) setEmpresas(list); });
        return () => { alive = false; };
    }, [currentUser]);

    const empresaSelecionada = empresas.find(e => e.id === empresaId) || null;

    const buscar = async () => {
        if (!competencia) {
            onShowToast?.('Informe a competência antes de buscar.');
            return;
        }
        setLoading(true);
        setBuscou(false);
        try {
            // Competência vai ao servidor (where ==). Empresa é filtrada aqui no
            // cliente por id OU CNPJ — docs capturados server-side (autXML/ZIP/
            // SAE) podem não ter empresaId preenchido, só o CNPJ.
            const d = await listDocumentos(currentUser, { competencia });
            const cnpjSel = (empresaSelecionada?.cnpj || '').replace(/\D/g, '');
            const raizSel = cnpjSel.slice(0, 8);
            const filtradosEmpresa = empresaSelecionada
                ? d.filter(doc =>
                    doc.empresaId === empresaSelecionada.id
                    || (raizSel && String(doc.empresaCnpj || '').replace(/\D/g, '').startsWith(raizSel)))
                : d;
            setDocs(filtradosEmpresa);
            setBuscou(true);
        } catch (err: any) {
            onShowToast?.(`Falha na busca: ${err?.message || err}`);
        } finally {
            setLoading(false);
        }
    };

    const filtrados = useMemo(() => {
        return docs.filter(d => {
            if (direcao && d.direcao !== direcao) return false;
            // IOB/SAGE Folhamatic Fiscal so aceita NFe/NFCe (modelo 55/65). CTe (57),
            // MDFe (58) e NFSe seguem fluxo proprio e nao entram neste arquivo .FML.
            const tipo = (d as any).tipoDoc || (d as any).tipo;
            if (tipo && !['NFe', 'NFCe'].includes(tipo)) return false;
            return true;
        });
    }, [docs, direcao]);

    const totalValor = useMemo(
        () => filtrados.reduce((acc, d) => acc + (d.totais?.vNF || 0), 0),
        [filtrados],
    );

    const handleExportar = async () => {
        if (filtrados.length === 0) {
            onShowToast?.('Nenhum documento para exportar com os filtros atuais.');
            return;
        }
        setExporting(true);
        try {
            const result = exportarParaIobSage({
                documentos: filtrados,
                numeroEmpresaEfiscal,
            });
            downloadBlob(result.blob, result.fileName);
            onShowToast?.(
                `Arquivo ${result.fileName} gerado: ${result.estatisticas.documentos} NF, ` +
                `${result.estatisticas.participantes} participantes, ${result.estatisticas.produtos} produtos.`,
            );
        } catch (err: any) {
            onShowToast?.(`Falha ao gerar arquivo: ${err?.message || err}`);
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
                <p className="text-xs text-emerald-800 dark:text-emerald-300">
                    Gera arquivo <strong>.FML</strong> no Layout Folhamatic Fiscal v2.0.06 (largura fixa, Windows-1252, CRLF) para importação no E-Fiscal IOB SAGE.
                </p>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1">
                    Inclui registros E001, E010 (clientes/fornecedores), E020 (produtos), E200, E201, E221, E222 e E342 (chave NF-e).
                </p>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                            Competência <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="month"
                            value={competencia}
                            onChange={(e) => setCompetencia(e.target.value)}
                            className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                        />
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">Empresa (opcional — vazio = todas)</label>
                        <div className="flex gap-2">
                            <div className="flex-1">
                                <EmpresaSearchSelect empresas={empresas} value={empresaId} onChange={setEmpresaId} placeholder="Todas — busque por nome ou CNPJ…" />
                            </div>
                            {empresaId && (
                                <button onClick={() => setEmpresaId('')} title="Limpar empresa (todas)"
                                    className="px-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-500 text-xs">✕</button>
                            )}
                        </div>
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">Direção</label>
                        <select
                            value={direcao}
                            onChange={(e) => setDirecao(e.target.value as any)}
                            className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm"
                        >
                            <option value="">Entradas e saídas</option>
                            <option value="entrada">Apenas entradas</option>
                            <option value="saida">Apenas saídas</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                            Nº empresa no E-Fiscal
                        </label>
                        <input
                            type="number"
                            min={1}
                            max={9999}
                            value={numeroEmpresaEfiscal}
                            onChange={(e) => setNumeroEmpresaEfiscal(parseInt(e.target.value) || 1)}
                            className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm"
                            title="Código da empresa no cadastro do E-Fiscal Folhamatic (campo do registro E001)"
                        />
                    </div>
                </div>

                <div className="flex justify-between items-center pt-1">
                    <p className="text-[11px] text-slate-400">
                        {buscou
                            ? `${filtrados.length} documento(s) no recorte.`
                            : 'Defina a competência (e a empresa, se quiser) e clique em Buscar — nada é carregado antes disso.'}
                    </p>
                    <button
                        onClick={buscar}
                        disabled={loading || !competencia}
                        className="px-4 py-2 text-sm bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed font-bold"
                    >
                        {loading ? 'Buscando…' : '🔎 Buscar documentos'}
                    </button>
                </div>

                {buscou && (
                    <>
                        <div className="border-t border-slate-200 dark:border-slate-700 pt-3 grid grid-cols-3 gap-3">
                            <div className="bg-slate-50 dark:bg-slate-700/40 rounded-lg p-3 text-center">
                                <p className="text-[10px] uppercase text-slate-500">Documentos</p>
                                <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{filtrados.length}</p>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-700/40 rounded-lg p-3 text-center">
                                <p className="text-[10px] uppercase text-slate-500">Valor total</p>
                                <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{formatCurrency(totalValor)}</p>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-700/40 rounded-lg p-3 text-center">
                                <p className="text-[10px] uppercase text-slate-500">Itens (E222)</p>
                                <p className="text-lg font-bold text-slate-700 dark:text-slate-200">
                                    {filtrados.reduce((a, d) => a + (d.itens?.length || 0), 0)}
                                </p>
                            </div>
                        </div>

                        <div className="flex justify-end pt-2">
                            <button
                                onClick={handleExportar}
                                disabled={exporting || filtrados.length === 0}
                                className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed font-bold"
                            >
                                {exporting ? 'Gerando...' : 'Gerar arquivo .FML'}
                            </button>
                        </div>
                    </>
                )}
            </div>

            {buscou && filtrados.length > 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">
                            Pré-visualização ({Math.min(filtrados.length, 100)} de {filtrados.length})
                        </h3>
                    </div>
                    <div className="overflow-x-auto max-h-[320px]">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 dark:bg-slate-700 sticky top-0">
                                <tr>
                                    <th className="px-3 py-2 text-left">Empresa</th>
                                    <th className="px-3 py-2 text-left">Comp.</th>
                                    <th className="px-3 py-2 text-left">Tipo</th>
                                    <th className="px-3 py-2 text-left">Nº</th>
                                    <th className="px-3 py-2 text-left">Direção</th>
                                    <th className="px-3 py-2 text-right">Valor</th>
                                    <th className="px-3 py-2 text-center">Itens</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                {filtrados.slice(0, 100).map(d => (
                                    <tr key={d.id}>
                                        <td className="px-3 py-1.5 truncate max-w-[180px]" title={d.empresaNome || d.empresaCnpj}>{d.empresaNome || d.empresaCnpj || '—'}</td>
                                        <td className="px-3 py-1.5 font-mono">{d.competencia}</td>
                                        <td className="px-3 py-1.5">{d.tipo}</td>
                                        <td className="px-3 py-1.5 font-mono">{d.numero}/{d.serie}</td>
                                        <td className="px-3 py-1.5">{d.direcao}</td>
                                        <td className="px-3 py-1.5 text-right font-bold">{formatCurrency(d.totais?.vNF || 0)}</td>
                                        <td className="px-3 py-1.5 text-center">{d.itens?.length || 0}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {buscou && filtrados.length === 0 && (
                <p className="text-center text-xs text-slate-400 py-4">
                    Nenhum documento NFe/NFCe encontrado para {competencia}{empresaSelecionada ? ` · ${empresaSelecionada.nome}` : ''}{direcao ? ` · ${direcao}` : ''}.
                </p>
            )}
        </div>
    );
};

export default XmlExportarIobSage;
