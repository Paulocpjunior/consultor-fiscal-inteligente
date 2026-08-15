/**
 * PrazosMunicipaisPanel — o CALENDÁRIO MUNICIPAL, o buraco maior do mês.
 *
 * Paulo, 11/08: *"os vencimentos são datas definidas pelos órgãos
 * governamentais, sempre separados por esferas — federal, estadual, municipal;
 * isso nunca se altera e é onde deve ser feita a consulta"*.
 *
 * Não existe "dia do ISS" nacional: cada prefeitura tem o seu. Enquanto o
 * calendário da cidade não estiver cadastrado, o ISS aparece como PENDÊNCIA
 * NOMEADA na Rotina — nunca com uma data chutada. Cadastrado aqui, ele vira
 * obrigação de verdade, com vencimento, para os clientes daquela cidade.
 *
 * A fila é POR MUNICÍPIO porque é assim que o trabalho rende: cadastrar uma
 * cidade resolve todos os clientes dela de uma vez.
 */
import React, { useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';

interface Cadastro {
    id: string;
    codMunIBGE: string;
    municipioNome: string | null;
    obrigacao: string;
    diaVencimento: number;
    mesesApos: number;
    baseLegal: string;
    vigenciaInicio: string | null;
    vigenciaFim: string | null;
    ativo?: boolean;
    cadastradoPorEmail?: string | null;
}

interface MunicipioFaltando {
    codMunIBGE: string;
    municipioNome: string | null;
    total: number;
    clientes: Array<{ id: string | null; nome: string; cnpj: string }>;
}

const FORM_VAZIO = {
    codMunIBGE: '', municipioNome: '', obrigacao: 'ISS',
    diaVencimento: '', mesesApos: '1', baseLegal: '',
    vigenciaInicio: '', vigenciaFim: '',
};

const PrazosMunicipaisPanel: React.FC<{ onShowToast?: (m: string) => void }> = ({ onShowToast }) => {
    const [dados, setDados] = useState<any>(null);
    const [carregando, setCarregando] = useState(false);
    const [form, setForm] = useState({ ...FORM_VAZIO });
    const [erros, setErros] = useState<string[]>([]);
    const [salvando, setSalvando] = useState(false);

    const token = async () => {
        const u = getAuth().currentUser;
        if (!u) throw new Error('Sessão expirada — entre novamente.');
        return u.getIdToken();
    };

    const carregar = async () => {
        setCarregando(true);
        try {
            const r = await fetch('/api/admin/prazos-municipais', { headers: { Authorization: `Bearer ${await token()}` } });
            setDados(await r.json());
        } catch (e: any) {
            setDados({ ok: false, error: e?.message || 'falha ao carregar' });
        } finally { setCarregando(false); }
    };
    useEffect(() => { carregar(); }, []);

    const salvar = async () => {
        setErros([]); setSalvando(true);
        try {
            const r = await fetch('/api/admin/prazos-municipais', {
                method: 'POST',
                headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...form,
                    diaVencimento: Number(form.diaVencimento),
                    mesesApos: Number(form.mesesApos),
                }),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) { setErros(j.erros || [j.error || `HTTP ${r.status}`]); return; }
            onShowToast?.(`Calendário de ${form.obrigacao} cadastrado para ${form.municipioNome || form.codMunIBGE}.`);
            setForm({ ...FORM_VAZIO });
            await carregar();
        } catch (e: any) {
            setErros([e?.message || 'falha ao gravar']);
        } finally { setSalvando(false); }
    };

    const campo = 'w-full p-2 text-sm rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600';
    const rotulo = 'text-[10px] uppercase font-bold block mb-1 text-slate-500 dark:text-slate-400';

    return (
        <div className="space-y-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">🏛️ Calendário municipal (ISS)</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-3xl">
                    Não existe “dia do ISS” nacional — <strong>cada prefeitura tem o seu</strong>. Enquanto a cidade não
                    estiver cadastrada aqui, o ISS aparece na Rotina como <strong>pendência nomeada</strong>, nunca com
                    uma data chutada. Cadastrado, ele vira obrigação com vencimento para os clientes daquela cidade.
                </p>
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    ⚠ O prazo vale <strong>por vigência</strong>: mudou a lei, cadastre a vigência nova em vez de editar a
                    antiga. Competência velha continua saindo com a regra que valia nela.
                </p>
            </div>

            {/* ── FILA: onde cadastrar rende mais ───────────────────────────── */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                        📋 Municípios sem calendário
                    </h4>
                    <button onClick={carregar} disabled={carregando}
                        className="btn-press text-[11px] px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 disabled:opacity-50 whitespace-nowrap">
                        {carregando ? '⏳' : '↻ Atualizar'}
                    </button>
                </div>

                {dados?.error && <p className="text-xs text-red-600 dark:text-red-400">{dados.error}</p>}

                {dados?.ok && (
                    <>
                        <p className="text-xs text-slate-600 dark:text-slate-300">
                            <strong>{dados.totalMunicipios}</strong> cidade(s) sem calendário, cobrindo{' '}
                            <strong>{dados.totalClientes}</strong> cliente(s).
                            {dados.clientesSemMunicipio > 0 && (
                                <> · <strong>{dados.clientesSemMunicipio}</strong> cliente(s) <strong>sem município
                                cadastrado</strong> — esses não entram na fila: a ação é preencher o município nos
                                Dados Fiscais.</>
                            )}
                        </p>
                        <div className="space-y-1">
                            {(dados.municipios || []).map((m: MunicipioFaltando) => (
                                <div key={m.codMunIBGE}
                                    className="flex items-center justify-between gap-2 text-[11px] p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                                    <span className="text-amber-800 dark:text-amber-300">
                                        <strong>{m.municipioNome || `IBGE ${m.codMunIBGE}`}</strong>
                                        {' · '}{m.total} cliente(s): {m.clientes.slice(0, 3).map((c) => c.nome).join(', ')}
                                        {m.clientes.length > 3 && ` +${m.clientes.length - 3}`}
                                    </span>
                                    <button
                                        onClick={() => setForm((f) => ({
                                            ...f, codMunIBGE: m.codMunIBGE, municipioNome: m.municipioNome || '',
                                        }))}
                                        className="btn-press px-2 py-0.5 rounded border border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-300 whitespace-nowrap">
                                        cadastrar
                                    </button>
                                </div>
                            ))}
                            {dados.totalMunicipios === 0 && (
                                <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                                    ✓ Todas as cidades com cliente de ISS próprio têm calendário cadastrado.
                                </p>
                            )}
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">{dados.escopo}</p>
                    </>
                )}
            </div>

            {/* ── CADASTRO ───────────────────────────────────────────────────── */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
                <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200">➕ Cadastrar calendário</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                        <label className={rotulo}>Código IBGE (7 dígitos)</label>
                        <input value={form.codMunIBGE} onChange={(e) => setForm({ ...form, codMunIBGE: e.target.value })}
                            className={`${campo} font-mono`} placeholder="3550308" />
                    </div>
                    <div>
                        <label className={rotulo}>Município</label>
                        <input value={form.municipioNome} onChange={(e) => setForm({ ...form, municipioNome: e.target.value })}
                            className={campo} placeholder="São Paulo" />
                    </div>
                    <div>
                        <label className={rotulo}>Dia do vencimento</label>
                        <input value={form.diaVencimento} onChange={(e) => setForm({ ...form, diaVencimento: e.target.value })}
                            className={campo} placeholder="10" />
                    </div>
                    <div>
                        <label className={rotulo}>Meses após a competência</label>
                        <input value={form.mesesApos} onChange={(e) => setForm({ ...form, mesesApos: e.target.value })}
                            className={campo} placeholder="1" />
                    </div>
                </div>
                <div>
                    <label className={rotulo}>Base legal (lei/decreto municipal ou link do calendário oficial)</label>
                    <input value={form.baseLegal} onChange={(e) => setForm({ ...form, baseLegal: e.target.value })}
                        className={campo} placeholder="Lei Municipal 13.701/2003, art. 20" />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                    <div>
                        <label className={rotulo}>Vigência de</label>
                        <input type="date" value={form.vigenciaInicio}
                            onChange={(e) => setForm({ ...form, vigenciaInicio: e.target.value })} className={campo} />
                    </div>
                    <div>
                        <label className={rotulo}>Vigência até (vazio = sem fim)</label>
                        <input type="date" value={form.vigenciaFim}
                            onChange={(e) => setForm({ ...form, vigenciaFim: e.target.value })} className={campo} />
                    </div>
                    <button onClick={salvar} disabled={salvando}
                        className="btn-press px-4 py-2 text-sm font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 whitespace-nowrap">
                        {salvando ? '⏳ gravando…' : 'Cadastrar'}
                    </button>
                </div>
                {erros.length > 0 && (
                    <ul className="text-xs text-red-600 dark:text-red-400 space-y-1 list-disc ml-4">
                        {erros.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                )}
            </div>

            {/* ── CADASTRADOS ────────────────────────────────────────────────── */}
            {!!dados?.cadastros?.length && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                    <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">
                        ✓ Calendários cadastrados ({dados.cadastros.length})
                    </h4>
                    <div className="space-y-1">
                        {dados.cadastros.map((c: Cadastro) => (
                            <p key={c.id} className={`text-[11px] ${c.ativo === false ? 'opacity-50 line-through' : 'text-slate-600 dark:text-slate-300'}`}>
                                <strong>{c.municipioNome || c.codMunIBGE}</strong> · {c.obrigacao} · dia {c.diaVencimento}
                                {c.mesesApos !== 1 && ` (+${c.mesesApos} mês/meses)`}
                                {' · '}<span className="opacity-80">{c.baseLegal}</span>
                                {c.vigenciaInicio && ` · de ${c.vigenciaInicio}`}{c.vigenciaFim && ` até ${c.vigenciaFim}`}
                                {c.cadastradoPorEmail && <span className="opacity-60"> · por {c.cadastradoPorEmail}</span>}
                            </p>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default PrazosMunicipaisPanel;
