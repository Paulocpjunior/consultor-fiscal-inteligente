/**
 * components/LucroPresumidoReal/ReportView.tsx
 *
 * Memoria de Apuracao do regime LP/LR -- layout padrao Big4 (template
 * de "Memoria de Apuracao" pra cliente). Extraida de
 * LucroPresumidoRealDashboard.tsx (renderReport, ~290 linhas).
 *
 * Sessoes:
 *   1. Header (titulo + enquadramento + competencia)
 *   2. Identificacao (nome/CNPJ + carga tributaria efetiva)
 *   3. Fluxo Operacional: receitas/bases (esquerda) + custos/impostos (direita)
 *   4. Acumulado trimestral (so quando periodo eh Trimestral)
 *
 * Botoes (escondidos no print):
 *   - Voltar pra details
 *   - Editar competencia
 *   - Imprimir (HTML→PDF via window.print)
 *   - Comparativo P×R (PDF Big4 lateral via lucroComparativoPdf service)
 *
 * Calcula os mesmos valores do card live (incluindo retencoes acumuladas
 * do trimestre) pra IRPJ/CSLL aparecerem liquidos -- consistente.
 */
import React from 'react';
import { LucroPresumidoEmpresa, FichaFinanceiraRegistro, LucroInput } from '../../types';
import { calcularLucro } from '../../services/lucroService';
import { ArrowLeftIcon, PencilIcon, DownloadIcon, BuildingIcon, InfoIcon } from '../Icons';
import { convertFichaToInput, getRetencoesAcumuladasTrimestre } from './fichaCalc';

