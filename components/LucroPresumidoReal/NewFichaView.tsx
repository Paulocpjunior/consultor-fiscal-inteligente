/**
 * components/LucroPresumidoReal/NewFichaView.tsx
 *
 * Tela de criacao/edicao de competencia (ficha financeira) do regime
 * Lucro Presumido/Real. Extraida de LucroPresumidoRealDashboard.tsx
 * (renderNewFicha) -- ~512 linhas que dominavam o monolito.
 *
 * Layout em 2 colunas:
 *   COLUNA 1 (esquerda, lg:col-span-2): Configuracoes fiscais (ISS,
 *     equiparacao hospitalar, presuncao reduzida), consolidacao de
 *     filiais, receitas da matriz com acumulado trimestral, deducoes,
 *     apuracao de ICMS/IPI manual e ajustes lucro real + saldos credores.
 *   COLUNA 2 (direita sticky): card preto com detalhamento dos impostos
 *     apurados em tempo real (liveResults), botao DCTFWeb e formulario
 *     de custos e retencoes na fonte.
 *
 * Estado e setters ficam no dashboard pai porque o useEffect que popula
 * os campos quando o usuario edita uma ficha existente depende de muitos
 * deles -- centralizar la simplifica a dependencia. Esta view eh
 * puramente apresentacional, recebe tudo via props.
 */
import React, { useState } from 'react';
import { LucroPresumidoEmpresa, LucroResult, ItemFinanceiroAvulso } from '../../types';
import DareSpModal from './DareSpModal';
import {
    ArrowLeftIcon, SaveIcon, ShieldIcon, BuildingIcon, CalculatorIcon,
    InfoIcon, TagIcon, BriefcaseIcon, PlusIcon, TrashIcon,
} from '../Icons';
import { CurrencyInput, ToggleSwitch } from './inputs';
import { avaliarPresuncaoReduzida16, avisoPeriodoApuracao } from '../../services/lucroService';

interface NewFichaViewProps {
    // Contexto
    selectedEmpresa: LucroPresumidoEmpresa | undefined;
    selectedFichaId: string | null;
    loading: boolean;

    // Receitas (Matriz)
    fichaMes: string; setFichaMes: (v: string) => void;
    periodoApuracao: 'Mensal' | 'Trimestral'; setPeriodoApuracao: (v: 'Mensal' | 'Trimestral') => void;
    fichaComercio: number; setFichaComercio: (v: number) => void;
    fichaIndustria: number; setFichaIndustria: (v: number) => void;
    fichaServico: number; setFichaServico: (v: number) => void;
    fichaServicoRetido: number; setFichaServicoRetido: (v: number) => void;
    fichaLocacao: number; setFichaLocacao: (v: number) => void;
    fichaServicoHospitalar: number; setFichaServicoHospitalar: (v: number) => void;
    fichaRecFinanceira: number; setFichaRecFinanceira: (v: number) => void;

    // Acumulado Trimestre
    acumuladoComercio: number; setAcumuladoComercio: (v: number) => void;
    acumuladoIndustria: number; setAcumuladoIndustria: (v: number) => void;
    acumuladoServico: number; setAcumuladoServico: (v: number) => void;
    acumuladoServicoHospitalar: number; setAcumuladoServicoHospitalar: (v: number) => void;
    acumuladoFinanceira: number; setAcumuladoFinanceira: (v: number) => void;
    acumuladoAluguel: number; setAcumuladoAluguel: (v: number) => void;
    /** Receita dos TRIMESTRES ANTERIORES do ano — limite da majoração LC 224/25. */
    saldoAnteriorLc224: number; setSaldoAnteriorLc224: (v: number) => void;

    // Filiais
    fichaFilialComercio: number; setFichaFilialComercio: (v: number) => void;
    fichaFilialIndustria: number; setFichaFilialIndustria: (v: number) => void;
    fichaFilialServico: number; setFichaFilialServico: (v: number) => void;
    fichaFilialServicoHospitalar: number; setFichaFilialServicoHospitalar: (v: number) => void;

    // Deducoes
    isMonofasicoOption: boolean; setIsMonofasicoOption: (v: boolean) => void;
    fichaMonofasico: number; setFichaMonofasico: (v: number) => void;
    fichaIpi: number; setFichaIpi: (v: number) => void;
    /** ICMS-ST destacado nas vendas — dedução da receita bruta (igual IPI). */
    fichaIcmsStFaturado: number; setFichaIcmsStFaturado: (v: number) => void;
    fichaIcmsVendas: number; setFichaIcmsVendas: (v: number) => void;
    fichaDevolucoes: number; setFichaDevolucoes: (v: number) => void;

    // Custos
    fichaCmv: number; setFichaCmv: (v: number) => void;
    fichaFolha: number; setFichaFolha: (v: number) => void;
    fichaDespesas: number; setFichaDespesas: (v: number) => void;
    fichaDespesasDedutiveis: number; setFichaDespesasDedutiveis: (v: number) => void;

