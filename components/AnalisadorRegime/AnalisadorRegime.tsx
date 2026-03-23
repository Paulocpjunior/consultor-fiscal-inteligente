import React, { useState, useCallback } from 'react';
import { analisarRegimes, type EntradaCalculo, type ResultadoAnalise, type ResultadoRegime, type AtividadeTipo, type RegimeTipo } from '../../services/analisadorRegimeService';

const fmt = (v:number) => v.toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2});
const fmtP = (v:number) => v.toFixed(2)+'%';

const ATIV_LABELS:Record<AtividadeTipo,string> = {
  comercio:'Comercio (Anexo I)',industria:'Industria (Anexo II)',
  servicos_simples:'Servicos - Educacao/Saude/Academia (Anexo III)',
  servicos_fator_r:'Servicos - Fator R (Anexo III ou V)',
  servicos_especiais:'Servicos - TI/Consultoria (Anexo V)',
  servicos_gerais:'Servicos em Geral (Anexo IV)'
};

const CORES:Record<RegimeTipo,string> = {simples:'#22c55e',presumido:'#3b82f6',real:'#a855f7'};

const AnalisadorRegime:React.FC = () => {
  const [ent,setEnt] = useState<EntradaCalculo>({receitaBrutaMensal:50000,receitaBrutaAcumulada12:600000,folhaPagamentoMensal:15000,custosMercadorias:20000,despesasDedutiveis:8000,creditosPisCofins:0,atividade:'servicos_simples',issAliquota:2,temImportacao:false});
  const [res,setRes] = useState<ResultadoAnalise|null>(null);
  const [ia,setIa] = useState('');
  const [iaLoad,setIaLoad] = useState(false);
  const [exp,setExp] = useState<RegimeTipo|null>(null);

  const set = (k:keyof EntradaCalculo,v:string|AtividadeTipo) =>
    setEnt(p=>({...p,[k]:k==='atividade'?v:parseFloat(String(v))||0}));

  const calcular = () => setRes(analisarRegimes(ent));

  const analisarIA = useCallback(async () => {
    if(!res) return;
    setIaLoad(true); setIa('');
    const prompt = `Voce e um especialista tributario brasileiro. Analise estes resultados e forneca consultoria objetiva (max 220 palavras):\n\nEmpresa: ${ATIV_LABELS[ent.atividade]}\nReceita Mensal: ${fmt(ent.receitaBrutaMensal)}\nReceita 12m: ${fmt(ent.receitaBrutaAcumulada12)}\nFolha: ${fmt(ent.folhaPagamentoMensal)}\n\nResultados:\n${res.resultados.map(r=>`- ${r.label}: ${fmt(r.impostoMensal)}/mes (${fmtP(r.aliquotaEfetiva)})${r.recomendado?' <- MENOR CARGA':''}`).join('\n')}\n\nEconomia potencial: ${fmt(res.economiaAnual)}/ano\n\nForneca: 1) Confirmacao ou ressalvas sobre o regime recomendado 2) Riscos especificos 3) Oportunidades de planejamento 4) Impacto da Reforma Tributaria CBS/IBS`;
    try {
      const r = await fetch('/api/gemini',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt})});
      const d = await r.json();
      setIa(d.candidates?.[0]?.content?.parts?.[0]?.text || d.text || d.response || 'Sem resposta da IA.');
    } catch { setIa('Erro ao conectar com a IA.'); }
    finally { setIaLoad(false); }
  },[res,ent]);

  const inp = (label:string,k:keyof EntradaCalculo,hint?:string) => (
    <div style={{display:'flex',flexDirection:'column',gap:3}}>
      <label style={{fontSize:11,fontWeight:600,color:'#94a3b8',textTransform:'uppercase',letterSpacing:.4}}>{label}</label>
      <input type="number" value={ent[k] as number} min={0} step={100}
        onChange={e=>set(k,e.target.value)}
        style={{background:'rgba(255,255,255,.06)',border:'1px solid rgba(255,255,255,.12)',borderRadius:8,padding:'9px 12px',color:'#f1f5f9',fontSize:14,outline:'none'}}/>
      {hint&&<span style={{fontSize:10,color:'#64748b'}}>{hint}</span>}
    </div>
  );

  return (
    <div style={{background:'linear-gradient(135deg,#0f172a,#1e1b4b)',borderRadius:16,padding:28,color:'#e2e8f0',fontFamily:'system-ui,sans-serif',maxWidth:900,margin:'0 auto'}}>
      <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:24,paddingBottom:18,borderBottom:'1px solid rgba(255,255,255,.08)'}}>
        <div style={{fontSize:32,width:52,height:52,borderRadius:14,background:'rgba(139,92,246,.2)',display:'flex',alignItems:'center',justifyContent:'center'}}>⚖️</div>
        <div>
          <h2 style={{margin:0,fontSize:20,fontWeight:700,color:'#f1f5f9'}}>Analisador de Regime Tributario</h2>
          <p style={{margin:'3px 0 0',fontSize:13,color:'#94a3b8'}}>Compare Simples Nacional, Lucro Presumido e Lucro Real com IA</p>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:14,marginBottom:18}}>
        <div style={{gridColumn:'1/-1',display:'flex',flexDirection:'column',gap:3}}>
          <label style={{fontSize:11,fontWeight:600,color:'#94a3b8',textTransform:'uppercase',letterSpacing:.4}}>Tipo de Atividade</label>
          <select value={ent.atividade} onChange={e=>set('atividade',e.target.value as AtividadeTipo)}
            style={{background:'rgba(255,255,255,.06)',border:'1px solid rgba(255,255,255,.12)',borderRadius:8,padding:'9px 12px',color:'#f1f5f9',fontSize:13,outline:'none'}}>
            {Object.entries(ATIV_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {inp('Receita Bruta Mensal (R$)','receitaBrutaMensal','Faturamento bruto do mes')}
        {inp('Receita Acumulada 12m (R$)','receitaBrutaAcumulada12','Base de calculo do Simples')}
        {inp('Folha de Pagamento (R$)','folhaPagamentoMensal','Salarios + encargos patronais')}
        {inp('Custos / CMV (R$)','custosMercadorias','Deducao no Lucro Real')}
        {inp('Despesas Operacionais (R$)','despesasDedutiveis','Aluguel, energia, servicos')}
        {inp('Creditos PIS/COFINS (R$)','creditosPisCofins','Entradas com direito a credito')}
        {inp('ISS Municipal (%)','issAliquota','Entre 2% e 5%')}
      </div>

      <button onClick={calcular} style={{width:'100%',padding:'13px 0',background:'linear-gradient(135deg,#6d28d9,#4f46e5)',border:'none',borderRadius:10,color:'#fff',fontSize:15,fontWeight:700,cursor:'pointer',marginBottom:24}}>
        Calcular Melhor Regime
      </button>

      {res && <>
        <div style={{background:'linear-gradient(135deg,#065f46,#064e3b)',border:'1px solid #10b981',borderRadius:12,padding:'14px 20px',display:'flex',alignItems:'center',gap:14,flexWrap:'wrap',marginBottom:16}}>
          <span style={{color:'#6ee7b7',fontSize:13,flex:1}}>Economia potencial com regime otimo</span>
          <span style={{color:'#10b981',fontSize:24,fontWeight:800}}>{fmt(res.economiaAnual)}/ano</span>
          <span style={{background:'rgba(16,185,129,.15)',border:'1px solid #10b981',borderRadius:20,padding:'4px 12px',color:'#34d399',fontSize:12,fontWeight:700}}>{fmtP(res.percentualEconomia)} reducao</span>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:14,marginBottom:16}}>
          {res.resultados.map(r=>(
            <div key={r.regime} style={{background:`${CORES[r.regime]}10`,border:`${r.recomendado?'2px':'1px'} solid ${r.recomendado?CORES[r.regime]:'rgba(255,255,255,.1)'}`,borderRadius:12,padding:'16px 15px',position:'relative',boxShadow:r.recomendado?`0 0 18px ${CORES[r.regime]}40`:'none'}}>
              {r.recomendado&&<div style={{position:'absolute',top:-10,right:10,background:CORES[r.regime],color:'#fff',borderRadius:20,fontSize:10,fontWeight:700,padding:'3px 10px'}}>MENOR CARGA</div>}
              <div style={{fontSize:11,color:'#94a3b8',textTransform:'uppercase',letterSpacing:.4,marginBottom:5}}>{r.label}</div>
              <div style={{fontSize:26,fontWeight:800,color:'#f1f5f9',lineHeight:1}}>{fmt(r.impostoMensal)}<span style={{fontSize:13,fontWeight:400,color:'#64748b'}}>/mes</span></div>
              <div style={{fontSize:12,color:'#94a3b8',marginTop:4,marginBottom:10}}>Aliquota efetiva: <strong>{fmtP(r.aliquotaEfetiva)}</strong></div>
              <button onClick={()=>setExp(exp===r.regime?null:r.regime)} style={{width:'100%',padding:'5px 10px',background:'rgba(255,255,255,.06)',border:'1px solid rgba(255,255,255,.1)',borderRadius:6,color:'#94a3b8',fontSize:11,cursor:'pointer'}}>
                {exp===r.regime?'Ocultar detalhes':'Ver detalhamento'}
              </button>
              {exp===r.regime&&<div style={{marginTop:10,borderTop:'1px solid rgba(255,255,255,.06)',paddingTop:10}}>
                {Object.entries(r.detalhamento).map(([k,v])=>(
                  <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:12,color:'#cbd5e1',padding:'2px 0'}}><span>{k}</span><span>{fmt(v as number)}</span></div>
                ))}
                {r.observacoes.map((o,i)=><p key={i} style={{fontSize:11,color:'#94a3b8',margin:'4px 0 0',lineHeight:1.5}}>{o}</p>)}
              </div>}
            </div>
          ))}
        </div>

        {res.alertas.length>0&&<div style={{background:'rgba(245,158,11,.08)',border:'1px solid rgba(245,158,11,.3)',borderRadius:10,padding:'12px 16px',marginBottom:16,fontSize:13,color:'#fcd34d'}}>
          <strong>Alertas</strong>
          {res.alertas.map((a,i)=><p key={i} style={{margin:'5px 0 0',color:'#fde68a',fontSize:12}}>{a}</p>)}
        </div>}

        <div style={{background:'rgba(255,255,255,.03)',borderRadius:12,padding:'16px 18px',border:'1px solid rgba(255,255,255,.06)',marginBottom:16}}>
          <div style={{fontSize:12,color:'#94a3b8',marginBottom:12}}>Comparativo visual</div>
          {res.resultados.map(r=>{const mx=Math.max(...res.resultados.map(x=>x.impostoMensal));return(
            <div key={r.regime} style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
              <span style={{width:130,fontSize:12,color:'#94a3b8'}}>{r.label}</span>
              <div style={{flex:1,height:6,background:'rgba(255,255,255,.08)',borderRadius:3,overflow:'hidden'}}>
                <div style={{width:`${mx>0?(r.impostoMensal/mx)*100:0}%`,height:'100%',background:CORES[r.regime],borderRadius:3,transition:'width .6s ease'}}/>
              </div>
              <span style={{width:105,fontSize:12,color:'#e2e8f0',textAlign:'right'}}>{fmt(r.impostoMensal)}</span>
            </div>
          );})}
        </div>

        <button onClick={analisarIA} disabled={iaLoad} style={{width:'100%',padding:'11px 0',background:'linear-gradient(135deg,#1e3a5f,#1e40af)',border:'1px solid #3b82f6',borderRadius:10,color:'#93c5fd',fontSize:13,fontWeight:700,cursor:'pointer',marginBottom:12}}>
          {iaLoad?'Analisando com IA...':'Analise Detalhada com IA (Gemini)'}
        </button>
        {ia&&<div style={{background:'rgba(59,130,246,.06)',border:'1px solid rgba(59,130,246,.2)',borderRadius:12,padding:'16px 18px'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,color:'#93c5fd',fontSize:13,fontWeight:700,marginBottom:10}}>🤖 Consultoria Tributaria — Gemini AI</div>
          <p style={{fontSize:14,color:'#cbd5e1',lineHeight:1.7,margin:0,whiteSpace:'pre-wrap'}}>{ia}</p>
        </div>}
      </>}
    </div>
  );
};

export default AnalisadorRegime;
