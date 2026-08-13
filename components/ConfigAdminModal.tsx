// ============================================================================
// ConfigAdminModal — ⚙️ Configurações do Admin (Paulo, 11/08)
// ----------------------------------------------------------------------------
// Um lugar só pro que é config de admin. Hoje:
//   · Templates do WhatsApp (Cloud API da Meta) — cadastrar/editar/desativar por
//     departamento. O backend valida pela regra da Meta; aqui é a caixa.
//   · Horários dos colaboradores — a EXCEÇÃO de horário mora por usuário no
//     "Gerenciar Usuários"; aqui só o atalho, pra não duplicar a régua.
// ============================================================================
import React, { useCallback, useEffect, useState } from 'react';
import { CogIcon, CloseIcon, UserGroupIcon } from './Icons';
import {
    listarTemplates, salvarTemplate, desativarTemplate, statusWhatsapp,
    WhatsappTemplate, TemplateVariavel,
} from '../services/whatsappTemplatesService';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    /** Atalho pros horários — abre o Gerenciar Usuários (onde a exceção mora). */
    onOpenUsers?: () => void;
}

const DEPARTAMENTOS: { id: string; nome: string }[] = [
    { id: 'fiscal', nome: '🧾 Fiscal' },
    { id: 'contabil', nome: '📊 Contábil' },
    { id: 'dp-folha', nome: '👥 DP / Folha' },
    { id: 'legalizacao', nome: '📋 Legalização' },
    { id: 'financeiro', nome: '💰 Financeiro' },
];

const nomeDepto = (id: string) => DEPARTAMENTOS.find((d) => d.id === id)?.nome || id;

const FORM_VAZIO = {
    departamento: 'fiscal',
    nome: '',
    idioma: 'pt_BR',
    descricao: '',
    temDocumento: false,
    variaveis: [] as TemplateVariavel[],
};

