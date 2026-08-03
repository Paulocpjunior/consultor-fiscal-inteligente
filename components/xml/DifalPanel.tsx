/**
 * DifalPanel — DIFAL de aquisição interestadual (fase 1, 03/08).
 * Desenho do Alexandre: consolidado NO MÊS pro Simples (consumo + revenda);
 * nota com ST (art. 426-A) é individual por documento e fica fora da
 * consolidação — listada à parte. Alíquota interna padrão 18%, editável por
 * nota (NCM 12%/25% ajusta na linha).
 */
import React, { useState } from 'react';
import { auth } from '../../services/firebaseConfig';

interface VarreduraLinha {
    empresaId: string; nome: string; cnpj: string;
    notasInterestaduais: number; notasComSt: number; baseAproximada: number;
}
interface LinhaDifal {
    chave: string; numero: string; dhEmi: string | null; fornecedor: string;
    ufOrigem: string; base: number; aliqInterna: number; aliqInterDerivada: boolean; difal: number;
}
interface Painel {
    ok: boolean; error?: string;
    empresa?: { id: string; nome: string; cnpj: string; regime: string };
    linhas?: LinhaDifal[]; totalBase?: number; totalDifal?: number;
    antecipacaoIndividual?: LinhaDifal[]; avisos?: string[]; ressalvas?: string[];
}

