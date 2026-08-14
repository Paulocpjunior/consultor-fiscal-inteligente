
import React, { useMemo, useState } from 'react';
import { SimplesNacionalEmpresa, SimplesNacionalNota, User } from '../types';
import * as simplesService from '../services/simplesNacionalService';
import { PlusIcon, InfoIcon, ShieldIcon, PencilIcon, TrashIcon } from './Icons';
import { previewMesclagem, executarMesclagem, descreverResumo } from '../services/empresasMergeService';
import SimplesBaseVarreduraModal from './SimplesBaseVarreduraModal';
import { empresaBateBusca, prefixoCodCliente } from '../services/buscaEmpresa';

interface SimplesNacionalDashboardProps {
    empresas: SimplesNacionalEmpresa[];
    notas: Record<string, SimplesNacionalNota[]>;
    onSelectEmpresa: (id: string, view: 'detalhe' | 'cliente') => void;
    onAddNew: () => void;
    onEdit: (empresa: SimplesNacionalEmpresa) => void;
    onDelete?: (empresa: SimplesNacionalEmpresa) => void;
    currentUser?: User | null;
    onShowToast?: (msg: string) => void;
    /** Chamado após mesclagem de duplicatas (recarrega a lista da nuvem). */
    onMesclado?: () => void;
}

// CNPJ SEMPRE formatado na exibição — mesmo padrão do Lucro (ListView): a
// base tem registros mistos ('05049535000170' e '05.049.535/0001-70'), o que
// esconde duplicatas do olho humano (caso WALDESA 24/07).
const fmtCnpj = (c?: string): string => {
    const d = String(c || '').replace(/\D/g, '');
    return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : (c || '—');
};

