/**
 * DiagnosticoCapturaPanel — "por que essa NFSe nao veio?"
 *
 * Caso de uso: cliente diz "tomei servico da Serasa em Barueri/SP mas a NFSe
 * nao apareceu no app". Painel pega o CNPJ do CLIENTE (tomador), faz
 * checklist completo cobrindo:
 *   - Cadastro
 *   - Dados fiscais (UF + municipio)
 *   - Cert A1
 *   - ADN ativo + estado do sync
 *   - ABRASF (se municipio suportado) ativo + estado do sync
 *
 * Devolve item-a-item o que esta OK e o que esta bloqueando.
 */
import React, { useState } from 'react';
import { diagnosticarCaptura, type DiagnosticoResposta } from '../../services/abrasfAdapterService';

interface Props {
    onShowToast?: (msg: string) => void;
}

const DiagnosticoCapturaPanel: React.FC<Props> = ({ onShowToast }) => {
    const [cnpj, setCnpj] = useState('');
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<DiagnosticoResposta | null>(null);
    const [erro, setErro] = useState<string | null>(null);

    const fmtCnpj = (s: string) => s.replace(/\D/g, '')
        .replace(/^(\d{2})(\d)/, '$1.$2')
        .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
        .replace(/\.(\d{3})(\d)/, '.$1/$2')
        .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
        .slice(0, 18);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const limpo = cnpj.replace(/\D/g, '');
        if (limpo.length !== 14) {
            onShowToast?.('CNPJ deve ter 14 dígitos');
            return;
        }
        setLoading(true);
        setErro(null);
        setData(null);
        try {
            const r = await diagnosticarCaptura(limpo);
            setData(r);
        } catch (e: any) {
            setErro(e?.message || 'Falha');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="p-4 rounded-lg border border-sky-200 bg-sky-50 dark:bg-sky-900/20 dark:border-sky-800">
                <div className="flex items-start gap-3">
                    <div className="text-2xl">🔍</div>
                    <div className="text-sm text-sky-900 dark:text-sky-200">
                        <p className="font-bold">Por que essa NFS-e não veio?</p>
                        <p className="mt-1">
                            Informe o CNPJ do <b>cliente que tomou o serviço</b> (não do prestador).
                            O sistema faz um checklist completo do que pode estar bloqueando a captura.
                        </p>
                    </div>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs text-slate-500 mb-1">CNPJ do cliente</label>
                    <input
                        type="text"
                        value={cnpj}
                        onChange={e => setCnpj(fmtCnpj(e.target.value))}
                        placeholder="00.000.000/0000-00"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                </div>
                <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold rounded-lg disabled:opacity-50"
                >
                    {loading ? 'Diagnosticando…' : 'Diagnosticar'}
                </button>
            </form>

            {erro && (
                <div className="p-3 rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300">
                    Erro: {erro}
                </div>
            )}

            {data && (
                <div className="space-y-3">
                    {/* Cabecalho */}
                    {data.empresa && (
                        <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                            <div className="text-xs text-slate-500">CNPJ {data.cnpj}</div>
                            <div className="text-lg font-bold mt-1">{data.empresa.nome}</div>
                            <div className="text-xs text-slate-500 mt-1">
                                Coleção: <code>{data.empresa.colecao}</code>
                            </div>
                        </div>
                    )}

                    {/* Conclusão */}
                    <div className="p-4 rounded-lg border-2 font-bold text-sm border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800">
                        {data.conclusao}
                    </div>

                    {/* Checklist */}
                    <div className="space-y-2">
                        {data.checklist.map((c, i) => (
                            <div
                                key={i}
                                className={`p-3 rounded-lg border flex items-start gap-3 ${
                                    c.ok
                                        ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800'
                                        : 'border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800'
                                }`}
                            >
                                <div className="text-xl">{c.ok ? '✅' : '⚠️'}</div>
                                <div className="flex-1">
                                    <div className="text-sm font-bold">{c.item}</div>
                                    <div className={`text-xs mt-0.5 ${
                                        c.ok ? 'text-emerald-800 dark:text-emerald-300'
                                             : 'text-amber-800 dark:text-amber-300'
                                    }`}>
                                        {c.detalhe}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default DiagnosticoCapturaPanel;
