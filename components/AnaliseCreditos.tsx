import React, { useState, useCallback, useEffect } from 'react';
import AnaliseCreditoExtrato from './AnaliseCreditoExtrato';
import type { User } from '../types';
import { getEmpresasParaPerfilCliente, type EmpresaPerfilOption } from '../services/xmlFiscalService';

type Regime = 'LUCRO_REAL_INDUSTRIA' | 'LUCRO_REAL_SERVICOS' | 'LUCRO_REAL_COMERCIO' | 'LUCRO_PRESUMIDO' | 'SIMPLES';
type TipoNota = 'PRODUTO' | 'SERVICO';
type TipoResultado = 'APROVADO' | 'PARCIAL' | 'NEGADO' | 'REVISAR';

interface PerfilCliente { regime: Regime; uf: string; aliqInternaIcms?: number; }

// ─── Tabela de aliquotas internas ICMS 2026 ────────────────────────────────
// Aliquota geral por UF (RICMS). Atencao: cada estado tem excecoes por NCM
// (essenciais como arroz/feijao em SP = 7%, suntuarios = 25-30%, etc).
// Usar como SUGESTAO de partida — contador deve revisar conforme produto.
//
// Fonte: simplifique.contmatic.com.br/blogs/tabela-icms-2026 (10/04/2026)
// e cruzamento com tabelas Conta Azul/SimTax. Inclui FECP/FECOEP quando
// incorporado na aliquota modal divulgada.
//
// IMPORTANTE: revisar anualmente (RJ subiu de 20→22% em 2024; AL 19→20,5%
// em 04/2026; varios estados ajustaram em 2025). Em 2029 o ICMS comeca a
// ser substituido pelo IBS — esta tabela vai precisar de revisao gradual.
const ALIQUOTAS_INTERNAS_ICMS_2026: Record<string, number> = {
  AC: 0.19, AL: 0.205, AM: 0.20, AP: 0.18, BA: 0.205, CE: 0.20,
  DF: 0.20, ES: 0.17, GO: 0.19, MA: 0.23, MG: 0.18, MS: 0.17,
  MT: 0.17, PA: 0.19, PB: 0.20, PE: 0.205, PI: 0.225, PR: 0.195,
  RJ: 0.22, RN: 0.20, RO: 0.195, RR: 0.20, RS: 0.17, SC: 0.17,
  SE: 0.19, SP: 0.18, TO: 0.20,
};

const aliquotaInternaPorUf = (uf?: string): number | undefined => {
  if (!uf) return undefined;
  return ALIQUOTAS_INTERNAS_ICMS_2026[uf.toUpperCase().trim()];
};
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
  { value: 'LUCRO_REAL_INDUSTRIA' as Regime, label: 'Lucro Real — Indústria' },
  { value: 'LUCRO_REAL_SERVICOS' as Regime, label: 'Lucro Real — Prestadora de Serviços' },
  { value: 'LUCRO_REAL_COMERCIO' as Regime, label: 'Lucro Real — Comércio' },
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

interface AnaliseCreditosProps {
  currentUser: User | null;
}

