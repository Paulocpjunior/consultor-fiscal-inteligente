/**
 * CfopCorrelacaoModal — modal pra revisar e editar correlacao de CFOP por
 * empresa. Le os CFOPs reais das notas de entrada da empresa, mostra o
 * sufixo automatico (heuristica via naturezaAtividade) e permite override
 * manual.
 *
 * Override salvo em empresa.dadosFiscais.cfopOverrides — Record<string,string>.
 *
 * Vence sobre a heuristica na geracao SPED Fiscal.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { User, DocumentoFiscal, EmpresaDadosFiscais } from '../types';
import { listDocumentos } from '../services/xmlFiscalService';
import { CloseIcon } from './Icons';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    empresaId: string;
    empresaNome: string;
    empresaCnpj: string;
    user: User | null;
    valoresAtuais?: EmpresaDadosFiscais;
    onSave: (dados: EmpresaDadosFiscais) => Promise<void>;
}

interface CfopRow {
    cfopOrigem: string;
    quantidade: number;
    sufixoAutomatico: string;  // baseado em naturezaAtividade
    valorOverride: string;     // o que o usuario digitou
    descricaoOrigem?: string;
}

// Replica simplificada da logica do backend pra calcular sufixo automatico
// (sem importar de sefaz-backend pra nao acoplar o frontend).
function calcularSufixoAutomatico(
    cfopOrigem: string,
    naturezaAtividade?: 'comercio' | 'industria' | 'servicos' | 'misto',
): string {
    const c = String(cfopOrigem || '').trim();
    if (c.length !== 4) return '';
    if (!['5', '6', '7'].includes(c[0])) return '';

    const sufixo = c.slice(1);
    const primeiroDestino = ({ '5': '1', '6': '2', '7': '3' } as const)[c[0] as '5'|'6'|'7'];

    // Categorias preservadas
    const PRESERVA_SUFIXO = [
        '401','403','405','406','407','408','409','410','411',  // ST
        '910','911','912','913','918','919',                    // devolucao
        '551','552','553','554','555',                          // ativo
        '556','557',                                            // uso/consumo
    ];
    if (PRESERVA_SUFIXO.includes(sufixo)) {
        return primeiroDestino + sufixo;
    }

    const COMPRA_PRODUTO = ['101','102','116','117','118','120','122'];
    if (COMPRA_PRODUTO.includes(sufixo)) {
        const map: Record<string, string> = {
            comercio: '102',
            industria: '101',
            servicos: '556',
        };
        if (naturezaAtividade && map[naturezaAtividade]) {
            return primeiroDestino + map[naturezaAtividade];
        }
        // misto ou ausente -> conversao mecanica
        return primeiroDestino + sufixo;
    }

    // Default: conversao mecanica
    return primeiroDestino + sufixo;
}

const CfopCorrelacaoModal: React.FC<Props> = ({
    isOpen, onClose, empresaId, empresaNome, empresaCnpj, user, valoresAtuais, onSave,
}) => {
    const [carregando, setCarregando] = useState(false);
    const [salvando, setSalvando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [rows, setRows] = useState<CfopRow[]>([]);
    const [naturezaLocal, setNaturezaLocal] = useState<'comercio' | 'industria' | 'servicos' | 'misto' | undefined>(
        valoresAtuais?.naturezaAtividade,
    );

    // Carrega CFOPs reais das notas da empresa
    useEffect(() => {
        if (!isOpen) return;

        let cancelado = false;
        (async () => {
            setCarregando(true);
            setErro(null);
            try {
                const docs = await listDocumentos(user, { empresaId });
                if (cancelado) return;

                // Conta CFOPs em notas de ENTRADA (modelo 55/65)
                const contagem = new Map<string, number>();
                for (const d of docs as DocumentoFiscal[]) {
                    if (d.direcao !== 'entrada') continue;
                    if (!['55', '65'].includes(String(d.modelo))) continue;
                    for (const item of (d.itens || [])) {
                        const cfop = String(item.cfop || '').trim();
                        if (cfop.length !== 4) continue;
                        contagem.set(cfop, (contagem.get(cfop) || 0) + 1);
                    }
                }

                const overrides = valoresAtuais?.cfopOverrides || {};
                const lista: CfopRow[] = Array.from(contagem.entries())
                    .sort((a, b) => b[1] - a[1])  // mais usados primeiro
                    .map(([cfopOrigem, quantidade]) => ({
                        cfopOrigem,
                        quantidade,
                        sufixoAutomatico: calcularSufixoAutomatico(cfopOrigem, valoresAtuais?.naturezaAtividade),
                        valorOverride: overrides[cfopOrigem] || '',
                    }));

                if (!cancelado) setRows(lista);
            } catch (e: any) {
                if (!cancelado) setErro(e?.message || 'Erro ao carregar CFOPs');
            } finally {
                if (!cancelado) setCarregando(false);
            }
        })();
        return () => { cancelado = true; };
    }, [isOpen, empresaId, user, valoresAtuais]);

    // Recalcula sufixo automatico quando o usuario muda a natureza no modal
    useEffect(() => {
        setRows(prev => prev.map(r => ({
            ...r,
            sufixoAutomatico: calcularSufixoAutomatico(r.cfopOrigem, naturezaLocal),
        })));
    }, [naturezaLocal]);

    const handleOverrideChange = (cfopOrigem: string, valor: string) => {
        setRows(prev => prev.map(r =>
            r.cfopOrigem === cfopOrigem
                ? { ...r, valorOverride: valor.replace(/\D/g, '').slice(0, 4) }
                : r
        ));
    };

    const overridesValidos = useMemo(() => {
        const out: Record<string, string> = {};
        for (const r of rows) {
            const v = r.valorOverride.trim();
            // So salva quando: tem 4 digitos E difere do automatico
            if (v.length === 4 && v !== r.sufixoAutomatico) {
                out[r.cfopOrigem] = v;
            }
        }
        return out;
    }, [rows]);

    const handleSalvar = async () => {
        setSalvando(true);
        setErro(null);
        try {
            const novosDados: EmpresaDadosFiscais = {
                ...(valoresAtuais || {}),
                naturezaAtividade: naturezaLocal,
                cfopOverrides: Object.keys(overridesValidos).length > 0 ? overridesValidos : undefined,
            };
            await onSave(novosDados);
            onClose();
        } catch (e: any) {
            setErro(e?.message || 'Erro ao salvar');
        } finally {
            setSalvando(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[70] animate-fade-in"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                            🔄 Correlacao de CFOP
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            {empresaNome}
                        </p>
                    </div>
                    <button onClick={onClose} className="btn-press p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700">
                        <CloseIcon className="w-5 h-5 text-slate-500" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {/* Natureza */}
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            Natureza da Atividade
                        </label>
                        <select
                            value={naturezaLocal || ''}
                            onChange={e => setNaturezaLocal((e.target.value || undefined) as any)}
                            className="w-full md:w-1/2 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100"
                        >
                            <option value="">— Derivar de Ind. Atividade —</option>
                            <option value="comercio">Comercio (revenda) → sufixo 102</option>
                            <option value="industria">Industria → sufixo 101</option>
                            <option value="servicos">Servicos → sufixo 556 (uso/consumo)</option>
                            <option value="misto">Misto (sem heuristica)</option>
                        </select>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">
                            A heuristica define o CFOP automatico. Voce pode sobrescrever individualmente abaixo.
                        </p>
                    </div>

                    {/* Tabela */}
                    {carregando && (
                        <div className="text-center py-8 text-slate-500">Carregando CFOPs das notas...</div>
                    )}
                    {!carregando && rows.length === 0 && (
                        <div className="text-center py-8 text-slate-500">
                            Nenhum CFOP encontrado nas notas de entrada desta empresa.
                        </div>
                    )}
                    {!carregando && rows.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-600 dark:text-slate-400 text-left">
                                    <tr>
                                        <th className="px-3 py-2">CFOP do XML</th>
                                        <th className="px-3 py-2 text-center">Qtd. itens</th>
                                        <th className="px-3 py-2">Automatico (heuristica)</th>
                                        <th className="px-3 py-2">Override manual (opcional)</th>
                                        <th className="px-3 py-2">CFOP final</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(r => {
                                        const final = r.valorOverride.length === 4 ? r.valorOverride : r.sufixoAutomatico;
                                        const ehOverride = r.valorOverride.length === 4 && r.valorOverride !== r.sufixoAutomatico;
                                        return (
                                            <tr key={r.cfopOrigem} className="border-t border-slate-200 dark:border-slate-700">
                                                <td className="px-3 py-2 font-mono">{r.cfopOrigem}</td>
                                                <td className="px-3 py-2 text-center text-slate-500">{r.quantidade}</td>
                                                <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-400">
                                                    {r.sufixoAutomatico || '—'}
                                                </td>
                                                <td className="px-3 py-2">
                                                    <input
                                                        type="text"
                                                        value={r.valorOverride}
                                                        onChange={e => handleOverrideChange(r.cfopOrigem, e.target.value)}
                                                        placeholder="ex: 2102"
                                                        maxLength={4}
                                                        className="w-24 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded font-mono bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100"
                                                    />
                                                </td>
                                                <td className={`px-3 py-2 font-mono font-bold ${ehOverride ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                                                    {final}
                                                    {ehOverride && <span className="ml-2 text-xs font-normal">(override)</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {erro && (
                        <div className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 p-3 rounded">
                            {erro}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between p-6 border-t border-slate-200 dark:border-slate-700">
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                        {Object.keys(overridesValidos).length} override(s) configurado(s)
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="btn-press px-4 py-2 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleSalvar}
                            disabled={salvando}
                            className="btn-press px-6 py-2 bg-amber-600 text-white font-bold rounded-lg hover:bg-amber-700 disabled:opacity-50"
                        >
                            {salvando ? 'Salvando...' : 'Salvar'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CfopCorrelacaoModal;
