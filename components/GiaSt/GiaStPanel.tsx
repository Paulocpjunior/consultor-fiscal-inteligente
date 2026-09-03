/**
 * components/GiaSt/GiaStPanel.tsx
 *
 * GIA-ST — gera a guia (Ajuste SINIEF 04/93) a partir do relatório
 * "Livro de ICMS Substituto (Operações Interestaduais)" do Office Fiscal
 * (IOB/SAGE):
 *   1. Upload do PDF → parser (giaStParserService);
 *   2. Seleção das UFs favorecidas (onde a empresa tem IE de substituto);
 *   3. Revisão editável dos campos 7-21/39 com cálculo automático (18/20/21)
 *      e validações no espírito da aba Inconsistências do GIA-ST 3;
 *   4. Salvar (Firestore gia_st_guias) + Espelho PDF de conferência.
 *
 * A geração do arquivo TXT de importação p/ o aplicativo GIA-ST 3 (seção
 * 4.15 do manual) entra na fase 2, quando o layout oficial
 * (Layout_ArquivoGIA-ST_v3.pdf) for anexado ao projeto.
 */

import React, { useMemo, useRef, useState } from 'react';
import type { User } from '../../types';
import {
    parseGiaStPdf, type GiaStRelatorioParsed, type GiaStLinhaUf,
} from '../../services/giaStParserService';
import {
    calcularGiaSt, validarGiaSt, montarIdGuia, salvarGiaSt, listarGiaStPorCnpj,
    excluirGiaSt, type GiaStGuia, type GiaStValores,
} from '../../services/giaStService';
import { gerarEspelhoGiaStPdf } from '../../services/giaStPdf';
import {
    gerarArquivoGiaStBlob, type GiaStDeclarante, type GiaStAnexoNf,
    type GiaStAnexoTransferencia, type GiaStArquivoGuia,
} from '../../services/giaStExportService';
import { downloadBlob } from '../../services/iobSageExportService';
import { useEmpresaAtiva } from '../../services/empresaAtivaContext';
import { fmtComp } from '../../services/formatos';

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

interface FormGuia extends GiaStValores {
    incluida: boolean;
    inscricaoEstadualUfFavorecida: string;
    dataVencimento: string;
    informacoesComplementares: string;
    semMovimento: boolean;
    retificacao: boolean;
    c37DistribuidoraCombustivel: boolean;
    anexoI: GiaStAnexoNf[];
    anexoII: GiaStAnexoNf[];
    anexoIII: GiaStAnexoTransferencia[];
}

const DECLARANTE_VAZIO: GiaStDeclarante = {
    nome: '', cpf: '', cargo: '', telefoneDdd: '', telefoneNumero: '', email: '', local: '',
};

const ANEXO_NF_VAZIO: GiaStAnexoNf = {
    numeroNf: '', serie: '', inscricaoEstadual: '', dataEmissao: '', valor: 0,
};

