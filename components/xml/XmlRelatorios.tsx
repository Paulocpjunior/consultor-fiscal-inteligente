import React, { useEffect, useMemo, useState } from 'react';
import { getView } from '../../services/xmlDocumentoView';
import type { User, DocumentoFiscal } from '../../types';
import { listDocumentos, listErros, summarize } from '../../services/xmlFiscalService';
import { formatCurrency } from '../../services/xmlParserService';
// A direção pela RÉGUA e o LADO da contraparte pelo dono — as mesmas leituras
// que o SPED, o `.FML` e a lista de documentos usam. Aqui o resumo por
// competência já contava pelo dono e estes relatórios liam o campo cru: dois
// números do mesmo fato na mesma tela.
import { direcaoEfetivaDoc } from '../../sefaz-backend/xml-metadata-helper.js';
import { ladoDaContraparte } from '../../sefaz-backend/participante-doc-helper.js';

interface Props {
    currentUser: User;
    refreshKey?: number;
    onShowToast?: (msg: string) => void;
}

type RelatorioId =
    | 'competencia'
    | 'empresa'
    | 'entradas'
    | 'saidas'
    | 'cfops'
    | 'ncms'
    | 'erros'
    | 'duplicados';

interface RelatorioDef {
    id: RelatorioId;
    nome: string;
    descricao: string;
}

const RELATORIOS: RelatorioDef[] = [
    { id: 'competencia', nome: 'XMLs por competência', descricao: 'Quantidade e valor agrupados por mês de emissão.' },
    { id: 'empresa', nome: 'XMLs por empresa', descricao: 'Volume e valor por empresa do cadastro.' },
    { id: 'entradas', nome: 'XMLs de entrada', descricao: 'Documentos em que a empresa é destinatária.' },
    { id: 'saidas', nome: 'XMLs de saída', descricao: 'Documentos em que a empresa é emitente.' },
    { id: 'cfops', nome: 'CFOPs utilizados', descricao: 'Ranking de CFOPs encontrados nos itens.' },
    { id: 'ncms', nome: 'NCMs movimentados', descricao: 'Ranking de NCMs encontrados nos itens.' },
    { id: 'erros', nome: 'Erros de importação', descricao: 'Histórico de XMLs que falharam.' },
    { id: 'duplicados', nome: 'XMLs duplicados', descricao: 'Documentos com chave de NF-e repetida.' },
];

