/**
 * CreditoAcumulado — F0 do e-CredAc (Portaria CAT 207/2009).
 *
 * O item estava 🟡 "sob demanda" no de-para. Antes de construir o arquivo pra
 * possivelmente ninguém — foi o que os dados já responderam sobre o SAT, o
 * regime de caixa, o E310 e o bloco K — esta tela responde: QUANTOS clientes
 * realmente acumulam crédito de ICMS?
 *
 * E, principalmente, separa os dois casos que parecem iguais na planilha:
 *
 *   gerador-recorrente   credor mês a mês E com hipótese do art. 71 → e-CredAc
 *   credor-sem-hipotese  credor mês a mês SEM hipótese → SAÍDA FALTANDO
 *
 * O segundo é o mais comum e o mais perigoso: mandar abrir processo no
 * e-CredAc em cima de um livro sem as saídas seria pior que não ter a
 * ferramenta.
 */
import React, { useState } from 'react';
import { auth } from '../../services/firebaseConfig';

interface Competencia {
    competencia: string;
    debitos: number; creditos: number; saldo: number;
    credor: boolean; credorValor: number;
    exportacao: number; isentaComCredito: number; reducaoBase: number;
    aliqSaida: number | null; aliqEntrada: number | null; aliquotaMenor: boolean;
    itensLidos: number;
}
interface Linha {
    empresaId: string; nome: string; cnpj: string; uf: string;
    situacao: string; motivo: string; acao: string | null; credorValor: number;
    competencias: Competencia[];
}
interface Resp {
    ok: boolean; error?: string;
    periodo?: { de: string; ate: string; competencias: string[] };
    lidos?: number;
    linhas?: Linha[];
    resumo?: {
        empresas: number; geradorRecorrente: number; credorSemHipotese: number;
        geradorPontual: number; credorPontual: number; devedor: number; semDados: number;
    };
    avisos?: string[];
}