const fmt = (n: number): string =>
    (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtCnpj = (c: string): string => {
    const d = (c || '').replace(/\D/g, '');
    return d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : c;
};


/** Vencimento padrão: dia 10 do mês subsequente (Ajuste SINIEF 04/93, cl. 10 §4). */
function vencimentoPadrao(competencia: string): string {
    const m = competencia.match(/^(\d{4})-(\d{2})$/);
    if (!m) return '';
    const ano = parseInt(m[1], 10);
    const mes = parseInt(m[2], 10);
    const prox = mes === 12 ? { ano: ano + 1, mes: 1 } : { ano, mes: mes + 1 };
    return `${prox.ano}-${String(prox.mes).padStart(2, '0')}-10`;
}

function formInicial(saida: GiaStLinhaUf | undefined, incluida: boolean): FormGuia {
    return {
        incluida,
        inscricaoEstadualUfFavorecida: '',
        dataVencimento: '',
        informacoesComplementares: '',
        semMovimento: false,
        retificacao: false,
        // Mapeamento relatório → GIA-ST (seção C, Saídas):
        //   Valor Contábil → 7 (contém IPI+despesas; 8 e 9 ficam editáveis)
        //   Base de Cálculo → 10 · Valor do ICMS → 11
        //   BC (ICMS Retido) → 12 · ICMS Retido Fonte → 13
        c7ValorProdutos: saida?.valorContabil ?? 0,
        c8ValorIpi: 0,
        c9DespesasAcessorias: 0,
        c10BcIcmsProprio: saida?.baseCalculo ?? 0,
        c11IcmsProprio: saida?.valorIcms ?? 0,
        c12BcIcmsSt: saida?.bcIcmsRetido ?? 0,
        c13IcmsRetidoSt: saida?.icmsRetidoFonte ?? 0,
        c14IcmsDevolucao: 0,
        c15IcmsRessarcimentos: 0,
        c16CreditoPeriodoAnterior: 0,
        c17PagamentosAntecipados: 0,
        c19RepasseRefinarias: 0,
        c39RepasseOutros: 0,
        c37DistribuidoraCombustivel: false,
        anexoI: [],
        anexoII: [],
        anexoIII: [],
    };
}

const CAMPOS_EDITAVEIS: Array<{ key: keyof GiaStValores; label: string }> = [
    { key: 'c7ValorProdutos', label: '7. Valor dos Produtos' },
    { key: 'c8ValorIpi', label: '8. Valor do IPI' },
    { key: 'c9DespesasAcessorias', label: '9. Despesas Acessórias' },
    { key: 'c10BcIcmsProprio', label: '10. BC do ICMS Próprio' },
    { key: 'c11IcmsProprio', label: '11. ICMS Próprio' },
    { key: 'c12BcIcmsSt', label: '12. BC ICMS-ST' },
    { key: 'c13IcmsRetidoSt', label: '13. ICMS Retido por ST' },
    { key: 'c14IcmsDevolucao', label: '14. ICMS Devolução (Anexo I)' },
    { key: 'c15IcmsRessarcimentos', label: '15. Ressarcimentos (Anexo II)' },
    { key: 'c16CreditoPeriodoAnterior', label: '16. Crédito Período Anterior' },
    { key: 'c17PagamentosAntecipados', label: '17. Pagamentos Antecipados' },
    { key: 'c19RepasseRefinarias', label: '19. Repasse Refinarias' },
    { key: 'c39RepasseOutros', label: '39. Repasse Outros Contrib.' },
];

const inputCls = 'w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded px-2 py-1 text-xs text-right';
const inputTxtCls = 'w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded px-2 py-1 text-xs';

/** Editor genérico dos Anexos I/II (notas: A1/A2 do arquivo). */
const AnexoNfEditor: React.FC<{
    titulo: string;
    somaEsperada: number;
    itens: GiaStAnexoNf[];
    onChange: (itens: GiaStAnexoNf[]) => void;
}> = ({ titulo, somaEsperada, itens, onChange }) => {
    const soma = itens.reduce((acc, i) => acc + (i.valor || 0), 0);
    const bate = Math.round(soma * 100) === Math.round(somaEsperada * 100);
    const setItem = (idx: number, campo: keyof GiaStAnexoNf, valor: string | number) =>
        onChange(itens.map((it, i) => (i === idx ? { ...it, [campo]: valor } : it)));
    return (
        <div className="border border-slate-200 dark:border-slate-600 rounded p-2 space-y-1.5">
            <div className="flex justify-between items-center flex-wrap gap-1">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{titulo}</span>
                <span className={`text-[11px] font-semibold ${bate ? 'text-emerald-600' : 'text-rose-500'}`}>
                    Soma: R$ {fmt(soma)} / campo: R$ {fmt(somaEsperada)} {bate ? '✓' : '≠'}
                </span>
            </div>
            {itens.map((it, idx) => (
                <div key={idx} className="grid grid-cols-2 md:grid-cols-6 gap-1 items-end">
                    <input className={inputTxtCls} placeholder="Nº NF" value={it.numeroNf}
                        onChange={e => setItem(idx, 'numeroNf', e.target.value.replace(/\D/g, ''))} />
                    <input className={inputTxtCls} placeholder="Série" value={it.serie}
                        onChange={e => setItem(idx, 'serie', e.target.value)} />
                    <input className={inputTxtCls} placeholder="IE do emitente/destinatário" value={it.inscricaoEstadual}
                        onChange={e => setItem(idx, 'inscricaoEstadual', e.target.value)} />
                    <input type="date" className={inputTxtCls} value={it.dataEmissao}
                        onChange={e => setItem(idx, 'dataEmissao', e.target.value)} />
                    <input type="number" step="0.01" min="0" className={inputCls} placeholder="Valor ICMS-ST" value={it.valor}
                        onChange={e => setItem(idx, 'valor', parseFloat(e.target.value) || 0)} />
                    <button onClick={() => onChange(itens.filter((_, i) => i !== idx))}
                        className="text-rose-500 text-[11px] hover:underline text-left">remover</button>
                </div>
            ))}
            <button onClick={() => onChange([...itens, { ...ANEXO_NF_VAZIO }])}
                className="text-indigo-500 text-[11px] hover:underline">+ adicionar nota</button>
        </div>
    );
};

const GiaStPanel: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [parsing, setParsing] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [relatorio, setRelatorio] = useState<GiaStRelatorioParsed | null>(null);
    // Aqui a empresa NÃO vem da ativa: vem do PDF, porque o documento é a fonte.
    // A ativa serve só para DENUNCIAR o PDF do cliente errado.
    const { empresa: empresaAtiva } = useEmpresaAtiva();
    const divergeDaAtiva = !!empresaAtiva && !!relatorio
        && String(relatorio.empresaCnpj || '').replace(/\D/g, '')
        !== String(empresaAtiva.cnpj || '').replace(/\D/g, '');
    const [forms, setForms] = useState<Record<string, FormGuia>>({});
    const [salvas, setSalvas] = useState<GiaStGuia[]>([]);
    const [salvando, setSalvando] = useState<string | null>(null);
    const [declarante, setDeclarante] = useState<GiaStDeclarante>(DECLARANTE_VAZIO);
    const fileRef = useRef<HTMLInputElement>(null);

    const toast = (msg: string) => onShowToast?.(msg);

    const carregarSalvas = async (cnpj: string) => {
        try { setSalvas(await listarGiaStPorCnpj(cnpj)); } catch { /* lista é auxiliar */ }
    };

    const handleFile = async (file: File | null) => {
        if (!file) return;
        setParsing(true);
        setErro(null);
        setRelatorio(null);
        setForms({});
        try {
            const parsed = await parseGiaStPdf(file);
            setRelatorio(parsed);
            const novo: Record<string, FormGuia> = {};
            for (const saida of parsed.saidas.linhas) {
                const temSt = saida.bcIcmsRetido > 0 || saida.icmsRetidoFonte > 0;
                novo[saida.uf] = formInicial(saida, temSt);
                novo[saida.uf].dataVencimento = vencimentoPadrao(parsed.competencia);
            }
            // Pré-preenche IE/declarante das guias já salvas — AUXILIAR: uma
            // falha aqui (rede, permissão) não pode impedir a montagem dos
            // formulários, senão a tela inteira fica inerte.
            try {
                const anteriores = await listarGiaStPorCnpj(parsed.empresaCnpj);
                setSalvas(anteriores);
                for (const g of anteriores) {
                    if (novo[g.ufFavorecida] && !novo[g.ufFavorecida].inscricaoEstadualUfFavorecida) {
                        novo[g.ufFavorecida].inscricaoEstadualUfFavorecida = g.inscricaoEstadualUfFavorecida || '';
                    }
                }
                const comDeclarante = anteriores.find(g => g.declarante?.nome);
                if (comDeclarante?.declarante) setDeclarante({ ...DECLARANTE_VAZIO, ...comDeclarante.declarante });
            } catch (e: any) {
                console.warn('[GiaSt] falha carregando guias salvas (segue sem pré-preenchimento):', e?.message);
            }
            setForms(novo);
        } catch (e: any) {
            setErro(e?.message || 'Falha ao ler o PDF.');
        } finally {
            setParsing(false);
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    const setCampo = (uf: string, campo: keyof FormGuia, valor: FormGuia[keyof FormGuia]) => {
        // Fallback formInicial: nunca deixar um form parcial no estado (um
        // form sem os campos texto derruba o render com undefined.trim()).
        setForms(prev => {
            const saida = relatorio?.saidas.linhas.find(l => l.uf === uf);
            const base = prev[uf] || formInicial(saida, false);
            return { ...prev, [uf]: { ...base, [campo]: valor } };
        });
    };

    const montarGuia = (uf: string): GiaStGuia => {
        const f = forms[uf];
        const r = relatorio!;
        const calc = calcularGiaSt(f);
        const saida = r.saidas.linhas.find(l => l.uf === uf);
        const entrada = r.entradas.linhas.find(l => l.uf === uf);
        const base: Omit<GiaStGuia, 'inconsistencias'> = {
            id: montarIdGuia(r.empresaCnpj, uf, r.competencia),
            empresaCnpj: r.empresaCnpj,
            empresaNome: r.empresaNome,
            ufFavorecida: uf,
            inscricaoEstadualUfFavorecida: String(f.inscricaoEstadualUfFavorecida || '').trim(),
            competencia: r.competencia,
            semMovimento: !!f.semMovimento,
            retificacao: !!f.retificacao,
            dataVencimento: f.dataVencimento || '',
            informacoesComplementares: f.informacoesComplementares || '',
            origemRelatorio: {
                ...(saida ? { saidas: { valorContabil: saida.valorContabil, baseCalculo: saida.baseCalculo, valorIcms: saida.valorIcms, bcIcmsRetido: saida.bcIcmsRetido, icmsRetidoFonte: saida.icmsRetidoFonte } } : {}),
                ...(entrada ? { entradas: { valorContabil: entrada.valorContabil, baseCalculo: entrada.baseCalculo, valorIcms: entrada.valorIcms, bcIcmsRetido: entrada.bcIcmsRetido, icmsRetidoFonte: entrada.icmsRetidoFonte } } : {}),
            },
            c7ValorProdutos: f.c7ValorProdutos, c8ValorIpi: f.c8ValorIpi,
            c9DespesasAcessorias: f.c9DespesasAcessorias, c10BcIcmsProprio: f.c10BcIcmsProprio,
            c11IcmsProprio: f.c11IcmsProprio, c12BcIcmsSt: f.c12BcIcmsSt,
            c13IcmsRetidoSt: f.c13IcmsRetidoSt, c14IcmsDevolucao: f.c14IcmsDevolucao,
            c15IcmsRessarcimentos: f.c15IcmsRessarcimentos,
            c16CreditoPeriodoAnterior: f.c16CreditoPeriodoAnterior,
            c17PagamentosAntecipados: f.c17PagamentosAntecipados,
            c19RepasseRefinarias: f.c19RepasseRefinarias, c39RepasseOutros: f.c39RepasseOutros,
            c37DistribuidoraCombustivel: !!f.c37DistribuidoraCombustivel,
            declarante: String(declarante.nome || '').trim() ? declarante : null,
            anexoI: f.anexoI || [], anexoII: f.anexoII || [], anexoIII: f.anexoIII || [],
            ...calc,
        };
        return { ...base, inconsistencias: validarGiaSt(base) };
    };

    const handleArquivoTxt = () => {
        try {
            const itens: GiaStArquivoGuia[] = ufsIncluidas.map(uf => {
                const guia = montarGuia(uf);
                return { guia, anexoI: guia.anexoI, anexoII: guia.anexoII, anexoIII: guia.anexoIII };
            });
            const { blob, nomeArquivo } = gerarArquivoGiaStBlob(itens, declarante);
            downloadBlob(blob, nomeArquivo);
            toast(`Arquivo ${nomeArquivo} gerado com ${itens.length} GIA-ST. Importe no aplicativo GIA-ST 3: Arquivo → Importar → Sistema Próprio.`);
        } catch (e: any) {
            toast(`Arquivo não gerado: ${e?.message || e}`);
        }
    };

    const handleSalvar = async (uf: string) => {
        setSalvando(uf);
        try {
            const guia = montarGuia(uf);
            await salvarGiaSt(guia, currentUser);
            toast(`GIA-ST ${uf} ${fmtComp(guia.competencia)} salva${guia.inconsistencias.length ? ` com ${guia.inconsistencias.length} inconsistência(s)` : ' e válida'}.`);
            await carregarSalvas(guia.empresaCnpj);
        } catch (e: any) {
            toast(`Erro ao salvar GIA-ST ${uf}: ${e?.message || e}`);
        } finally {
            setSalvando(null);
        }
    };

    const handleEspelho = async (uf: string) => {
        try { await gerarEspelhoGiaStPdf(montarGuia(uf)); }
        catch (e: any) { toast(`Erro ao gerar espelho: ${e?.message || e}`); }
    };

    const ufsIncluidas = useMemo(
        () => Object.entries(forms).filter(([, f]) => f.incluida).map(([uf]) => uf).sort(),
        [forms],
    );

    return (
        <div className="space-y-4">
            <div className="bg-gradient-to-r from-amber-600 to-orange-600 rounded-xl p-4 text-white">
                <h2 className="text-lg font-bold">GIA-ST — Guia Nacional de Informação e Apuração do ICMS-ST</h2>
                <p className="text-xs opacity-90">
                    Importe o relatório "Livro de ICMS Substituto (Operações Interestaduais)" do Office Fiscal (IOB/SAGE),
                    revise por UF favorecida e gere a guia validada (Ajuste SINIEF 04/93 · aplicativo GIA-ST 3).
                </p>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-2">
                    1) Relatório do Office Fiscal (PDF)
                </label>
                <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf"
                    disabled={parsing}
                    onChange={e => handleFile(e.target.files?.[0] || null)}
                    className="text-xs text-slate-600 dark:text-slate-300 file:mr-3 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-amber-600 file:text-white file:text-xs file:font-semibold hover:file:bg-amber-700"
                />
                {parsing && <p className="text-xs text-slate-400 mt-2">Lendo PDF…</p>}
                {erro && <p className="text-xs text-rose-600 dark:text-rose-400 mt-2">{erro}</p>}
                <p className="text-[11px] text-slate-400 mt-2">
                    Saídas: espelho PDF de conferência e <strong>arquivo TXT de importação</strong> no layout oficial
                    v3.1 (PROCERGS) — no aplicativo GIA-ST 3 use Arquivo → Importar → Sistema Próprio, valide e
                    transmita pelo TED.
                </p>
            </div>

            {relatorio && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                    {/* A EMPRESA VEM DO PDF, e é assim que tem que ser: o documento
                        é a fonte e digitação não vence documento. Mas subir o
                        relatório do cliente ERRADO gravaria a GIA-ST em nome de
                        outra empresa, então a divergência com a ativa ACENDE —
                        é a regra de 06/08 (fonte × cadastro discordando é ALERTA,
                        nunca escolha silenciosa). O app NÃO troca nada sozinho. */}
                    {divergeDaAtiva && (
                        <div className="mb-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-2.5 text-[11px] text-amber-800 dark:text-amber-200">
                            ⚠ O relatório é de <strong>{relatorio.empresaNome}</strong> ({fmtCnpj(relatorio.empresaCnpj)}),
                            mas a empresa ativa é <strong>{empresaAtiva!.nome}</strong>. Confira se subiu o PDF certo —
                            salvar aqui grava a GIA-ST em nome da empresa <strong>do relatório</strong>, não da ativa.
                        </div>
                    )}
                    <div className="flex flex-wrap gap-x-8 gap-y-1 text-xs">
                        <span><strong>Empresa:</strong> {relatorio.empresaNome}</span>
                        <span><strong>CNPJ:</strong> {fmtCnpj(relatorio.empresaCnpj)}</span>
                        <span><strong>IE origem:</strong> {relatorio.inscricaoEstadual || '—'}</span>
                        <span><strong>Competência:</strong> {fmtComp(relatorio.competencia)}</span>
                    </div>
                    {relatorio.validacao.ok ? (
                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-2">
                            ✓ Totais do relatório conferem com a soma das UFs (Entradas e Saídas).
                        </p>
                    ) : (
                        <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-2">
                            ⚠ Divergências entre a soma das UFs e os totais impressos:
                            <ul className="list-disc ml-4">{relatorio.validacao.divergencias.map((d, i) => <li key={i}>{d}</li>)}</ul>
                        </div>
                    )}

                    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                        <h4 className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-2">
                            Declarante (registro A0 do arquivo · aba Identificação do GIA-ST 3)
                        </h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <div className="md:col-span-2">
                                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Nome *</label>
                                <input className={inputTxtCls} value={declarante.nome}
                                    onChange={e => setDeclarante(d => ({ ...d, nome: e.target.value }))} />
                            </div>
                            <div>
                                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">CPF *</label>
                                <input className={inputTxtCls} value={declarante.cpf} placeholder="somente números"
                                    onChange={e => setDeclarante(d => ({ ...d, cpf: e.target.value.replace(/\D/g, '').slice(0, 11) }))} />
                            </div>
                            <div>
                                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Cargo</label>
                                <input className={inputTxtCls} value={declarante.cargo}
                                    onChange={e => setDeclarante(d => ({ ...d, cargo: e.target.value }))} />
                            </div>
                            <div>
                                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">DDD</label>
                                <input className={inputTxtCls} value={declarante.telefoneDdd}
                                    onChange={e => setDeclarante(d => ({ ...d, telefoneDdd: e.target.value.replace(/\D/g, '').slice(0, 4) }))} />
                            </div>
                            <div>
                                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Telefone</label>
                                <input className={inputTxtCls} value={declarante.telefoneNumero}
                                    onChange={e => setDeclarante(d => ({ ...d, telefoneNumero: e.target.value.replace(/\D/g, '').slice(0, 9) }))} />
                            </div>
                            <div>
                                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">E-mail</label>
                                <input className={inputTxtCls} value={declarante.email}
                                    onChange={e => setDeclarante(d => ({ ...d, email: e.target.value }))} />
                            </div>
                            <div>
                                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Local (cidade)</label>
                                <input className={inputTxtCls} value={declarante.local}
                                    onChange={e => setDeclarante(d => ({ ...d, local: e.target.value }))} />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {relatorio && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">2) Saídas por UF — marque as UFs favorecidas (IE de substituto)</h3>
                        <p className="text-[11px] text-slate-400">Pré-marcadas as UFs com ICMS retido na fonte no relatório.</p>
                    </div>
                    <div className="overflow-x-auto max-h-[380px]">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 dark:bg-slate-700 sticky top-0">
                                <tr>
                                    <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Gerar</th>
                                    <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">UF</th>
                                    <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">Valor Contábil</th>
                                    <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">Base de Cálculo</th>
                                    <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">Valor ICMS</th>
                                    <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">BC ICMS Retido</th>
                                    <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">ICMS Retido Fonte</th>
                                </tr>
                            </thead>
                            <tbody>
                                {relatorio.saidas.linhas.map(l => (
                                    <tr key={l.uf} className={`border-t border-slate-100 dark:border-slate-700 ${forms[l.uf]?.incluida ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}>
                                        <td className="px-3 py-1.5">
                                            <input
                                                type="checkbox"
                                                checked={forms[l.uf]?.incluida || false}
                                                onChange={e => setCampo(l.uf, 'incluida', e.target.checked)}
                                            />
                                        </td>
                                        <td className="px-3 py-1.5 font-semibold">{l.uf} <span className="text-slate-400 font-normal">{l.nomeUf}</span></td>
                                        <td className="px-3 py-1.5 text-right">{fmt(l.valorContabil)}</td>
                                        <td className="px-3 py-1.5 text-right">{fmt(l.baseCalculo)}</td>
                                        <td className="px-3 py-1.5 text-right">{fmt(l.valorIcms)}</td>
                                        <td className="px-3 py-1.5 text-right">{fmt(l.bcIcmsRetido)}</td>
                                        <td className="px-3 py-1.5 text-right font-semibold">{fmt(l.icmsRetidoFonte)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {relatorio && ufsIncluidas.map(uf => {
                const f = forms[uf];
                const calc = calcularGiaSt(f);
                const entrada = relatorio.entradas.linhas.find(l => l.uf === uf);
                const guiaPrevia = montarGuia(uf);
                return (
                    <div key={uf} className="bg-white dark:bg-slate-800 rounded-xl border-2 border-amber-300 dark:border-amber-700 p-4 space-y-3">
                        <div className="flex justify-between items-center flex-wrap gap-2">
                            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                                3) GIA-ST · UF favorecida <span className="text-amber-600">{uf}</span> · {fmtComp(relatorio.competencia)}
                            </h3>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => handleEspelho(uf)}
                                    className="px-3 py-1.5 text-xs font-semibold bg-slate-600 text-white rounded hover:bg-slate-700"
                                >
                                    Espelho PDF
                                </button>
                                <button
                                    onClick={() => handleSalvar(uf)}
                                    disabled={salvando === uf}
                                    className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-40"
                                >
                                    {salvando === uf ? 'Salvando…' : 'Salvar guia'}
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <div>
                                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">IE na UF favorecida *</label>
                                <input
                                    className={inputTxtCls}
                                    value={f.inscricaoEstadualUfFavorecida}
                                    onChange={e => setCampo(uf, 'inscricaoEstadualUfFavorecida', e.target.value)}
                                    placeholder="Inscrição de substituto"
                                />
                            </div>
                            <div>
                                <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Vencimento ICMS-ST</label>
                                <input
                                    type="date"
                                    className={inputTxtCls}
                                    value={f.dataVencimento}
                                    onChange={e => setCampo(uf, 'dataVencimento', e.target.value)}
                                />
                            </div>
                            <label className="flex items-end gap-1 text-[11px] text-slate-500 dark:text-slate-400 pb-1.5">
                                <input type="checkbox" checked={f.semMovimento} onChange={e => setCampo(uf, 'semMovimento', e.target.checked)} />
                                1. Sem movimento
                            </label>
                            <label className="flex items-end gap-1 text-[11px] text-slate-500 dark:text-slate-400 pb-1.5">
                                <input type="checkbox" checked={f.retificacao} onChange={e => setCampo(uf, 'retificacao', e.target.checked)} />
                                2. Retificação
                            </label>
                            <label className="flex items-end gap-1 text-[11px] text-slate-500 dark:text-slate-400 pb-1.5 col-span-2">
                                <input type="checkbox" checked={f.c37DistribuidoraCombustivel} onChange={e => setCampo(uf, 'c37DistribuidoraCombustivel', e.target.checked)} />
                                37. Distribuidora de combustíveis/TRR
                            </label>
                        </div>

                        {entrada && (entrada.icmsRetidoFonte > 0 || entrada.bcIcmsRetido > 0) && (
                            <p className="text-[11px] text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-900/30 rounded px-2 py-1">
                                Entradas nesta UF no período (possíveis devoluções p/ campo 14 · Anexo I):
                                ICMS retido R$ {fmt(entrada.icmsRetidoFonte)} · BC retido R$ {fmt(entrada.bcIcmsRetido)}.
                            </p>
                        )}

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            {CAMPOS_EDITAVEIS.map(({ key, label }) => (
                                <div key={key}>
                                    <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{label}</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        className={inputCls}
                                        value={f[key]}
                                        onChange={e => setCampo(uf, key, parseFloat(e.target.value) || 0)}
                                    />
                                </div>
                            ))}
                        </div>

                        {f.c14IcmsDevolucao > 0 && (
                            <AnexoNfEditor
                                titulo="Anexo I — notas de devolução (campo 14)"
                                somaEsperada={f.c14IcmsDevolucao}
                                itens={f.anexoI}
                                onChange={itens => setCampo(uf, 'anexoI', itens)}
                            />
                        )}
                        {f.c15IcmsRessarcimentos > 0 && (
                            <AnexoNfEditor
                                titulo="Anexo II — notas de ressarcimento (campo 15)"
                                somaEsperada={f.c15IcmsRessarcimentos}
                                itens={f.anexoII}
                                onChange={itens => setCampo(uf, 'anexoII', itens)}
                            />
                        )}

                        <div className="border border-slate-200 dark:border-slate-600 rounded p-2 space-y-1.5">
                            <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                                Anexo III — transferências p/ filial na UF favorecida (campo 38 · opcional)
                            </span>
                            {f.anexoIII.map((it, idx) => (
                                <div key={idx} className="grid grid-cols-2 md:grid-cols-4 gap-1 items-end">
                                    <input className={inputTxtCls} placeholder="IE da filial" value={it.inscricaoEstadual}
                                        onChange={e => setCampo(uf, 'anexoIII', f.anexoIII.map((x, i) => i === idx ? { ...x, inscricaoEstadual: e.target.value } : x))} />
                                    <input type="number" step="0.01" min="0" className={inputCls} placeholder="Base de cálculo" value={it.baseCalculo}
                                        onChange={e => setCampo(uf, 'anexoIII', f.anexoIII.map((x, i) => i === idx ? { ...x, baseCalculo: parseFloat(e.target.value) || 0 } : x))} />
                                    <input type="number" step="0.01" min="0" className={inputCls} placeholder="ICMS destacado" value={it.valorIcmsDestacado}
                                        onChange={e => setCampo(uf, 'anexoIII', f.anexoIII.map((x, i) => i === idx ? { ...x, valorIcmsDestacado: parseFloat(e.target.value) || 0 } : x))} />
                                    <button onClick={() => setCampo(uf, 'anexoIII', f.anexoIII.filter((_, i) => i !== idx))}
                                        className="text-rose-500 text-[11px] hover:underline text-left">remover</button>
                                </div>
                            ))}
                            <button
                                onClick={() => setCampo(uf, 'anexoIII', [...f.anexoIII, { inscricaoEstadual: '', baseCalculo: 0, valorIcmsDestacado: 0 }])}
                                className="text-indigo-500 text-[11px] hover:underline"
                            >
                                + adicionar transferência
                            </button>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                            <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded p-2 text-center">
                                <div className="text-[11px] text-indigo-700 dark:text-indigo-300 font-semibold">18. ICMS-ST Devido</div>
                                <div className="text-sm font-bold text-indigo-800 dark:text-indigo-200">R$ {fmt(calc.c18IcmsStDevido)}</div>
                            </div>
                            <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded p-2 text-center">
                                <div className="text-[11px] text-indigo-700 dark:text-indigo-300 font-semibold">20. Crédito Per. Seguinte</div>
                                <div className="text-sm font-bold text-indigo-800 dark:text-indigo-200">R$ {fmt(calc.c20CreditoPeriodoSeguinte)}</div>
                            </div>
                            <div className="bg-emerald-50 dark:bg-emerald-900/30 rounded p-2 text-center">
                                <div className="text-[11px] text-emerald-700 dark:text-emerald-300 font-semibold">21. Total a Recolher</div>
                                <div className="text-sm font-bold text-emerald-800 dark:text-emerald-200">R$ {fmt(calc.c21TotalRecolher)}</div>
                            </div>
                        </div>

                        <div>
                            <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">36. Informações Complementares</label>
                            <textarea
                                rows={2}
                                className={inputTxtCls}
                                value={f.informacoesComplementares}
                                onChange={e => setCampo(uf, 'informacoesComplementares', e.target.value)}
                            />
                        </div>

                        {guiaPrevia.inconsistencias.length > 0 && (
                            <div className="text-[11px] text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 rounded px-2 py-1.5">
                                <strong>Inconsistências (o GIA-ST 3 não gera arquivo com pendências):</strong>
                                <ul className="list-disc ml-4">{guiaPrevia.inconsistencias.map((inc, i) => <li key={i}>{inc}</li>)}</ul>
                            </div>
                        )}
                    </div>
                );
            })}

            {relatorio && ufsIncluidas.length > 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border-2 border-emerald-300 dark:border-emerald-700 p-4 flex items-center justify-between flex-wrap gap-2">
                    <div>
                        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">4) Arquivo de importação — GIA-ST 3 (Sistema Próprio · layout v3.1)</h3>
                        <p className="text-[11px] text-slate-400">
                            Gera 1 arquivo TXT com {ufsIncluidas.length} GIA-ST ({ufsIncluidas.join(', ')}).
                            No aplicativo da SEFAZ-RS: Arquivo → Importar → Sistema Próprio → validar → Gerar Arquivo p/ Transmissão (TED).
                        </p>
                    </div>
                    <button
                        onClick={handleArquivoTxt}
                        className="px-4 py-2 text-xs font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700"
                    >
                        ⬇ Gerar arquivo TXT
                    </button>
                </div>
            )}

            {salvas.length > 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">Guias salvas desta empresa</h3>
                    </div>
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-700">
                            <tr>
                                <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Competência</th>
                                <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">UF</th>
                                <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">IE</th>
                                <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">21. Total a Recolher</th>
                                <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Situação</th>
                                <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {salvas.map(g => (
                                <tr key={g.id} className="border-t border-slate-100 dark:border-slate-700">
                                    <td className="px-3 py-1.5">{fmtComp(g.competencia)}</td>
                                    <td className="px-3 py-1.5 font-semibold">{g.ufFavorecida}</td>
                                    <td className="px-3 py-1.5">{g.inscricaoEstadualUfFavorecida || '—'}</td>
                                    <td className="px-3 py-1.5 text-right font-semibold">R$ {fmt(g.c21TotalRecolher)}</td>
                                    <td className="px-3 py-1.5">
                                        {g.semMovimento ? <span className="text-slate-400">sem movimento</span>
                                            : g.inconsistencias?.length
                                                ? <span className="text-rose-500">{g.inconsistencias.length} pendência(s)</span>
                                                : <span className="text-emerald-500">válida</span>}
                                    </td>
                                    <td className="px-3 py-1.5 flex gap-2">
                                        <button
                                            onClick={() => gerarEspelhoGiaStPdf(g).catch(e => toast(String(e?.message || e)))}
                                            className="text-indigo-500 hover:underline"
                                        >
                                            Espelho PDF
                                        </button>
                                        <button
                                            onClick={() => {
                                                try {
                                                    const { blob, nomeArquivo } = gerarArquivoGiaStBlob(
                                                        [{ guia: g, anexoI: g.anexoI, anexoII: g.anexoII, anexoIII: g.anexoIII }],
                                                        g.declarante || declarante,
                                                    );
                                                    downloadBlob(blob, nomeArquivo);
                                                } catch (e: any) { toast(`Arquivo não gerado: ${e?.message || e}`); }
                                            }}
                                            className="text-emerald-600 hover:underline"
                                        >
                                            TXT
                                        </button>
                                        {currentUser.role === 'admin' && (
                                            <button
                                                onClick={async () => {
                                                    if (!window.confirm(`Excluir GIA-ST ${g.ufFavorecida} ${fmtComp(g.competencia)}?`)) return;
                                                    try {
                                                        await excluirGiaSt(g.id);
                                                        await carregarSalvas(g.empresaCnpj);
                                                        toast('Guia excluída.');
                                                    } catch (e: any) { toast(`Erro ao excluir: ${e?.message || e}`); }
                                                }}
                                                className="text-rose-500 hover:underline"
                                            >
                                                Excluir
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default GiaStPanel;