const XmlRelatorios: React.FC<Props> = ({ currentUser, refreshKey, onShowToast }) => {
    const [docs, setDocs] = useState<DocumentoFiscal[]>([]);
    const [erros, setErros] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState<RelatorioId | null>(null);
    const reportRef = React.useRef<HTMLDivElement>(null);
    const [active, setActive] = useState<RelatorioId>('competencia');

    useEffect(() => {
        let alive = true;
        setLoading(true);
        Promise.all([listDocumentos(currentUser), listErros(currentUser)]).then(([d, e]) => {
            if (alive) { setDocs(d); setErros(e); setLoading(false); }
        });
        return () => { alive = false; };
    }, [currentUser, refreshKey]);

    const summary = useMemo(() => summarize(docs), [docs]);

    const exportPdf = async () => {
        if (!reportRef.current) return;
        try {
            setExporting(active);
            const { default: jsPDF } = await import('jspdf');
            const { default: html2canvas } = await import('html2canvas');
            const canvas = await html2canvas(reportRef.current, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            pdf.setFontSize(10);
            pdf.setTextColor(100);
            pdf.text(`Central de Documentos Fiscais — ${RELATORIOS.find(r => r.id === active)?.nome}`, 10, 10);
            pdf.addImage(imgData, 'PNG', 0, 15, pdfWidth, pdfHeight);
            pdf.save(`relatorio-xml-${active}-${Date.now()}.pdf`);
            onShowToast?.('Relatório exportado em PDF.');
        } catch (e) {
            console.error(e);
            onShowToast?.('Falha ao gerar PDF.');
        } finally {
            setExporting(null);
        }
    };

    const exportBase64Json = () => {
        const payload = JSON.stringify(buildReportData(active, docs, summary, erros), null, 2);
        const b64 = btoa(unescape(encodeURIComponent(payload)));
        const blob = new Blob([b64], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `relatorio-xml-${active}-${Date.now()}.b64.txt`;
        a.click();
        URL.revokeObjectURL(url);
        onShowToast?.('Base64 do relatório baixado (uso para API).');
    };

    if (loading) return <p className="text-center text-xs text-slate-400 py-6">Gerando relatórios...</p>;

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {RELATORIOS.map(r => (
                    <button
                        key={r.id}
                        onClick={() => setActive(r.id)}
                        className={`text-left p-3 rounded-lg border transition-colors ${
                            active === r.id
                                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 ring-1 ring-emerald-300'
                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300'
                        }`}
                    >
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{r.nome}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{r.descricao}</p>
                    </button>
                ))}
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="flex justify-between items-center px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">
                        {RELATORIOS.find(r => r.id === active)?.nome}
                    </h3>
                    <div className="flex gap-2">
                        <button
                            onClick={exportPdf}
                            disabled={exporting !== null}
                            className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
                        >
                            {exporting === active ? 'Gerando...' : 'Exportar PDF'}
                        </button>
                        <button
                            onClick={exportBase64Json}
                            className="px-3 py-1.5 text-xs bg-slate-600 text-white rounded hover:bg-slate-700"
                        >
                            Exportar Base64
                        </button>
                    </div>
                </div>
                <div ref={reportRef} className="p-4 bg-white dark:bg-slate-800">
                    {renderRelatorio(active, docs, summary, erros)}
                </div>
            </div>
        </div>
    );
};

function buildReportData(id: RelatorioId, docs: DocumentoFiscal[], summary: ReturnType<typeof summarize>, erros: any[]) {
    switch (id) {
        case 'competencia': return summary.porCompetencia;
        case 'empresa': return summary.porEmpresa;
        // 🚨 Pela RÉGUA: o resumo por competência ao lado já conta pelo dono
        // (`direcaoDoDocumento`), e estes dois liam o campo cru — a compra de
        // produtor rural (art. 136) caía no relatório de SAÍDAS enquanto o
        // contador acima já a somava nas entradas. Dois números do mesmo fato
        // na mesma tela.
        case 'entradas': return docs.filter(d => direcaoEfetivaDoc(d) === 'entrada');
        case 'saidas': return docs.filter(d => direcaoEfetivaDoc(d) === 'saida');
        case 'cfops': return summary.cfops;
        case 'ncms': return summary.ncms;
        case 'erros': return erros;
        case 'duplicados': {
            const map = new Map<string, DocumentoFiscal[]>();
            docs.forEach(d => { if (d.chave) { const arr = map.get(d.chave) || []; arr.push(d); map.set(d.chave, arr); } });
            return Array.from(map.entries()).filter(([, arr]) => arr.length > 1);
        }
    }
}

function renderRelatorio(id: RelatorioId, docs: DocumentoFiscal[], summary: ReturnType<typeof summarize>, erros: any[]) {
    if (id === 'competencia') {
        const rows = Object.entries(summary.porCompetencia).sort(([a], [b]) => b.localeCompare(a));
        return rows.length === 0 ? <p className="text-xs text-slate-400">Sem dados.</p> : (
            <table className="w-full text-xs"><thead><tr className="text-left text-slate-500">
                <th>Competência</th><th>Entradas</th><th>Saídas</th><th>Valor Entradas</th><th>Valor Saídas</th>
            </tr></thead><tbody className="divide-y divide-slate-100">
                {rows.map(([c, v]) => (<tr key={c}>
                    <td className="font-mono py-1">{c}</td>
                    <td>{v.entradas}</td><td>{v.saidas}</td>
                    <td>{formatCurrency(v.valorEntradas)}</td><td>{formatCurrency(v.valorSaidas)}</td>
                </tr>))}
            </tbody></table>
        );
    }
    if (id === 'empresa') {
        const rows = Object.entries(summary.porEmpresa).sort(([, a], [, b]) => b.valorTotal - a.valorTotal);
        return rows.length === 0 ? <p className="text-xs text-slate-400">Sem dados.</p> : (
            <table className="w-full text-xs"><thead><tr className="text-left text-slate-500">
                <th>Empresa</th><th>Qtd</th><th>Valor</th>
            </tr></thead><tbody className="divide-y divide-slate-100">
                {rows.map(([id, v]) => (<tr key={id}><td className="py-1">{v.nome}</td><td>{v.total}</td><td>{formatCurrency(v.valorTotal)}</td></tr>))}
            </tbody></table>
        );
    }
    if (id === 'entradas' || id === 'saidas') {
        const list = docs.filter(d => direcaoEfetivaDoc(d) === (id === 'entradas' ? 'entrada' : 'saida'));
        return list.length === 0 ? <p className="text-xs text-slate-400">Sem dados.</p> : (
            <table className="w-full text-xs"><thead><tr className="text-left text-slate-500">
                <th>Data</th><th>Empresa</th><th>Nº</th><th>Contraparte</th><th className="text-right">Valor</th>
            </tr></thead><tbody className="divide-y divide-slate-100">
                {list.slice(0, 200).map(d => (<tr key={d.id}>
                    <td className="py-1">{new Date(d.dhEmi).toLocaleDateString('pt-BR')}</td>
                    <td>{d.empresaNome}</td>
                    <td className="font-mono">{d.numero}</td>
                    {/* ⚠️ A contraparte NÃO se deduz de "estou no relatório de
                        entradas": na nota própria de entrada quem está no
                        emitente é o PRÓPRIO cliente. Quem responde é o dono. */}
                    <td>{ladoDaContraparte(d, d.empresaCnpj) === 'emitente'
                        ? (getView(d).emitente.nome || '—')
                        : (getView(d).destinatario.nome || '—')}</td>
                    <td className="text-right font-bold">{formatCurrency(getView(d).valores.total)}</td>
                </tr>))}
            </tbody></table>
        );
    }
    if (id === 'cfops' || id === 'ncms') {
        const rows = Object.entries(id === 'cfops' ? summary.cfops : summary.ncms).sort(([, a], [, b]) => b.quantidade - a.quantidade);
        return rows.length === 0 ? <p className="text-xs text-slate-400">Sem dados.</p> : (
            <table className="w-full text-xs"><thead><tr className="text-left text-slate-500">
                <th>{id === 'cfops' ? 'CFOP' : 'NCM'}</th><th>Qtd</th><th>Valor</th>
            </tr></thead><tbody className="divide-y divide-slate-100">
                {rows.map(([k, v]) => (<tr key={k}><td className="font-mono py-1">{k}</td><td>{v.quantidade}</td><td>{formatCurrency(v.valor)}</td></tr>))}
            </tbody></table>
        );
    }
    if (id === 'erros') {
        return erros.length === 0 ? <p className="text-xs text-slate-400">Nenhum erro.</p> : (
            <table className="w-full text-xs"><thead><tr className="text-left text-slate-500">
                <th>Data</th><th>Origem</th><th>Arquivo</th><th>Mensagem</th>
            </tr></thead><tbody className="divide-y divide-slate-100">
                {erros.slice(0, 200).map((e: any) => (<tr key={e.id}>
                    <td className="py-1">{new Date(e.timestamp).toLocaleString('pt-BR')}</td>
                    <td>{e.origem}</td>
                    <td className="font-mono truncate max-w-[160px]">{e.fileName || e.chave}</td>
                    <td className="text-red-600">{e.mensagem}</td>
                </tr>))}
            </tbody></table>
        );
    }
    if (id === 'duplicados') {
        const map = new Map<string, DocumentoFiscal[]>();
        docs.forEach(d => { if (d.chave) { const arr = map.get(d.chave) || []; arr.push(d); map.set(d.chave, arr); } });
        const rows = Array.from(map.entries()).filter(([, arr]) => arr.length > 1);
        return rows.length === 0 ? <p className="text-xs text-slate-400">Nenhum duplicado encontrado.</p> : (
            <table className="w-full text-xs"><thead><tr className="text-left text-slate-500">
                <th>Chave</th><th>Ocorrências</th>
            </tr></thead><tbody className="divide-y divide-slate-100">
                {rows.map(([k, arr]) => (<tr key={k}><td className="font-mono py-1">{k}</td><td>{arr.length}</td></tr>))}
            </tbody></table>
        );
    }
    return null;
}

export default XmlRelatorios;
