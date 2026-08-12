/**
 * InsumosDepartamentos — o semáforo da DCTFWeb por departamento (Paulo,
 * 10/08): quem for fechar a declaração VÊ, antes, o que cada departamento já
 * entregou — 👥 DP/Folha (eSocial via Folhamatic), 📊 Contábil (Reinf) e
 * 🧾 Fiscal (MIT). Mata o retrabalho de transmitir sem o insumo alheio e
 * retificar depois.
 *
 * A conta NÃO é daqui: tudo vem de /api/admin/dctfweb/insumos (prova por dado
 * real — SERPRO + gateway + NFS-e). Consulta ao SERPRO custa: por isso o
 * componente só busca no clique (ou quando `autoCarregar`).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';

export interface SeloInsumo {
    departamento: string;
    rotulo: string;
    estado: 'recebido' | 'pendente' | 'sem-movimento' | 'indeterminado';
    detalhe: string;
    fonte?: string;
    quando?: string | null;
    quem?: string | null;
}

interface Resposta {
    ok: boolean;
    selos?: SeloInsumo[];
    veredito?: 'pronto' | 'incompleto' | 'incerto';
    frase?: string;
    error?: string;
}

const COR: Record<SeloInsumo['estado'], string> = {
    'recebido': 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border-green-300 dark:border-green-700',
    'pendente': 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border-red-300 dark:border-red-700',
    'sem-movimento': 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600',
    'indeterminado': 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700',
};

const ICONE: Record<SeloInsumo['estado'], string> = {
    'recebido': '✓', 'pendente': '✗', 'sem-movimento': '—', 'indeterminado': '?',
};

const VEREDITO_COR: Record<string, string> = {
    pronto: 'text-green-700 dark:text-green-400',
    incompleto: 'text-red-700 dark:text-red-400',
    incerto: 'text-amber-700 dark:text-amber-400',
};

const InsumosDepartamentos: React.FC<{
    empresaCnpj: string;
    competencia: string; // YYYY-MM
    empresaId?: string;
    autoCarregar?: boolean;
}> = ({ empresaCnpj, competencia, empresaId, autoCarregar = false }) => {
    const [dados, setDados] = useState<Resposta | null>(null);
    const [carregando, setCarregando] = useState(false);

    const carregar = useCallback(async () => {
        setCarregando(true);
        try {
            const token = await getAuth().currentUser?.getIdToken();
            const qs = new URLSearchParams({ cnpj: empresaCnpj, competencia });
            if (empresaId) qs.set('empresaId', empresaId);
            const res = await fetch(`/api/admin/dctfweb/insumos?${qs}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const j = await res.json().catch(() => ({}));
            setDados(res.ok ? j : { ok: false, error: j.error || `HTTP ${res.status}` });
        } catch (e: any) {
            setDados({ ok: false, error: e.message });
        } finally {
            setCarregando(false);
        }
    }, [empresaCnpj, competencia, empresaId]);

    useEffect(() => {
        if (autoCarregar) carregar();
    }, [autoCarregar, carregar]);

    return (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2 bg-white dark:bg-slate-800">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                    🚦 Insumos da DCTFWeb por departamento
                </span>
                <button
                    onClick={carregar}
                    disabled={carregando}
                    className="text-xs font-bold px-3 py-1 rounded-md bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
                >
                    {carregando ? '⏳ Consultando…' : dados ? '↻ Atualizar' : '🔎 Conferir insumos'}
                </button>
            </div>
            {!dados && !carregando && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    eSocial (👥 DP/Folha) · Reinf (📊 Contábil) · MIT (🧾 Fiscal) — confira o que já entrou
                    ANTES de fechar a declaração. Transmitir sem um insumo é retificar depois.
                </p>
            )}
            {dados && !dados.ok && (
                <p className="text-xs text-amber-700 dark:text-amber-300 dark:text-amber-400">
                    ⚠ Não deu pra consultar os insumos ({dados.error}) — o app não afirma o que não leu.
                </p>
            )}
            {dados?.ok && (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        {(dados.selos || []).map((s) => (
                            <div key={s.departamento} className={`rounded-lg border px-3 py-2 ${COR[s.estado]}`}>
                                <div className="text-xs font-bold flex items-center justify-between">
                                    <span>{s.rotulo}</span>
                                    <span className="text-base leading-none">{ICONE[s.estado]}</span>
                                </div>
                                <p className="text-[11px] mt-1 leading-snug">{s.detalhe}</p>
                                {(s.quem || s.quando) && (
                                    <p className="text-[10px] mt-1 opacity-75">
                                        {s.quem ? `por ${s.quem}` : ''}{s.quem && s.quando ? ' · ' : ''}{s.quando || ''}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                    <p className={`text-xs font-bold ${VEREDITO_COR[dados.veredito || 'incerto']}`}>
                        {dados.veredito === 'pronto' ? '✅' : dados.veredito === 'incompleto' ? '🛑' : '⚠️'} {dados.frase}
                    </p>
                </>
            )}
        </div>
    );
};

export default InsumosDepartamentos;
