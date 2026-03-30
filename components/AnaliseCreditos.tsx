import React, { useState, useCallback } from 'react';

type Regime = 'LUCRO_REAL' | 'LUCRO_PRESUMIDO' | 'SIMPLES';
type TipoNota = 'PRODUTO' | 'SERVICO';
type TipoResultado = 'APROVADO' | 'PARCIAL' | 'NEGADO' | 'REVISAR';

interface PerfilCliente { regime: Regime; uf: string; aliqInternaIcms?: number; }
interface NotaManual {
  numero: string; emitente: string; cfop: string; cst: string; natureza: string;
  valorTotal: string; baseCalculo: string; valorIcms: string; aliquotaIcms: string; tipo: TipoNota;
}
interface DetalheNota {
  tipo: TipoResultado; creditoPIS?: number; creditoCOFINS?: number; creditoIcms?: number;
  observacao: string; fundamentoLegal: string; avisos: string[];
}
interface ResultadoAnalise {
  totais: { creditoPIS: number; creditoCOFINS: number; creditoIcms: number; creditoTotal: number; notasAnalisadas: number;
    resumo: { pisCofins: { totalAprovado:number; totalParcial:number; totalNegado:number; totalRevisar:number };
               icms:     { totalAprovado:number; totalParcial:number; totalNegado:number; totalRevisar:number }; }; };
  detalhes: Array<{ nota: Record<string,unknown>; pisCofins: DetalheNota|null; icms: DetalheNota|null }>;
  alertas: Array<{ nivel: string; mensagem: string }>;
}

const REGIMES = [
  { value: 'LUCRO_REAL' as Regime, label: 'Lucro Real (Não Cumulativo)' },
  { value: 'LUCRO_PRESUMIDO' as Regime, label: 'Lucro Presumido (Cumulativo)' },
  { value: 'SIMPLES' as Regime, label: 'Simples Nacional' },
];
const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];
const NOTA_VAZIA: NotaManual = { numero:'', emitente:'', cfop:'', cst:'', natureza:'', valorTotal:'', baseCalculo:'', valorIcms:'', aliquotaIcms:'', tipo:'PRODUTO' };
const API_BASE = '';