const fmtBRL = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtCnpj = (c: string) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const compAnterior = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const DifalPanel: React.FC<{ onShowToast?: (m: string) => void }> = ({ onShowToast }) => {
    const [competencia, setCompetencia] = useState(compAnterior());
    const [varredura, setVarredura] = useState<VarreduraLinha[] | null>(null);
    const [painel, setPainel] = useState<Painel | null>(null);
    const [overrides, setOverrides] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(false);

    const token = async () => auth?.currentUser?.getIdToken();

    const varrer = async () => {
        setLoading(true); setPainel(null);
        try {
            const r = await fetch(`/api/admin/difal/varredura?competencia=${competencia}`, {
                headers: { Authorization: `Bearer ${await token()}` },
            });
            const j = await r.json();
            if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setVarredura(j.linhas);
        } catch (e: any) {
            onShowToast?.(`Falha na varredura: ${e.message}`);
        } finally { setLoading(false); }
    };

    const abrir = async (empresaId: string, novosOverrides?: Record<string, number>) => {
        setLoading(true);
        try {
            const ov = novosOverrides ?? overrides;
            const aliq = Object.entries(ov).map(([c, a]) => `${c}:${a}`).join(',');
            const r = await fetch(
                `/api/admin/difal/painel?empresaId=${empresaId}&competencia=${competencia}${aliq ? `&aliq=${encodeURIComponent(aliq)}` : ''}`,
                { headers: { Authorization: `Bearer ${await token()}` } },
            );
            const j: Painel = await r.json();
            if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setPainel(j);
        } catch (e: any) {
            onShowToast?.(`Falha no painel: ${e.message}`);
        } finally { setLoading(false); }
    };

    const mudarAliq = (chave: string, aliq: number) => {
        const novos = { ...overrides };
        if (aliq > 0 && aliq !== 18) novos[chave] = aliq; else delete novos[chave];
        setOverrides(novos);
        if (painel?.empresa) abrir(painel.empresa.id, novos);
    };

    return (
        <div className="space-y-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-1">🧭 DIFAL de aquisição interestadual — Simples (consolidado mensal)</h3>
                <p className="text-xs text-slate-500 mb-3">
                    Compras de fora do estado de clientes do Simples: o DIFAL é apurado consolidado no mês
                    (consumo e revenda). Nota com <strong>ST</strong> fica fora — a antecipação do art. 426-A
                    é individual por documento e aparece listada à parte.
                </p>
                <div className="flex items-end gap-2 flex-wrap">
                    <div>
                        <label className="text-[10px] uppercase font-bold block mb-1 text-slate-500">Competência</label>
                        <input type="month" value={competencia} onChange={e => setCompetencia(e.target.value)}
                            className="p-2 text-sm rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600" />
                    </div>
                    <button onClick={varrer} disabled={loading}
                        className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm rounded-lg font-semibold disabled:opacity-40">
                        {loading ? 'Varrendo…' : '🔎 Varrer carteira'}
                    </button>
                    {varredura && <span className="text-xs text-slate-500 pb-2">{varredura.length} cliente(s) com compra interestadual</span>}
                </div>
            </div>

            {varredura && varredura.length > 0 && !painel && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="text-slate-500 border-b border-slate-200 dark:border-slate-700">
                            <tr><th className="text-left py-1">Cliente</th><th className="text-right">Notas interestaduais</th>
                                <th className="text-right">c/ ST (426-A)</th><th className="text-right">Base aprox.</th><th></th></tr>
                        </thead>
                        <tbody>
                            {varredura.map(l => (
                                <tr key={l.empresaId} className="border-b border-slate-100 dark:border-slate-700/50">
                                    <td className="py-1.5 font-semibold">{l.nome}<span className="block text-[10px] font-mono text-slate-400">{fmtCnpj(l.cnpj)}</span></td>
                                    <td className="text-right font-mono">{l.notasInterestaduais}</td>
                                    <td className="text-right font-mono">{l.notasComSt || '—'}</td>
                                    <td className="text-right font-mono">{fmtBRL(l.baseAproximada)}</td>
                                    <td className="text-right">
                                        <button onClick={() => { setOverrides({}); abrir(l.empresaId); }}
                                            className="px-3 py-1 text-[11px] font-bold rounded-md bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800">
                                            Apurar →
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {varredura && varredura.length === 0 && !painel && (
                <p className="text-xs text-slate-500 text-center py-3">Nenhum cliente do Simples com compra interestadual em {competencia.split('-').reverse().join('/')}.</p>
            )}

            {painel?.empresa && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                            {painel.empresa.nome} · {fmtCnpj(painel.empresa.cnpj)}
                        </h4>
                        <button onClick={() => setPainel(null)} className="text-xs text-slate-500 hover:text-slate-700">← voltar à varredura</button>
                    </div>

                    {(painel.avisos || []).map((a, i) => (
                        <p key={i} className="text-[11px] font-semibold text-amber-600 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">⚠ {a}</p>
                    ))}

                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                <tr><th className="text-left py-1">Nota</th><th className="text-left">Fornecedor</th><th>UF</th>
                                    <th className="text-right">Base</th><th className="text-right">Alíq. interna %</th><th className="text-right">DIFAL</th></tr>
                            </thead>
                            <tbody>
                                {(painel.linhas || []).map(l => (
                                    <tr key={l.chave} className="border-b border-slate-100 dark:border-slate-700/50">
                                        <td className="py-1 font-mono">{l.numero}{l.aliqInterDerivada && <span title="alíquota interestadual derivada (sem pICMS na nota)" className="text-amber-500 ml-1">*</span>}</td>
                                        <td className="max-w-[220px] truncate" title={l.fornecedor}>{l.fornecedor}</td>
                                        <td className="text-center">{l.ufOrigem}</td>
                                        <td className="text-right font-mono">{fmtBRL(l.base)}</td>
                                        <td className="text-right">
                                            <input type="number" min="1" step="0.5" defaultValue={l.aliqInterna}
                                                onBlur={e => mudarAliq(l.chave, parseFloat(e.target.value) || 18)}
                                                className="w-16 p-1 text-right text-xs rounded bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 font-mono" />
                                        </td>
                                        <td className="text-right font-mono font-bold">{fmtBRL(l.difal)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex items-center justify-between flex-wrap gap-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-2.5">
                        <span className="text-xs font-bold text-blue-800 dark:text-blue-300">
                            DIFAL consolidado de {competencia.split('-').reverse().join('/')}
                        </span>
                        <span className="text-base font-bold font-mono text-blue-800 dark:text-blue-300">{fmtBRL(painel.totalDifal || 0)}</span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                        A guia sai pelo trilho DARE já existente (unitário assistido / API) com este valor —
                        e o envio ao cliente segue o rito padrão (SharePoint + baixa + auditoria).
                    </p>

                    {(painel.antecipacaoIndividual || []).length > 0 && (
                        <div className="border border-amber-200 dark:border-amber-800 rounded-lg p-3 bg-amber-50/50 dark:bg-amber-900/10">
                            <p className="text-xs font-bold text-amber-700 dark:text-amber-400 mb-1">
                                ⚠ {painel.antecipacaoIndividual!.length} nota(s) com ST — antecipação art. 426-A, INDIVIDUAL por documento (fora da consolidação; conta com IVA-ST é a fase 2):
                            </p>
                            <ul className="text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5">
                                {painel.antecipacaoIndividual!.map(l => (
                                    <li key={l.chave} className="font-mono">NF {l.numero} · {l.fornecedor} ({l.ufOrigem}) · base {fmtBRL(l.base)}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <ul className="text-[10px] text-slate-500 list-disc pl-4 space-y-0.5">
                        {(painel.ressalvas || []).map((r, i) => <li key={i}>{r}</li>)}
                        <li>* = alíquota interestadual derivada de UF/origem (a nota não destacou pICMS).</li>
                    </ul>
                </div>
            )}
        </div>
    );
};

export default DifalPanel;