const AnaliseCreditos: React.FC<AnaliseCreditosProps> = ({ currentUser }) => {
  const [aba, setAba] = useState<'manual'|'upload'|'extrato'>('manual');
  const [perfil, setPerfil] = useState<PerfilCliente>({ regime:'LUCRO_REAL_SERVICOS', uf:'SP' });
  const [empresas, setEmpresas] = useState<EmpresaPerfilOption[]>([]);
  const [empresaVinculadaId, setEmpresaVinculadaId] = useState<string>('');
  const [carregandoEmpresas, setCarregandoEmpresas] = useState(false);
  // Rastrea se o usuario digitou a aliq ICMS manualmente — se sim, vincular
  // empresa ou trocar UF NAO sobrescreve. Apagar o campo libera auto de novo.
  const [aliqIcmsManual, setAliqIcmsManual] = useState(false);
  const [notas, setNotas] = useState<NotaManual[]>([{...NOTA_VAZIA}]);
  const [arquivo, setArquivo] = useState<File|null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string|null>(null);
  const [resultado, setResultado] = useState<ResultadoAnalise|null>(null);

  const setPerfilField = (f: keyof PerfilCliente, v: string|number) => setPerfil(p => ({...p,[f]:v}));

  useEffect(() => {
    if (!currentUser) { setEmpresas([]); return; }
    let alive = true;
    setCarregandoEmpresas(true);
    getEmpresasParaPerfilCliente(currentUser)
      .then(list => { if (alive) setEmpresas(list); })
      .finally(() => { if (alive) setCarregandoEmpresas(false); });
    return () => { alive = false; };
  }, [currentUser]);

  const empresaVinculada = empresas.find(e => e.id === empresaVinculadaId);

  const vincularEmpresa = (id: string) => {
    setEmpresaVinculadaId(id);
    const emp = empresas.find(e => e.id === id);
    if (!emp) return;
    const novaUf = emp.uf || '';
    const aliqAuto = aliquotaInternaPorUf(novaUf);
    setPerfil(prev => ({
      ...prev,
      regime: emp.regimeSugerido as Regime,
      uf: novaUf || prev.uf,
      // Preserva valor manual se contador ja digitou. Senao, auto-preenche
      // com a aliquota geral da UF da empresa (RICMS 2026).
      aliqInternaIcms: aliqIcmsManual ? prev.aliqInternaIcms : (aliqAuto ?? prev.aliqInternaIcms),
    }));
  };

  // Trocar UF manualmente (sem vincular empresa) sincroniza a aliquota
  // sugerida, respeitando a regra "manual prevalece".
  const trocarUf = (novaUf: string) => {
    const aliqAuto = aliquotaInternaPorUf(novaUf);
    setPerfil(prev => ({
      ...prev,
      uf: novaUf,
      aliqInternaIcms: aliqIcmsManual ? prev.aliqInternaIcms : (aliqAuto ?? prev.aliqInternaIcms),
    }));
  };

  // Quando o usuario digita no input de aliquota: marca como manual.
  // Se apagar o campo (string vazia), libera o auto-preenchimento de novo.
  const setAliqIcmsManualUser = (raw: string) => {
    if (raw === '' || raw === '0') {
      setAliqIcmsManual(false);
      setPerfil(p => ({...p, aliqInternaIcms: undefined}));
      return;
    }
    setAliqIcmsManual(true);
    const parsed = parseFloat(raw.replace(',', '.'));
    if (!isNaN(parsed)) setPerfil(p => ({...p, aliqInternaIcms: parsed / 100}));
  };

  const limparVinculo = () => {
    setEmpresaVinculadaId('');
  };

  const [exportandoPDF, setExportandoPDF] = useState(false);
  const resultadoRef = React.useRef<HTMLDivElement>(null);
  const exportarCSV = () => {
    if (!resultado) return;
    const rows: string[][] = [["Categoria","Valor","PIS","COFINS","Status"]];
    resultado.detalhes.forEach(d=>{
      const cat=String(d.nota.numero||d.nota.emitente||"");
      const pis=(d.pisCofins?.creditoPIS||0).toFixed(2);
      const cof=(d.pisCofins?.creditoCOFINS||0).toFixed(2);
      const sts=d.pisCofins?.tipo||"";
      const ents=(d.nota.entradas||[]) as any[];
      if(ents.length>0)ents.forEach(e=>rows.push([cat,e.valor.toFixed(2),pis,cof,sts]));
      else rows.push([cat,Number(d.nota.valorTotal||0).toFixed(2),pis,cof,sts]);
    });
    const csv=rows.map(r=>r.map(x=>`"${x}"`).join(";")).join("\r\n");
    const blob=new Blob(["﻿"+csv],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="creditos.csv";a.click();
  };
  const exportarPDF = async () => {
    if (!resultado) return;
    setExportandoPDF(true);
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const W = pdf.internal.pageSize.getWidth();
      const H = pdf.internal.pageSize.getHeight();
      const m = 12;
      const now = new Date().toLocaleDateString('pt-BR');
      const drawHeader = () => {
        pdf.setFillColor(2, 0, 38); pdf.rect(0, 0, W, 16, 'F');
        pdf.setTextColor(255, 255, 255); pdf.setFontSize(11); pdf.setFont('helvetica', 'bold');
        pdf.text('SP Contabil - Analise de Creditos Fiscais (PIS/COFINS/ICMS)', m, 10);
        pdf.setFontSize(8); pdf.setFont('helvetica', 'normal');
        pdf.text('Gerado em: ' + now, W - m - 40, 10);
      };
      drawHeader();
      let y = 24;
      const checkPage = (h: number) => { if (y + h > H - 12) { pdf.addPage(); drawHeader(); y = 24; } };
      const tot = resultado.totais;
      pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(2, 0, 38);
      pdf.text('RESUMO DE CREDITOS FISCAIS', m, y); y += 6;
      const kpis = [
        ['Credito PIS', 'R$ ' + tot.creditoPIS.toLocaleString('pt-BR', { minimumFractionDigits: 2 })],
        ['Credito COFINS', 'R$ ' + tot.creditoCOFINS.toLocaleString('pt-BR', { minimumFractionDigits: 2 })],
        ['Credito ICMS', 'R$ ' + tot.creditoIcms.toLocaleString('pt-BR', { minimumFractionDigits: 2 })],
        ['Credito Total', 'R$ ' + tot.creditoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })],
      ];
      const kW = (W - m * 2) / 4;
      kpis.forEach((k, i) => {
        const x = m + i * kW;
        pdf.setFillColor(240, 245, 255); pdf.rect(x, y - 4, kW - 2, 14, 'F');
        pdf.setFontSize(7); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(80, 80, 80);
        pdf.text(k[0], x + 2, y + 1);
        pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(2, 0, 38);
        pdf.text(k[1], x + 2, y + 7);
      });
      y += 20;
      checkPage(10);
      pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(2, 0, 38);
      pdf.text('DETALHAMENTO POR CATEGORIA E NOTA FISCAL', m, y); y += 2;
      pdf.setDrawColor(200, 200, 200); pdf.line(m, y, W - m, y); y += 5;
      resultado.detalhes.forEach(d => {
        const cat = String(d.nota.numero || d.nota.emitente || '');
        const val = Number(d.nota.valorTotal || 0);
        const pis = d.pisCofins?.creditoPIS || 0;
        const cof = d.pisCofins?.creditoCOFINS || 0;
        const sts = d.pisCofins?.tipo || '';
        const ents = (d.nota.entradas || []) as any[];
        checkPage(16);
        pdf.setFillColor(225, 235, 255); pdf.rect(m, y - 4, W - m * 2, 12, 'F');
        pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(2, 0, 38);
        pdf.text(cat, m + 2, y + 1);
        pdf.setFontSize(8); pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(sts === 'APROVADO' ? 0 : 160, sts === 'APROVADO' ? 130 : 0, 0);
        pdf.text(sts === 'APROVADO' ? 'Aprovado' : sts === 'NEGADO' ? 'Negado' : sts, W - m - 25, y + 1);
        pdf.setTextColor(60, 60, 60);
        pdf.text('Base: R$ ' + val.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + '  |  PIS: R$ ' + pis.toFixed(2) + '  |  COFINS: R$ ' + cof.toFixed(2), m + 2, y + 7);
        y += 14;
        if (ents.length > 0) {
          checkPage(8);
          pdf.setFillColor(245, 245, 245); pdf.rect(m + 2, y - 3, W - m * 2 - 4, 6, 'F');
          pdf.setFontSize(7); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(80, 80, 80);
          pdf.text('NOTA / FATURA', m + 4, y + 1);
          pdf.text('FORNECEDOR', m + 55, y + 1);
          pdf.text('VALOR', W - m - 22, y + 1);
          y += 6;
          ents.forEach((e: any) => {
            checkPage(6);
            pdf.setFont('helvetica', 'normal'); pdf.setTextColor(50, 50, 50);
            const nota = String(e.nota || '-').substring(0, 20);
            const forn = String(e.forn || '-').substring(0, 38);
            const vl = 'R$ ' + Number(e.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
            pdf.text(nota, m + 4, y);
            pdf.text(forn, m + 55, y);
            pdf.text(vl, W - m - 22, y);
            y += 5;
          });
          y += 3;
        }
        pdf.setDrawColor(230, 230, 230); pdf.line(m, y, W - m, y); y += 4;
      });
      pdf.setFontSize(6); pdf.setTextColor(150, 150, 150);
      pdf.text('Classificacao baseada em CFOP e CST. Revise antes de enviar ao cliente.', m, H - 4);
      const blob = pdf.output('blob');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'relatorio_creditos_' + new Date().toISOString().slice(0, 10) + '.pdf';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) { console.error(e); } finally { setExportandoPDF(false); }
  };

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

        <div className="mb-4">
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
            Vincular empresa cadastrada <span className="text-gray-400">(opcional — preenche Regime e UF)</span>
          </label>
          <div className="flex gap-2">
            <select
              value={empresaVinculadaId}
              onChange={e => vincularEmpresa(e.target.value)}
              disabled={carregandoEmpresas || empresas.length === 0}
              className={`${inp} flex-1`}
            >
              <option value="">
                {carregandoEmpresas
                  ? 'Carregando empresas...'
                  : empresas.length === 0
                    ? 'Nenhuma empresa cadastrada'
                    : '— Selecione uma empresa cadastrada —'}
              </option>
              {empresas.map(e => (
                <option key={e.id} value={e.id}>
                  {e.nome} — {e.cnpj} ({e.fonte === 'simples' ? 'Simples' : 'Lucro'})
                </option>
              ))}
            </select>
            {empresaVinculadaId && (
              <button
                onClick={limparVinculo}
                type="button"
                className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Limpar
              </button>
            )}
          </div>
          {empresaVinculada && (
            <div className="mt-2 text-xs text-teal-700 dark:text-teal-300 flex items-center gap-1">
              🔗 Vinculado a: <strong>{empresaVinculada.nome}</strong>
              {!empresaVinculada.uf && (
                <span className="text-amber-600 dark:text-amber-400 ml-2">
                  (sem UF cadastrada — preencha manualmente)
                </span>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div><label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Regime *</label>
            <select value={perfil.regime} onChange={e=>setPerfilField('regime',e.target.value)} className={inp}>
              {REGIMES.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">UF *</label>
            <select value={perfil.uf} onChange={e=>trocarUf(e.target.value)} className={inp}>
              {UFS.map(uf=><option key={uf} value={uf}>{uf}</option>)}
            </select></div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block flex items-center gap-1">
              Alíq. ICMS (%)
              {perfil.aliqInternaIcms !== undefined && !aliqIcmsManual && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  title={`Alíquota geral da UF ${perfil.uf} (RICMS 2026). Atencao: pode haver exceções por NCM/produto.`}
                >
                  auto
                </span>
              )}
            </label>
            <input
              type="number"
              step="0.1"
              placeholder={perfil.uf ? `Padrao ${perfil.uf}: ${((aliquotaInternaPorUf(perfil.uf) ?? 0.18) * 100).toFixed(1)}%` : 'Ex: 18'}
              value={perfil.aliqInternaIcms !== undefined ? (perfil.aliqInternaIcms * 100).toFixed(2).replace(/\.?0+$/, '') : ''}
              onChange={e => setAliqIcmsManualUser(e.target.value)}
              className={inp}
              title="Alíquota interna do ICMS para crédito. Auto-preenchida a partir da UF da empresa (RICMS 2026). Exceções por produto (essenciais 7-12%, supérfluos 25-30%) devem ser ajustadas manualmente."
            />
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        {(['manual','upload','extrato'] as const).map(a=>(
          <button key={a} onClick={()=>setAba(a)} className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${aba===a?'bg-teal-600 text-white shadow':'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600'}`}>
            {a==='manual'?'✏️ Digitação Manual':a==='upload'?'📂 Upload Excel/XML':'🏦 Extrato de Conciliação'}
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


      {aba==='extrato' && (
        <AnaliseCreditoExtrato currentUser={currentUser} empresas={empresas} />
      )}

      {erro && <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-700 dark:text-red-300">⚠️ {erro}</div>}

      {resultado && (
        <div ref={resultadoRef} className="space-y-6">
          <div className="flex justify-between items-center bg-white dark:bg-gray-800 rounded-2xl px-5 py-3 shadow-sm border border-gray-100 dark:border-gray-700 mb-2">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Relatorio de Creditos Fiscais</span>
            <div className="flex gap-2">
              <button onClick={exportarCSV} className="text-xs bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded-lg">Exportar CSV</button>
              <button onClick={exportarPDF} disabled={exportandoPDF} className="text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-60">{exportandoPDF?"Gerando...":"Exportar PDF"}</button>
            </div>
          </div>
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
