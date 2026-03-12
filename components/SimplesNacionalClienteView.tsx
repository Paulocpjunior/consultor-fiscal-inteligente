import React, { useMemo, useState } from 'react';
import { SimplesNacionalEmpresa, SimplesNacionalNota } from '../types';
import * as simplesService from '../services/simplesNacionalService';
import Logo from './Logo';
import { ArrowLeftIcon, DownloadIcon, ShieldIcon } from './Icons';
import SimpleChart from './SimpleChart';

interface SimplesNacionalClienteViewProps {
    empresa: SimplesNacionalEmpresa;
    notas: SimplesNacionalNota[];
    onBack: () => void;
}

const InfoCard: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
    <div className="flex flex-col h-full">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">{label}</p>
        <p className="text-2xl font-bold text-sky-700 dark:text-sky-400">{value}</p>
        {sub && <p className="text-xs text-slate-400 dark:text-slate-500 mt-auto pt-1">{sub}</p>}
    </div>
);

const getMesesOptions = (): Date[] => {
    const options = [];
    const today = new Date();
    today.setDate(1);
    
    // Últimos 12 meses + Próximos 12 meses (Total 24 meses para seleção)
    for (let i = -12; i < 12; i++) {
        const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
        options.push(date);
    }
    return options;
};

const SimplesNacionalClienteView: React.FC<SimplesNacionalClienteViewProps> = ({ empresa, notas, onBack }) => {
    const [isExporting, setIsExporting] = useState(false);
    const [mesApuracao, setMesApuracao] = useState(new Date());
    
    const resumo = useMemo(() => {
        return simplesService.calcularResumoEmpresa(empresa, notas, mesApuracao);
    }, [empresa, notas, mesApuracao]);

    const discriminacaoImpostos = useMemo(() => {
        return simplesService.calcularDiscriminacaoImpostos(
            resumo.anexo_efetivo,
            resumo.faixa_index,
            resumo.das_mensal
        );
    }, [resumo]);

    const percentuaisImpostos = useMemo(() => {
        return simplesService.REPARTICAO_IMPOSTOS[resumo.anexo_efetivo]?.[Math.min(resumo.faixa_index, 5)] || {};
    }, [resumo]);

    const handleExportPDF = async () => {
        setIsExporting(true);
        
        // Aguarda um pequeno tempo para garantir que estados de UI se estabilizem antes da captura
        await new Promise(resolve => setTimeout(resolve, 100));

        try {
            const { default: jsPDF } = await import('jspdf');
            const { default: html2canvas } = await import('html2canvas');

            const element = document.getElementById('cliente-report-content');
            if (!element) return;
            
            const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';

            // Garante que a janela está no topo para evitar cortes no canvas
            window.scrollTo(0, 0);

            const canvas = await html2canvas(element, { 
                scale: 2,
                backgroundColor: theme === 'dark' ? '#1e293b' : '#ffffff',
                useCORS: true,
                logging: false,
                // Força a altura total do elemento para evitar cortes
                height: element.scrollHeight,
                windowHeight: element.scrollHeight
            });
            const imgData = canvas.toDataURL('image/png');

            const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

            const imgProps = pdf.getImageProperties(imgData);
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;
            
            let heightLeft = imgHeight;
            let position = 0;

            // Primeira página
            pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
            heightLeft -= pageHeight;

            // Demais páginas
            while (heightLeft > 0) {
                position -= pageHeight; // Move a imagem para cima exatamente a altura da página anterior
                pdf.addPage();
                pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
                heightLeft -= pageHeight;
            }
            
            const filename = `resumo-simples-${empresa.nome.replace(/[^a-zA-Z0-9]/g, '-')}-${mesApuracao.toISOString().slice(0,7)}.pdf`;
            pdf.save(filename);
        } catch (e) {
            console.error("Erro ao exportar PDF:", e);
            alert("Não foi possível gerar o PDF. Tente novamente.");
        } finally {
            setIsExporting(false);
        }
    };
    
    const chartData = {
        labels: resumo.historico_simulado.map(h => h.label),
        datasets: [
            {
                label: 'Faturamento Mensal (R$)',
                data: resumo.historico_simulado.map(h => h.faturamento),
                borderColor: 'rgb(14, 165, 233)', // sky-500
                backgroundColor: 'rgba(14, 165, 233, 0.1)',
                pointBackgroundColor: 'rgb(14, 165, 233)',
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: 'rgb(14, 165, 233)',
                fill: true,
                tension: 0.3,
                yAxisID: 'y',
            },
            {
                label: 'Alíquota Efetiva (%)',
                data: resumo.historico_simulado.map(h => h.aliquotaEfetiva),
                type: 'line' as const,
                borderColor: 'rgba(239, 68, 68, 0.6)', // Red 500
                borderWidth: 2,
                pointRadius: 0,
                yAxisID: 'y1',
            }
        ],
    };

     const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: true,
                position: 'bottom' as const
            },
            tooltip: {
                callbacks: {
                    label: function(context: any) {
                        let label = context.dataset.label || '';
                        if (label) {
                            label += ': ';
                        }
                        if (context.parsed.y !== null) {
                            if (context.dataset.yAxisID === 'y1') {
                                label += context.parsed.y.toFixed(2) + '%';
                            } else {
                                label += new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(context.parsed.y);
                            }
                        }
                        return label;
                    }
                }
            }
        },
        scales: {
            x: {
                grid: {
                    display: false
                },
                ticks: {
                    font: {
                        size: 10
                    }
                }
            },
            y: {
                beginAtZero: true,
                grid: {
                    color: 'rgba(0, 0, 0, 0.05)'
                },
                position: 'left' as const,
                ticks: {
                    callback: function(value: any) {
                        // Shorten large numbers
                        if(value >= 1000000) return (value/1000000).toFixed(1) + 'M';
                        if(value >= 1000) return (value/1000).toFixed(0) + 'k';
                        return value;
                    },
                     font: {
                        size: 10
                    }
                }
            },
            y1: {
                beginAtZero: true,
                type: 'linear' as const,
                display: true,
                position: 'right' as const,
                grid: {
                    drawOnChartArea: false,
                },
                ticks: {
                    callback: function(value: any) {
                        return value + '%';
                    }
                }
            }
        }
    };

    const mesesOptions = getMesesOptions();

    // Prepare breakdown list (last 12 months)
    const getRbt12Breakdown = () => {
        const breakdown: { mes: string; valor: number }[] = [];
        const dataInicioPeriodoRBT12 = new Date(mesApuracao.getFullYear(), mesApuracao.getMonth() - 12, 1);
        
        for (let i = 0; i < 12; i++) {
            const mesIteracao = new Date(dataInicioPeriodoRBT12.getFullYear(), dataInicioPeriodoRBT12.getMonth() + i, 1);
            const mesChave = `${mesIteracao.getFullYear()}-${(mesIteracao.getMonth() + 1).toString().padStart(2, '0')}`;
            const valor = resumo.mensal[mesChave] || 0;
            breakdown.push({
                mes: (mesIteracao as any).toLocaleString('pt-BR', { month: 'short', year: 'numeric' }),
                valor: valor
            });
        }
        return breakdown;
    };
    
    const rbt12Data = getRbt12Breakdown();

    return (
        <div className="animate-fade-in max-w-4xl mx-auto">
             <div className="flex justify-between items-center mb-6 print:hidden">
                <button onClick={onBack} className="flex items-center gap-2 text-sm font-semibold text-sky-600 dark:text-sky-400 hover:underline transition-colors">
                    <ArrowLeftIcon className="w-4 h-4" />
                    Voltar para o Painel
                </button>
                <button
                    onClick={handleExportPDF}
                    disabled={isExporting}
                    className="btn-press flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 transition-colors"
                >
                    <DownloadIcon className="w-5 h-5" />
                    {isExporting ? 'Gerando PDF...' : 'Salvar PDF'}
                </button>
            </div>
            
            <div id="cliente-report-content" className="bg-white dark:bg-slate-800 rounded-xl shadow-xl overflow-hidden">
                {/* Branding Header */}
                <div className="bg-gradient-to-r from-sky-700 to-blue-900 p-8 text-white">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                        <div>
                            <div className="flex items-center gap-3 mb-2">
                                {/* Logo em Branco para contraste */}
                                <Logo className="h-14 w-auto text-white" />
                                <div className="pl-3 border-l border-sky-500/50">
                                    <h1 className="text-2xl font-bold leading-tight">Relatório Gerencial</h1>
                                    <p className="text-sky-200 text-sm tracking-wider font-medium">SIMPLES NACIONAL</p>
                                </div>
                            </div>
                        </div>
                        <div className="text-right">
                            <h2 className="text-xl font-semibold">{empresa.nome}</h2>
                            <p className="text-sky-200 text-sm font-mono">{empresa.cnpj}</p>
                        </div>
                    </div>
                </div>

                <div className="p-8">
                    {/* Controls */}
                    <div className="flex items-center justify-between mb-8 pb-6 border-b border-slate-100 dark:border-slate-700">
                         <div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wide">Período de Apuração</p>
                            <p className="text-lg font-bold text-slate-800 dark:text-slate-200 capitalize">
                                {(mesApuracao as any).toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}
                            </p>
                         </div>
                         
                         <div className="print:hidden">
                             <select 
                                id="mes-ref"
                                value={mesApuracao.toISOString().substring(0, 7)}
                                onChange={e => setMesApuracao(new Date(e.target.value + '-02'))}
                                className="bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm rounded-lg focus:ring-sky-500 focus:border-sky-500 block p-2.5 cursor-pointer shadow-sm"
                            >
                                {mesesOptions.map(date => (
                                    <option key={date.toISOString()} value={date.toISOString().substring(0, 7)}>
                                        {(date as any).toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                    
                    <div className="space-y-8">
                         {/* Alerta de Sub-limite no Cliente */}
                        {resumo.ultrapassou_sublimite && (
                            <div className="p-4 bg-orange-50 dark:bg-orange-900/20 border-l-4 border-orange-500 dark:border-orange-400 rounded-r-lg">
                                <div className="flex items-start">
                                    <ShieldIcon className="w-6 h-6 text-orange-600 dark:text-orange-400 mr-3 mt-0.5" />
                                    <div>
                                        <h3 className="font-bold text-orange-800 dark:text-orange-200">Atenção: Sub-limite Estadual/Municipal Excedido</h3>
                                        <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                                            Sua empresa ultrapassou o limite de R$ 3,6 milhões de faturamento em 12 meses. O ICMS (Estadual) e ISS (Municipal) não estão mais incluídos na guia única do DAS e deverão ser pagos separadamente. Entre em contato para mais detalhes.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Cards Principais */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                             <div className="p-6 rounded-xl bg-sky-50 dark:bg-sky-900/20 border border-sky-100 dark:border-sky-800/50 transition-all hover:shadow-md">
                                <InfoCard label="Faturamento Mês (Base)" value={`R$ ${(resumo.totalMercadoInterno + resumo.totalMercadoExterno).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} />
                             </div>
                             <div className="p-6 rounded-xl bg-slate-50 dark:bg-slate-700/30 border border-slate-100 dark:border-slate-700 transition-all hover:shadow-md">
                                <InfoCard label="Faturamento 12 Meses (RBT12)" value={`R$ ${resumo.rbt12.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} />
                             </div>
                             <div className="p-6 rounded-xl bg-slate-50 dark:bg-slate-700/30 border border-slate-100 dark:border-slate-700 transition-all hover:shadow-md">
                                <InfoCard label="Folha de Salários (12m)" value={`R$ ${resumo.folha_12.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} sub={`Fator R: ${(resumo.fator_r * 100).toFixed(1)}%`} />
                             </div>
                             <div className="p-6 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/50 transition-all hover:shadow-md">
                                <InfoCard label="Enquadramento" value={`Anexo ${resumo.anexo_efetivo}`} sub={empresa.anexo === 'III_V' ? 'Sujeito ao Fator R' : 'Tabela Fixa'} />
                             </div>
                        </div>

                        {/* Destaque Tributário */}
                        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                            <div className="bg-slate-50 dark:bg-slate-700/50 px-8 py-4 border-b border-slate-200 dark:border-slate-700">
                                <h3 className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                                    Cálculo do Imposto
                                    <span className="px-2 py-0.5 text-[10px] uppercase bg-sky-100 text-sky-700 rounded-full font-bold">Estimado</span>
                                </h3>
                            </div>
                            <div className="p-8 grid grid-cols-1 sm:grid-cols-3 gap-8 items-center">
                                <div className="text-center sm:text-left">
                                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Alíquota Efetiva</p>
                                    <p className="text-4xl font-extrabold text-slate-800 dark:text-slate-100">{resumo.aliq_eff.toFixed(2)}%</p>
                                </div>
                                <div className="text-center sm:text-left sm:col-span-2 p-4 bg-sky-50 dark:bg-sky-900/20 rounded-lg border border-sky-100 dark:border-sky-800/30">
                                    <p className="text-sm text-sky-700 dark:text-sky-300 mb-1 font-semibold uppercase tracking-wide">Valor do DAS (Mês)</p>
                                    <p className="text-4xl font-extrabold text-sky-600 dark:text-sky-400">
                                        R$ {resumo.das_mensal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                    </p>
                                    <p className="text-xs text-sky-600/70 dark:text-sky-400/70 mt-1">
                                        Vencimento estimado: dia 20 do próximo mês
                                    </p>
                                </div>
                            </div>
                             <div className="px-8 py-3 bg-yellow-50 dark:bg-yellow-900/20 border-t border-yellow-100 dark:border-yellow-800/30">
                                <p className="text-xs text-yellow-700 dark:text-yellow-400 flex items-center gap-2">
                                    <span className="font-bold bg-yellow-200 dark:bg-yellow-800 px-1.5 rounded text-[10px]">NOTA</span> 
                                    Este é um cálculo simulado com base nos dados informados. A guia oficial para pagamento deve ser gerada exclusivamente no portal do e-CAC.
                                </p>
                            </div>
                        </div>

                        {/* Resumo da Receita Bruta (Tabela) - Included for PDF Export */}
                        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                            <div className="bg-slate-50 dark:bg-slate-700/50 px-6 py-3 border-b border-slate-200 dark:border-slate-700">
                                <h3 className="font-bold text-slate-700 dark:text-slate-200 text-sm">
                                    Detalhamento da Receita Bruta (RBT12)
                                </h3>
                            </div>
                            <div className="p-6">
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                                    {rbt12Data.map((item, index) => (
                                        <div key={index} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-700/30 rounded-lg border border-slate-100 dark:border-slate-700">
                                            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 capitalize">{item.mes}</span>
                                            <span className="text-sm font-mono font-bold text-slate-700 dark:text-slate-200">
                                                {(item.valor as any).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700 flex justify-end">
                                    <div className="text-right">
                                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mr-2">Total Acumulado:</span>
                                        <span className="text-lg font-bold text-sky-700 dark:text-sky-400">
                                            R$ {(resumo.rbt12 as any).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        {/* Memória de Cálculo - Discriminação dos Impostos */}
                        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm break-inside-avoid">
                            <div className="bg-slate-50 dark:bg-slate-700/50 px-6 py-3 border-b border-slate-200 dark:border-slate-700">
                                <h3 className="font-bold text-slate-700 dark:text-slate-200 text-sm">
                                    Discriminação Estimada dos Tributos (Memória de Cálculo)
                                </h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left text-slate-500 dark:text-slate-400">
                                    <thead className="text-xs text-slate-700 uppercase bg-slate-50 dark:bg-slate-700 dark:text-slate-300">
                                        <tr>
                                            <th scope="col" className="px-6 py-3">Tributo / Ente</th>
                                            <th scope="col" className="px-6 py-3 text-center">% Partilha</th>
                                            <th scope="col" className="px-6 py-3 text-right">Valor (R$)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Object.entries(discriminacaoImpostos).map(([imposto, valor], index) => {
                                             const percentual = percentuaisImpostos[imposto] || 0;
                                             return (
                                                <tr key={imposto} className="bg-white dark:bg-slate-800 border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                                    <td className="px-6 py-3 font-medium text-slate-900 dark:text-white">
                                                        {imposto}
                                                    </td>
                                                    <td className="px-6 py-3 text-center">
                                                        {percentual.toFixed(2)}%
                                                    </td>
                                                    <td className="px-6 py-3 text-right font-mono text-slate-700 dark:text-slate-200">
                                                        {(valor as any).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                    </td>
                                                </tr>
                                             );
                                        })}
                                        {Object.keys(discriminacaoImpostos).length === 0 && (
                                            <tr>
                                                <td colSpan={3} className="px-6 py-4 text-center text-slate-400">
                                                    Nenhum imposto calculado ou valor do DAS zerado.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                            {resumo.ultrapassou_sublimite && (
                                <div className="px-6 py-3 bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-700">
                                    * Nota: Devido ao sublimite excedido, ICMS e ISS não compõem o cálculo acima.
                                </div>
                            )}
                        </div>

                        {/* Gráfico */}
                        <div>
                            <h3 className="text-lg font-bold text-slate-700 dark:text-slate-200 mb-4">Evolução do Faturamento</h3>
                            <div className="h-80 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-sm">
                                {resumo.historico_simulado.length > 0 ? (
                                    <SimpleChart type="bar" options={chartOptions} data={chartData} />
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-400">
                                        <p>Sem dados.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <footer className="bg-slate-50 dark:bg-slate-900/50 p-8 text-center border-t border-slate-200 dark:border-slate-700 mt-4">
                     <div className="flex items-center justify-center gap-2 mb-3 opacity-70 grayscale hover:grayscale-0 transition-all">
                        <Logo className="h-8 w-auto text-slate-600 dark:text-slate-400" />
                     </div>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                        Documento gerado em {(new Date() as any).toLocaleDateString('pt-BR')} • SP Assessoria Contábil
                    </p>
                </footer>
            </div>
        </div>
    );
};

export default SimplesNacionalClienteView;