const ConfigAdminModal: React.FC<Props> = ({ isOpen, onClose, onOpenUsers }) => {
    const [carregando, setCarregando] = useState(false);
    const [templates, setTemplates] = useState<WhatsappTemplate[]>([]);
    const [canalPronto, setCanalPronto] = useState<boolean | null>(null);
    const [form, setForm] = useState({ ...FORM_VAZIO });
    const [editando, setEditando] = useState(false);
    const [msg, setMsg] = useState<{ texto: string; tipo: 'ok' | 'erro' } | null>(null);
    const [salvando, setSalvando] = useState(false);
    // O id do doc é `departamento__nome`, então renomear CRIA outro template.
    // Guardar o id de origem é o que permite ao backend desativar o antigo em
    // vez de deixar dois ativos (que fariam o envio recusar por ambiguidade).
    //
    // FICA AQUI, junto dos outros hooks e ANTES do `if (!isOpen) return null`.
    // Declarado depois do early return, ele só roda com o modal ABERTO — a
    // contagem de hooks muda entre um render e outro e o React derruba a tela
    // inteira com o erro #310. Foi o que aconteceu em 13/08.
    const [idAnterior, setIdAnterior] = useState<string | null>(null);

    const recarregar = useCallback(async () => {
        setCarregando(true);
        try {
            const [lst, st] = await Promise.all([listarTemplates(), statusWhatsapp()]);
            setTemplates(lst.ok ? lst.templates : []);
            setCanalPronto(st.ok ? st.pronto : null);
            if (!lst.ok) setMsg({ texto: lst.error || 'Falha ao carregar templates.', tipo: 'erro' });
        } finally {
            setCarregando(false);
        }
    }, []);

    useEffect(() => { if (isOpen) { setMsg(null); recarregar(); } }, [isOpen, recarregar]);

    if (!isOpen) return null;

    const limparForm = () => { setForm({ ...FORM_VAZIO }); setEditando(false); setIdAnterior(null); };

    const editar = (t: WhatsappTemplate) => {
        setIdAnterior(t.id || null);
        setForm({
            departamento: t.departamento,
            nome: t.nome,
            idioma: t.idioma || 'pt_BR',
            descricao: t.descricao || '',
            temDocumento: !!t.temDocumento,
            variaveis: (t.variaveis || []).map((v) => ({ chave: v.chave, rotulo: v.rotulo })),
        });
        setEditando(true);
        setMsg(null);
    };

    const addVar = () => setForm((f) => ({ ...f, variaveis: [...f.variaveis, { chave: '', rotulo: '' }] }));
    const setVar = (i: number, campo: keyof TemplateVariavel, valor: string) =>
        setForm((f) => ({ ...f, variaveis: f.variaveis.map((v, j) => (j === i ? { ...v, [campo]: valor } : v)) }));
    const delVar = (i: number) => setForm((f) => ({ ...f, variaveis: f.variaveis.filter((_, j) => j !== i) }));

    const salvar = async () => {
        setSalvando(true);
        setMsg(null);
        try {
            const r = await salvarTemplate({ ...form, ...(idAnterior ? { idAnterior } : {}) } as any);
            if (!r.ok) {
                const det = (r as any).detalhes as string[] | undefined;
                setMsg({ texto: `${r.error}${det?.length ? `: ${det.join('; ')}` : ''}`, tipo: 'erro' });
                return;
            }
            const sub = (r as any).substituiu;
            setMsg({
                texto: sub
                    ? `Template "${r.template.nome}" salvo. O anterior ("${sub.nome || sub.id}") foi DESATIVADO — `
                      + 'dois ativos no mesmo departamento fariam o envio recusar por ambiguidade.'
                    : `Template "${r.template.nome}" salvo.`,
                tipo: 'ok',
            });
            limparForm();
            await recarregar();
        } finally {
            setSalvando(false);
        }
    };

    const desativar = async (t: WhatsappTemplate) => {
        setMsg(null);
        const r = await desativarTemplate(t.id);
        if (!r.ok) { setMsg({ texto: r.error || 'Falha ao desativar.', tipo: 'erro' }); return; }
        setMsg({ texto: `Template "${t.nome}" desativado.`, tipo: 'ok' });
        await recarregar();
    };

    const inp = 'w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100';

    return (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center p-4 z-[70] animate-fade-in overflow-y-auto" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col my-auto" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="bg-slate-100 dark:bg-slate-900 p-4 rounded-t-xl flex justify-between items-center border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-slate-800 dark:text-slate-100 font-bold text-lg flex items-center gap-2">
                        <CogIcon className="w-5 h-5 text-sky-600" />
                        Configurações do Admin
                    </h3>
                    <button onClick={onClose} className="p-1 rounded-full text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700">
                        <CloseIcon className="w-5 h-5" />
                    </button>
                </div>

                <div className="overflow-y-auto p-4 space-y-5">
                    {msg && (
                        <p className={`text-xs px-3 py-2 rounded ${msg.tipo === 'ok'
                            ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                            : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'}`}>
                            {msg.texto}
                        </p>
                    )}

                    {/* ── Horários dos colaboradores (atalho) ─────────────────── */}
                    <section className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                        <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                            ⏰ Horários dos colaboradores
                        </h4>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                            A exceção de horário de acesso é <strong>por colaborador</strong> e mora no Gerenciar Usuários
                            (bloco “Horário de acesso” em cada usuário). O padrão da casa é seg–sex, 07:00–20:00; ali você
                            solta 24h ou define um horário próprio.
                        </p>
                        {onOpenUsers && (
                            <button
                                onClick={() => { onClose(); onOpenUsers(); }}
                                className="mt-2 inline-flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg bg-sky-50 dark:bg-sky-900/30 border border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-300 font-semibold hover:bg-sky-100 dark:hover:bg-sky-900/50"
                            >
                                <UserGroupIcon className="w-4 h-4" /> Abrir Gerenciar Usuários
                            </button>
                        )}
                    </section>

                    {/* ── Templates do WhatsApp ───────────────────────────────── */}
                    <section className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200">💬 Templates do WhatsApp (Cloud API oficial)</h4>
                            {canalPronto === false && (
                                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                                    canal não configurado — falta o secret/env (o envio não sai até ligar)
                                </span>
                            )}
                            {canalPronto === true && (
                                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">canal pronto</span>
                            )}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                            Cada departamento usa o SEU template aprovado pela Meta. As variáveis viram {'{{1}}'}, {'{{2}}'}…
                            na ORDEM da lista — no envio, o app preenche por nome ({'{cliente}'}, {'{competencia}'}…) e o
                            backend recusa se faltar variável (nunca manda meio preenchido).
                        </p>

                        {/* Lista */}
                        <div className="mt-3">
                            {carregando ? (
                                <p className="text-xs text-slate-500">Carregando…</p>
                            ) : templates.length === 0 ? (
                                <p className="text-xs text-slate-500">Nenhum template cadastrado ainda.</p>
                            ) : (
                                <div className="space-y-1.5">
                                    {templates.map((t) => (
                                        <div key={t.id} className={`flex items-center justify-between gap-2 text-xs rounded border px-2 py-1.5 ${t.ativo === false ? 'opacity-50 border-slate-200 dark:border-slate-700' : 'border-slate-200 dark:border-slate-700'}`}>
                                            <div className="min-w-0">
                                                <span className="font-semibold text-slate-700 dark:text-slate-200">{nomeDepto(t.departamento)}</span>
                                                <span className="mx-1 text-slate-400">·</span>
                                                <span className="font-mono">{t.nome}</span>
                                                <span className="ml-1 text-slate-400">({t.idioma})</span>
                                                {t.temDocumento && <span className="ml-1 text-sky-500">📎 doc</span>}
                                                {t.ativo === false && <span className="ml-1 text-red-500">inativo</span>}
                                                <span className="block text-[10px] text-slate-400 truncate">
                                                    {t.variaveis?.length || 0} variável(is){t.descricao ? ` · ${t.descricao}` : ''}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <button onClick={() => editar(t)} className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600">editar</button>
                                                {t.ativo !== false && (
                                                    <button onClick={() => desativar(t)} className="px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200">desativar</button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Formulário */}
                        <div className="mt-4 border-t border-slate-200 dark:border-slate-700 pt-3">
                            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">
                                {editando ? 'Editar template' : 'Novo template'}
                                {editando && (
                                    <button onClick={limparForm} className="ml-2 text-[10px] text-slate-400 underline">cancelar edição</button>
                                )}
                            </p>
                            {/* O nome e o departamento eram TRAVADOS na edição
                                (o id do doc é `departamento__nome`, então mudar
                                um deles cria outro template). A trava virou
                                beco sem saída quando o template aprovado mudou
                                de nome. Agora dá pra corrigir — e o backend
                                desativa o anterior, senão dois ativos no mesmo
                                departamento fazem o envio recusar. */}
                            {editando && (
                                <p className="mb-2 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 text-[10px] text-amber-800 dark:text-amber-300">
                                    Mudar o <strong>nome</strong> ou o <strong>departamento</strong> troca o vínculo: o app passa a usar
                                    o template novo e <strong>desativa o anterior</strong> (ele continua na Meta; só sai do uso aqui).
                                </p>
                            )}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <label className="text-[11px] text-slate-500">
                                    Departamento
                                    <select value={form.departamento} onChange={(e) => setForm((f) => ({ ...f, departamento: e.target.value }))} className={inp}>
                                        {DEPARTAMENTOS.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
                                    </select>
                                </label>
                                <label className="text-[11px] text-slate-500">
                                    Nome do template (Meta: minúsculas, dígitos e _)
                                    <input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} placeholder="guia_das_mensal" className={`${inp} font-mono`} />
                                </label>
                                <label className="text-[11px] text-slate-500">
                                    Idioma
                                    <input value={form.idioma} onChange={(e) => setForm((f) => ({ ...f, idioma: e.target.value }))} placeholder="pt_BR" className={inp} />
                                </label>
                                <label className="text-[11px] text-slate-500">
                                    Descrição (opcional)
                                    <input value={form.descricao} onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))} className={inp} />
                                </label>
                            </div>
                            <label className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 mt-2">
                                <input type="checkbox" checked={form.temDocumento} onChange={(e) => setForm((f) => ({ ...f, temDocumento: e.target.checked }))} />
                                Tem cabeçalho de documento (PDF) — o envio exige anexar o PDF
                            </label>

                            <div className="mt-3">
                                <div className="flex items-center justify-between">
                                    <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Variáveis (na ordem {'{{1}}'}, {'{{2}}'}…)</p>
                                    <button onClick={addVar} className="text-[11px] px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600">+ variável</button>
                                </div>
                                {form.variaveis.length === 0 && <p className="text-[10px] text-slate-400 mt-1">Template sem variáveis (corpo fixo).</p>}
                                <div className="space-y-1.5 mt-1.5">
                                    {form.variaveis.map((v, i) => (
                                        <div key={i} className="flex items-center gap-2">
                                            <span className="text-[10px] text-slate-400 w-8 shrink-0">{`{{${i + 1}}}`}</span>
                                            <input value={v.chave} onChange={(e) => setVar(i, 'chave', e.target.value)} placeholder="chave (ex.: cliente)" className={`${inp} font-mono`} />
                                            <input value={v.rotulo} onChange={(e) => setVar(i, 'rotulo', e.target.value)} placeholder="rótulo (ex.: Nome do cliente)" className={inp} />
                                            <button onClick={() => delVar(i)} className="text-red-400 hover:text-red-600 px-1 shrink-0" title="remover">✕</button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="mt-3 flex items-center gap-2">
                                <button
                                    onClick={salvar}
                                    disabled={salvando || !form.nome.trim()}
                                    className="px-3 py-1.5 text-sm rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-semibold disabled:opacity-50"
                                >
                                    {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Cadastrar template'}
                                </button>
                                <span className="text-[10px] text-slate-400">
                                    O template precisa já estar APROVADO na Meta com esse mesmo nome/idioma — aqui você só
                                    o LINKA e diz o que cada variável significa.
                                </span>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
};

export default ConfigAdminModal;