const SimplesNacionalDashboard: React.FC<SimplesNacionalDashboardProps> = ({ empresas, notas, onSelectEmpresa, onAddNew, onEdit, onDelete, currentUser, onShowToast, onMesclado }) => {
    const [mesclando, setMesclando] = useState<string | null>(null);

    // Mesclagem quando AS DUAS duplicatas têm lançamentos (mesmo fluxo do
    // Lucro): clicada = vencedora; gêmea entra com os meses que faltam e vira
    // lápide _merged_into. Preview obrigatório antes de aplicar.
    const mesclarDuplicata = async (vencedora: SimplesNacionalEmpresa) => {
        const cnpjN = String(vencedora.cnpj || '').replace(/\D/g, '');
        const gemea = empresas.find(e => e.id !== vencedora.id && String(e.cnpj || '').replace(/\D/g, '') === cnpjN);
        if (!gemea) { onShowToast?.('Gêmea não encontrada na lista.'); return; }
        setMesclando(vencedora.id);
        try {
            const p = await previewMesclagem('simples', vencedora.id, gemea.id);
            if (!p.ok) { onShowToast?.(`Preview falhou: ${p.error}`); return; }
            const msg = `MESCLAR duplicatas de ${vencedora.nome}?\n\nMANTIDA: "${vencedora.nome}"\nMESCLADA E ARQUIVADA: a gêmea\n\n${descreverResumo(p.resumo, p.conflitos)}\n\nA gêmea sai de todas as listas (lápide de mesclagem) — nada é apagado.`;
            if (!confirm(msg)) return;
            const r = await executarMesclagem('simples', vencedora.id, gemea.id);
            if (!r.ok) { onShowToast?.(`Mesclagem falhou: ${r.error}`); return; }
            onShowToast?.(`✓ Mesclado. ${descreverResumo(r.resumo, r.conflitos)}`);
            onMesclado?.();
        } catch (e: any) {
            onShowToast?.(`Mesclagem falhou: ${e?.message || e}`);
        } finally {
            setMesclando(null);
        }
    };

    const empresasComResumo = useMemo(() => {
        return empresas.map(empresa => {
            // Pass { fullHistory: false } to align "mensal" data with RBT12 period (last 12 months)
            const resumo = simplesService.calcularResumoEmpresa(empresa, notas[empresa.id] || [], new Date(), { fullHistory: false });
            return { ...empresa, resumo };
        });
    }, [empresas, notas]);

    const isAdminView = currentUser?.role === 'admin' || currentUser?.email === 'junior@spassessoriacontabil.com.br';

    // Duplicatas por CNPJ NORMALIZADO — mesmo padrão do painel Lucro: mesma
    // empresa cadastrada 2+ vezes (em formatos diferentes o olho não pega).
    const cnpjsDuplicados = useMemo(() => {
        const contagem = new Map<string, number>();
        for (const e of empresas) {
            const d = String(e.cnpj || '').replace(/\D/g, '');
            if (d.length === 14) contagem.set(d, (contagem.get(d) || 0) + 1);
        }
        return new Set([...contagem.entries()].filter(([, n]) => n > 1).map(([c]) => c));
    }, [empresas]);

    const [busca, setBusca] = useState('');
    // Conferência das bases (RBT12) — varre a carteira atrás de detalhamento
    // por CNAE acima do total lançado, que inflava a faixa e o DAS.
    const [varreduraAberta, setVarreduraAberta] = useState(false);
    // Régua ÚNICA (código, nome ou CNPJ) — a mesma do seletor das telas de
    // XML. Paulo procurou "pelo número" aqui e não achou (05/08).
    const empresasFiltradas = useMemo(
        () => empresasComResumo.filter(e => empresaBateBusca(busca, e)),
        [empresasComResumo, busca],
    );

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex justify-between items-center">
                <div>
                    <div className="flex items-center gap-2">
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                            Painel Simples Nacional
                        </h2>
                        {isAdminView && (
                             <span className="px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400 text-xs font-bold rounded-full flex items-center gap-1">
                                <ShieldIcon className="w-3 h-3" /> Admin View
                             </span>
                        )}
                    </div>
                    <p className="mt-1 text-slate-500 dark:text-slate-400">
                        Gerencie as empresas e acompanhe os cálculos do Simples.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setVarreduraAberta(true)}
                        className="btn-press flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                        title="Procura clientes cujo detalhamento por CNAE soma acima do total lançado do mês — era isso que inflava o RBT12 e deixava o DAS acima do PGDAS-D."
                    >
                        🔍 Conferir bases (RBT12)
                    </button>
                    <button
                        onClick={onAddNew}
                        className="btn-press flex items-center gap-2 px-4 py-2 bg-sky-600 text-white font-semibold rounded-lg hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 transition-colors"
                    >
                        <PlusIcon className="w-5 h-5" />
                        Nova Empresa
                    </button>
                </div>
            </div>
            
            {empresas.length > 0 && (
                <div className="relative">
                    <input
                        type="text"
                        value={busca}
                        onChange={(ev) => setBusca(ev.target.value)}
                        placeholder="Buscar por código, nome ou CNPJ..."
                        className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                </div>
            )}

            {empresasComResumo.length > 0 ? (
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-slate-500 dark:text-slate-400">
                            <thead className="text-xs text-slate-700 uppercase bg-slate-50 dark:bg-slate-700 dark:text-slate-300">
                                <tr>
                                    <th scope="col" className="px-6 py-3">Empresa</th>
                                    {isAdminView && <th scope="col" className="px-6 py-3">Usuário</th>}
                                    <th scope="col" className="px-6 py-3">Anexo Efetivo</th>
                                    <th scope="col" className="px-6 py-3 text-right">RBT12 (R$)</th>
                                    <th scope="col" className="px-6 py-3 text-center">Aliq. Efetiva</th>
                                    <th scope="col" className="px-6 py-3 text-right bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300">DAS (Mês Atual)</th>
                                    <th scope="col" className="px-6 py-3 text-right">DAS Est. 12m</th>
                                    <th scope="col" className="px-6 py-3 text-center sticky right-0 z-10 bg-slate-50 dark:bg-slate-700">Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {empresasFiltradas.map(e => (
                                    <tr key={e.id} className="bg-white dark:bg-slate-800 border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600/20">
                                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-white whitespace-nowrap">
                                            {prefixoCodCliente(e) && (
                                                <span className="font-mono text-[11px] font-bold text-blue-600 dark:text-blue-400 mr-1">
                                                    {prefixoCodCliente(e)}
                                                </span>
                                            )}
                                            {/* ABRIR A EMPRESA pelo NOME.
                                                Paulo, 14/08: *"cadê a opção p ATIVAR EMPRESA"* — ele
                                                buscou 1200, achou a linha e não tinha como entrar.
                                                A coluna "Ações" existia, mas fica DEPOIS de 7 colunas,
                                                fora da tela, dentro de um overflow-x que não avisa que
                                                existe mais coisa à direita. Ação principal escondida
                                                atrás de rolagem horizontal é ação que não existe. */}
                                            <button
                                                onClick={() => onSelectEmpresa(e.id, 'detalhe')}
                                                className="text-left hover:underline text-sky-700 dark:text-sky-300"
                                                title="Abrir o painel desta empresa"
                                            >
                                                {e.nome}
                                            </button>
                                            {cnpjsDuplicados.has(String(e.cnpj || '').replace(/\D/g, '')) && (() => {
                                                // Responde "qual excluir?" com dado: quem tem 0 lançamentos
                                                // (faturamento/histórico) é o cadastro-lixo; quem tem dados é
                                                // o verdadeiro. Dois com dados = NÃO excluir nenhum (mesclar).
                                                const nLanc = Object.keys(e.faturamentoManual || {}).length + (e.historicoCalculos || []).length;
                                                const cnpjN = String(e.cnpj || '').replace(/\D/g, '');
                                                const gemea = empresas.find(x => x.id !== e.id && String(x.cnpj || '').replace(/\D/g, '') === cnpjN);
                                                const nLancGemea = gemea ? Object.keys(gemea.faturamentoManual || {}).length + (gemea.historicoCalculos || []).length : 0;
                                                const ambasComDados = nLanc > 0 && nLancGemea > 0;
                                                return (
                                                    <>
                                                    <span
                                                        className={`ml-2 px-1.5 py-0.5 text-[10px] font-bold rounded ${
                                                            nLanc === 0
                                                                ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                                                                : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                                        }`}
                                                        title={nLanc === 0
                                                            ? 'CNPJ duplicado e SEM lançamentos — este é o cadastro que pode ser excluído (🗑️).'
                                                            : `CNPJ duplicado, mas este cadastro TEM ${nLanc} lançamento(s) de faturamento/cálculo — é o que deve ser MANTIDO. Exclua o gêmeo sem dados.`}
                                                    >
                                                        ⚠ duplicada · {nLanc === 0 ? '0 lançamentos — excluir este' : `${nLanc} lançamento(s) — manter`}
                                                    </span>
                                                    {ambasComDados && isAdminView && (
                                                        <button
                                                            onClick={(ev) => { ev.stopPropagation(); mesclarDuplicata(e); }}
                                                            disabled={mesclando !== null}
                                                            className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 hover:bg-violet-200 disabled:opacity-50"
                                                            title="As DUAS têm lançamentos — mescla a gêmea NESTE cadastro (mantém este; copia da gêmea só os meses que faltam; a gêmea vira lápide de mesclagem). Preview antes de aplicar."
                                                        >
                                                            {mesclando === e.id ? '⏳ mesclando…' : '⇄ Mesclar aqui'}
                                                        </button>
                                                    )}
                                                    </>
                                                );
                                            })()}
                                            <p className="font-normal font-mono text-slate-500 dark:text-slate-400">{fmtCnpj(e.cnpj)}</p>
                                        </td>
                                        {isAdminView && (
                                            <td className="px-6 py-4">
                                                <span className="text-xs font-mono bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded">
                                                    {e.createdByEmail || 'Desconhecido'}
                                                </span>
                                            </td>
                                        )}
                                        <td className="px-6 py-4">
                                            <span className="px-2 py-1 text-xs font-semibold rounded-full bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-300">
                                                Anexo {e.resumo.anexo_efetivo}
                                            </span>
                                            {e.anexo === 'III_V' && (
                                                 <span className="block mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                    Fator R: {(e.resumo.fator_r * 100).toFixed(1)}%
                                                 </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right font-mono">
                                            {e.resumo.rbt12.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            {/* Badges em ordem de gravidade — so a mais grave aparece. */}
                                            {e.resumo.alertas_faturamento?.excesso_maior_20_pct.atingido ? (
                                                <div className="flex items-center justify-end gap-1 mt-1 text-red-700 dark:text-red-400 text-xs font-bold" title="Excesso > 20% do limite federal (R$ 5,76M) — desenquadramento RETROATIVO (LC 123 art. 30 §1º II)">
                                                    <InfoIcon className="w-3 h-3" />
                                                    Excesso 20%!
                                                </div>
                                            ) : e.resumo.alertas_faturamento?.limite_federal.atingido ? (
                                                <div className="flex items-center justify-end gap-1 mt-1 text-red-600 dark:text-red-400 text-xs font-bold" title="Limite federal Simples ultrapassado (R$ 4,8M) — empresa vedada ao Simples">
                                                    <InfoIcon className="w-3 h-3" />
                                                    Limite federal!
                                                </div>
                                            ) : e.resumo.alertas_faturamento?.proximo_limite_federal.atingido ? (
                                                <div className="flex items-center justify-end gap-1 mt-1 text-amber-600 dark:text-amber-400 text-xs font-bold" title="Receita acima de 90% do limite federal (R$ 4,32M)">
                                                    <InfoIcon className="w-3 h-3" />
                                                    {'>'}90% limite
                                                </div>
                                            ) : (e.resumo.alertas_faturamento?.sublimite_icms_iss.atingido ?? e.resumo.ultrapassou_sublimite) ? (
                                                <div className="flex items-center justify-end gap-1 mt-1 text-orange-600 dark:text-orange-400 text-xs font-bold" title="Sub-limite Estadual/Municipal ICMS/ISS ultrapassado (R$ 3,6M)">
                                                    <InfoIcon className="w-3 h-3" />
                                                    Sub-limite!
                                                </div>
                                            ) : e.resumo.alertas_faturamento?.proxima_mudanca_faixa ? (
                                                <div className="flex items-center justify-end gap-1 mt-1 text-sky-600 dark:text-sky-400 text-xs font-bold" title={`Próxima faixa: alíquota nominal ${e.resumo.alertas_faturamento.proxima_mudanca_faixa.aliquota_nominal_proxima.toFixed(2)}%`}>
                                                    <InfoIcon className="w-3 h-3" />
                                                    Próx. faixa
                                                </div>
                                            ) : null}
                                        </td>
                                        <td className="px-6 py-4 text-center font-mono">{e.resumo.aliq_eff.toFixed(2)}%</td>
                                        <td className="px-6 py-4 text-right font-mono font-bold bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300">
                                            {e.resumo.das_mensal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-6 py-4 text-right font-mono">{e.resumo.das.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                        <td className="px-6 py-4 text-center space-x-2 whitespace-nowrap sticky right-0 z-10 bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700">
                                            <button onClick={() => onSelectEmpresa(e.id, 'detalhe')} className="font-medium text-sky-600 dark:text-sky-400 hover:underline">
                                                Painel
                                            </button>
                                            <span className="text-slate-300 dark:text-slate-600">|</span>
                                            <button onClick={() => onSelectEmpresa(e.id, 'cliente')} className="font-medium text-sky-600 dark:text-sky-400 hover:underline">
                                                Cliente
                                            </button>
                                            <span className="text-slate-300 dark:text-slate-600">|</span>
                                            <button onClick={() => onEdit(e)} className="font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800" title="Editar Empresa">
                                                <PencilIcon className="w-4 h-4 inline" />
                                            </button>
                                            {isAdminView && onDelete && (
                                                <>
                                                    <span className="text-slate-300 dark:text-slate-600">|</span>
                                                    <button onClick={() => onDelete(e)} className="font-medium text-red-500 hover:text-red-700" title="Excluir empresa (admin)">
                                                        <TrashIcon className="w-4 h-4 inline" />
                                                    </button>
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="text-center p-8 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
                    <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">Nenhuma empresa cadastrada</h3>
                    <p className="mt-2 text-slate-500 dark:text-slate-400">
                        Clique em "Nova Empresa" para começar a fazer seus cálculos do Simples Nacional.
                    </p>
                </div>
            )}

            {varreduraAberta && (
                <SimplesBaseVarreduraModal
                    empresas={empresas}
                    onClose={() => setVarreduraAberta(false)}
                    onAbrirEmpresa={(id) => onSelectEmpresa(id, 'detalhe')}
                />
            )}
        </div>
    );
};

export default SimplesNacionalDashboard;
