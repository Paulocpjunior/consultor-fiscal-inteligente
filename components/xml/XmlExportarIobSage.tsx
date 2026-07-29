import React, { useEffect, useMemo, useState } from 'react';
import type { User, DocumentoFiscal } from '../../types';
import { listDocumentos, getEmpresasDisponiveis, type EmpresaXmlOption } from '../../services/xmlFiscalService';
import { exportarParaIobSage, downloadBlob } from '../../services/iobSageExportService';
import { conferirAntesDeGerar, type ResultadoPreflight } from '../../services/iobSagePreflight';
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
    const [truncado, setTruncado] = useState(false);
    const [loading, setLoading] = useState(false);
    const [empresaId, setEmpresaId] = useState<string>('');
    const [competencia, setCompetencia] = useState<string>('');
    const [direcao, setDirecao] = useState<'entrada' | 'saida' | ''>('');
    const [numeroEmpresaEfiscal, setNumeroEmpresaEfiscal] = useState<number>(1);
    // E020 campo 11. Cada escritório cadastra os próprios tipos de inventário
    // no E-Fiscal; mandar um código inexistente recusa TODOS os produtos.
    // Em branco (padrão) o campo não é informado — e o layout permite.
    const [tipoInventario, setTipoInventario] = useState<string>('');
    // Notas que ficaram FORA do arquivo. Antes isso era console.warn: o .FML
    // saía só com produtos e o E-Fiscal ainda dizia "importado com sucesso".
    const [falhas, setFalhas] = useState<Array<{ documento: string; motivo: string }>>([]);
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
        setTruncado(false);
        try {
            // Competência vai ao servidor (where ==). Empresa é filtrada aqui no
            // cliente por id OU CNPJ — docs capturados server-side (autXML/ZIP/
            // SAE) podem não ter empresaId preenchido, só o CNPJ.
            const meta: { truncado?: boolean } = {};
            const d = await listDocumentos(currentUser, { competencia }, meta);
            setTruncado(!!meta.truncado);
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

    // FREIO: confere o que seria enviado ANTES de baixar. Roda sobre o recorte
    // atual, sem clique — o colaborador vê o problema antes de gastar uma
    // rodada de importação no E-Fiscal (Paulo, 29/07).
    const preflight: ResultadoPreflight | null = useMemo(() => {
        if (!buscou || filtrados.length === 0) return null;
        try {
            return conferirAntesDeGerar(filtrados, {
                numeroEmpresaEfiscal,
                tipoInventario: tipoInventario.trim(),
            });
        } catch {
            return null;
        }
    }, [buscou, filtrados, numeroEmpresaEfiscal, tipoInventario]);

    const totalValor = useMemo(
        () => filtrados.reduce((acc, d) => acc + (d.totais?.vNF || 0), 0),
        [filtrados],
    );

    const handleExportar = async () => {
        if (filtrados.length === 0) {
            onShowToast?.('Nenhum documento para exportar com os filtros atuais.');
            return;
        }
        // Bloqueio conhecido: confirma antes, porque o E-Fiscal vai recusar
        // essas notas e o "importação concluída" não deixa isso claro.
        if (preflight && preflight.bloqueios > 0) {
            const ok = window.confirm(
                `${preflight.bloqueios} nota(s) serão recusadas pelo E-Fiscal:\n\n`
                + preflight.problemas.filter(p => p.gravidade === 'bloqueia')
                    .map(p => `• ${p.qtd}× ${p.causa}`).join('\n')
                + `\n\nGerar mesmo assim com as ${preflight.notasNoArquivo} nota(s) que passam?`,
            );
            if (!ok) return;
        }
        setExporting(true);
        try {
            const result = exportarParaIobSage({
                documentos: filtrados,
                numeroEmpresaEfiscal,
                tipoInventario: tipoInventario.trim(),
            });
            const st = result.estatisticas;
            setFalhas(result.falhas);
            // Só baixa se ALGUMA nota entrou. Arquivo só com produtos importa
            // "com sucesso" no E-Fiscal e não lança nada — pior que erro.
            if (st.notasNoArquivo === 0) {
                onShowToast?.(
                    `Nenhuma das ${st.documentos} nota(s) pôde ser gerada — arquivo NÃO baixado. Veja os motivos abaixo.`,
                );
                return;
            }
            downloadBlob(result.blob, result.fileName);
            onShowToast?.(
                `Arquivo ${result.fileName}: ${st.notasNoArquivo} de ${st.documentos} NF, ` +
                `${st.participantes} participantes, ${st.produtos} produtos.`
                + (result.falhas.length > 0 ? ` ⚠ ${result.falhas.length} item(ns) ficaram de fora.` : ''),
            );
        } catch (err: any) {
            onShowToast?.(`Falha ao gerar arquivo: ${err?.message || err}`);
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="space-y-3">
            {preflight && preflight.problemas.length > 0 && (
                <div className={`rounded-lg border p-3 space-y-2 ${
                    preflight.farol === 'bloqueado'
                        ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20'
                        : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20'
                }`}>
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-100">
                        🚦 Conferência antes de gerar — {preflight.resumo}
                    </p>
                    {preflight.problemas.map((p, i) => (
                        <div key={i} className="border-l-2 pl-2"
                            style={{ borderColor: p.gravidade === 'bloqueia' ? '#dc2626' : '#d97706' }}>
                            <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                                {p.gravidade === 'bloqueia' ? '✕' : '!'} {p.qtd}× {p.causa}
                            </p>
                            <p className="text-[11px] text-slate-600 dark:text-slate-300">
                                No E-Fiscal: {p.oQueAconteceLa}
                            </p>
                            <p className="text-[11px] text-sky-700 dark:text-sky-400">→ {p.acao}</p>
                            <details>
                                <summary className="text-[10px] cursor-pointer text-slate-500">ver exemplos</summary>
                                <ul className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5 space-y-0.5">
                                    {p.exemplos.map((e, j) => <li key={j}>{e}</li>)}
                                </ul>
                            </details>
                        </div>
                    ))}
                </div>
            )}
            {preflight && preflight.problemas.length === 0 && (
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-2">
                    🚦 {preflight.resumo}
                </p>
            )}

            {falhas.length > 0 && (
                <div className="border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                    <p className="text-xs font-bold text-red-800 dark:text-red-300">
                        {falhas.length} item(ns) ficaram FORA do arquivo
                    </p>
                    <p className="text-[11px] text-red-700 dark:text-red-400">
                        O E-Fiscal importa o que receber e diz "sucesso" mesmo assim — o que está aqui simplesmente
                        não vai chegar lá.
                    </p>
                    <ul className="mt-1 text-[11px] text-slate-700 dark:text-slate-300 space-y-0.5 max-h-40 overflow-y-auto">
                        {falhas.slice(0, 50).map((f, i) => (
                            <li key={i}><strong>{f.documento}</strong> — {f.motivo}</li>
                        ))}
                    </ul>
                    {falhas.length > 50 && (
                        <p className="text-[11px] text-slate-500 mt-1">…e mais {falhas.length - 50}.</p>
                    )}
                </div>
            )}
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

                    <div>
                        <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
                            Tipo p/ inventário (opcional)
                        </label>
                        <input
                            type="text"
                            inputMode="numeric"
                            maxLength={4}
                            placeholder="deixe vazio"
                            value={tipoInventario}
                            onChange={(e) => setTipoInventario(e.target.value.replace(/\D/g, ''))}
                            className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm"
                            title="E020 campo 11. Só preencha com um código que EXISTA em Cadastros → Tipos de Inventário do E-Fiscal do cliente."
                        />
                    </div>
                </div>

                <p className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-2">
                    <strong>Tipo p/ inventário:</strong> deixe <strong>vazio</strong> salvo orientação em contrário. Esse
                    código vem da tabela <em>Cadastros → Tipos de Inventário</em> do E-Fiscal de cada cliente — se você
                    mandar um número que não existe lá, o E-Fiscal recusa <strong>todos</strong> os produtos (E020) e as
                    notas entram sem item.
                </p>

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

                {buscou && truncado && (
                    <div className="bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg p-3">
                        <p className="text-xs font-bold text-red-800 dark:text-red-300">
                            ⚠️ Recorte possivelmente incompleto — limite de leitura atingido.
                        </p>
                        <p className="text-[11px] text-red-700 dark:text-red-400 mt-1">
                            A competência {competencia} retornou o máximo de documentos que o navegador
                            carrega de uma vez. O arquivo gerado pode <strong>não conter todas as notas</strong>.
                            Selecione uma <strong>empresa específica</strong> acima e busque de novo para garantir a exportação completa.
                        </p>
                    </div>
                )}

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
                            {/* Conferência ao lado dos totais: o colaborador vê o
                                veredito no MESMO lugar onde decide gerar. */}
                            <div className={`rounded-lg p-3 text-center ${
                                !preflight ? 'bg-slate-50 dark:bg-slate-700/40'
                                : preflight.farol === 'bloqueado' ? 'bg-red-50 dark:bg-red-900/20'
                                : preflight.farol === 'atencao' ? 'bg-amber-50 dark:bg-amber-900/20'
                                : 'bg-emerald-50 dark:bg-emerald-900/20'}`}>
                                <p className="text-[10px] uppercase text-slate-500">Vão chegar no E-Fiscal</p>
                                <p className={`text-lg font-bold ${
                                    preflight?.farol === 'bloqueado' ? 'text-red-700 dark:text-red-400'
                                    : 'text-emerald-700 dark:text-emerald-400'}`}>
                                    {preflight ? `${preflight.notasNoArquivo}/${preflight.documentos}` : '—'}
                                </p>
                            </div>
                        </div>

                        <div className="flex justify-between items-center gap-3 flex-wrap pt-2">
                            <p className="text-[11px] text-slate-600 dark:text-slate-300 flex-1 min-w-[240px]">
                                {preflight?.farol === 'bloqueado'
                                    ? <><strong className="text-red-700 dark:text-red-400">Corrija antes de gerar:</strong> {preflight.bloqueios} nota(s) serão recusadas pelo E-Fiscal. Arrume o que está no quadro acima e clique em <strong>Reconferir</strong>.</>
                                    : preflight?.farol === 'atencao'
                                        ? <>Nada trava a importação — as ressalvas do quadro acima são para conferir.</>
                                        : preflight
                                            ? <>Conferência feita: nada que o E-Fiscal costume recusar.</>
                                            : <>Busque um recorte para o app conferir antes de gerar.</>}
                            </p>
                            <div className="flex gap-2">
                                <button
                                    onClick={buscar}
                                    disabled={loading || !competencia}
                                    className="px-3 py-2 text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-40"
                                    title="Recarrega os documentos e refaz a conferência — use depois de corrigir."
                                >
                                    {loading ? 'Conferindo…' : '↻ Reconferir'}
                                </button>
                                <button
                                    onClick={handleExportar}
                                    disabled={exporting || filtrados.length === 0}
                                    className={`px-4 py-2 text-sm text-white rounded-lg font-bold disabled:opacity-40 disabled:cursor-not-allowed ${
                                        preflight?.farol === 'bloqueado'
                                            ? 'bg-amber-600 hover:bg-amber-700'
                                            : 'bg-emerald-600 hover:bg-emerald-700'}`}
                                >
                                    {exporting ? 'Gerando...'
                                        : preflight?.farol === 'bloqueado'
                                            ? `Gerar assim mesmo (${preflight.notasNoArquivo} de ${preflight.documentos})`
                                            : 'Gerar arquivo .FML'}
                                </button>
                            </div>
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
