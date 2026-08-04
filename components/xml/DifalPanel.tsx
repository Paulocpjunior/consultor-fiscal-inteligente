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
    /** Cliente sem UF no cadastro: não dá pra separar dentro × fora do estado. */
    semUfCadastrada?: boolean;
    /** 'simples' = guia consolidada aqui · 'lucro' = escritura no SPED. */
    regime?: 'simples' | 'lucro';
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
    antecipacao426A?: Antecipacao426A;
}

/** Fase 2: antecipação do art. 426-A, uma guia POR documento. */
interface Linha426A {
    chave: string; numero: string; fornecedor: string; ufOrigem: string;
    calculavel: boolean; motivo?: string | null;
    va: number; ic: number; aliqInterna: number; aliqInterestadual: number;
    ivaSt: number; ivaAplicado: number; ivaFoiAjustado?: boolean;
    baseSt: number; antecipacao: number;
}
interface Antecipacao426A {
    calculadas: Linha426A[]; pendentes: Linha426A[];
    totalAntecipacao: number;
    resumo: { documentos: number; calculados: number; pendentes: number };
    ressalvas: string[];
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
    // IVA-ST informado por nota com ST (vem da Portaria CAT — o app não deduz).
    const [ivas, setIvas] = useState<Record<string, number>>({});
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

    const abrir = async (empresaId: string, novosOverrides?: Record<string, number>, novosIvas?: Record<string, number>) => {
        setLoading(true);
        try {
            const ov = novosOverrides ?? overrides;
            const iv = novosIvas ?? ivas;
            const aliq = Object.entries(ov).map(([c, a]) => `${c}:${a}`).join(',');
            const iva = Object.entries(iv).map(([c, v]) => `${c}:${v}`).join(',');
            const r = await fetch(
                `/api/admin/difal/painel?empresaId=${empresaId}&competencia=${competencia}${aliq ? `&aliq=${encodeURIComponent(aliq)}` : ''}${iva ? `&iva=${encodeURIComponent(iva)}` : ''}`,
                { headers: { Authorization: `Bearer ${await token()}` } },
            );
            const j: Painel = await r.json();
            if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setPainel(j);
        } catch (e: any) {
            onShowToast?.(`Falha no painel: ${e.message}`);
        } finally { setLoading(false); }
    };

    const mudarIva = (chave: string, iva: number) => {
        const novos = { ...ivas };
        if (iva > 0) novos[chave] = iva; else delete novos[chave];
        setIvas(novos);
        if (painel?.empresa) abrir(painel.empresa.id, undefined, novos);
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
                                    <td className="py-1.5 font-semibold">
                                        {l.nome}
                                        {l.regime === 'lucro' && (
                                            <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300"
                                                title="Cliente do Lucro Presumido/Real: o DIFAL existe, mas não sai em guia consolidada — ele é escriturado no SPED (C195/C197) e o débito entra pela aba Ajustes E111.">
                                                Lucro · vai pelo SPED
                                            </span>
                                        )}
                                        {l.semUfCadastrada && (
                                            <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                                                title="A empresa está sem UF no cadastro — sem ela não dá pra separar compra de dentro e de fora do estado. Preencha em Dados Fiscais.">
                                                UF do cliente não cadastrada
                                            </span>
                                        )}
                                        <span className="block text-[10px] font-mono text-slate-400">{fmtCnpj(l.cnpj)}</span>
                                    </td>
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
            {varredura && varredura.some(l => l.regime === 'lucro') && !painel && (
                <p className="text-[11px] text-violet-700 dark:text-violet-300 px-1 -mt-2">
                    Clientes marcados <strong>Lucro · vai pelo SPED</strong> pagam DIFAL do mesmo jeito,
                    mas a guia não é consolidada aqui: a nota é escriturada no <strong>C195/C197</strong> do
                    SPED Fiscal e o débito entra pela aba <strong>Ajustes E111</strong>. A apuração abaixo
                    serve pra conferir o valor.
                </p>
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
                                ⚠ {painel.antecipacaoIndividual!.length} nota(s) com ST — antecipação do art. 426-A, uma guia POR DOCUMENTO (fora da consolidação acima)
                            </p>
                            <p className="text-[11px] text-slate-600 dark:text-slate-300 mb-2">
                                Informe o <b>IVA-ST</b> da Portaria CAT do segmento de cada mercadoria — o índice não está
                                na nota e o app não o deduz. O ajuste pela alíquota interestadual é feito aqui.
                            </p>

                            <div className="overflow-x-auto">
                                <table className="w-full text-[11px]">
                                    <thead>
                                        <tr className="text-left text-slate-500 border-b border-amber-200 dark:border-amber-800">
                                            <th className="py-1">NF · fornecedor</th>
                                            <th className="py-1 text-right">VA</th>
                                            <th className="py-1 text-right">ICMS pago</th>
                                            <th className="py-1 text-center">IVA-ST %</th>
                                            <th className="py-1 text-right">Base ST</th>
                                            <th className="py-1 text-right">Antecipação</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[...(painel.antecipacao426A?.calculadas || []), ...(painel.antecipacao426A?.pendentes || [])]
                                            .map(l => (
                                            <tr key={l.chave} className="border-b border-amber-100 dark:border-amber-900/40">
                                                <td className="py-1">
                                                    <span className="font-mono">NF {l.numero}</span> · {l.fornecedor} ({l.ufOrigem})
                                                </td>
                                                <td className="py-1 text-right font-mono">{fmtBRL(l.va)}</td>
                                                <td className="py-1 text-right font-mono">{fmtBRL(l.ic)}</td>
                                                <td className="py-1 text-center">
                                                    <input
                                                        type="number" step="0.01" min={0}
                                                        defaultValue={ivas[l.chave] || ''}
                                                        placeholder="—"
                                                        onBlur={e => mudarIva(l.chave, Number(e.target.value))}
                                                        className="w-16 px-1 py-0.5 text-right rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800"
                                                        title="IVA-ST original da Portaria CAT; o ajuste pela interestadual é automático"
                                                    />
                                                    {l.ivaFoiAjustado && (
                                                        <div className="text-[9px] text-amber-700 dark:text-amber-400">
                                                            aj. {l.ivaAplicado.toFixed(2)}%
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="py-1 text-right font-mono">{l.calculavel ? fmtBRL(l.baseSt) : '—'}</td>
                                                <td className="py-1 text-right font-mono font-bold">
                                                    {l.calculavel
                                                        ? fmtBRL(l.antecipacao)
                                                        : <span className="text-amber-700 dark:text-amber-400 font-normal">pendente</span>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {painel.antecipacao426A && (
                                <p className="text-[11px] mt-2 text-slate-700 dark:text-slate-200">
                                    <b>{fmtBRL(painel.antecipacao426A.totalAntecipacao)}</b> em antecipação —
                                    {' '}{painel.antecipacao426A.resumo.calculados} de {painel.antecipacao426A.resumo.documentos} documento(s) calculado(s)
                                    {painel.antecipacao426A.resumo.pendentes > 0 && (
                                        <span className="text-amber-700 dark:text-amber-400">
                                            {' '}· {painel.antecipacao426A.resumo.pendentes} sem IVA-ST informado (fora do total — pendente não é isento)
                                        </span>
                                    )}
                                </p>
                            )}
                            <ul className="text-[10px] text-slate-500 list-disc pl-4 mt-1 space-y-0.5">
                                {(painel.antecipacao426A?.ressalvas || []).map((r, i) => <li key={i}>{r}</li>)}
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