    // Retencoes na fonte
    fichaRetPis: number; setFichaRetPis: (v: number) => void;
    fichaRetCofins: number; setFichaRetCofins: (v: number) => void;
    fichaRetIrpj: number; setFichaRetIrpj: (v: number) => void;
    fichaRetCsll: number; setFichaRetCsll: (v: number) => void;

    // Outros impostos manuais
    fichaIpiRecolher: number; setFichaIpiRecolher: (v: number) => void;
    fichaIcmsProprio: number; setFichaIcmsProprio: (v: number) => void;
    fichaIcmsSt: number; setFichaIcmsSt: (v: number) => void;

    // Ajustes Lucro Real
    ajustesLucroRealAdicoes: number; setAjustesLucroRealAdicoes: (v: number) => void;
    ajustesLucroRealExclusoes: number; setAjustesLucroRealExclusoes: (v: number) => void;
    itensAdicionaisExtra: number; setItensAdicionaisExtra: (v: number) => void;

    // Despesas itemizadas
    despesasAvulsas: ItemFinanceiroAvulso[];
    onAddDespesa: () => void;
    onRemoveDespesa: (id: string) => void;
    onUpdateDespesa: (id: string, field: keyof ItemFinanceiroAvulso, value: any) => void;

    // Saldos credores
    saldoCredorIcms: number; setSaldoCredorIcms: (v: number) => void;
    saldoCredorIpi: number; setSaldoCredorIpi: (v: number) => void;
    saldoCredorPis: number; setSaldoCredorPis: (v: number) => void;
    saldoCredorCofins: number; setSaldoCredorCofins: (v: number) => void;

    // Configuracoes fiscais
    isEquiparacaoHospitalar: boolean; setIsEquiparacaoHospitalar: (v: boolean) => void;
    isPresuncaoReduzida: boolean; setIsPresuncaoReduzida: (v: boolean) => void;
    issTipo: 'aliquota_municipal' | 'sup_fixo'; setIssTipo: (v: 'aliquota_municipal' | 'sup_fixo') => void;
    issAliquota: number; setIssAliquota: (v: number) => void;
    pagarCotas: boolean; setPagarCotas: (v: boolean) => void;

    // Calculo em tempo real
    liveResults: LucroResult | null;
    retencoesAcumuladas: { irpj: number; csll: number };

    // Callbacks
    onVoltar: () => void;
    onSalvar: () => void;
    onAbrirConferirDctfweb: () => void;
}

