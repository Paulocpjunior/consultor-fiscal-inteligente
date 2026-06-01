/**
 * components/AnaliseRetencoesNfseSP.tsx
 *
 * Modo "Retenções NFSe SP" do componente Análise de Créditos.
 * Upload do CSV (formato exportado pela captura nfse-sp-portal) e
 * análise de retenções tributárias por nota:
 *   ISS / INSS / PIS / COFINS / CSLL / IRRF
 *
 * Função pura de análise mora em services/retencoesNfseAnalyzer.ts.
 */
import React, { useState, useMemo } from 'react';
import {
    parseCsvNfseSp,
    analisarRetencoes,
    resumirRetencoes,
    type LinhaNfseCsv,
    type AnaliseRetencoes,
} from '../services/retencoesNfseAnalyzer';

type LinhaAnalisada = LinhaNfseCsv & { analise: AnaliseRetencoes };

const TRIBUTOS = ['iss', 'inss', 'pis', 'cofins', 'csll', 'irrf'] as const;
const LABEL_TRIBUTO: Record<typeof TRIBUTOS[number], string> = {
    iss: 'ISS', inss: 'INSS', pis: 'PIS', cofins: 'COFINS', csll: 'CSLL', irrf: 'IRRF',
};
const COR_TRIBUTO: Record<typeof TRIBUTOS[number], string> = {
    iss: 'bg-blue-100 text-blue-800 border-blue-300',
    inss: 'bg-purple-100 text-purple-800 border-purple-300',
    pis: 'bg-teal-100 text-teal-800 border-teal-300',
    cofins: 'bg-cyan-100 text-cyan-800 border-cyan-300',
    csll: 'bg-amber-100 text-amber-800 border-amber-300',
    irrf: 'bg-rose-100 text-rose-800 border-rose-300',
};

