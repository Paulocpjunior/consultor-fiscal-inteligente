/**
 * NcmCadastroPanel — cadastro de NCM (alíquota interna, IVA-ST, CEST).
 *
 * Paulo, 04/08: "o que nós não temos e devemos implementar: um cadastro de
 * NCM, para melhor consulta e parâmetro de impostos e ST".
 *
 * O ganho concreto: hoje o IVA-ST é digitado item a item, toda competência,
 * mesmo sendo sempre o mesmo índice para o mesmo NCM. Aqui digita-se UMA vez,
 * com a Portaria e a VIGÊNCIA — e o painel do DIFAL passa a preencher sozinho
 * (sem nunca sobrescrever o que o colaborador informou na tela).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import type { User } from '../../types';

interface Props {
    currentUser: User;
    onShowToast?: (msg: string) => void;
}

interface LinhaNcm {
    id: string;
    ncm: string;
    uf?: string | null;
    descricao?: string | null;
    cest?: string | null;
    aliqInterna?: number | null;
    ivaSt?: number | null;
    ivaJaAjustado?: boolean;
    portariaIvaSt?: string | null;
    temSt?: boolean | null;
    reducaoBase?: number | null;
    vigenciaInicio?: string | null;
    vigenciaFim?: string | null;
    atualizadoPor?: string | null;
}

const VAZIO: Partial<LinhaNcm> = {
    ncm: '', uf: 'SP', descricao: '', cest: '',
    aliqInterna: null, ivaSt: null, portariaIvaSt: '', vigenciaInicio: '',
};

const fmtNcm = (v: string) => {
    const d = String(v || '').replace(/\D/g, '');
    return d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : d;
};
const pct = (v: number | null | undefined) =>
    v == null ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}%`;

const NcmCadastroPanel: React.FC<Props> = ({ currentUser, onShowToast }) => {
    const [linhas, setLinhas] = useState<LinhaNcm[]>([]);
    const [total, setTotal] = useState(0);
    const [truncado, setTruncado] = useState(false);
    const [busca, setBusca] = useState('');
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState<Partial<LinhaNcm>>(VAZIO);
    const [salvando, setSalvando] = useState(false);

    const ehAdmin = currentUser?.role === 'admin';
    const token = async () => {
        const u = getAuth().currentUser;
        if (!u) throw new Error('Sessão expirada — entre de novo.');
        return u.getIdToken();
    };

    const carregar = useCallback(async (termo = busca) => {
        setLoading(true);
        try {
            const qs = termo ? `?busca=${encodeURIComponent(termo)}` : '';
            const r = await fetch(`/api/admin/ncm${qs}`, {
                headers: { Authorization: `Bearer ${await token()}` },
            });
            const j = await r.json();
            if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setLinhas(j.linhas || []);
            setTotal(j.total || 0);
            setTruncado(!!j.truncado);
        } catch (e: any) {
            onShowToast?.(`Falha ao ler o cadastro: ${e?.message || e}`);
        } finally {
            setLoading(false);
        }
    }, [busca, onShowToast]);

    useEffect(() => { carregar(''); /* eslint-disable-next-line */ }, []);

    const salvar = async () => {
        setSalvando(true);
        try {
            const r = await fetch('/api/admin/ncm', {
                method: 'PUT',
                headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            const j = await r.json();
            if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
            onShowToast?.(`NCM ${fmtNcm(j.ncm)} salvo.`);
            setForm(VAZIO);
            await carregar();
        } catch (e: any) {
            onShowToast?.(e?.message || 'Não foi possível salvar.');
        } finally {
            setSalvando(false);
        }
    };

    const remover = async (id: string) => {
        try {
            const r = await fetch(`/api/admin/ncm/${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${await token()}` },
            });
            const j = await r.json();
            if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
            await carregar();
        } catch (e: any) {
            onShowToast?.(e?.message || 'Não foi possível remover.');
        }
    };

    const campo = (k: keyof LinhaNcm, v: any) => setForm(f => ({ ...f, [k]: v }));
    const inputCls = 'w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 text-sm';
    const rotCls = 'block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1';

    return (
        <div className="space-y-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                    🏷️ Cadastro de NCM — parâmetros de imposto e ST
                </h3>
                <p className="text-[11px] text-slate-500 mt-1">
                    Alíquota interna, IVA-ST (com a <b>Portaria CAT</b> e a <b>vigência</b>), CEST e redução de base.
                    O painel do DIFAL usa este cadastro para preencher o IVA-ST sozinho — <b>o que você digitar na
                    tela do DIFAL sempre vence</b>. A vigência é resolvida pela <b>data da nota</b>, não pela de hoje:
                    a Portaria muda, e aplicar o índice atual numa nota antiga recolhe errado.
                </p>
            </div>

            {ehAdmin && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Novo / atualizar</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div>
                            <label className={rotCls}>NCM *</label>
                            <input className={inputCls} value={form.ncm || ''} placeholder="8708.99.90"
                                onChange={e => campo('ncm', e.target.value)} />
                        </div>
                        <div>
                            <label className={rotCls}>UF (vazio = todas)</label>
                            <input className={inputCls} value={form.uf || ''} placeholder="SP" maxLength={2}
                                onChange={e => campo('uf', e.target.value.toUpperCase())} />
                        </div>
                        <div className="col-span-2">
                            <label className={rotCls}>Descrição</label>
                            <input className={inputCls} value={form.descricao || ''}
                                onChange={e => campo('descricao', e.target.value)} />
                        </div>
                        <div>
                            <label className={rotCls}>Alíquota interna %</label>
                            <input className={inputCls} type="number" step="0.01" value={form.aliqInterna ?? ''}
                                placeholder="18" onChange={e => campo('aliqInterna', e.target.value)} />
                        </div>
                        <div>
                            <label className={rotCls}>IVA-ST %</label>
                            <input className={inputCls} type="number" step="0.01" value={form.ivaSt ?? ''}
                                placeholder="71,78" onChange={e => campo('ivaSt', e.target.value)} />
                        </div>
                        <div className="col-span-2">
                            <label className={rotCls}>Portaria CAT do IVA-ST *</label>
                            <input className={inputCls} value={form.portariaIvaSt || ''} placeholder="CAT 26/2025"
                                onChange={e => campo('portariaIvaSt', e.target.value)} />
                        </div>
                        <div>
                            <label className={rotCls}>CEST</label>
                            <input className={inputCls} value={form.cest || ''} placeholder="0106000"
                                onChange={e => campo('cest', e.target.value)} />
                        </div>
                        <div>
                            <label className={rotCls}>Redução de base %</label>
                            <input className={inputCls} type="number" step="0.01" value={form.reducaoBase ?? ''}
                                onChange={e => campo('reducaoBase', e.target.value)} />
                        </div>
                        <div>
                            <label className={rotCls}>Vigência início</label>
                            <input className={inputCls} type="date" value={form.vigenciaInicio || ''}
                                onChange={e => campo('vigenciaInicio', e.target.value)} />
                        </div>
                        <div>
                            <label className={rotCls}>Vigência fim</label>
                            <input className={inputCls} type="date" value={form.vigenciaFim || ''}
                                onChange={e => campo('vigenciaFim', e.target.value)} />
                        </div>
                    </div>
                    <div className="flex items-center gap-4 flex-wrap">
                        <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                            <input type="checkbox" checked={!!form.ivaJaAjustado}
                                onChange={e => campo('ivaJaAjustado', e.target.checked)} />
                            O IVA-ST informado JÁ é o ajustado (a Portaria publica os dois)
                        </label>
                        <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                            <input type="checkbox" checked={!!form.temSt}
                                onChange={e => campo('temSt', e.target.checked)} />
                            Mercadoria sujeita a ST
                        </label>
                        <button onClick={salvar} disabled={salvando || !form.ncm}
                            className="ml-auto px-4 py-2 text-sm bg-blue-700 hover:bg-blue-800 text-white rounded-lg font-bold disabled:opacity-40">
                            {salvando ? 'Salvando…' : '💾 Salvar'}
                        </button>
                    </div>
                    <p className="text-[10px] text-amber-700 dark:text-amber-400">
                        ⚠ Informar IVA-ST <b>exige</b> a Portaria: índice sem origem não se confere depois. Preço
                        final fixado (pauta/PMC) usa a base do §3º, não o IVA-ST.
                    </p>
                </div>
            )}

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <div className="flex gap-2 items-end mb-3 flex-wrap">
                    <div className="flex-1 min-w-[200px]">
                        <label className={rotCls}>Buscar por NCM, descrição ou CEST</label>
                        <input className={inputCls} value={busca} onChange={e => setBusca(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && carregar()} placeholder="8708 ou autopeça" />
                    </div>
                    <button onClick={() => carregar()} disabled={loading}
                        className="px-4 py-2 text-sm bg-slate-100 dark:bg-slate-700 rounded-lg font-semibold disabled:opacity-40">
                        {loading ? 'Buscando…' : '🔎 Buscar'}
                    </button>
                    <span className="text-[11px] text-slate-500 pb-2">
                        {linhas.length} de {total} no cadastro{truncado && ' · mostrando os 500 primeiros'}
                    </span>
                </div>

                {linhas.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4 text-center">
                        Cadastro vazio. Comece pelos NCMs que mais aparecem nas notas com ST dos seus clientes —
                        eles são os que hoje exigem digitação a cada competência.
                    </p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-[11px]">
                            <thead className="text-slate-500 border-b border-slate-200 dark:border-slate-700">
                                <tr>
                                    <th className="text-left py-1">NCM · descrição</th>
                                    <th className="text-center">UF</th>
                                    <th className="text-right">Interna</th>
                                    <th className="text-right">IVA-ST</th>
                                    <th className="text-left pl-2">Portaria</th>
                                    <th className="text-left">Vigência</th>
                                    {ehAdmin && <th></th>}
                                </tr>
                            </thead>
                            <tbody>
                                {linhas.map(l => (
                                    <tr key={l.id} className="border-b border-slate-100 dark:border-slate-700/50">
                                        <td className="py-1.5">
                                            <span className="font-mono font-semibold">{fmtNcm(l.ncm)}</span>
                                            {l.cest && <span className="ml-2 text-[9px] font-mono text-slate-400">CEST {l.cest}</span>}
                                            <span className="block text-[10px] text-slate-500">{l.descricao || '—'}</span>
                                        </td>
                                        <td className="text-center font-mono">{l.uf || 'todas'}</td>
                                        <td className="text-right font-mono">{pct(l.aliqInterna)}</td>
                                        <td className="text-right font-mono">
                                            {pct(l.ivaSt)}
                                            {l.ivaJaAjustado && <span className="block text-[9px] text-slate-400">já ajustado</span>}
                                        </td>
                                        <td className="pl-2 text-slate-500">{l.portariaIvaSt || '—'}</td>
                                        <td className="text-slate-500 font-mono text-[10px]">
                                            {l.vigenciaInicio || '—'}{l.vigenciaFim ? ` → ${l.vigenciaFim}` : ''}
                                        </td>
                                        {ehAdmin && (
                                            <td className="text-right">
                                                <button onClick={() => remover(l.id)}
                                                    className="px-2 py-0.5 text-[10px] text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded">
                                                    remover
                                                </button>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default NcmCadastroPanel;