const fmtCnpj = (c: string) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const brl = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const mesesAtras = (n: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const ROTULO: Record<string, { txt: string; cls: string }> = {
    'gerador-recorrente': { txt: '💰 acumula crédito', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
    'credor-sem-hipotese': { txt: '🚨 saída faltando?', cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
    'gerador-pontual': { txt: '👀 credor 1 mês (c/ hipótese)', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
    'credor-pontual': { txt: '👀 credor 1 mês', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
    devedor: { txt: '— devedor', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
    'sem-dados': { txt: '? sem dados', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
};

const CreditoAcumulado: React.FC<{ onShowToast?: (m: string) => void }> = ({ onShowToast }) => {
    const [de, setDe] = useState(mesesAtras(5));
    const [ate, setAte] = useState(mesesAtras(1));
    const [dados, setDados] = useState<Resp | null>(null);
    const [loading, setLoading] = useState(false);
    const [aberta, setAberta] = useState<string | null>(null);

    const buscar = async () => {
        setLoading(true);
        try {
            const token = await auth?.currentUser?.getIdToken();
            const r = await fetch(`/api/admin/sped/credito-acumulado?de=${de}&ate=${ate}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const j: Resp = await r.json();
            if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setDados(j);
        } catch (e: any) {
            onShowToast?.(`Falha na varredura: ${e.message}`);
            setDados(null);
        } finally {
            setLoading(false);
        }
    };

    const linhas = dados?.linhas || [];
    // Devedor e sem-dados não precisam aparecer por padrão: são a maioria e
    // não pedem ação nenhuma. Mas a tela diz quantos ficaram de fora.
    const relevantes = linhas.filter((l) => l.situacao !== 'devedor' && l.situacao !== 'sem-dados');

    return (
        <div className="space-y-4">
            <div className="p-5 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                <h3 className="text-sm font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                    🏦 Crédito acumulado de ICMS (e-CredAc)
                </h3>
                <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                    Quem realmente <strong>acumula crédito</strong> — e quem só parece acumular. Saldo credor
                    sozinho não é crédito acumulado: ele precisa de uma <strong>hipótese do art. 71 do
                    RICMS/SP</strong> (exportação, saída isenta com manutenção, redução de base, alíquota de
                    saída menor que a de entrada). Credor todo mês <em>sem</em> hipótese quase sempre é
                    <strong> saída faltando na captura</strong>. Só Lucro/RPA — optante do Simples não apura
                    ICMS por conta gráfica.
                </p>
                <div className="flex items-end gap-3 flex-wrap">
                    <div>
                        <label className="text-[10px] uppercase font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>De</label>
                        <input type="month" value={de} onChange={(e) => setDe(e.target.value)}
                            className="p-2 text-sm rounded-lg"
                            style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }} />
                    </div>
                    <div>
                        <label className="text-[10px] uppercase font-bold block mb-1" style={{ color: 'var(--text-muted)' }}>Até</label>
                        <input type="month" value={ate} onChange={(e) => setAte(e.target.value)}
                            className="p-2 text-sm rounded-lg"
                            style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }} />
                    </div>
                    <button onClick={buscar} disabled={loading}
                        className="px-4 py-2 text-sm font-bold rounded-lg disabled:opacity-40"
                        style={{ background: 'var(--accent-primary)', color: '#fff' }}>
                        {loading ? 'Varrendo…' : '🏦 Varrer carteira'}
                    </button>
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        Máx. 12 competências por varredura.
                    </span>
                </div>
            </div>

            {dados?.resumo && (
                <div className="p-5 rounded-xl space-y-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <div className="rounded-lg border border-emerald-300 dark:border-emerald-700 p-2">
                            <p className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-400">Acumulam crédito</p>
                            <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{dados.resumo.geradorRecorrente}</p>
                            <p className="text-[10px] text-slate-500">credor recorrente + hipótese legal</p>
                        </div>
                        <div className="rounded-lg border border-red-300 dark:border-red-700 p-2">
                            <p className="text-[10px] uppercase font-bold text-red-700 dark:text-red-400">Saída faltando?</p>
                            <p className="text-lg font-bold text-red-700 dark:text-red-400">{dados.resumo.credorSemHipotese}</p>
                            <p className="text-[10px] text-slate-500">credor sem hipótese nenhuma</p>
                        </div>
                        <div className="rounded-lg border p-2" style={{ borderColor: 'var(--border-subtle)' }}>
                            <p className="text-[10px] uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Credor pontual</p>
                            <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                                {dados.resumo.geradorPontual + dados.resumo.credorPontual}
                            </p>
                            <p className="text-[10px] text-slate-500">um mês só — acompanhar</p>
                        </div>
                        <div className="rounded-lg border p-2" style={{ borderColor: 'var(--border-subtle)' }}>
                            <p className="text-[10px] uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Devedor · sem dados</p>
                            <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                                {dados.resumo.devedor} · {dados.resumo.semDados}
                            </p>
                            <p className="text-[10px] text-slate-500">de {dados.resumo.empresas} do Lucro</p>
                        </div>
                    </div>
                    {(dados.avisos || []).map((a, i) => (
                        <p key={i} className="text-[11px] text-amber-700 dark:text-amber-400">⚠ {a}</p>
                    ))}
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        Período: {dados.periodo?.competencias.join(' · ')} · {dados.lidos} documento(s) lidos.
                    </p>
                </div>
            )}

            {dados?.linhas && (
                <div className="p-5 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                    {relevantes.length === 0 ? (
                        <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>
                            Nenhuma empresa com saldo credor no período — todas devedoras.
                            Isso é a resposta do F0: o arquivo do e-CredAc não atenderia ninguém hoje.
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {relevantes.map((l) => (
                                <div key={l.empresaId} className="rounded-lg border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
                                    <div className="flex items-start justify-between gap-2 flex-wrap">
                                        <div>
                                            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{l.nome}</p>
                                            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                                {fmtCnpj(l.cnpj)}{l.uf ? ` · ${l.uf}` : ''}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ROTULO[l.situacao]?.cls || ''}`}>
                                                {ROTULO[l.situacao]?.txt || l.situacao}
                                            </span>
                                            {l.credorValor > 0 && (
                                                <p className="text-[11px] font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>
                                                    {brl(l.credorValor)} acumulado no período
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>{l.motivo}</p>
                                    {l.acao && <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-0.5">→ {l.acao}</p>}

                                    <button onClick={() => setAberta(aberta === l.empresaId ? null : l.empresaId)}
                                        className="text-[11px] underline mt-1" style={{ color: 'var(--text-muted)' }}>
                                        {aberta === l.empresaId ? 'ocultar' : 'ver mês a mês'}
                                    </button>
                                    {aberta === l.empresaId && (
                                        <div className="overflow-x-auto mt-2">
                                            <table className="w-full text-[11px]">
                                                <thead>
                                                    <tr className="text-left text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>
                                                        <th className="py-1">Competência</th>
                                                        <th className="text-right">Débitos</th>
                                                        <th className="text-right">Créditos</th>
                                                        <th className="text-right">Saldo</th>
                                                        <th>Hipótese do art. 71</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {l.competencias.map((c) => (
                                                        <tr key={c.competencia} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                                                            <td className="py-1">{c.competencia.split('-').reverse().join('/')}</td>
                                                            <td className="text-right">{brl(c.debitos)}</td>
                                                            <td className="text-right">{brl(c.creditos)}</td>
                                                            <td className={`text-right font-bold ${c.credor ? 'text-red-600 dark:text-red-400' : ''}`}>
                                                                {c.credor ? `credor ${brl(c.credorValor)}` : brl(c.saldo)}
                                                            </td>
                                                            <td style={{ color: 'var(--text-muted)' }}>
                                                                {[
                                                                    c.exportacao ? `${c.exportacao} item(ns) de exportação` : '',
                                                                    c.isentaComCredito ? `${c.isentaComCredito} isenta/não trib.` : '',
                                                                    c.reducaoBase ? `${c.reducaoBase} c/ redução de base` : '',
                                                                    c.aliquotaMenor ? `saída ${c.aliqSaida}% < entrada ${c.aliqEntrada}%` : '',
                                                                ].filter(Boolean).join(' · ')
                                                                    || (c.itensLidos === 0 ? 'itens não lidos — não dá pra afirmar' : 'nenhuma')}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            ))}
                            {/* Lista recortada SEMPRE diz o que ficou de fora. */}
                            <p className="text-[11px] pt-1" style={{ color: 'var(--text-muted)' }}>
                                Mostrando {relevantes.length} de {linhas.length} empresa(s) do Lucro —
                                as {linhas.length - relevantes.length} restantes estão devedoras ou sem dados no período.
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default CreditoAcumulado;