interface ReportViewProps {
    ficha: FichaFinanceiraRegistro;
    empresa: LucroPresumidoEmpresa;
    onVoltar: () => void;
    onEditar: () => void;
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ReportView: React.FC<ReportViewProps> = ({ ficha, empresa, onVoltar, onEditar }) => {
    const financeiro = {
        cmv: ficha.cmv || 0,
        folha: ficha.folha || 0,
        despesas: (ficha.despesas || 0) + (ficha.despesasDedutiveis || 0),
    };
    const itensAvulsos = ficha.itensAvulsos || [];

    // Aplica retencoes acumuladas do trimestre (meses anteriores) ao input do calculo,
    // para o relatorio final mostrar IRPJ/CSLL liquidos -- igual ao card live.
    const baseInput = convertFichaToInput(ficha, empresa);
    const retAcum = getRetencoesAcumuladasTrimestre(empresa, ficha.mesReferencia, ficha.periodoApuracao);
    const inputRelatorio: LucroInput = {
        ...baseInput,
        retencaoIrpj: (baseInput.retencaoIrpj || 0) + retAcum.irpj,
        retencaoCsll: (baseInput.retencaoCsll || 0) + retAcum.csll,
    };
    const resultadoCalculado = calcularLucro(inputRelatorio);
    const [ano, mes] = ficha.mesReferencia.split('-');
    const dateObj = new Date(parseInt(ano), parseInt(mes) - 1, 1);
    const mesExtenso = dateObj.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });

    // Bases pra exibicao
    const baseIrpjCsll = ficha.faturamentoMesTotal - (ficha.valorIpi || 0) - (ficha.valorDevolucoes || 0);
    // Base PIS/COFINS pra referencia visual (liquida de ICMS)
    const basePisCofins = baseIrpjCsll - (ficha.icmsVendas || 0);

    const handleComparativoPdf = async () => {
        // Gera PDF profissional Presumido × Real com capa, sumario, apuracao
        // lado a lado e disclaimer (padrao Big4) via lazy import.
        const { compararRegimes, gerarPdfComparativoLucro } =
            await import('../../services/lucroComparativoPdf');
        const comp = compararRegimes(inputRelatorio);
        const blob = await gerarPdfComparativoLucro({
            input: inputRelatorio,
            comparativo: comp,
            cliente: empresa?.nome,
            clienteCnpj: empresa?.cnpj,
            periodo: mesExtenso,
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `comparativo-lucro-${empresa?.nome?.replace(/\W+/g, '-').toLowerCase() || 'cliente'}-${ficha.mesReferencia}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6 animate-fade-in pb-10">
            <div className="flex items-center justify-between gap-4 print:hidden">
                <div className="flex items-center gap-4">
                    <button onClick={onVoltar} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full"><ArrowLeftIcon className="w-5 h-5" /></button>
                    <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Relatório de Apuração</h2>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={onEditar}
                        className="btn-press flex items-center gap-2 px-4 py-2 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-bold rounded-lg hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                    >
                        <PencilIcon className="w-4 h-4" /> Editar Competência
                    </button>
                    <button
                        className="btn-press flex items-center gap-2 px-4 py-2 bg-sky-600 text-white font-bold rounded-lg hover:bg-sky-700 transition-colors"
                        onClick={() => window.print()}
                        title="Imprime via navegador o relatório de apuração do regime atual (HTML→PDF)"
                    >
                        <DownloadIcon className="w-4 h-4" /> Imprimir (regime atual)
                    </button>
                    <button
                        className="btn-press flex items-center gap-2 px-4 py-2 bg-slate-800 text-white font-bold rounded-lg hover:bg-slate-900 transition-colors"
                        onClick={handleComparativoPdf}
                        title="Gera PDF profissional Presumido × Real com capa, sumário executivo, apuração lado a lado e recomendação. Pronto pra levar à reunião com o cliente."
                    >
                        <DownloadIcon className="w-4 h-4" /> Comparativo P × R (PDF)
                    </button>
                </div>
            </div>

            {/* PDF Template Container */}
            <div className="bg-white text-slate-800 p-0 md:p-8 max-w-4xl mx-auto rounded-none md:rounded-xl shadow-none md:shadow-lg overflow-hidden">

                {/* Header Report */}
                <div className="flex justify-between items-start border-b-4 border-sky-600 pb-6 mb-8">
                    <div>
                        <h1 className="text-3xl font-black text-slate-800 tracking-tight">MEMÓRIA DE APURAÇÃO</h1>
                        <p className="text-sky-600 font-bold text-sm uppercase tracking-widest mt-1">SP ASSESSORIA CONTÁBIL • AUDITORIA E PLANEJAMENTO</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] text-slate-400 uppercase font-bold">Enquadramento Aplicado</p>
                        <p className="text-xl font-black text-sky-800 uppercase leading-none">{ficha.regime} {ficha.periodoApuracao === 'Trimestral' ? '/ Trimestral' : ''}</p>
                        <p className="text-sm font-bold text-slate-500 uppercase mt-1">{mesExtenso}</p>
                    </div>
                </div>

                <div className="flex justify-between items-center bg-slate-50 rounded-2xl p-6 mb-8 border border-slate-100">
                    <div>
                        <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">Empresa / Contribuinte</p>
                        <h2 className="text-xl font-black text-slate-800">{empresa.nome}</h2>
                        <span className="inline-block bg-sky-100 text-sky-800 text-xs font-mono font-bold px-2 py-1 rounded mt-1">{empresa.cnpj}</span>
                    </div>
                    <div className="bg-sky-600 text-white px-6 py-4 rounded-xl text-center shadow-lg transform -rotate-1">
                        <p className="text-[10px] font-bold opacity-80 uppercase">Carga Tributária Efetiva</p>
                        <p className="text-3xl font-black">{resultadoCalculado.cargaTributaria.toFixed(2)}%</p>
                        <p className="text-[9px] font-bold opacity-80 uppercase">Sobre Faturamento Bruto</p>
                    </div>
                </div>

                <div className="mb-6 flex items-center gap-2">
                    <div className="bg-sky-800 text-white p-2 rounded-lg">
                        <BuildingIcon className="w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-black text-slate-800 uppercase">1. Fluxo Operacional de Receitas e Custos</h3>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Receitas */}
                    <div className="bg-white border-2 border-slate-100 rounded-[2rem] p-8 shadow-sm">
                        <h4 className="text-xs font-black text-slate-400 uppercase mb-6 border-b pb-2">Receitas Operacionais Brutas</h4>
                        <div className="space-y-2">
                            {ficha.faturamentoMesComercio > 0 && <div className="flex justify-between text-sm font-bold text-slate-600"><span>Comércio (Matriz+Filial):</span><span>{brl(ficha.faturamentoMesComercio)}</span></div>}
                            {ficha.faturamentoMesIndustria > 0 && <div className="flex justify-between text-sm font-bold text-slate-600"><span>Indústria (Matriz+Filial):</span><span>{brl(ficha.faturamentoMesIndustria)}</span></div>}
                            {ficha.faturamentoMesServico > 0 && <div className="flex justify-between text-sm font-bold text-slate-600"><span>Serviços ISS Próprio (Matriz+Filial):</span><span>{brl(ficha.faturamentoMesServico)}</span></div>}
                            {ficha.faturamentoMesServicoRetido > 0 && <div className="flex justify-between text-sm font-bold text-slate-600"><span>Serviços ISS Retido (Matriz+Filial):</span><span>{brl(ficha.faturamentoMesServicoRetido)}</span></div>}
                            {ficha.faturamentoMesLocacao > 0 && <div className="flex justify-between text-sm font-bold text-slate-600"><span>Locação de Bens (Matriz+Filial):</span><span>{brl(ficha.faturamentoMesLocacao)}</span></div>}
                            {ficha.faturamentoMesServicoHospitalar > 0 && <div className="flex justify-between text-sm font-bold text-slate-600"><span>Serviços Hospitalares (Matriz+Filial):</span><span>{brl(ficha.faturamentoMesServicoHospitalar)}</span></div>}
                            {ficha.receitaFinanceira > 0 && <div className="flex justify-between text-sm font-bold text-amber-600"><span>(+) Receita Financeira:</span><span>{brl(ficha.receitaFinanceira)}</span></div>}
                            {itensAvulsos.filter(i => i.tipo === 'receita').length > 0 && (
                                <div className="flex justify-between text-sm font-bold text-emerald-600">
                                    <span>(+) Itens Adicionais (Extra Operacionais):</span>
                                    <span>{brl(itensAvulsos.filter(i => i.tipo === 'receita').reduce((a, b) => a + b.valor, 0))}</span>
                                </div>
                            )}

                            {/* Deduções e Bases */}
                            {(ficha.valorIpi > 0 || ficha.valorDevolucoes > 0) && (
                                <div className="pt-2 mt-2 border-t border-dashed border-slate-200">
                                    {ficha.valorIpi > 0 && <div className="flex justify-between text-xs font-bold text-red-400 italic"><span>(-) Dedução IPI:</span><span>{brl(ficha.valorIpi)}</span></div>}
                                    {ficha.valorDevolucoes > 0 && <div className="flex justify-between text-xs font-bold text-red-400 italic"><span>(-) Dedução Devoluções:</span><span>{brl(ficha.valorDevolucoes)}</span></div>}
                                </div>
                            )}

                            <div className="flex justify-between text-base font-black text-slate-800 border-t pt-4 mt-2">
                                <span>Base Cálculo IRPJ/CSLL:</span>
                                <span>{brl(baseIrpjCsll)}</span>
                            </div>

                            {ficha.icmsVendas > 0 && (
                                <div className="flex justify-between text-xs font-bold text-blue-400 italic mt-1">
                                    <span>(-) Ded. ICMS s/ Vendas (STF):</span>
                                    <span>{brl(ficha.icmsVendas)}</span>
                                </div>
                            )}

                            {ficha.faturamentoMonofasico > 0 && (
                                <div className="flex justify-between text-xs font-bold text-blue-400 italic mt-1">
                                    <span>(-) Receita Monofásica (PIS/COFINS):</span>
                                    <span>{brl(ficha.faturamentoMonofasico)}</span>
                                </div>
                            )}

                            <div className="flex justify-between text-sm font-black text-slate-700 mt-2">
                                <span>Base Cálculo PIS/COFINS:</span>
                                <span>{brl(basePisCofins)}</span>
                            </div>

                            {/* Ajustes Lucro Real */}
                            {ficha.regime === 'Real' && ((ficha.ajustesLucroRealAdicoes || 0) > 0 || (ficha.ajustesLucroRealExclusoes || 0) > 0) && (
                                <div className="pt-2 mt-2 border-t border-emerald-100">
                                    <h5 className="text-[10px] font-black text-emerald-600 uppercase mb-1">Ajustes Lucro Real (LALUR)</h5>
                                    {(ficha.ajustesLucroRealAdicoes || 0) > 0 && <div className="flex justify-between text-xs font-bold text-emerald-600"><span>(+) Adições:</span><span>{brl(ficha.ajustesLucroRealAdicoes || 0)}</span></div>}
                                    {(ficha.ajustesLucroRealExclusoes || 0) > 0 && <div className="flex justify-between text-xs font-bold text-red-500"><span>(-) Exclusões:</span><span>{brl(ficha.ajustesLucroRealExclusoes || 0)}</span></div>}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Custos, Gastos e IMPOSTOS */}
                    <div className="bg-white border-2 border-slate-100 rounded-[2rem] p-8 shadow-sm">
                        <h4 className="text-xs font-black text-slate-400 uppercase mb-6 border-b pb-2">Custos, Gastos e Impostos</h4>
                        <div className="space-y-4">
                            <div className="flex justify-between text-sm font-bold text-slate-600"><span>Custo de Mercadoria (CMV):</span><span>{brl(financeiro.cmv)}</span></div>
                            <div className="flex justify-between text-sm font-bold text-slate-600"><span>Folha e Encargos Sociais:</span><span>{brl(financeiro.folha)}</span></div>
                            <div className="flex justify-between text-sm font-bold text-slate-600"><span>Despesas Operacionais:</span><span>{brl(financeiro.despesas)}</span></div>

                            {/* Saldos Credores */}
                            {((ficha.saldoCredorIcms || 0) > 0 || (ficha.saldoCredorIpi || 0) > 0) && (
                                <div className="pt-2 mt-2 border-t border-slate-100">
                                    <h5 className="text-[10px] font-black text-slate-400 uppercase mb-1">Saldos Credores Compensados</h5>
                                    {(ficha.saldoCredorIcms || 0) > 0 && <div className="flex justify-between text-xs font-bold text-slate-500"><span>Cred. ICMS Anterior:</span><span>{brl(ficha.saldoCredorIcms || 0)}</span></div>}
                                    {(ficha.saldoCredorIpi || 0) > 0 && <div className="flex justify-between text-xs font-bold text-slate-500"><span>Cred. IPI Anterior:</span><span>{brl(ficha.saldoCredorIpi || 0)}</span></div>}
                                </div>
                            )}

                            {/* Retenções na Fonte */}
                            {(ficha.retencaoPis > 0 || ficha.retencaoCofins > 0 || ficha.retencaoIrpj > 0 || ficha.retencaoCsll > 0) && (
                                <div className="pt-2 mt-2 border-t border-slate-100">
                                    <h5 className="text-[10px] font-black text-slate-400 uppercase mb-1">Retenções na Fonte (Deduções Federais)</h5>
                                    {ficha.retencaoPis > 0 && <div className="flex justify-between text-xs font-bold text-slate-500"><span>PIS Retido:</span><span>{brl(ficha.retencaoPis)}</span></div>}
                                    {ficha.retencaoCofins > 0 && <div className="flex justify-between text-xs font-bold text-slate-500"><span>COFINS Retido:</span><span>{brl(ficha.retencaoCofins)}</span></div>}
                                    {ficha.retencaoIrpj > 0 && <div className="flex justify-between text-xs font-bold text-slate-500"><span>IRPJ Retido:</span><span>{brl(ficha.retencaoIrpj)}</span></div>}
                                    {ficha.retencaoCsll > 0 && <div className="flex justify-between text-xs font-bold text-slate-500"><span>CSLL Retido:</span><span>{brl(ficha.retencaoCsll)}</span></div>}
                                </div>
                            )}

                            {itensAvulsos.filter(i => i.tipo === 'despesa').length > 0 && (
                                <div className="flex justify-between text-sm font-bold text-slate-600">
                                    <span>(+) Outras Despesas:</span>
                                    <span>{brl(itensAvulsos.filter(i => i.tipo === 'despesa').reduce((a, b) => a + b.valor, 0))}</span>
                                </div>
                            )}

                            {/* Detalhamento de Impostos - Lista Completa */}
                            <div className="pt-4 mt-2 border-t border-slate-100 space-y-2">
                                {resultadoCalculado.detalhamento.map((det, idx) => (
                                    <div key={idx} className="flex justify-between text-sm font-bold text-amber-600">
                                        <span>{det.imposto}:</span>
                                        <span>{brl(det.valor)}</span>
                                    </div>
                                ))}
                                {resultadoCalculado.detalhamento.length === 0 && (
                                    <p className="text-xs text-slate-400 italic">Nenhum imposto apurado.</p>
                                )}
                            </div>

                            <div className="flex justify-between text-base font-black text-sky-900 border-t border-sky-100 pt-4 mt-2">
                                <span>Total Desembolsos:</span>
                                <span>{brl(financeiro.cmv + financeiro.folha + financeiro.despesas + itensAvulsos.filter(i => i.tipo === 'despesa').reduce((a, b) => a + b.valor, 0) + resultadoCalculado.totalImpostos)}</span>
                            </div>
                        </div>
                    </div>

                    {/* SEÇÃO EXTRA: DADOS TRIMESTRAIS ACUMULADOS (Se houver) */}
                    {ficha.dadosTrimestrais && ficha.periodoApuracao === 'Trimestral' && (
                        <div className="bg-sky-50/50 border-2 border-sky-100 rounded-[2rem] p-8 shadow-sm col-span-1 lg:col-span-2">
                            <h4 className="text-xs font-black text-sky-600 uppercase mb-4 border-b border-sky-100 pb-2 flex items-center gap-2">
                                <InfoIcon className="w-4 h-4" /> Memória de Cálculo - Acumulado Trimestral (Meses Anteriores)
                            </h4>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm mb-4">
                                {ficha.dadosTrimestrais.comercio > 0 && (
                                    <div>
                                        <span className="block text-slate-500 text-[10px] uppercase font-bold">Comércio Ant.</span>
                                        <span className="font-bold text-slate-700">{brl(ficha.dadosTrimestrais.comercio)}</span>
                                    </div>
                                )}
                                {ficha.dadosTrimestrais.industria > 0 && (
                                    <div>
                                        <span className="block text-slate-500 text-[10px] uppercase font-bold">Indústria Ant.</span>
                                        <span className="font-bold text-slate-700">{brl(ficha.dadosTrimestrais.industria)}</span>
                                    </div>
                                )}
                                {ficha.dadosTrimestrais.servico > 0 && (
                                    <div>
                                        <span className="block text-slate-500 text-[10px] uppercase font-bold">Serviços Ant.</span>
                                        <span className="font-bold text-slate-700">{brl(ficha.dadosTrimestrais.servico)}</span>
                                    </div>
                                )}
                                {(ficha.dadosTrimestrais.servicoHospitalar || 0) > 0 && (
                                    <div>
                                        <span className="block text-slate-500 text-[10px] uppercase font-bold">Hospitalar Ant.</span>
                                        <span className="font-bold text-slate-700">{brl(ficha.dadosTrimestrais.servicoHospitalar || 0)}</span>
                                    </div>
                                )}
                                {ficha.dadosTrimestrais.financeira > 0 && (
                                    <div>
                                        <span className="block text-slate-500 text-[10px] uppercase font-bold">Rec. Fin. Ant.</span>
                                        <span className="font-bold text-slate-700">{brl(ficha.dadosTrimestrais.financeira)}</span>
                                    </div>
                                )}
                                {(ficha.dadosTrimestrais.aluguel ?? 0) > 0 && (
                                    <div>
                                        <span className="block text-slate-500 text-[10px] uppercase font-bold">Rec. Fin. Ant.</span>
                                        <span className="font-bold text-slate-700">{brl(ficha.dadosTrimestrais.aluguel ?? 0)}</span>
                                    </div>
                                )}
                            </div>
                            <p className="text-[10px] text-slate-500 italic">
                                * Estes valores foram somados à receita do mês atual para o cálculo da base trimestral do IRPJ e CSLL (Adicional de 10% sobre excedente de R$ 60.000,00).
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ReportView;
