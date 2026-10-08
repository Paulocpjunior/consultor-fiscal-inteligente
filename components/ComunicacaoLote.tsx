import React, { useEffect, useRef, useState } from 'react';
import { getCurrentUser } from '../services/authService';
import { getEmpresasParaPerfilCliente } from '../services/xmlFiscalService';
import { listarCarteiras } from '../services/carteiraService';

type Contato = { para: string; empresa: string; cnpj: string; contato: string; selecionado: boolean; carteira?: string[] };
type Modelo = { id?: string; nome: string; canal: string; variaveis: string[] };
type Previa = { para: string; assunto?: string; corpo: string; html?: string };
type Lote = { id: string; nome: string; quantidade: number; status: string; criadoEm: string };
type Api = (path: string, body?: unknown) => Promise<any>;
const campo = 'w-full rounded border border-slate-300 dark:border-slate-600 p-2 bg-white dark:bg-slate-900';
const botao = 'rounded border px-3 py-2 disabled:opacity-50';
const emailOk = (s: string) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(s);
const auto = ['cliente','empresa','cnpj','contato'];
export default function ComunicacaoLote({ departamento, modelos, api, atualizar }: { departamento: string; modelos: Modelo[]; api: Api; atualizar: () => Promise<void> }) {
    const [contatos,setContatos] = useState<Contato[]>([]);
    const [carteira,setCarteira] = useState('');
    const [modeloId,setModeloId] = useState('');
    const [inicio,setInicio] = useState('');
    const [fim,setFim] = useState('');
    const [recorrencia,setRecorrencia] = useState('unica');
    const [valores,setValores] = useState<Record<string,string>>({});
    const [revisaoConferida,setRevisaoConferida] = useState<number|null>(null);
    const [previas,setPrevias] = useState<Previa[]>([]);
    const [lotes,setLotes] = useState<Lote[]>([]);
    const [texto,setTexto] = useState('');
    const [aviso,setAviso] = useState('');
    const [erro,setErro] = useState('');
    const [ocupado,setOcupado] = useState(false);
    const pedido = useRef(crypto.randomUUID());
    const modelo = modelos.find(m=>m.id===modeloId);
    const visiveis = contatos.map((c,i)=>({c,i})).filter(({c})=>!carteira||c.carteira?.includes(carteira));
    const escolhidos = contatos.filter(c=>c.selecionado);
    const valido = (c: Contato) => modelo?.canal==='whatsapp' ? /^\+?\d{10,15}$/.test(c.para) : emailOk(c.para);
    const invalidos = escolhidos.filter(c=>!valido(c)).length;
    const payload = () => ({ modeloId, modeloRevisao:revisaoConferida, inicio, fim:recorrencia==='unica'?'':fim, recorrencia, valores, contatos:escolhidos.map(({para,cnpj,empresa,contato})=>({para,cnpj,empresa,contato})), pedidoId:pedido.current });
    const invalidar = () => { setPrevias([]); setRevisaoConferida(null); pedido.current=crypto.randomUUID(); };
    const carregarLotes = async () => { const d=await api('/lotes?departamento='+departamento);setLotes(d.lotes);if(d.truncado)setAviso('Mostrando os primeiros 200 lotes. Os agendamentos continuam disponíveis na lista individual.'); };
    useEffect(()=>{void carregarLotes().catch(e=>setErro(e.message));},[departamento]);
    const executar = async (fn:()=>Promise<void>) => {if(ocupado)return;setOcupado(true);setErro('');setAviso('');try{await fn();}catch(e){setErro(e instanceof Error?e.message:'Falha ao concluir.');}finally{setOcupado(false);}};
    const adicionar = (novos: Omit<Contato,'selecionado'>[]) => {invalidar();setContatos(prev=>[...prev,...novos.map(c=>({...c,selecionado:false}))]);};
    const carregarBase = async () => {
        const user=getCurrentUser(); const [empresas,vinculos]=await Promise.all([getEmpresasParaPerfilCliente(user),listarCarteiras(user)]);
        adicionar(empresas.flatMap(e=>(e.email?.split(/[;,\n]+/).filter(Boolean)||['']).map(para=>({para:para.trim(),empresa:e.nome,cnpj:e.cnpj,contato:'',carteira:[...new Set(vinculos.filter(v=>v.empresaId===e.id).map(v=>v.colaboradorNome))]}))));
        setAviso('Empresas carregadas. Filtre a carteira, confira os contatos e selecione os destinatários.');
    };
    const importar = async (file: File) => {
        const XLSX=await import('xlsx'); const wb=XLSX.read(await file.arrayBuffer(),{type:'array'}); const sheet=wb.Sheets[wb.SheetNames[0]!];
        if(!sheet)throw new Error('Planilha vazia.');
        const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:'',raw:false});
        const chave=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z]/g,'');
        const novos=rows.flatMap(r=>{const d=Object.fromEntries(Object.entries(r).map(([k,v])=>[chave(k),String(v||'')]));return String(d.email||d.destinatario||d.telefone||'').split(/[;,\n]+/).map(para=>({para:para.trim(),cnpj:d.cnpj||'',empresa:d.empresa||d.razaosocial||'',contato:d.contato||d.nome||''}));});
        if(!novos.length)throw new Error('Use colunas empresa, CNPJ, contato e email (ou telefone).');adicionar(novos);
    };
    return <section className="border rounded-xl p-4 space-y-3" aria-label="Agendamento em lote">
        <h4 className="font-bold">Agendamento em lote</h4><p className="text-sm">Selecione clientes ou importe Excel/CSV com empresa, CNPJ, contato e email (ou telefone para WhatsApp). Cada cliente recebe sua mensagem individualmente. Até 400 contatos por lote; a ativação exige revisão. Os envios são processados gradualmente a partir do horário escolhido.</p>
        {erro&&<p role="alert" className="text-red-700">{erro}</p>}{aviso&&<p role="status">{aviso}</p>}
        <fieldset disabled={ocupado} className="space-y-3">
        <div className="flex flex-wrap gap-2"><button className={botao} onClick={()=>executar(carregarBase)}>Carregar empresas e contatos cadastrados</button><button className={botao} onClick={()=>executar(async()=>{const d=await api('/contatos?departamento='+departamento);adicionar(d.contatos);if(d.truncado)setAviso('Base limitada a 2.000 contatos nesta consulta.');})}>Carregar base de comunicação</button><label className={botao}>Importar planilha<input aria-label="Importar contatos" type="file" accept=".xlsx,.xls,.csv" onChange={e=>{const f=e.target.files?.[0];if(f)void executar(()=>importar(f));e.target.value='';}} /></label></div>
        <label className="block">Colar e-mails ou telefones, separados por linha, vírgula ou ponto e vírgula<textarea className={campo} value={texto} onChange={e=>setTexto(e.target.value)} /></label><button className={botao} onClick={()=>{adicionar(texto.split(/[;,\n]+/).filter(s=>s.trim()).map(para=>({para:para.trim(),empresa:'',cnpj:'',contato:''})));setTexto('');}}>Adicionar destinatários</button>
        <label className="block">Modelo<select className={campo} value={modeloId} onChange={e=>{setModeloId(e.target.value);setValores({});invalidar();}}><option value="">Selecione</option>{modelos.map(m=><option key={m.id} value={m.id}>{m.nome} ({m.canal})</option>)}</select></label>
        <label className="block">Filtrar carteira<select className={campo} value={carteira} onChange={e=>setCarteira(e.target.value)}><option value="">Todas</option>{[...new Set(contatos.flatMap(c=>c.carteira||[]))].sort().map(c=><option key={c}>{c}</option>)}</select></label>
        <div className="flex gap-2"><button className={botao} onClick={()=>{invalidar();const ids=new Set(visiveis.map(x=>x.i));setContatos(cs=>cs.map((c,i)=>({...c,selecionado:ids.has(i)})));}}>Selecionar somente visíveis</button><button className={botao} onClick={()=>{invalidar();setContatos(cs=>cs.map(c=>({...c,selecionado:false})));}}>Desmarcar todos</button><button className={botao} onClick={()=>{invalidar();setContatos([]);}}>Limpar lista</button></div>
        <div className="max-h-80 overflow-auto"><table className="w-full text-sm"><thead><tr><th>Enviar</th><th>Empresa</th><th>CNPJ</th><th>Contato</th><th>Destinatário</th></tr></thead><tbody>{visiveis.map(({c,i})=><tr key={i}><td><input aria-label={'Selecionar '+(c.empresa||c.para||i)} type="checkbox" checked={c.selecionado} onChange={e=>{invalidar();setContatos(cs=>cs.map((x,j)=>j===i?{...x,selecionado:e.target.checked}:x));}} /></td>{(['empresa','cnpj','contato','para'] as const).map(k=><td key={k}><input aria-label={k+' linha '+(i+1)} className={campo+(k==='para'&&!valido(c)?' border-red-500':'')} value={c[k]} onChange={e=>{invalidar();setContatos(cs=>cs.map((x,j)=>j===i?{...x,[k]:e.target.value}:x));}} /></td>)}</tr>)}</tbody></table></div>
        <p>{escolhidos.length} selecionados · {invalidos} destinatários inválidos. Duplicados da mesma empresa serão unificados na prévia.</p>
        <button className={botao} disabled={!escolhidos.length||!!invalidos||modelo?.canal==='whatsapp'} onClick={()=>executar(async()=>{const d=await api('/contatos',{departamento,contatos:payload().contatos});setAviso(`${d.quantidade} contatos salvos na base de comunicação deste departamento. O cadastro fiscal das empresas não foi alterado.`);})}>Salvar contatos na base de comunicação</button>
        <div className="grid sm:grid-cols-3 gap-3"><label>Primeiro envio — Brasília<input type="datetime-local" className={campo} value={inicio} onChange={e=>{setInicio(e.target.value);invalidar();}} /></label><label>Repetição<select className={campo} value={recorrencia} onChange={e=>{setRecorrencia(e.target.value);invalidar();}}><option value="unica">Uma vez</option><option value="diaria">Diária</option><option value="semanal">Semanal</option><option value="mensal">Mensal</option></select></label>{recorrencia!=='unica'&&<label>Até — Brasília<input type="datetime-local" className={campo} value={fim} onChange={e=>{setFim(e.target.value);invalidar();}} /></label>}</div>
        <p className="text-sm">As variáveis cliente, empresa, CNPJ e contato são preenchidas por destinatário. Outras variáveis abaixo valem para todo o lote e permanecem fixas nas repetições.</p>
        {modelo?.variaveis.filter(k=>!auto.includes(k)).map(k=><label key={k} className="block">{k}<input className={campo} value={valores[k]||''} onChange={e=>{setValores(v=>({...v,[k]:e.target.value}));invalidar();}} /></label>)}
        <button className={botao} disabled={!modelo||!escolhidos.length||!!invalidos} onClick={()=>executar(async()=>{const d=await api('/lotes/previa',payload());setPrevias(d.previas);setRevisaoConferida(d.revisao);setAviso(`${d.previas.length} mensagens individuais; ${d.duplicados} duplicados removidos. Confira antes de salvar.`);})}>Conferir mensagens do lote</button>
        {previas.length>0&&<><div className="max-h-80 overflow-auto">{previas.map((p,i)=><details key={i} className="border p-2"><summary>{p.para} — {p.assunto||modelo?.nome}</summary>{p.html?<iframe title={'Mensagem '+(i+1)} sandbox="" srcDoc={p.html} className="w-full h-64"/>:<pre className="whitespace-pre-wrap">{p.corpo}</pre>}</details>)}</div><button className={botao} onClick={()=>executar(async()=>{const d=await api('/lotes',payload());invalidar();await carregarLotes();await atualizar();setAviso(`Lote salvo pausado: ${d.quantidade} mensagens. Ative o lote abaixo para autorizar os envios.`);})}>Salvar lote pausado</button></>}
        </fieldset>
        <h4 className="font-bold">Lotes salvos</h4>{lotes.map(l=><div className="border rounded p-3" key={l.id}><b>{l.nome}</b><p>{l.quantidade} mensagens · última ação do lote: {l.status}. Confira a execução de cada destinatário no histórico.</p><div className="flex gap-2">{(['ativo','pausado','cancelado'] as const).map(status=><button className={botao} key={status} disabled={ocupado||l.status==='cancelado'} onClick={()=>executar(async()=>{if(status==='ativo'&&!window.confirm(`Autorizar os envios individuais deste lote (${l.quantidade} destinatários), conforme as mensagens e datas conferidas?`))return;await api('/lotes/'+l.id+'/estado',{status});await carregarLotes();await atualizar();setAviso('Lote atualizado.');})}>{status==='ativo'?'Ativar lote':status==='pausado'?'Pausar lote':'Cancelar lote'}</button>)}</div></div>)}
    </section>;
}
