import React, { useState } from 'react';
import { capturarNFCeSaida, type SaeNfceResultado } from '../../services/saeNfceService';

/**
 * SaeNfceCaptura — painel admin da captura de SAÍDA de NFC-e (modelo 65) via
 * SAE-NFC-e da SEFAZ-SP, com o A1 do próprio contribuinte (do cofre).
 *
 * Só NFC-e (mod 65). Janela máxima de 100 dias por consulta.
 */
const SaeNfceCaptura: React.FC = () => {
    const [cnpj, setCnpj] = useState('32602701000197'); // Vinatex (piloto — emite mod 65)
    const [dataInicial, setDataInicial] = useState('');
    const [dataFinal, setDataFinal] = useState('');
    const [loading, setLoading] = useState(false);
    const [resp, setResp] = useState<SaeNfceResultado | null>(null);

    const rodar = async () => {
        setLoading(true);
        setResp(null);
        try {
            setResp(await capturarNFCeSaida({ cnpj, dataInicial, dataFinal }));
        } catch (e) {
            setResp({ ok: false, error: e instanceof Error ? e.message : String(e) });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    🧾 Captura de NFC-e de Saída (SAE-NFC-e · SEFAZ-SP)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Baixa as <strong>NFC-e (modelo 65) emitidas</strong> pelo contribuinte via webservice
                    SAE-NFC-e, usando o A1 dele (do cofre). Grava como <code>direção=saída</code>.
                    Só NFC-e; NF-e (mod 55) é pelo trilho do portal. Janela máx. 100 dias — vazio = últimos 100 dias.
                </p>
                <div className="flex flex-wrap items-end gap-2 mt-3">
                    <label className="text-xs text-slate-600 dark:text-slate-300">
                        CNPJ do contribuinte
                        <input value={cnpj} onChange={e => setCnpj(e.target.value)}
                            className="block mt-1 w-44 px-2 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 font-mono" />
                    </label>
                    <label className="text-xs text-slate-600 dark:text-slate-300">
                        Data inicial
                        <input type="date" value={dataInicial} onChange={e => setDataInicial(e.target.value)}
                            className="block mt-1 px-2 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900" />
                    </label>
                    <label className="text-xs text-slate-600 dark:text-slate-300">
                        Data final
                        <input type="date" value={dataFinal} onChange={e => setDataFinal(e.target.value)}
                            className="block mt-1 px-2 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900" />
                    </label>
                    <button onClick={rodar} disabled={loading || cnpj.replace(/\D/g, '').length < 8}
                        className="px-4 py-1.5 text-xs font-bold rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white">
                        {loading ? 'Capturando…' : 'Capturar NFC-e de saída'}
                    </button>
                </div>
                {loading && <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">Consultando a SEFAZ-SP e baixando XMLs — pode levar alguns minutos…</p>}
            </div>

            {resp && !resp.ok && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                    <p className="text-sm font-bold text-red-700 dark:text-red-300">Falha na captura</p>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">{resp.error || 'Erro desconhecido.'}</p>
                </div>
            )}

            {resp && resp.ok && (
                <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4 space-y-2">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-100">✓ {resp.veredito}</p>
                    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                        <dt className="text-slate-500">Período</dt><dd className="text-slate-700 dark:text-slate-200">{resp.periodo?.de} → {resp.periodo?.ate}</dd>
                        <dt className="text-slate-500">Chaves encontradas</dt><dd className="text-slate-700 dark:text-slate-200">{resp.chavesEncontradas ?? 0}</dd>
                        <dt className="text-slate-500">Importadas</dt><dd className="text-slate-700 dark:text-slate-200">{resp.importadas ?? 0}</dd>
                        <dt className="text-slate-500">Já completas</dt><dd className="text-slate-700 dark:text-slate-200">{resp.jaCompletas ?? 0}</dd>
                        <dt className="text-slate-500">Duplicadas</dt><dd className="text-slate-700 dark:text-slate-200">{resp.duplicadas ?? 0}</dd>
                        <dt className="text-slate-500">Erros</dt><dd className="text-slate-700 dark:text-slate-200">{resp.erros ?? 0}</dd>
                    </dl>
                    {resp.parcial && <p className="text-xs text-amber-600 dark:text-amber-400">⏳ Retorno parcial (orçamento de ~2 min). Clique em <strong>“Capturar NFC-e de saída”</strong> de novo no mesmo período para continuar — as já baixadas são puladas automaticamente.</p>}
                    {resp.limiteAtingido && <p className="text-xs text-amber-600 dark:text-amber-400">⚠ Limite de segurança atingido — rode períodos menores para pegar o restante.</p>}
                    {resp.errosDetalhe && resp.errosDetalhe.length > 0 && (
                        <details className="text-xs">
                            <summary className="cursor-pointer text-slate-500">Ver erros ({resp.errosDetalhe.length})</summary>
                            <ul className="mt-1 list-disc list-inside text-red-600 dark:text-red-400">
                                {resp.errosDetalhe.map((e, i) => <li key={i} className="break-all">{e}</li>)}
                            </ul>
                        </details>
                    )}
                </div>
            )}
        </div>
    );
};

export default SaeNfceCaptura;