const BadgeTipo: React.FC<{tipo: TipoResultado}> = ({ tipo }) => {
  const cfg = {
    APROVADO: { bg:'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200', label:'✅ Aprovado' },
    PARCIAL:  { bg:'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200', label:'⚠️ Parcial' },
    NEGADO:   { bg:'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200', label:'❌ Negado' },
    REVISAR:  { bg:'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200', label:'🔍 Revisar' },
  };
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg[tipo].bg}`}>{cfg[tipo].label}</span>;
};

const CardTotal: React.FC<{label:string; valor:number; cor:string}> = ({ label, valor, cor }) => (
  <div className={`rounded-xl p-4 ${cor} flex flex-col gap-1`}>
    <span className="text-xs font-medium opacity-75">{label}</span>
    <span className="text-xl font-bold">R$ {valor.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span>
  </div>
);

const AnaliseCreditos: React.FC = () => {
  const [aba, setAba] = useState<'manual'|'upload'>('manual');
  const [perfil, setPerfil] = useState<PerfilCliente>({ regime:'LUCRO_REAL', uf:'SP' });
  const [notas, setNotas] = useState<NotaManual[]>([{...NOTA_VAZIA}]);
  const [arquivo, setArquivo] = useState<File|null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string|null>(null);
  const [resultado, setResultado] = useState<ResultadoAnalise|null>(null);

  const setPerfilField = (f: keyof PerfilCliente, v: string|number) => setPerfil(p => ({...p,[f]:v}));
  const setNotaField = (idx:number, f:keyof NotaManual, v:string) => setNotas(p => p.map((n,i) => i===idx ? {...n,[f]:v} : n));
  const addNota = () => setNotas(p => [...p, {...NOTA_VAZIA}]);
  const removeNota = (idx:number) => setNotas(p => p.filter((_,i) => i!==idx));

  const analisarManual = useCallback(async () => {
    setErro(null); setResultado(null); setLoading(true);
    try {
      const notasNorm = notas.map(n => ({...n, valorTotal:parseFloat(n.valorTotal.replace(',','.'))||0, baseCalculo:parseFloat(n.baseCalculo.replace(',','.'))||0, valorIcms:parseFloat(n.valorIcms.replace(',','.'))||0, aliquotaIcms:parseFloat(n.aliquotaIcms.replace(',','.'))||0 }));
      const res = await fetch(`${API_BASE}/api/analise-creditos/manual`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({notas:notasNorm, perfilCliente:perfil}) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro||'Erro na análise');
      setResultado(data.resultado);
    } catch(e:unknown) { setErro(e instanceof Error ? e.message : 'Erro'); }
    finally { setLoading(false); }
  }, [notas, perfil]);

  const analisarUpload = useCallback(async () => {
    if (!arquivo) return;
    setErro(null); setResultado(null); setLoading(true);
    try {
      const fd = new FormData(); fd.append('arquivo', arquivo); fd.append('perfil', JSON.stringify(perfil));
      const res = await fetch(`${API_BASE}/api/analise-creditos/upload`, { method:'POST', body:fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro||'Erro no upload');
      setResultado(data.resultado);
    } catch(e:unknown) { setErro(e instanceof Error ? e.message : 'Erro'); }
    finally { setLoading(false); }
  }, [arquivo, perfil]);

  const inp = "w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400";

  return (
    <div className="space-y-6 pb-10">
      <div>
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Análise de Créditos Fiscais</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Determine o aproveitamento de créditos de PIS/COFINS, ICMS e ISS por nota fiscal</p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
        <h3 className="font-semibold text-gray-700 dark:text-gray-200 mb-4">📋 Perfil do Cliente</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div><label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Regime *</label>
            <select value={perfil.regime} onChange={e=>setPerfilField('regime',e.target.value)} className={inp}>
              {REGIMES.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">UF *</label>
            <select value={perfil.uf} onChange={e=>setPerfilField('uf',e.target.value)} className={inp}>
              {UFS.map(uf=><option key={uf} value={uf}>{uf}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Alíq. ICMS (%)</label>
            <input type="number" placeholder="Ex: 18" onChange={e=>setPerfilField('aliqInternaIcms',parseFloat(e.target.value)/100)} className={inp}/></div>
        </div>
      </div>

      <div className="flex gap-2">
        {(['manual','upload'] as const).map(a=>(
          <button key={a} onClick={()=>setAba(a)} className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${aba===a?'bg-teal-600 text-white shadow':'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600'}`}>
            {a==='manual'?'✏️ Digitação Manual':'📂 Upload Excel/XML'}
          </button>
        ))}
      </div>

      {aba==='manual' && (
        <div className="space-y-4">
          {notas.map((nota,idx)=>(
            <div key={idx} className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex justify-between items-center mb-4">
                <span className="font-semibold text-gray-700 dark:text-gray-200 text-sm">Nota #{idx+1}</span>
                {notas.length>1 && <button onClick={()=>removeNota(idx)} className="text-xs text-red-500 hover:text-red-700">✕ Remover</button>}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[{f:'numero',l:'Número NF',p:'001'},{f:'emitente',l:'Emitente',p:'Razão Social'},{f:'cfop',l:'CFOP *',p:'1101'},{f:'cst',l:'CST/CSOSN',p:'50'},{f:'natureza',l:'Natureza',p:'Compra p/ revenda'},{f:'valorTotal',l:'Valor Total *',p:'10000,00'},{f:'baseCalculo',l:'Base PIS/COF',p:'10000,00'},{f:'valorIcms',l:'Valor ICMS',p:'1800,00'},{f:'aliquotaIcms',l:'Alíq. ICMS %',p:'18'}].map(({f,l,p})=>(
                  <div key={f}><label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{l}</label>
                    <input value={nota[f as keyof NotaManual]} placeholder={p} onChange={e=>setNotaField(idx,f as keyof NotaManual,e.target.value)} className={inp}/></div>
                ))}
                <div><label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Tipo</label>
                  <select value={nota.tipo} onChange={e=>setNotaField(idx,'tipo',e.target.value)} className={inp}>
                    <option value="PRODUTO">Produto</option><option value="SERVICO">Serviço</option>
                  </select></div>
              </div>
            </div>
          ))}
          <div className="flex gap-3">
            <button onClick={addNota} className="px-4 py-2 rounded-xl border border-dashed border-teal-400 text-teal-600 dark:text-teal-400 text-sm hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-all">+ Adicionar Nota</button>
            <button onClick={analisarManual} disabled={loading} className="px-6 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm disabled:opacity-50">{loading?'Analisando...':'🔍 Analisar Créditos'}</button>
          </div>
        </div>
      )}

      {aba==='upload' && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">Envie planilha Excel/CSV ou XML de NF-e. Colunas: <strong>CFOP, CST, Valor Total, Valor ICMS</strong></p>
          <div onClick={()=>document.getElementById('input-arquivo')?.click()} className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center cursor-pointer hover:border-teal-400 transition-all">
            <div className="text-4xl mb-2">📂</div>
            <p className="text-sm text-gray-500 dark:text-gray-400">{arquivo?arquivo.name:'Clique para selecionar .xlsx, .csv ou .xml'}</p>
          </div>
          <input id="input-arquivo" type="file" accept=".xlsx,.xls,.csv,.xml" className="hidden" onChange={e=>setArquivo(e.target.files?.[0]||null)}/>
          <button onClick={analisarUpload} disabled={!arquivo||loading} className="px-6 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm disabled:opacity-50">{loading?'Processando...':'🔍 Analisar Arquivo'}</button>
        </div>
      )}

      {erro && <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-700 dark:text-red-300">⚠️ {erro}</div>}

      {resultado && (
        <div className="space-y-6">
          {resultado.alertas.length>0 && <div className="space-y-2">{resultado.alertas.map((a,i)=>(
            <div key={i} className={`text-sm px-4 py-3 rounded-xl ${a.nivel==='ATENCAO'?'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 border border-yellow-200 dark:border-yellow-700':'bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-700'}`}>
              {a.nivel==='ATENCAO'?'⚠️':'ℹ️'} {a.mensagem}
            </div>
          ))}</div>}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <CardTotal label="Crédito PIS"    valor={resultado.totais.creditoPIS}    cor="bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-100"/>
            <CardTotal label="Crédito COFINS" valor={resultado.totais.creditoCOFINS} cor="bg-purple-50 dark:bg-purple-900/30 text-purple-800 dark:text-purple-100"/>
            <CardTotal label="Crédito ICMS"   valor={resultado.totais.creditoIcms}   cor="bg-orange-50 dark:bg-orange-900/30 text-orange-800 dark:text-orange-100"/>
            <CardTotal label="Crédito Total"  valor={resultado.totais.creditoTotal}  cor="bg-teal-50 dark:bg-teal-900/30 text-teal-800 dark:text-teal-100"/>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
            <h3 className="font-semibold text-gray-700 dark:text-gray-200 mb-3 text-sm">Resumo por Tributo</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {[{label:'PIS/COFINS',t:resultado.totais.resumo.pisCofins},{label:'ICMS',t:resultado.totais.resumo.icms}].map(({label,t})=>(
                <div key={label}><p className="font-medium text-gray-600 dark:text-gray-300 mb-2">{label}</p>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-green-600">✅ Aprovado</span><span>{t.totalAprovado}</span></div>
                    <div className="flex justify-between"><span className="text-yellow-600">⚠️ Parcial</span><span>{t.totalParcial}</span></div>
                    <div className="flex justify-between"><span className="text-red-600">❌ Negado</span><span>{t.totalNegado}</span></div>
                    <div className="flex justify-between"><span className="text-blue-600">🔍 Revisar</span><span>{t.totalRevisar}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="p-5 border-b border-gray-100 dark:border-gray-700">
              <h3 className="font-semibold text-gray-700 dark:text-gray-200 text-sm">Detalhes por Nota ({resultado.totais.notasAnalisadas} notas)</h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {resultado.detalhes.map((d,idx)=>(
                <div key={idx} className="p-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <div><span className="font-medium text-gray-700 dark:text-gray-200 text-sm">{String(d.nota.emitente||`Nota ${d.nota.numero||idx+1}`)}</span>
                      <span className="ml-2 text-xs text-gray-400">CFOP {String(d.nota.cfop||'')}</span></div>
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">R$ {Number(d.nota.valorTotal||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[{label:'PIS/COFINS',det:d.pisCofins},{label:'ICMS',det:d.icms}].map(({label,det})=>det&&(
                      <div key={label} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 text-xs space-y-1">
                        <div className="flex justify-between items-center"><span className="font-medium text-gray-600 dark:text-gray-300">{label}</span><BadgeTipo tipo={det.tipo}/></div>
                        {label==='PIS/COFINS'&&(det.creditoPIS||0)>0&&<div className="text-green-600 dark:text-green-400">PIS: R$ {(det.creditoPIS||0).toFixed(2)} | COFINS: R$ {(det.creditoCOFINS||0).toFixed(2)}</div>}
                        {label==='ICMS'&&(det.creditoIcms||0)>0&&<div className="text-green-600 dark:text-green-400">ICMS: R$ {(det.creditoIcms||0).toFixed(2)}</div>}
                        <p className="text-gray-500 dark:text-gray-400">{det.observacao}</p>
                        <p className="text-gray-400 italic">{det.fundamentoLegal}</p>
                        {det.avisos.map((av,i)=><p key={i} className="text-yellow-600 dark:text-yellow-400">⚠️ {av}</p>)}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnaliseCreditos;
