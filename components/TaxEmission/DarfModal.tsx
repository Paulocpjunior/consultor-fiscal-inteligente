/**
 * components/TaxEmission/DarfModal.tsx
 * Modal de emissao manual de DARF (Lucro Presumido / Real).
 * Sugere valor a partir da FichaFinanceira via taxEmissionService.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type {
    User, LucroPresumidoEmpresa, DarfRegime, DarfTributo,
    DarfPeriodicidade, DarfCodigoReceita,
} from '../../types';
import { DARF_TRIBUTO_LABELS } from '../../types';
import { emitirDarf, sugerirCodigoReceita } from '../../services/darfService';
import { sugerirValorDarf, formatBRL } from '../../services/taxEmissionService';
import EmpresaSearchSelect from '../xml/EmpresaSearchSelect';
import { paraEmpresaOptions } from '../../services/empresaOption';
import { parseValorMoeda } from '../../services/valorDigitado';

interface Props {
    currentUser: User | null;
    empresas: LucroPresumidoEmpresa[];
    onClose: () => void;
    onEmitido: () => void;
    onShowToast?: (msg: string) => void;
}

const competenciaAtualDefault = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const DarfModal: React.FC<Props> = ({ currentUser, empresas, onClose, onEmitido, onShowToast }) => {
    const [empresaId, setEmpresaId] = useState('');
    const [regime, setRegime] = useState<DarfRegime>('Presumido');
    const [tributo, setTributo] = useState<DarfTributo>('IRPJ');
    const [periodicidade, setPeriodicidade] = useState<DarfPeriodicidade>('trimestral');
    const [competencia, setCompetencia] = useState<string>(competenciaAtualDefault);
    const [valor, setValor] = useState<string>('');
    const [codigoReceita, setCodigoReceita] = useState<string>('');
    const [codigoSugerido, setCodigoSugerido] = useState<DarfCodigoReceita | null>(null);
    const [vencimento, setVencimento] = useState<string>('');
    const [observacao, setObservacao] = useState<string>('');
    const [emitindo, setEmitindo] = useState(false);
    const [sugestaoDetalhe, setSugestaoDetalhe] = useState<string>('');

    const empresa = useMemo(
        () => empresas.find(e => e.id === empresaId),
        [empresas, empresaId]
    );

    // Quando trocar IRPJ/CSLL → trimestral default; PIS/COFINS → mensal
    useEffect(() => {
        if (tributo === 'IRPJ' || tributo === 'CSLL') setPeriodicidade('trimestral');
        else setPeriodicidade('mensal');
    }, [tributo]);

    // Quando empresa estiver definida e tiver regimePadrao, sincroniza
    useEffect(() => {
        if (empresa?.regimePadrao) setRegime(empresa.regimePadrao);
    }, [empresa]);

    // Buscar código de receita sugerido
    useEffect(() => {
        let cancelado = false;
        (async () => {
            try {
                const sug = await sugerirCodigoReceita(currentUser, regime, tributo, periodicidade);
                if (cancelado) return;
                setCodigoSugerido(sug);
                if (sug && !codigoReceita) setCodigoReceita(sug.codigo);
            } catch {/* ignora */}
        })();
        return () => { cancelado = true; };
    }, [regime, tributo, periodicidade, currentUser]);

    // Sugerir valor a partir da FichaFinanceira
    useEffect(() => {
        if (!empresa) {
            setSugestaoDetalhe('');
            return;
        }
        const sug = sugerirValorDarf(empresa, tributo, regime, competencia, periodicidade);
        if (sug.valor > 0) {
            setValor(sug.valor.toFixed(2).replace('.', ','));
            setSugestaoDetalhe(`Sugestão (${sug.fonte}): ${sug.detalhe || ''}`);
        } else {
            setSugestaoDetalhe(sug.detalhe || '');
        }
    }, [empresa, tributo, regime, competencia, periodicidade]);

    const handleEmitir = async () => {
        if (!empresa) return onShowToast?.('Selecione uma empresa');
        // `replace(/\./g, '')` antes da vírgula fazia "1234.56" virar 123456 —
        // DARF cem vezes maior, aceito pelo SICALC. O dono lê as três formas e
        // devolve null no ilegível: recusa NOMEADA, nunca zero nem chute.
        const v = parseValorMoeda(valor);
        if (v === null) return onShowToast?.(`Não entendi o valor "${valor}" — use 1234,56. Nada foi emitido.`);
        if (v < 10) return onShowToast?.('Valor mínimo R$ 10,00');

        setEmitindo(true);
        try {
            await emitirDarf(currentUser, {
                empresaId: empresa.id,
                empresaCnpj: empresa.cnpj,
                empresaNome: empresa.nome,
                regime,
                tributo,
                competencia,
                valor: v,
                periodicidade,
                codigoReceita: codigoReceita || undefined,
                vencimento: vencimento || undefined,
                observacao: observacao || undefined,
            });
            onShowToast?.(`DARF de ${DARF_TRIBUTO_LABELS[tributo]} emitida com sucesso`);
            onEmitido();
            onClose();
        } catch (e: any) {
            onShowToast?.(`Erro: ${e.message}`);
        } finally {
            setEmitindo(false);
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black/60 flex items-start justify-center p-4 z-[70] overflow-y-auto"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto my-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="p-6 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                        Emitir DARF
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Documento de Arrecadação de Receitas Federais — Lucro Presumido / Real
                    </p>
                </div>

                <div className="p-6 space-y-4">
                    {/* Aviso DCTFWeb: os 4 tributos deste modal são exatamente os
                        declarados na DCTFWeb — o DARF correto sai da declaração
                        transmitida (vinculação automática do pagamento). Emissão
                        avulsa aqui é pra recolhimentos FORA de declaração. Sem
                        este aviso, o colaborador tentava emitir avulso (caso
                        RADIO E TV 06/2026) e ainda tomava erro do catálogo. */}
                    <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 text-xs text-amber-800 dark:text-amber-300">
                        <b>Tributo declarado na DCTFWeb?</b> IRPJ/CSLL/PIS/COFINS apurados na DCTFWeb devem ter o
                        DARF emitido pelo <b>Painel DCTFWeb</b> (linha da declaração transmitida → <b>Detalhe</b> → DARF) —
                        ele sai vinculado à declaração e o pagamento se casa sozinho na Receita. Use esta emissão
                        avulsa apenas para recolhimentos <b>fora de declaração</b> (complementos, diferenças, multas isoladas).
                    </div>

                    {/* Empresa */}
                    <div>
                        <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Empresa</label>
                        <EmpresaSearchSelect
                            empresas={paraEmpresaOptions(empresas, 'lucro')}
                            value={empresaId}
                            onChange={setEmpresaId}
                            placeholder="Selecione a empresa — código, nome ou CNPJ"
                        />
                    </div>

                    {/* Regime + Tributo */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Regime</label>
                            <select
                                value={regime}
                                onChange={e => setRegime(e.target.value as DarfRegime)}
                                className="mt-1 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                            >
                                <option value="Presumido">Lucro Presumido</option>
                                <option value="Real">Lucro Real</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Tributo</label>
                            <select
                                value={tributo}
                                onChange={e => setTributo(e.target.value as DarfTributo)}
                                className="mt-1 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                            >
                                {(['IRPJ','CSLL','PIS','COFINS','IRRF'] as DarfTributo[]).map(t => (
                                    <option key={t} value={t}>{DARF_TRIBUTO_LABELS[t]}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Periodicidade + Competência */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Periodicidade</label>
                            <select
                                value={periodicidade}
                                onChange={e => setPeriodicidade(e.target.value as DarfPeriodicidade)}
                                className="mt-1 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                            >
                                <option value="mensal">Mensal</option>
                                <option value="trimestral">Trimestral</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                                Competência {periodicidade === 'trimestral' && '(último mês do trimestre)'}
                            </label>
                            <input
                                type="month"
                                value={competencia}
                                onChange={e => setCompetencia(e.target.value)}
                                className="mt-1 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                            />
                        </div>
                    </div>

                    {/* Código de receita */}
                    <div>
                        <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                            Código de Receita
                            {codigoSugerido && (
                                <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                                    Sugerido: {codigoSugerido.codigo} — {codigoSugerido.descricao}
                                </span>
                            )}
                        </label>
                        <input
                            type="text"
                            placeholder="ex: 2089"
                            value={codigoReceita}
                            onChange={e => setCodigoReceita(e.target.value.replace(/\D/g, '').slice(0, 4))}
                            className="mt-1 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 font-mono"
                        />
                    </div>

                    {/* Valor */}
                    <div>
                        <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Valor Principal (R$)</label>
                        <input
                            type="text"
                            placeholder="0,00"
                            value={valor}
                            onChange={e => setValor(e.target.value)}
                            className="mt-1 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 font-mono text-lg"
                        />
                        {sugestaoDetalhe && (
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sugestaoDetalhe}</p>
                        )}
                    </div>

                    {/* Vencimento + Observação */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                                Vencimento (opcional)
                            </label>
                            <input
                                type="date"
                                value={vencimento}
                                onChange={e => setVencimento(e.target.value)}
                                className="mt-1 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Observação</label>
                            <input
                                type="text"
                                placeholder="ex: Recolhimento complementar"
                                value={observacao}
                                onChange={e => setObservacao(e.target.value)}
                                className="mt-1 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                            />
                        </div>
                    </div>

                    {empresa && valor && (
                        <div className="bg-slate-50 dark:bg-slate-900/40 p-3 rounded border border-slate-200 dark:border-slate-700 text-sm">
                            <div className="font-medium text-slate-700 dark:text-slate-200 mb-1">Pré-visualização</div>
                            <div className="text-xs text-slate-600 dark:text-slate-400 space-y-0.5">
                                <div>Empresa: <span className="font-medium">{empresa.nome}</span></div>
                                <div>{DARF_TRIBUTO_LABELS[tributo]} {regime} — competência {competencia}</div>
                                <div>Código {codigoReceita || '—'} — valor principal {parseValorMoeda(valor) === null ? 'não entendi este valor — use 1234,56' : formatBRL(parseValorMoeda(valor) as number)}</div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="btn-press px-4 py-2 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleEmitir}
                        disabled={emitindo || !empresaId || !valor}
                        className="btn-press px-4 py-2 bg-sky-600 text-white font-bold rounded-lg hover:bg-sky-700 disabled:opacity-50"
                    >
                        {emitindo ? 'Emitindo...' : 'Emitir DARF'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DarfModal;