const NewFichaView: React.FC<NewFichaViewProps> = (p) => {
    // DARE-SP: único estado local desta view (efêmero de UI — não precisa
    // subir pro dashboard pai como os campos da ficha).
    const [dareModal, setDareModal] = useState<{ valor: number; derivacao: 'proprio' | 'st' } | null>(null);
    const avisoPeriodo = avisoPeriodoApuracao(p.selectedEmpresa?.regimePadrao, p.periodoApuracao, p.fichaMes);
    return (
    <div className="max-w-7xl mx-auto animate-fade-in pb-20">
        <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-4">
                <button onClick={p.onVoltar} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full text-slate-500 dark:text-slate-300"><ArrowLeftIcon className="w-5 h-5" /></button>
                <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 uppercase">{p.selectedEmpresa?.nome}</h2>
            </div>
            <div>
                <button onClick={p.onSalvar} disabled={p.loading} className="px-6 py-2 bg-sky-600 text-white rounded-lg font-bold hover:bg-sky-700 shadow-lg flex items-center gap-2">
                    {p.loading ? 'Salvando...' : <><SaveIcon className="w-5 h-5" /> {p.selectedFichaId ? 'Salvar Alterações' : 'Salvar Competência'}</>}
                </button>
            </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* COLUNA 1: Configurações e Inputs (Esquerda) */}
            <div className="lg:col-span-2 space-y-6">

                {/* Configurações Fiscais */}
                <div className="bg-slate-900/5 dark:bg-slate-800/50 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                    <h3 className="font-bold text-sky-700 dark:text-sky-400 mb-4 flex items-center gap-2 text-sm uppercase tracking-wide">
                        <ShieldIcon className="w-4 h-4" /> Configurações Fiscais (ISS e Especiais)
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        <ToggleSwitch
                            label="Equiparação Hospitalar"
                            description="Selecione se a empresa possui decisão judicial ou atende aos requisitos da ANVISA para alíquotas reduzidas (8% IRPJ / 12% CSLL)."
                            checked={p.isEquiparacaoHospitalar}
                            onChange={p.setIsEquiparacaoHospitalar}
                            colorClass="bg-purple-600"
                        />
                        <ToggleSwitch
                            label="Presunção Reduzida IRPJ (16%)"
                            description="Aplica-se apenas para receita bruta anual até R$ 120.000,00. Reduz a base de IRPJ de 32% para 16%."
                            checked={p.isPresuncaoReduzida}
                            onChange={p.setIsPresuncaoReduzida}
                            colorClass="bg-green-600"
                        />
                    </div>

                    {/* Aviso (não bloqueia) quando o 16% pode ser indevido:
                        atividade vedada (RIR art.15 §7º) ou receita > R$ 120k. */}
                    {p.isPresuncaoReduzida && (() => {
                        const receitaPeriodo = p.fichaComercio + p.fichaIndustria + p.fichaServico
                            + p.fichaServicoRetido + p.fichaLocacao + p.fichaServicoHospitalar + p.fichaRecFinanceira;
                        const receitaBrutaAnualEstimada = receitaPeriodo * (p.periodoApuracao === 'Trimestral' ? 4 : 12);
                        const aviso16 = avaliarPresuncaoReduzida16({
                            cnae: p.selectedEmpresa?.cnaePrincipal?.codigo,
                            receitaBrutaAnualEstimada,
                        });
                        if (!aviso16.alertar) return null;
                        return (
                            <div className="mb-6 -mt-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg p-3">
                                <p className="text-xs font-bold text-amber-800 dark:text-amber-300">⚠️ Atenção à presunção reduzida (16%)</p>
                                <ul className="mt-1 space-y-1 list-disc list-inside">
                                    {aviso16.motivos.map((m, i) => (
                                        <li key={i} className="text-[11px] text-amber-700 dark:text-amber-400">{m}</li>
                                    ))}
                                </ul>
                                <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-1">
                                    Aviso informativo — não bloqueia o cálculo. Confirme o enquadramento antes de aplicar.
                                </p>
                            </div>
                        );
                    })()}

                    <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row items-center gap-6">
                        <div className="flex gap-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="radio" checked={p.issTipo === 'aliquota_municipal'} onChange={() => p.setIssTipo('aliquota_municipal')} className="text-sky-600 focus:ring-sky-500" />
                                <span className="text-sm font-bold text-slate-700 dark:text-slate-300">Alíquota Municipal (%)</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="radio" checked={p.issTipo === 'sup_fixo'} onChange={() => p.setIssTipo('sup_fixo')} className="text-sky-600 focus:ring-sky-500" />
                                <span className="text-sm font-bold text-slate-700 dark:text-slate-300">ISS Fixo (SUP)</span>
                            </label>
                        </div>
                        <div className="flex-grow w-full md:w-auto">
                            {p.issTipo === 'aliquota_municipal' ? (
                                <div className="flex flex-col">
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1">Alíquota do ISS (%)</label>
                                    <input
                                        type="number"
                                        value={p.issAliquota}
                                        onChange={e => p.setIssAliquota(parseFloat(e.target.value) || 0)}
                                        className="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-white font-bold outline-none focus:ring-2 focus:ring-sky-500"
                                    />
                                </div>
                            ) : (
                                <div className="text-sm text-slate-500 italic">Cálculo por sócio (SUP) será aplicado.</div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Consolidação Filiais */}
                <div className="bg-slate-900/5 dark:bg-slate-800/50 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                    <h3 className="font-bold text-indigo-600 dark:text-indigo-400 mb-4 flex items-center gap-2 text-sm uppercase tracking-wide">
                        <BuildingIcon className="w-4 h-4" /> Consolidação de Filiais (Matriz)
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                        Insira o faturamento das filiais para cálculo unificado dos impostos federais (PIS/COFINS/IRPJ/CSLL).
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <CurrencyInput label="Faturamento Filiais (Comércio)" value={p.fichaFilialComercio} onChange={p.setFichaFilialComercio} className="bg-slate-50 dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700" />
                        <CurrencyInput label="Faturamento Filiais (Indústria)" value={p.fichaFilialIndustria} onChange={p.setFichaFilialIndustria} className="bg-slate-50 dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700" />
                        <CurrencyInput label="Faturamento Filiais (Serviço)" value={p.fichaFilialServico} onChange={p.setFichaFilialServico} className="bg-slate-50 dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700" />
                        {p.isEquiparacaoHospitalar && (
                            <CurrencyInput label="Filiais (Hospitalar 8%)" value={p.fichaFilialServicoHospitalar} onChange={p.setFichaFilialServicoHospitalar} className="bg-purple-50 dark:bg-purple-900/10 p-2 rounded border border-purple-200 dark:border-purple-800 animate-fade-in" highlight />
                        )}
                    </div>
                </div>

                {/* Receitas da Matriz */}
                <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                    <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2 text-sm uppercase tracking-wide border-b border-slate-100 dark:border-slate-700 pb-2">
                        <CalculatorIcon className="w-4 h-4" /> Receitas da Matriz
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="col-span-1 md:col-span-2 flex gap-4 items-end">
                            <div className="flex-grow">
                                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">Mês de Referência</label>
                                <input type="month" value={p.fichaMes} onChange={e => p.setFichaMes(e.target.value)} className="w-full p-2 rounded border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white" />
                            </div>
                            {/* Presumido apura IRPJ/CSLL por TRIMESTRE, mas PIS/COFINS/IPI
                                sao MENSAIS. Os dois botoes existem pros dois momentos do
                                trimestre: mes comum (so os mensais) e mes de fechamento
                                (fecha IRPJ/CSLL com o acumulado). No Lucro Real, 'Mensal'
                                continua sendo a estimativa. */}
                            <div className="bg-slate-100 dark:bg-slate-700 p-1 rounded-lg flex items-center h-[42px]">
                                <button
                                    onClick={() => p.setPeriodoApuracao('Mensal')}
                                    className={`px-3 h-full text-xs font-bold rounded transition-all ${p.periodoApuracao === 'Mensal' ? 'bg-white dark:bg-slate-600 text-sky-700 dark:text-sky-300 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                                >
                                    {p.selectedEmpresa?.regimePadrao === 'Presumido' ? 'Mensal (PIS/COFINS)' : 'Estimativa Mensal'}
                                </button>
                                <button
                                    onClick={() => p.setPeriodoApuracao('Trimestral')}
                                    className={`px-3 h-full text-xs font-bold rounded transition-all ${p.periodoApuracao === 'Trimestral' ? 'bg-white dark:bg-slate-600 text-sky-700 dark:text-sky-300 shadow-sm' : 'text-slate-500 dark:text-slate-400'}`}
                                >
                                    {p.selectedEmpresa?.regimePadrao === 'Presumido' ? 'Trimestral (fecha IRPJ/CSLL)' : 'Encerramento Trimestral'}
                                </button>
                            </div>
                        </div>

                        {/* Farol honesto: a escolha que contradiz a competencia nunca passa
                            calada — nos dois sentidos (fechar trimestre em mes que nao
                            fecha, e deixar de fechar no mes que fecha). */}
                        {avisoPeriodo && (
                            <div className="col-span-1 md:col-span-2 -mt-1 p-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
                                {avisoPeriodo}
                            </div>
                        )}

                        {/* Inputs Específicos para Fechamento Trimestral (Acumulado) */}
                        {p.periodoApuracao === 'Trimestral' && (
                            <div className="col-span-1 md:col-span-2 bg-sky-50 dark:bg-sky-900/20 p-4 rounded-lg border border-sky-200 dark:border-sky-800 animate-fade-in">
                                <h4 className="text-xs font-bold text-sky-800 dark:text-sky-300 uppercase mb-2 flex items-center gap-2">
                                    <InfoIcon className="w-4 h-4" /> Dados Anteriores do Trimestre (Acumulado)
                                </h4>
                                <p className="text-[10px] text-sky-600 dark:text-sky-400 mb-3">
                                    Informe a soma da receita bruta dos meses anteriores deste trimestre para o cálculo correto do Adicional do IRPJ (10% sobre o excedente de R$ 60.000,00 no trimestre).
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <CurrencyInput label="Acumulado Comércio" value={p.acumuladoComercio} onChange={p.setAcumuladoComercio} className="bg-white dark:bg-slate-800 p-2 rounded border border-sky-100 dark:border-sky-900" />
                                    <CurrencyInput label="Acumulado Indústria" value={p.acumuladoIndustria} onChange={p.setAcumuladoIndustria} className="bg-white dark:bg-slate-800 p-2 rounded border border-sky-100 dark:border-sky-900" />
                                    <CurrencyInput label="Acumulado Serviços" value={p.acumuladoServico} onChange={p.setAcumuladoServico} className="bg-white dark:bg-slate-800 p-2 rounded border border-sky-100 dark:border-sky-900" />
                                    {p.isEquiparacaoHospitalar && (
                                        <CurrencyInput label="Acumulado Hosp. (8%)" value={p.acumuladoServicoHospitalar} onChange={p.setAcumuladoServicoHospitalar} className="bg-purple-50 dark:bg-purple-900/10 p-2 rounded border border-purple-200 dark:border-purple-800" />
                                    )}
                                    <CurrencyInput label="Acumulado Financeira" value={p.acumuladoFinanceira} onChange={p.setAcumuladoFinanceira} className="bg-white dark:bg-slate-800 p-2 rounded border border-sky-100 dark:border-sky-900" />
                                    <CurrencyInput label="Acumulado Aluguel" value={p.acumuladoAluguel} onChange={p.setAcumuladoAluguel} className="bg-white dark:bg-slate-800 p-2 rounded border border-sky-100 dark:border-sky-900" />
                                </div>

                                {/* Limite da majoração (LC 224/25). O campo pede o SALDO — é o
                                    número que o relatório oficial dá pronto ("Saldo do Trimestre
                                    Anterior"), somado ao sublimite de R$ 1,25 mi do período.
                                    Pedir a RECEITA anterior e derivar o saldo aqui dava resultado
                                    errado quando um trimestre excedeu e outro sobrou — o carry é
                                    por período, não pela soma do ano (caso A CASTELLANO 2T/2026). */}
                                <div className="mt-3 pt-3 border-t border-sky-200 dark:border-sky-800">
                                    <CurrencyInput
                                        label="Saldo do TRIMESTRE ANTERIOR (limite não usado — LC 224/25)"
                                        value={p.saldoAnteriorLc224}
                                        onChange={p.setSaldoAnteriorLc224}
                                        className="bg-white dark:bg-slate-800 p-2 rounded border border-sky-100 dark:border-sky-900"
                                    />
                                    <p className="text-[10px] text-sky-600 dark:text-sky-400 mt-1">
                                        Copie o campo <strong>“Saldo do Trimestre Anterior”</strong> do relatório de
                                        excesso de limite. Ele soma ao sublimite de R$ 1.250.000 deste trimestre e vira
                                        o <strong>Total do Limite</strong> — o mesmo que aparece na observação do IRPJ/CSLL.
                                        Em branco, usamos só o limite deste trimestre: nunca presumimos sobra que a
                                        empresa não teve.
                                    </p>
                                </div>
                            </div>
                        )}

                        <CurrencyInput label="Comércio (Revenda)" value={p.fichaComercio} onChange={p.setFichaComercio} />
                        <CurrencyInput label="Indústria" value={p.fichaIndustria} onChange={p.setFichaIndustria} />

                        <div className="col-span-1 md:col-span-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                            <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Serviços e Locação</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <CurrencyInput
                                    label={p.isEquiparacaoHospitalar ? "Serviços (ISS A Pagar / Próprio - Sem Equip.)" : "Serviços (ISS A Pagar / Próprio)"}
                                    value={p.fichaServico}
                                    onChange={p.setFichaServico}
                                    className="bg-white dark:bg-slate-800"
                                />

                                <CurrencyInput
                                    label="Serviços (ISS Retido na Fonte)"
                                    value={p.fichaServicoRetido}
                                    onChange={p.setFichaServicoRetido}
                                    placeholder="ISS Retido pelo Tomador"
                                />

                                <CurrencyInput
                                    label="Locação de Bens (Não Incide ISS)"
                                    value={p.fichaLocacao}
                                    onChange={p.setFichaLocacao}
                                />

                                {p.isEquiparacaoHospitalar && (
                                    <div className="animate-fade-in">
                                        <CurrencyInput label="Serviços Hospitalares (8% - Equiparação)" value={p.fichaServicoHospitalar} onChange={p.setFichaServicoHospitalar} highlight />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="col-span-1 md:col-span-2 pt-4 mt-2 border-t border-slate-100 dark:border-slate-700">
                            <div className="p-4 bg-sky-50 dark:bg-sky-900/10 rounded-lg border border-sky-100 dark:border-sky-900">
                                <CurrencyInput
                                    label="Receita Financeira (Aplicações/Juros)"
                                    value={p.fichaRecFinanceira}
                                    onChange={p.setFichaRecFinanceira}
                                    highlight
                                />
                                <p className="text-[10px] text-sky-600 dark:text-sky-400 mt-1">
                                    * Soma-se integralmente à base de IRPJ/CSLL (não sofre presunção).
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Deduções e Ajustes */}
                <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                    <h3 className="font-bold text-orange-600 dark:text-orange-400 mb-4 flex items-center gap-2 text-sm uppercase tracking-wide border-b border-slate-100 dark:border-slate-700 pb-2">
                        <TagIcon className="w-4 h-4" /> Deduções e Ajustes
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <CurrencyInput label="IPI Faturado" value={p.fichaIpi} onChange={p.setFichaIpi} />
                        <CurrencyInput label="Devoluções de Vendas" value={p.fichaDevolucoes} onChange={p.setFichaDevolucoes} />
                        <div className="col-span-1">
                            <CurrencyInput label="ICMS ST (Destacado nas Vendas)" value={p.fichaIcmsStFaturado} onChange={p.setFichaIcmsStFaturado} />
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                                * Não integra a receita bruta (substituição tributária) — deduz a base de IRPJ/CSLL/PIS/COFINS, igual ao IPI.
                            </p>
                        </div>
                        <CurrencyInput label="ICMS sobre Vendas (Para dedução PIS/COFINS)" value={p.fichaIcmsVendas} onChange={p.setFichaIcmsVendas} />

                        <div className="col-span-1 md:col-span-2 pt-2 border-t border-orange-100 dark:border-orange-800/30">
                            <label className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-300 cursor-pointer mb-2">
                                <input
                                    type="checkbox"
                                    checked={p.isMonofasicoOption}
                                    onChange={e => p.setIsMonofasicoOption(e.target.checked)}
                                    className="w-4 h-4 text-sky-600 rounded"
                                />
                                Opção Monofásico?
                            </label>
                            {p.isMonofasicoOption && (
                                <div className="animate-fade-in pl-6">
                                    <CurrencyInput
                                        label="Valor Receita Monofásica"
                                        value={p.fichaMonofasico}
                                        onChange={p.setFichaMonofasico}
                                        className="bg-slate-50 dark:bg-slate-700 rounded-lg p-2 border border-slate-200 dark:border-slate-600"
                                    />
                                    <p className="text-[10px] text-slate-500 mt-1">
                                        * Base PIS/COFINS será ajustada (Faturamento Bruto - IPI - Devolução) conforme regra STF/Monofásico.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Novo Bloco: Impostos Estaduais e IPI (Apuração Manual) */}
                <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                    <h3 className="font-bold text-indigo-600 dark:text-indigo-400 mb-4 flex items-center gap-2 text-sm uppercase tracking-wide border-b border-slate-100 dark:border-slate-700 pb-2">
                        <BriefcaseIcon className="w-4 h-4" /> Apuração de ICMS e IPI (Saldos Devedores)
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <CurrencyInput
                            label="ICMS Próprio (A Recolher)"
                            value={p.fichaIcmsProprio}
                            onChange={p.setFichaIcmsProprio}
                            className="bg-indigo-50 dark:bg-indigo-900/10 p-2 rounded border border-indigo-100 dark:border-indigo-800"
                        />
                        <CurrencyInput
                            label="ICMS ST (A Recolher)"
                            value={p.fichaIcmsSt}
                            onChange={p.setFichaIcmsSt}
                            className="bg-indigo-50 dark:bg-indigo-900/10 p-2 rounded border border-indigo-100 dark:border-indigo-800"
                        />
                        <CurrencyInput
                            label="IPI (A Recolher)"
                            value={p.fichaIpiRecolher}
                            onChange={p.setFichaIpiRecolher}
                            className="bg-indigo-50 dark:bg-indigo-900/10 p-2 rounded border border-indigo-100 dark:border-indigo-800"
                        />
                    </div>
                </div>

                {/* Novo Bloco: Ajustes Lucro Real e Saldos Credores */}
                <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 animate-fade-in">
                    <h3 className="font-bold text-emerald-600 dark:text-emerald-400 mb-4 flex items-center gap-2 text-sm uppercase tracking-wide border-b border-slate-100 dark:border-slate-700 pb-2">
                        <CalculatorIcon className="w-4 h-4" /> Ajustes e Saldos Credores
                    </h3>

                    {p.selectedEmpresa?.regimePadrao === 'Real' && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                            <CurrencyInput
                                label="Adições (LALUR/LACS)"
                                value={p.ajustesLucroRealAdicoes}
                                onChange={p.setAjustesLucroRealAdicoes}
                                className="bg-emerald-50 dark:bg-emerald-900/10 p-2 rounded border border-emerald-100 dark:border-emerald-800"
                            />
                            <CurrencyInput
                                label="Exclusões (LALUR/LACS)"
                                value={p.ajustesLucroRealExclusoes}
                                onChange={p.setAjustesLucroRealExclusoes}
                                className="bg-emerald-50 dark:bg-emerald-900/10 p-2 rounded border border-emerald-100 dark:border-emerald-800"
                            />
                            <CurrencyInput
                                label="Itens Adicionais (Extra Operacionais)"
                                value={p.itensAdicionaisExtra}
                                onChange={p.setItensAdicionaisExtra}
                                className="bg-emerald-50 dark:bg-emerald-900/10 p-2 rounded border border-emerald-100 dark:border-emerald-800"
                            />
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <CurrencyInput
                            label="Saldo Credor ICMS (Mês Anterior)"
                            value={p.saldoCredorIcms}
                            onChange={p.setSaldoCredorIcms}
                            className="bg-slate-50 dark:bg-slate-700 p-2 rounded border border-slate-200 dark:border-slate-600"
                        />
                        <CurrencyInput
                            label="Saldo Credor IPI (Mês Anterior)"
                            value={p.saldoCredorIpi}
                            onChange={p.setSaldoCredorIpi}
                            className="bg-slate-50 dark:bg-slate-700 p-2 rounded border border-slate-200 dark:border-slate-600"
                        />
                        <CurrencyInput
                            label="Saldo Credor PIS (Mês Anterior)"
                            value={p.saldoCredorPis}
                            onChange={p.setSaldoCredorPis}
                            className="bg-sky-50 dark:bg-sky-900/10 p-2 rounded border border-sky-200 dark:border-sky-800"
                        />
                        <CurrencyInput
                            label="Saldo Credor COFINS (Mês Anterior)"
                            value={p.saldoCredorCofins}
                            onChange={p.setSaldoCredorCofins}
                            className="bg-sky-50 dark:bg-sky-900/10 p-2 rounded border border-sky-200 dark:border-sky-800"
                        />
                    </div>
                </div>
            </div>

            {/* COLUNA 2: RESULTADOS (Direita - Sticky) */}
            <div className="lg:col-span-1">
                <div className="sticky top-6 space-y-6">
                    {/* Resultado Card */}
                    <div className="bg-slate-800 dark:bg-slate-900 text-white rounded-xl shadow-xl overflow-hidden border border-slate-700">
                        <div className="p-4 bg-slate-900/50 border-b border-slate-700">
                            <h3 className="text-lg font-bold flex items-center gap-2 text-sky-400">
                                <InfoIcon className="w-5 h-5" /> Resultado da Apuração
                            </h3>
                        </div>

                        {p.liveResults ? (
                            <div className="p-6 space-y-6">
                                {p.liveResults.alertaLc224 && (
                                    <div className="p-3 bg-amber-100 dark:bg-amber-900/40 border-l-4 border-amber-500 rounded-r">
                                        <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
                                            Reforma Tributária 2025 (LC 224/25) aplicada
                                        </p>
                                        <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-1">
                                            A presunção foi majorada em 10% sobre a parcela da receita anual acima de R$ 5 milhões (R$ 3,75 mi para CSLL em 2026, por anterioridade nonagesimal). Veja o detalhe na observação de cada imposto (IRPJ/CSLL). Base legal: IN RFB 2.305/2025 art. 15.
                                        </p>
                                    </div>
                                )}
                                {p.liveResults.detalhamento.map((item, idx) => (
                                    <div key={idx} className="border-b border-slate-700/50 pb-4 last:border-0 last:pb-0">
                                        <div className="flex justify-between items-start mb-1">
                                            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{item.imposto}</span>
                                            <span className="text-lg font-bold text-sky-300">
                                                {item.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                            </span>
                                        </div>
                                        <div className="text-[10px] text-slate-500 font-mono">
                                            BASE: {item.baseCalculo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} ({item.aliquota}%)
                                        </div>
                                        {item.observacao && <div className="text-[10px] text-slate-600 italic mt-1">{item.observacao}</div>}

                                        {/* DARE-SP: ICMS é estadual — gera a guia com preview
                                            conferível (códigos validados nos DAREs reais 24/07). */}
                                        {(item.imposto === 'ICMS Próprio' || item.imposto === 'ICMS ST') && item.valor > 0 && p.selectedEmpresa?.cnpj && (
                                            <button
                                                type="button"
                                                onClick={() => setDareModal({ valor: item.valor, derivacao: item.imposto === 'ICMS ST' ? 'st' : 'proprio' })}
                                                className="mt-2 px-3 py-1 text-[11px] font-bold rounded bg-emerald-700 hover:bg-emerald-600 text-white"
                                                title="Preview conferível + dados prontos pra emissão do DARE-SP no portal da SEFAZ"
                                            >
                                                🧾 Gerar DARE-SP
                                            </button>
                                        )}

                                        {item.cotaInfo?.disponivel && (
                                            <div className="mt-2 bg-slate-700/30 p-2 rounded border border-slate-700">
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={p.pagarCotas}
                                                        onChange={e => p.setPagarCotas(e.target.checked)}
                                                        className="rounded border-slate-500 bg-slate-800 text-sky-500 focus:ring-offset-slate-900"
                                                    />
                                                    <span className="text-xs font-bold text-sky-400">PAGAR EM COTAS (3X)</span>
                                                </label>
                                                {p.pagarCotas && (
                                                    <div className="mt-1 pl-5 text-[10px] text-slate-400">
                                                        1ª Cota: {item.cotaInfo.valorPrimeiraCota.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}

                                <div className="pt-4 border-t border-slate-600 mt-4">
                                    <div className="flex justify-between items-center bg-sky-600 p-4 rounded-lg shadow-lg">
                                        <span className="text-xs font-bold text-sky-100 uppercase">TOTAL DE IMPOSTOS</span>
                                        <span className="text-2xl font-black text-white">
                                            {p.liveResults.totalImpostos.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                        </span>
                                    </div>
                                </div>

                                {/* Conferência DCTFWeb: cruza IRPJ/CSLL/PIS/COFINS apurados aqui
                                    contra o declarado na DCTFWeb MIT da mesma competência. */}
                                {p.selectedEmpresa?.cnpj && p.fichaMes && (
                                    <button
                                        type="button"
                                        onClick={p.onAbrirConferirDctfweb}
                                        className="mt-3 w-full px-4 py-2 text-sm font-semibold rounded-lg border border-sky-300 text-sky-700 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-900/30"
                                        title="Compara o apurado aqui com o declarado na DCTFWeb (MIT)"
                                    >
                                        🔎 Conferir vs DCTFWeb ({p.fichaMes})
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="p-8 text-center text-slate-500 italic">
                                Preencha os valores para visualizar a apuração.
                            </div>
                        )}
                    </div>

                    {/* Custos e Retenções (Inputs Secundários) */}
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                        <h3 className="font-bold text-slate-600 dark:text-slate-400 mb-4 text-xs uppercase tracking-wide">Custos e Retenções (Mês Vigente)</h3>
                        <div className="space-y-3">
                            <CurrencyInput label="CMV" value={p.fichaCmv} onChange={p.setFichaCmv} />
                            <CurrencyInput label="Folha de Pagamento" value={p.fichaFolha} onChange={p.setFichaFolha} />

                            <div className="pt-4 border-t border-slate-100 dark:border-slate-700">
                                <div className="flex justify-between items-center mb-3">
                                    <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Despesas Itemizadas</h4>
                                    <button
                                        onClick={p.onAddDespesa}
                                        className="text-[10px] flex items-center gap-1 bg-sky-50 text-sky-600 hover:bg-sky-100 px-2 py-1 rounded font-bold transition-colors"
                                    >
                                        <PlusIcon className="w-3 h-3" /> Adicionar Despesa
                                    </button>
                                </div>

                                <div className="space-y-2 mb-4">
                                    {p.despesasAvulsas.map((despesa) => (
                                        <div key={despesa.id} className="bg-slate-50 dark:bg-slate-700/30 p-2 rounded-lg border border-slate-100 dark:border-slate-600 group space-y-2">
                                            <div className="flex gap-2 items-center">
                                                <div className="flex-1">
                                                    <input
                                                        type="text"
                                                        placeholder="Descrição (ex: Frete, Aluguel)"
                                                        className="w-full text-xs bg-transparent border-none focus:ring-0 p-1 text-slate-700 dark:text-slate-200 font-medium"
                                                        value={despesa.descricao}
                                                        onChange={(e) => p.onUpdateDespesa(despesa.id, 'descricao', e.target.value)}
                                                    />
                                                </div>
                                                <div className="w-28">
                                                    <CurrencyInput
                                                        value={despesa.valor}
                                                        onChange={(val) => p.onUpdateDespesa(despesa.id, 'valor', val)}
                                                        noLabel
                                                        className="text-xs"
                                                    />
                                                </div>
                                                <button
                                                    onClick={() => p.onRemoveDespesa(despesa.id)}
                                                    className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                                                >
                                                    <TrashIcon className="w-4 h-4" />
                                                </button>
                                            </div>
                                            <div className="flex flex-wrap gap-x-4 gap-y-1 items-center pl-1 pt-1 border-t border-slate-200 dark:border-slate-600">
                                                <label
                                                    className="flex items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-300 cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                                                    title="Marque APENAS se a despesa se enquadra nas hipóteses da Lei 10.637/02 art. 3 + Lei 10.833/03 art. 3: insumos da produção/prestação, energia, aluguel a PJ, depreciação ativo imobilizado, frete na venda, vale-transporte/refeição. Salários, impostos, juros e propaganda NÃO geram crédito."
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={!!despesa.geraCreditoPisCofins}
                                                        onChange={(e) => p.onUpdateDespesa(despesa.id, 'geraCreditoPisCofins', e.target.checked)}
                                                        className="rounded border-slate-300 dark:border-slate-500 text-emerald-600 focus:ring-emerald-500 focus:ring-offset-0 w-3 h-3"
                                                    />
                                                    <span className="font-medium">Crédito PIS/COFINS</span>
                                                    <span className="text-amber-600 dark:text-amber-400" title="Hipóteses restritas — passe o mouse">ⓘ</span>
                                                </label>
                                                <label className="flex items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-300 cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
                                                    <input
                                                        type="checkbox"
                                                        checked={!!despesa.dedutivelIrpj}
                                                        onChange={(e) => p.onUpdateDespesa(despesa.id, 'dedutivelIrpj', e.target.checked)}
                                                        className="rounded border-slate-300 dark:border-slate-500 text-emerald-600 focus:ring-emerald-500 focus:ring-offset-0 w-3 h-3"
                                                    />
                                                    <span className="font-medium">Dedutível IRPJ/CSLL</span>
                                                </label>
                                            </div>
                                        </div>
                                    ))}
                                    {p.despesasAvulsas.length === 0 && (
                                        <p className="text-[10px] text-slate-400 italic text-center py-2">Nenhuma despesa itemizada adicionada.</p>
                                    )}
                                </div>
                            </div>

                            <CurrencyInput label="Outras Despesas (Total)" value={p.fichaDespesas} onChange={p.setFichaDespesas} />
                            <CurrencyInput
                                label="Despesas Dedutíveis (PIS/COFINS)"
                                value={p.fichaDespesasDedutiveis}
                                onChange={p.setFichaDespesasDedutiveis}
                                subtitle="Soma das hipóteses do art. 3º das Leis 10.637/02 e 10.833/03 (insumo, energia, aluguel PJ, depreciação, frete venda). Para apuração detalhada por categoria de fornecedor, use 'Análise de Créditos' (E-Fiscal)."
                            />

                            <div className="pt-3 border-t border-slate-100 dark:border-slate-700 grid grid-cols-2 gap-4">
                                <CurrencyInput label="Ret. PIS" value={p.fichaRetPis} onChange={p.setFichaRetPis} />
                                <CurrencyInput label="Ret. COFINS" value={p.fichaRetCofins} onChange={p.setFichaRetCofins} />

                                <CurrencyInput
                                    label="Ret. IRPJ"
                                    value={p.fichaRetIrpj}
                                    onChange={p.setFichaRetIrpj}
                                    subtitle={p.retencoesAcumuladas.irpj > 0 ? `+ ${p.retencoesAcumuladas.irpj.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})} (Ant. Trimestre)` : undefined}
                                    highlight={p.retencoesAcumuladas.irpj > 0}
                                />
                                <CurrencyInput
                                    label="Ret. CSLL"
                                    value={p.fichaRetCsll}
                                    onChange={p.setFichaRetCsll}
                                    subtitle={p.retencoesAcumuladas.csll > 0 ? `+ ${p.retencoesAcumuladas.csll.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})} (Ant. Trimestre)` : undefined}
                                    highlight={p.retencoesAcumuladas.csll > 0}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        {dareModal && p.selectedEmpresa?.cnpj && (
            <DareSpModal
                cnpj={p.selectedEmpresa.cnpj}
                razaoSocial={p.selectedEmpresa.nome || ''}
                empresaId={p.selectedEmpresa.id}
                competencia={p.fichaMes}
                valorInicial={dareModal.valor}
                derivacaoInicial={dareModal.derivacao}
                onClose={() => setDareModal(null)}
            />
        )}
    </div>
    );
};

export default NewFichaView;
