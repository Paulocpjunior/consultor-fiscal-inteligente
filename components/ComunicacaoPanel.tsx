import ComunicacaoLote from './ComunicacaoLote';
import React, { useEffect, useRef, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { listarTemplates, WhatsappTemplate } from '../services/whatsappTemplatesService';

type Modelo = { id?: string; revisao?: number; nome: string; departamento: string; canal: string; assunto: string; corpo: string; templateId: string; variaveis: string[]; ativo: boolean };
type Agenda = { id: string; modelo: Modelo; para: string; proximoEm: string; recorrencia: string; status: string; valores: Record<string, string>; fim?: string; iniciadoEm?: string; ultimoResultado?: { erro?: string } };
type Execucao = { id: string; para: string; previstoEm: string; status: string; erro?: string; messageId?: string };
type Dados = { modelos: Modelo[]; agendas: Agenda[]; execucoes: Execucao[]; ultimoTickEm?: string; truncado?: boolean };
const departamentos = [['fiscal', 'Fiscal'], ['contabil', 'Contábil'], ['dp-folha', 'DP / Folha'], ['legalizacao', 'Legalização'], ['financeiro', 'Financeiro']];
const vazio = (departamento: string): Modelo => ({ nome: '', departamento, canal: 'email', assunto: '', corpo: '', templateId: '', variaveis: [], ativo: true });
const campo = 'w-full mt-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-2 text-sm';
const botao = 'rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm disabled:opacity-50 hover:bg-slate-100 dark:hover:bg-slate-700';
const quando = (s: string) => new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
async function api(path: string, body?: unknown) {
    const user = getAuth().currentUser;
    if (!user) throw new Error('Entre novamente para continuar.');
    const response = await fetch('/api/admin/comunicacao' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${await user.getIdToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Não foi possível concluir.');
    return data;
}
export default function ComunicacaoPanel() {
    const inicial = new URLSearchParams(window.location.search).get('departamento') || 'fiscal';
    useEffect(() => { if (new URLSearchParams(window.location.search).get('painel') === 'comunicacao') document.getElementById('comunicacao-panel')?.scrollIntoView({ block: 'start' }); }, []);
    const [dep, setDep] = useState(departamentos.some(d => d[0] === inicial) ? inicial : 'fiscal');
    const [dados, setDados] = useState<Dados>({ modelos: [], agendas: [], execucoes: [] });
    const [whatsapp, setWhatsapp] = useState<WhatsappTemplate[]>([]);
    const [form, setForm] = useState<Modelo>(() => vazio(dep));
    const [valores, setValores] = useState<Record<string, string>>({});
    const [valoresAgenda, setValoresAgenda] = useState<Record<string, string>>({});
    const [previa, setPrevia] = useState<{ html?: string; corpo?: string } | null>(null);
    const [erro, setErro] = useState('');
    const [aviso, setAviso] = useState('');
    const [ocupado, setOcupado] = useState(false);
    const [selecionado, setSelecionado] = useState('');
    const [agenda, setAgenda] = useState({ para: '', inicio: '', recorrencia: 'unica', fim: '' });
    const pedidoId = useRef(crypto.randomUUID());
    const seq = useRef(0);
    const carregar = async () => {
        const atual = ++seq.current;
        const [d, w] = await Promise.all([api(`?departamento=${dep}`), listarTemplates(dep)]);
        if (atual !== seq.current) return;
        setDados(d); if (!w.ok) throw new Error(w.error || 'Não foi possível ler WhatsApp.');
        setWhatsapp(w.templates.filter(t => t.ativo !== false && !t.temDocumento));
    };
    const executar = async (fn: () => Promise<void>) => {
        if (ocupado) return;
        setOcupado(true); setErro(''); setAviso('');
        try { await fn(); } catch (e) { setErro(e instanceof Error ? e.message : 'Falha ao concluir.'); } finally { setOcupado(false); }
    };
    useEffect(() => {
        setDados({ modelos: [], agendas: [], execucoes: [] }); setWhatsapp([]); setForm(vazio(dep)); setValores({}); setPrevia(null); setSelecionado(''); setValoresAgenda({}); setErro('');
        void carregar().catch(e => setErro(e.message));
        return () => { seq.current++; };
    }, [dep]);
    const alterar = (patch: Partial<Modelo>) => { setForm(f => ({ ...f, ...patch })); setPrevia(null); };
    const chaves = form.canal === 'whatsapp' ? (whatsapp.find(t => t.id === form.templateId)?.variaveis.map(v => v.chave) || []) : [...new Set([...(`${form.assunto}\n${form.corpo}`).matchAll(/\{\{([a-zA-Z][a-zA-Z0-9_]{0,39})\}\}/g)].map(m => m[1]))];
    const modeloAgenda = dados.modelos.find(m => m.id === selecionado);
    const tickAtivo = dados.ultimoTickEm && Date.now() - Date.parse(dados.ultimoTickEm) < 15 * 60000;
    return <section id="comunicacao-panel" className="space-y-4 text-slate-800 dark:text-slate-100" aria-label="Templates e agendamentos">
        <div><h3 className="text-lg font-bold">Templates e agendamentos</h3><p className="text-sm text-slate-500">Modelos e envios automáticos dos cinco departamentos. Administração central da SP Assessoria.</p></div>
        <div className="flex flex-wrap gap-2 items-end"><label>Departamento<select className={campo} value={dep} disabled={ocupado} onChange={e => setDep(e.target.value)}>{departamentos.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}</select></label><button className={botao} disabled={ocupado} onClick={() => executar(carregar)}>Atualizar</button></div>
        {erro && <p role="alert" className="rounded-lg bg-red-50 text-red-800 p-3">{erro}</p>}{aviso && <p role="status" className="rounded-lg bg-emerald-50 text-emerald-800 p-3">{aviso}</p>}
        <p className={`rounded-lg p-3 text-sm ${tickAtivo ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>{tickAtivo ? `Agendador ativo. Última execução: ${quando(dados.ultimoTickEm!)}` : 'Agendador sem execução recente confirmada. Os envios dependem do serviço automático ativo.'} Horários de Brasília. Verificação a cada cinco minutos.</p>
        {dados.truncado && <p className="text-sm">Lista limitada: podem existir registros adicionais.</p>}
        <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2"><h4 className="font-bold">Modelos do departamento</h4><button className={botao} onClick={() => { setForm(vazio(dep)); setValores({}); setPrevia(null); }}>Novo modelo</button>
                {!dados.modelos.length && <p className="text-sm text-slate-500">Nenhum modelo adicional cadastrado. Os modelos anteriores continuam disponíveis nas telas de origem.</p>}
                {dados.modelos.map(m => <div className="border dark:border-slate-700 rounded-lg p-3" key={m.id}><b>{m.nome}</b><p className="text-xs">{m.canal} · revisão {m.revisao} · {m.ativo ? 'ativo' : 'inativo'}</p><div className="flex gap-2 mt-2"><button className={botao} onClick={() => { setForm(m); setValores({}); setPrevia(null); }}>Editar</button><button className={botao} onClick={() => { setForm({ ...m, id: undefined, revisao: undefined, nome: m.nome + ' (cópia)' }); setPrevia(null); setValores({}); }}>Duplicar</button><button className={botao} disabled={ocupado} onClick={() => executar(async () => { await api('/modelos', { ...m, ativo: !m.ativo }); await carregar(); })}>{m.ativo ? 'Desativar' : 'Ativar'}</button></div></div>)}
            </div>
            <div className="space-y-3 border dark:border-slate-700 rounded-xl p-4"><h4 className="font-bold">{form.id ? 'Editar modelo' : 'Novo modelo'}</h4>
                <label className="block">Nome<input className={campo} value={form.nome} maxLength={100} onChange={e => alterar({ nome: e.target.value })} /></label>
                <label className="block">Canal<select className={campo} value={form.canal} disabled={!!form.id} onChange={e => alterar({ canal: e.target.value })}><option value="email">E-mail</option><option value="whatsapp">WhatsApp</option></select></label>
                {form.canal === 'email' ? <><label className="block">Assunto<input className={campo} value={form.assunto} maxLength={200} onChange={e => alterar({ assunto: e.target.value })} /></label><label className="block">Mensagem<textarea rows={6} className={campo} value={form.corpo} maxLength={10000} onChange={e => alterar({ corpo: e.target.value })} /></label><p className="text-xs text-slate-500">Use {'{{cliente}}'}, {'{{documentos}}'}, {'{{competencia}}'} e outras variáveis. Cabeçalho, marca e rodapé seguem o layout existente.</p></> : <><label className="block">Template WhatsApp<select className={campo} value={form.templateId} onChange={e => alterar({ templateId: e.target.value })}><option value="">Selecione</option>{whatsapp.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}</select></label><p className="text-xs text-slate-500">Use o cadastro de WhatsApp abaixo para criar e submeter novos templates à Meta. Agendamentos usam modelos de serviço (UTILITY), aprovados e sem anexos.</p></>}
                {chaves.map(k => <label key={k} className="block text-sm">Exemplo: {k}<input className={campo} value={valores[k] || ''} onChange={e => { setValores({ ...valores, [k]: e.target.value }); setPrevia(null); }} /></label>)}
                <div className="flex gap-2"><button className={botao} disabled={ocupado} onClick={() => executar(async () => setPrevia(await api('/previa', { modelo: form, valores })))}>Visualizar</button><button className={botao} disabled={ocupado} onClick={() => executar(async () => { await api('/modelos', form); setForm(vazio(dep)); setPrevia(null); await carregar(); setAviso('Modelo salvo. Agendamentos existentes conservam a revisão e param se ela mudar.'); })}>Salvar modelo</button></div>
                {previa?.html ? <iframe title="Prévia do e-mail" sandbox="" srcDoc={previa.html} className="w-full h-96 rounded-lg border" /> : previa?.corpo && <pre className="whitespace-pre-wrap text-sm p-3 bg-slate-50 dark:bg-slate-900">{previa.corpo}</pre>}
            </div>
        </div>
        <div className="space-y-3 border dark:border-slate-700 rounded-xl p-4"><h4 className="font-bold">Novo agendamento</h4><p className="text-sm text-slate-500">Salve, confira os dados na lista e ative. Um destinatário por agendamento. Os valores permanecem os mesmos em cada repetição; use texto sem competência fixa para lembretes recorrentes.</p>
            <label className="block">Modelo<select className={campo} value={selecionado} onChange={e => { setSelecionado(e.target.value); setValoresAgenda({}); setPrevia(null); }}><option value="">Selecione</option>{dados.modelos.filter(m => m.ativo).map(m => <option key={m.id} value={m.id}>{m.nome} ({m.canal})</option>)}</select></label>
            <div className="grid sm:grid-cols-2 gap-3"><label>Destinatário<input className={campo} value={agenda.para} placeholder={modeloAgenda?.canal === 'whatsapp' ? '5511999999999' : 'cliente@empresa.com.br'} onChange={e => setAgenda({ ...agenda, para: e.target.value })} /></label><label>Primeiro envio — Brasília<input type="datetime-local" className={campo} value={agenda.inicio} onChange={e => setAgenda({ ...agenda, inicio: e.target.value })} /></label><label>Repetição<select className={campo} value={agenda.recorrencia} onChange={e => setAgenda({ ...agenda, recorrencia: e.target.value })}><option value="unica">Uma vez</option><option value="diaria">Diária</option><option value="semanal">Semanal</option><option value="mensal">Mensal</option></select></label>{agenda.recorrencia !== 'unica' && <label>Data final — Brasília<input type="datetime-local" className={campo} value={agenda.fim} onChange={e => setAgenda({ ...agenda, fim: e.target.value })} /></label>}</div>
            {modeloAgenda?.variaveis.map(k => <label className="block" key={k}>{k}<input className={campo} value={valoresAgenda[k] || ''} onChange={e => setValoresAgenda({ ...valoresAgenda, [k]: e.target.value })} /></label>)}
            <button className={botao} disabled={ocupado || !modeloAgenda} onClick={() => executar(async () => { await api('/agendas', { ...agenda, fim: agenda.recorrencia === 'unica' ? '' : agenda.fim, modeloId: selecionado, valores: valoresAgenda, pedidoId: pedidoId.current }); pedidoId.current = crypto.randomUUID(); await carregar(); setAviso('Agendamento salvo pausado. Confira e clique em Ativar para autorizar os envios.'); })}>Salvar agendamento pausado</button>
        </div>
        <ComunicacaoLote key={dep} departamento={dep} modelos={dados.modelos.filter(m=>m.ativo)} api={api} atualizar={carregar} />
        <div className="space-y-2"><h4 className="font-bold">Agendamentos</h4>{dados.agendas.length === 0 && <p className="text-sm text-slate-500">Nenhum agendamento neste departamento.</p>}{dados.agendas.map(a => <div key={a.id} className="rounded-lg border dark:border-slate-700 p-3"><b>{a.modelo.nome}</b><p className="text-sm">{a.para} · {quando(a.proximoEm)} · {a.recorrencia} · {a.status}</p><details className="my-2 text-sm"><summary>Conferir mensagem e parâmetros</summary><p>Modelo: revisão {a.modelo.revisao} · {a.modelo.canal}</p>{a.fim && <p>Até {quando(a.fim)}</p>}<pre className="whitespace-pre-wrap">{a.modelo.corpo || a.modelo.templateId}</pre>{Object.entries(a.valores || {}).map(([k, v]) => <p key={k}><b>{k}:</b> {v}</p>)}</details>{a.ultimoResultado?.erro && <p className="text-sm text-red-600">{a.ultimoResultado.erro}</p>}{['processando', 'indeterminado'].includes(a.status) && <p className="text-sm text-amber-700">Confira o provedor e o histórico antes de criar outro envio. Esta ocorrência não será reenviada automaticamente.</p>}{['ativo', 'pausado'].includes(a.status) && <div className="flex gap-2 mt-2">{[a.status === 'ativo' ? 'pausado' : 'ativo', 'cancelado'].map(status => <button key={status} className={botao} disabled={ocupado} onClick={() => executar(async () => { await api(`/agendas/${a.id}/estado`, { status }); await carregar(); })}>{status === 'ativo' ? 'Ativar envios' : status === 'pausado' ? 'Pausar' : 'Cancelar'}</button>)}</div>}</div>)}</div>
        <div className="space-y-2"><h4 className="font-bold">Histórico de ocorrências</h4><p className="text-xs text-slate-500">“Aceito” confirma a aceitação pelo provedor; não confirma leitura ou entrega ao cliente.</p>{dados.execucoes.map(e => <div key={e.id} className="text-sm border-b dark:border-slate-700 py-2">{quando(e.previstoEm)} · {e.para} · <b>{e.status}</b>{e.erro && <p>{e.erro}</p>}{e.messageId && <p className="break-all text-xs">Protocolo: {e.messageId}</p>}</div>)}</div>
    </section>;
}
