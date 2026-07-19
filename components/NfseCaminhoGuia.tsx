/**
 * NfseCaminhoGuia.tsx
 *
 * Guia (admin) do caminho de captura de NFS-e por município — orienta o
 * colaborador sobre como capturar em cada prefeitura. Em 2026 (LC 214/2025) o
 * padrão é o ADN nacional (por CNPJ), então a orientação é habilitar
 * nfseNacionalDfeAtivo + A1 próprio nas empresas, em vez de configurar WSDL
 * ABRASF (legado, em descontinuação).
 *
 * Auto-esconde para não-admin (403).
 */

import React, { useEffect, useState, useCallback } from 'react';
import { fetchNfseMunicipiosCaminho, type NfseMunicipiosGuia, type CaminhoNfse } from '../services/capturaDiagnosticoService';

const CAMINHO_UI: Record<CaminhoNfse, { label: string; cls: string }> = {
    adn:         { label: 'NFS-e Nacional (ADN)', cls: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
    'sp-portal': { label: 'Portal SP',            cls: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300' },
    abrasf:      { label: 'ABRASF (legado)',      cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
};

const NfseCaminhoGuia: React.FC = () => {
    const [data, setData] = useState<NfseMunicipiosGuia | null>(null);
    const [loading, setLoading] = useState(true);
    const [oculto, setOculto] = useState(false);

    const carregar = useCallback(async () => {
        setLoading(true);
        try {
            setData(await fetchNfseMunicipiosCaminho());
        } catch (e: any) {
            if (String(e?.message || '').includes('403') || /admin/i.test(String(e?.message || ''))) setOculto(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { carregar(); }, [carregar]);

    if (oculto) return null;

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 mt-4">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Captura de NFS-e por município</h3>
            {data?.nota && (
                <div className="mt-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
                    <p className="text-[11px] text-emerald-800 dark:text-emerald-300">{data.nota}</p>
                </div>
            )}

            {loading && !data && <p className="text-xs text-slate-400 py-2 mt-2">Carregando…</p>}

            {data && (
                <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-slate-500 dark:text-slate-400">
                                <th className="px-2 py-1 font-bold">Município</th>
                                <th className="px-2 py-1 font-bold">UF</th>
                                <th className="px-2 py-1 font-bold">Caminho</th>
                                <th className="px-2 py-1 font-bold">Observação</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {data.municipios.map((m) => {
                                const ui = CAMINHO_UI[m.caminho] || CAMINHO_UI.adn;
                                return (
                                    <tr key={m.cod}>
                                        <td className="px-2 py-1.5 font-semibold text-slate-700 dark:text-slate-200">{m.nome}</td>
                                        <td className="px-2 py-1.5 text-slate-500">{m.uf}</td>
                                        <td className="px-2 py-1.5">
                                            <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${ui.cls}`}>{ui.label}</span>
                                        </td>
                                        <td className="px-2 py-1.5 text-slate-500 dark:text-slate-400">{m.obs}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <p className="text-[10px] text-slate-400 mt-2">
                        Municípios fora desta lista também usam o ADN nacional por padrão (2026) — a captura é por CNPJ, sem configuração específica.
                    </p>
                </div>
            )}
        </div>
    );
};

export default NfseCaminhoGuia;