const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const AnaliseRetencoesNfseSP: React.FC = () => {
    const [linhas, setLinhas] = useState<LinhaAnalisada[]>([]);
    const [filtro, setFiltro] = useState<'todas' | 'comRetencao' | 'semRetencao'>('comRetencao');
    const [erro, setErro] = useState<string | null>(null);
    const [nomeArquivo, setNomeArquivo] = useState<string>('');
    const [exportandoPDF, setExportandoPDF] = useState(false);

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setErro(null);
        setNomeArquivo(file.name);
        try {
            const txt = await file.text();
            const parsed = parseCsvNfseSp(txt);
            if (parsed.length === 0) {
                setErro('Nenhuma nota encontrada. Verifique se é o CSV exportado pela captura NFSe SP.');
                setLinhas([]);
                return;
            }
            setLinhas(parsed.map(l => ({ ...l, analise: analisarRetencoes(l) })));
        } catch (err: any) {
            setErro(`Falha ao processar CSV: ${err?.message || err}`);
            setLinhas([]);
        }
    };

    const resumo = useMemo(() => resumirRetencoes(linhas.map(l => l.analise)), [linhas]);

    const linhasFiltradas = useMemo(() => {
        if (filtro === 'todas') return linhas;
        if (filtro === 'comRetencao') return linhas.filter(l => l.analise.temAlgumaRetencao);
        return linhas.filter(l => !l.analise.temAlgumaRetencao);
    }, [linhas, filtro]);

    const exportarPDF = async () => {
        if (linhas.length === 0) return;
        setExportandoPDF(true);
        try {
            const { jsPDF } = await import('jspdf');
            const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const W = pdf.internal.pageSize.getWidth();
            const H = pdf.internal.pageSize.getHeight();
            const m = 12;
            const now = new Date().toLocaleDateString('pt-BR');
            const brl = (v: number) => (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            const drawHeader = () => {
                pdf.setFillColor(2, 0, 38); pdf.rect(0, 0, W, 16, 'F');
                pdf.setTextColor(255, 255, 255); pdf.setFontSize(11); pdf.setFont('helvetica', 'bold');
                pdf.text('Auditoria de Retencoes - NFSe SP', m, 10);
                pdf.setFontSize(8); pdf.setFont('helvetica', 'normal');
                pdf.text('Gerado em: ' + now, W - m - 40, 10);
            };
            drawHeader();
            let y = 24;
            const checkPage = (h: number) => { if (y + h > H - 12) { pdf.addPage(); drawHeader(); y = 24; } };

            if (nomeArquivo) {
                pdf.setFontSize(8); pdf.setFont('helvetica', 'italic'); pdf.setTextColor(100, 100, 100);
                pdf.text(`Origem: ${nomeArquivo}`, m, y); y += 6;
            }

            pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(2, 0, 38);
            pdf.text('RESUMO DA AUDITORIA', m, y); y += 6;

            const kpisGerais = [
                ['Total de Notas', String(resumo.totalNotas)],
                ['Com Retencao', String(resumo.notasComRetencao)],
                ['Total Retido', 'R$ ' + brl(resumo.totalRetido)],
            ];
            const kWg = (W - m * 2) / 3;
            kpisGerais.forEach((k, i) => {
                const x = m + i * kWg;
                pdf.setFillColor(240, 245, 255); pdf.rect(x, y - 4, kWg - 2, 14, 'F');
                pdf.setFontSize(7); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(80, 80, 80);
                pdf.text(k[0], x + 2, y + 1);
                pdf.setFontSize(10); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(2, 0, 38);
                pdf.text(k[1], x + 2, y + 7);
            });
            y += 20;

            pdf.setFontSize(8); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(2, 0, 38);
            pdf.text('Quebra por Tributo', m, y); y += 4;
            const kWt = (W - m * 2) / 6;
            TRIBUTOS.forEach((t, i) => {
                const x = m + i * kWt;
                pdf.setFillColor(245, 250, 255); pdf.rect(x, y - 2, kWt - 2, 16, 'F');
                pdf.setFontSize(7); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(40, 40, 40);
                pdf.text(LABEL_TRIBUTO[t], x + 2, y + 2);
                pdf.setFontSize(7); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(80, 80, 80);
                pdf.text(`${resumo.porTributo[t].qtd} notas`, x + 2, y + 7);
                pdf.setFontSize(7); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(2, 0, 38);
                pdf.text('R$ ' + brl(resumo.porTributo[t].valor), x + 2, y + 11);
            });
            y += 20;

            const renderSecao = (titulo: string, items: LinhaAnalisada[], showRetencoes: boolean) => {
                if (items.length === 0) return;

                checkPage(16);
                pdf.setFillColor(225, 235, 255); pdf.rect(m, y - 4, W - m * 2, 12, 'F');
                pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(2, 0, 38);
                pdf.text(titulo, m + 2, y + 1);
                pdf.setTextColor(60, 60, 60); pdf.setFont('helvetica', 'normal');
                pdf.text(`${items.length} notas`, W - m - 30, y + 1);
                y += 14;

                checkPage(8);
                pdf.setFillColor(245, 245, 245); pdf.rect(m + 2, y - 3, W - m * 2 - 4, 6, 'F');
                pdf.setFontSize(7); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(80, 80, 80);
                pdf.text('DIR', m + 4, y + 1);
                pdf.text('Nº', m + 14, y + 1);
                pdf.text('DATA', m + 32, y + 1);
                pdf.text('CONTRAPARTE', m + 50, y + 1);
                pdf.text('VALOR', m + 122, y + 1);
                if (showRetencoes) {
                    pdf.text('RETENCOES', m + 144, y + 1);
                    pdf.text('TOTAL RET.', W - m - 22, y + 1);
                }
                y += 6;

                for (const l of items) {
                    checkPage(5);
                    const contraparte = l.direcao === 'Emitida' ? l.tomadorNome : l.prestadorNome;
                    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(50, 50, 50); pdf.setFontSize(7);
                    pdf.text((l.direcao || '').substring(0, 3), m + 4, y);
                    pdf.text(String(l.numero || '-').substring(0, 10), m + 14, y);
                    pdf.text(String(l.data || '-').substring(0, 10), m + 32, y);
                    pdf.text(String(contraparte || '-').substring(0, 38), m + 50, y);
                    pdf.text('R$ ' + brl(l.valorServicos), m + 122, y);
                    if (showRetencoes) {
                        const trib = TRIBUTOS.filter(t => l.analise[t].retido).map(t => LABEL_TRIBUTO[t]).join(', ');
                        pdf.text(trib.substring(0, 30), m + 144, y);
                        pdf.setFont('helvetica', 'bold');
                        pdf.text('R$ ' + brl(l.analise.totalRetido), W - m - 22, y);
                    }
                    y += 5;
                }
                y += 3;
            };

            const comRetencao = linhas.filter(l => l.analise.temAlgumaRetencao);
            const semRetencao = linhas.filter(l => !l.analise.temAlgumaRetencao);
            renderSecao('NOTAS COM RETENCAO', comRetencao, true);
            renderSecao('NOTAS SEM RETENCAO', semRetencao, false);

            checkPage(14);
            pdf.setFillColor(2, 0, 38); pdf.rect(m, y - 3, W - m * 2, 10, 'F');
            pdf.setTextColor(255, 255, 255); pdf.setFontSize(10); pdf.setFont('helvetica', 'bold');
            pdf.text(`TOTAL RETIDO: R$ ${brl(resumo.totalRetido)}`, m + 2, y + 4);

            const filename = `auditoria-retencoes-nfse-sp-${new Date().toISOString().slice(0, 10)}.pdf`;
            pdf.save(filename);
        } catch (err: any) {
            setErro(`Falha ao gerar PDF: ${err?.message || err}`);
        } finally {
            setExportandoPDF(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-2">
                    📑 Análise de Retenções — CSV NFSe SP
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    Importe o CSV exportado pela captura NFSe SP. O sistema identifica retenções de ISS, INSS, PIS,
                    COFINS, CSLL e IRRF por nota — ISS vem da coluna própria; demais tributos são extraídos da
                    discriminação com filtros pra ignorar tributos aproximados (IBPT/Lei 12741) e declarações de
                    não-retenção.
                </p>
                <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleUpload}
                    className="block text-sm text-gray-600 dark:text-gray-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100"
                />
                {nomeArquivo && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Arquivo: {nomeArquivo}</p>
                )}
                {erro && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{erro}</div>
                )}
            </div>

            {linhas.length > 0 && (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                            <div className="text-xs text-gray-500">Total notas</div>
                            <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{resumo.totalNotas}</div>
                        </div>
                        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                            <div className="text-xs text-gray-500">Com retenção</div>
                            <div className="text-xl font-bold text-emerald-700">{resumo.notasComRetencao}</div>
                        </div>
                        {TRIBUTOS.map(t => (
                            <div key={t} className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                                <div className="text-xs text-gray-500">{LABEL_TRIBUTO[t]}</div>
                                <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                                    {resumo.porTributo[t].qtd}
                                </div>
                                <div className="text-[10px] text-gray-500">{formatBRL(resumo.porTributo[t].valor)}</div>
                            </div>
                        ))}
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                        <span className="text-sm text-gray-600 dark:text-gray-300">Filtro:</span>
                        {(['comRetencao', 'semRetencao', 'todas'] as const).map(f => (
                            <button
                                key={f}
                                onClick={() => setFiltro(f)}
                                className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                                    filtro === f
                                        ? 'bg-teal-600 text-white'
                                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600'
                                }`}
                            >
                                {f === 'comRetencao' && `Com retenção (${resumo.notasComRetencao})`}
                                {f === 'semRetencao' && `Sem retenção (${resumo.totalNotas - resumo.notasComRetencao})`}
                                {f === 'todas' && `Todas (${resumo.totalNotas})`}
                            </button>
                        ))}
                        <span className="ml-auto text-sm font-semibold text-gray-700 dark:text-gray-200">
                            Total retido: {formatBRL(resumo.totalRetido)}
                        </span>
                        <button
                            onClick={exportarPDF}
                            disabled={exportandoPDF || linhas.length === 0}
                            className="px-3 py-1 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {exportandoPDF ? 'Gerando...' : '📄 Exportar PDF'}
                        </button>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                                    <tr>
                                        <th className="px-2 py-2 text-left font-medium">Direção</th>
                                        <th className="px-2 py-2 text-left font-medium">Nº</th>
                                        <th className="px-2 py-2 text-left font-medium">Data</th>
                                        <th className="px-2 py-2 text-left font-medium">Contraparte</th>
                                        <th className="px-2 py-2 text-right font-medium">Valor Serv.</th>
                                        <th className="px-2 py-2 text-left font-medium">Retenções</th>
                                        <th className="px-2 py-2 text-right font-medium">Total Retido</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                    {linhasFiltradas.map((l, i) => {
                                        const contraparte = l.direcao === 'Emitida' ? l.tomadorNome : l.prestadorNome;
                                        return (
                                            <tr key={`${l.numero}-${i}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                                <td className="px-2 py-2">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                                        l.direcao === 'Emitida'
                                                            ? 'bg-green-100 text-green-700'
                                                            : 'bg-orange-100 text-orange-700'
                                                    }`}>{l.direcao}</span>
                                                </td>
                                                <td className="px-2 py-2 font-mono">{l.numero}</td>
                                                <td className="px-2 py-2">{l.data}</td>
                                                <td className="px-2 py-2 truncate max-w-[260px]" title={contraparte}>{contraparte}</td>
                                                <td className="px-2 py-2 text-right font-mono">{formatBRL(l.valorServicos)}</td>
                                                <td className="px-2 py-2">
                                                    {l.analise.temAlgumaRetencao ? (
                                                        <div className="flex flex-wrap gap-1">
                                                            {TRIBUTOS.filter(t => l.analise[t].retido).map(t => (
                                                                <span
                                                                    key={t}
                                                                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${COR_TRIBUTO[t]}`}
                                                                    title={l.analise[t].trechoEvidencia}
                                                                >
                                                                    {LABEL_TRIBUTO[t]} {formatBRL(l.analise[t].valor)}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <span className="text-gray-400 text-[10px]">—</span>
                                                    )}
                                                </td>
                                                <td className="px-2 py-2 text-right font-mono font-semibold">
                                                    {l.analise.totalRetido > 0 ? formatBRL(l.analise.totalRetido) : '—'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {linhasFiltradas.length === 0 && (
                            <div className="p-4 text-center text-sm text-gray-500">
                                Nenhuma nota corresponde ao filtro.
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default AnaliseRetencoesNfseSP;
