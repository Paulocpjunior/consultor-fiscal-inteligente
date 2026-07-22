/**
 * ConferenciaChavesPanel — CFI × SIEG por chaves de acesso.
 * Cola o relatório da SIEG → o app extrai as 44-dígitos, diz QUAIS faltam
 * e importa só as faltantes (consulta por chave com o cert da empresa).
 * Caso motivador: EDUARDO GUERRA 07/2026 — SIEG 65 × CFI 45.
 */
import React, { useState } from 'react';
import { getAuth } from 'firebase/auth';

interface ItemConferencia {
    chave: string;
    modelo: string | null;
    status: 'presente-completa' | 'presente-resumo' | 'ausente';
}
interface RespConferencia {
    itens: ItemConferencia[];
    resumo: { total: number; presentesCompletas: number; presentesResumo: number; ausentes: number };
}
interface RespImportacao {
    ok: boolean; abortou656: boolean; processadas: number;
    importados: number; resumos: number; erros: number; restantes: number;
    resultados: Array<{ chave: string; status: string; motivo?: string }>;
    aviso: string | null;
}

async function api(path: string, body: any) {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    const token = await u.getIdToken();
    const res = await fetch(path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

const ConferenciaChavesPanel: React.FC = () => {
    const [texto, setTexto] = useState('');
    const [cnpj, setCnpj] = useState('');
    const [conferindo, setConferindo] = useState(false);
    const [importando, setImportando] = useState(false);
    const [conf, setConf] = useState<RespConferencia | null>(null);
    const [imp, setImp] = useState<RespImportacao | null>(null);
    const [erro, setErro] = useState<string | null>(null);

    const conferir = async () => {
        setConferindo(true); setErro(null); setImp(null);
        try { setConf(await api('/api/admin/sefaz/conferencia-chaves', { texto })); }
        catch (e: any) { setErro(e.message); setConf(null); }
        finally { setConferindo(false); }
    };

    const importarFaltantes = async () => {
        if (!conf) return;
        const faltantes = conf.itens.filter(i => i.status === 'ausente').map(i => i.chave);
        setImportando(true); setErro(null);
        try {
            const r = await api('/api/admin/sefaz/conferencia-chaves-importar', {
                cnpjDestinatario: cnpj.replace(/\D/g, ''),
                chaves: faltantes.slice(0, 60),
            });
            setImp(r);
        } catch (e: any) { setErro(e.message); }
        finally { setImportando(false); }
    };

    const faltantes = conf?.itens.filter(i => i.status === 'ausente') ?? [];

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 space-y-3 mt-4">
            <div>
                <h3 className="font-bold text-slate-800 dark:text-slate-100">⚖️ Conferência CFI × SIEG (por chaves)</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Cole abaixo qualquer relatório/CSV da SIEG — o app extrai as chaves de 44 dígitos,
                    mostra <b>quais faltam no CFI</b> e importa só as faltantes (com o certificado da
                    própria empresa, em ritmo seguro anti-656).
                </p>
            </div>

            <textarea
                value={texto} onChange={e => setTexto(e.target.value)}
                placeholder="Cole aqui o texto/CSV da SIEG com as chaves de acesso…"
                rows={5}
                className="w-full px-3 py-2 text-xs font-mono border rounded bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-slate-600 placeholder-gray-400 dark:placeholder-slate-500"
            />
            <div className="flex flex-wrap items-center gap-2">
                <button
                    onClick={conferir} disabled={conferindo || !texto.trim()}
                    className="px-3 py-1.5 text-sm font-semibold bg-sky-600 text-white rounded hover:bg-sky-700 disabled:opacity-50"
                >
                    {conferindo ? '⏳ Conferindo…' : '🔍 Conferir chaves'}
                </button>
                {conf && (
                    <span className="text-xs text-slate-600 dark:text-slate-300">
                        {conf.resumo.total} chave(s): <b className="text-emerald-600">{conf.resumo.presentesCompletas} completas</b> ·{' '}
                        <b className="text-sky-600">{conf.resumo.presentesResumo} resumos</b> ·{' '}
                        <b className={conf.resumo.ausentes > 0 ? 'text-red-600' : 'text-emerald-600'}>{conf.resumo.ausentes} FALTANTES</b>
                    </span>
                )}
            </div>

            {faltantes.length > 0 && (
                <div className="border border-red-200 dark:border-red-800 rounded p-3 space-y-2 bg-red-50/50 dark:bg-red-950/20">
                    <div className="text-xs font-bold text-red-800 dark:text-red-300">
                        {faltantes.length} chave(s) faltando no CFI{faltantes.length > 60 ? ' (importação em lotes de 60)' : ''}:
                    </div>
                    <div className="max-h-32 overflow-y-auto text-[10px] font-mono text-red-700 dark:text-red-400 space-y-0.5">
                        {faltantes.slice(0, 100).map(f => <div key={f.chave}>{f.chave} {f.modelo && f.modelo !== '55' ? `(mod ${f.modelo})` : ''}</div>)}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <input
                            value={cnpj} onChange={e => setCnpj(e.target.value)}
                            placeholder="CNPJ da empresa destinatária"
                            className="px-2 py-1 text-xs font-mono border rounded bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-slate-600 min-w-[200px]"
                        />
                        <button
                            onClick={importarFaltantes}
                            disabled={importando || cnpj.replace(/\D/g, '').length !== 14}
                            className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
                        >
                            {importando ? '⏳ Importando (ritmo seguro)…' : `⬇ Importar ${Math.min(faltantes.length, 60)} faltante(s)`}
                        </button>
                    </div>
                </div>
            )}

            {imp && (
                <div className={`rounded p-3 text-xs space-y-1 border ${imp.abortou656 ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/30' : 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30'}`}>
                    <div className="font-bold text-slate-800 dark:text-slate-100">
                        ✔ {imp.importados} importada(s) ({imp.resumos} como resumo) · {imp.erros} erro(s)
                        {imp.restantes > 0 && ` · ${imp.restantes} não processada(s)`}
                    </div>
                    {imp.aviso && <div className="text-slate-600 dark:text-slate-300">{imp.aviso}</div>}
                    {imp.resultados.filter(r => r.status === 'erro' || r.status === 'nao-retornada').slice(0, 5).map(r => (
                        <div key={r.chave} className="font-mono text-[10px] text-red-700 dark:text-red-400">
                            {r.chave}: {r.status}{r.motivo ? ` — ${r.motivo}` : ''}
                        </div>
                    ))}
                </div>
            )}

            {erro && <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-800 px-2 py-1 text-xs text-red-800 dark:text-red-300">{erro}</div>}
        </div>
    );
};

export default ConferenciaChavesPanel;
