import React, { useState } from 'react';
import { colherAutXml, type AutXmlHarvestResultado } from '../../services/saeNfceService';

/**
 * AutXmlHarvest — dispara a colheita de SAÍDA (mod 55) via tag <autXML>.
 *
 * Quando o cliente inclui o CNPJ do escritório na tag autXML da emissão, a
 * SEFAZ passa a distribuir o XML completo daquela nota para o escritório. Este
 * painel consulta a DistribuiçãoDFe com o cert do escritório e atribui cada
 * nota à empresa-cliente dona. Roda também via cron 3x/dia — este botão é para
 * disparo manual / backfill.
 */
const AutXmlHarvest: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [resp, setResp] = useState<AutXmlHarvestResultado | null>(null);

    const rodar = async (resetNSU: boolean) => {
        setLoading(true);
        setResp(null);
        try {
            setResp(await colherAutXml(resetNSU));
        } catch (e) {
            setResp({ ok: false, error: e instanceof Error ? e.message : String(e) });
        } finally {
            setLoading(false);
        }
    };

    const clientes = resp?.detalhePorEmpresa ? Object.entries(resp.detalhePorEmpresa) : [];
    const comSaida = clientes.filter(([, d]) => d.saida > 0);

    return (
        <div className="bg-sky-50 dark:bg-sky-900/10 border border-sky-200 dark:border-sky-800 rounded-xl p-4 space-y-3">
            <div>
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    🏢 Colheita de Saída via autXML (NF-e mod 55 · DistribuiçãoDFe)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Puxa o <strong>XML completo das NF-e de saída</strong> dos clientes que autorizaram o
                    <strong> CNPJ do escritório na tag <code>autXML</code></strong> da emissão — direto da SEFAZ,
                    sem portal. Usa o cert do escritório e atribui cada nota ao cliente dono. Roda sozinho 3×/dia;
                    este botão é para disparo manual / backfill dos últimos ~90 dias.
                </p>
            </div>

            <details className="text-xs text-slate-600 dark:text-slate-300">
                <summary className="cursor-pointer font-bold">O que o cliente precisa configurar (uma vez)</summary>
                <ol className="list-decimal list-inside mt-2 space-y-1">
                    <li>No sistema emissor do cliente, incluir o CNPJ do escritório na tag <code>autXML</code> das NF-e emitidas;</li>
                    <li>A partir daí, toda nota nova é distribuída automaticamente para cá (janela de ~90 dias por nota);</li>
                    <li>Notas antigas, emitidas antes da autorização, continuam vindo pelo <em>ZIP em massa</em> (Importação Manual acima).</li>
                </ol>
            </details>

            <div className="flex flex-wrap gap-2">
                <button onClick={() => rodar(false)} disabled={loading}
                    className="px-4 py-1.5 text-xs font-bold rounded-md bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white">
                    {loading ? 'Colhendo…' : 'Colher agora (incremental)'}
                </button>
                <button onClick={() => rodar(true)} disabled={loading}
                    className="px-4 py-1.5 text-xs font-bold rounded-md bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200">
                    Backfill (recomeçar do início)
                </button>
            </div>
            {loading && <p className="text-xs text-slate-500 dark:text-slate-400">Consultando a SEFAZ e distribuindo aos clientes — pode levar um minuto…</p>}

            {resp && !resp.ok && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                    <p className="text-sm font-bold text-red-700 dark:text-red-300">Falha na colheita</p>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">{resp.error || 'Erro desconhecido.'}</p>
                </div>
            )}

            {resp && resp.ok && (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-2">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-100">
                        ✓ {resp.docs ?? 0} documentos · <span className="text-emerald-600 dark:text-emerald-400">{resp.importadasSaida ?? 0} saídas</span> ·
                        {' '}{resp.importadasEntrada ?? 0} entradas · {resp.atualizadas ?? 0} completadas · {resp.duplicadas ?? 0} duplicadas · {resp.erros ?? 0} erros
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {resp.empresasMonitoradas ?? 0} empresas monitoradas · {resp.semDono ?? 0} docs sem cliente monitorado (ignorados) · NSU {resp.ultNSU}/{resp.maxNSU}
                        {resp.rateLimited && ' · ⚠ rate-limit da SEFAZ — rode de novo em alguns minutos'}
                    </p>
                    {comSaida.length > 0 && (
                        <div>
                            <p className="text-xs font-bold text-slate-600 dark:text-slate-300 mt-1">Clientes com saída capturada ({comSaida.length}):</p>
                            <ul className="mt-1 text-xs text-slate-600 dark:text-slate-400 space-y-0.5 max-h-40 overflow-y-auto">
                                {comSaida.map(([cnpj, d]) => (
                                    <li key={cnpj}><span className="font-mono">{cnpj}</span> — {d.nome}: <strong>{d.saida}</strong> saída(s){d.atualizadas ? `, ${d.atualizadas} completadas` : ''}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {comSaida.length === 0 && (resp.docs ?? 0) >= 0 && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400">
                            Nenhuma saída atribuída. Se esperava notas, confirme que os clientes incluíram o CNPJ do escritório no <code>autXML</code> da emissão.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

export default AutXmlHarvest;
