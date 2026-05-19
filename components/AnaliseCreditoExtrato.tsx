// components/AnaliseCreditoExtrato.tsx
// Análise de Crédito PIS/COFINS a partir da planilha de conciliação financeira
// (layout SP Contábil — extrato Itaú pós-conciliação, separador ';' em CSV).
// Reaproveita as 11 categorias do Relatório de Créditos já usado pela Eunice.

import React, { useCallback, useMemo, useState } from 'react';
import {
  parseExtratoConciliacao,
  classificar,
  totalizarPorCategoria,
  consolidarRelatorio,
  CATEGORIAS_CREDITO,
  type LancamentoExtrato,
  type TipoDespesaCredito,
} from '../services/analiseCreditoExtratoService';
import {
  parseEfiscalPdf,
  type EfiscalPdfParsed,
} from '../services/efiscalPdfParserService';
import {
  calcularCreditoEfiscal,
  regimeParaCalculo,
  type CreditoEfiscal,
} from '../services/efiscalCreditoService';
import type { EmpresaPerfilOption } from '../services/xmlFiscalService';
import type { User } from '../types';

// Alíquotas PIS/COFINS não-cumulativo (Lucro Real)
const ALIQ_PIS    = 0.0165;
const ALIQ_COFINS = 0.0760;

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BadgeConfianca: React.FC<{ c: LancamentoExtrato['confianca'] }> = ({ c }) => {
  const cfg: Record<LancamentoExtrato['confianca'], { bg: string; label: string }> = {
    ALTA:      { bg: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',    label: '✓ alta' },
    MEDIA:     { bg: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200', label: '~ média' },
    BAIXA:     { bg: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200', label: '! baixa' },
    SEM_MATCH: { bg: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',             label: '? revisar' },
  };
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cfg[c].bg}`}>
      {cfg[c].label}
    </span>
  );
};

const CardTotal: React.FC<{ label: string; valor: number; cor: string; qtde?: number }> = ({
  label, valor, cor, qtde,
}) => (
  <div className={`rounded-xl p-3 ${cor} flex flex-col gap-0.5`}>
    <span className="text-[11px] font-medium opacity-75">{label}</span>
    <span className="text-sm font-bold">R$ {brl(valor)}</span>
    {typeof qtde === 'number' && <span className="text-[10px] opacity-60">{qtde} lanç.</span>}
  </div>
);

interface AnaliseCreditoExtratoProps {
  currentUser?: User | null;
  empresas?: EmpresaPerfilOption[];
}

const AnaliseCreditoExtrato: React.FC<AnaliseCreditoExtratoProps> = ({
  currentUser = null,
  empresas = [],
}) => {
  const [arquivo, setArquivo]       = useState<File | null>(null);
  const [lancamentos, setLancamentos] = useState<LancamentoExtrato[]>([]);
  const [erro, setErro]             = useState<string | null>(null);
  const [filtro, setFiltro]         = useState<'todos' | 'com_credito' | 'sem_credito' | 'revisar'>('todos');
  const [exportandoPDF, setExportandoPDF] = useState(false);

  // Modo de entrada: 'csv' (extrato Itau) ou 'efiscal' (PDF Servicos Tomados)
  const [modo, setModo] = useState<'csv' | 'efiscal'>('csv');
  const [efiscal, setEfiscal] = useState<EfiscalPdfParsed | null>(null);
  const [efiscalCarregando, setEfiscalCarregando] = useState(false);
  const [empresaSelId, setEmpresaSelId] = useState<string>('');

  // Empresa tomadora selecionada (objeto completo)
  const empresaSel = useMemo(
    () => empresas.find(e => e.id === empresaSelId) ?? null,
    [empresas, empresaSelId],
  );

  // Credito recalcula sempre que o PDF parseado OU a empresa mudam.
  const credito = useMemo<CreditoEfiscal | null>(() => {
    if (!efiscal || !empresaSel) return null;
    const regCalc = regimeParaCalculo(empresaSel.regimeSugerido);
    return calcularCreditoEfiscal(efiscal.fornecedores, regCalc);
  }, [efiscal, empresaSel]);

  // Aviso de divergencia de CNPJ — tambem reativo.
  const avisoCnpj = useMemo<string | null>(() => {
    if (!efiscal || !empresaSel) return null;
    const soDigitos = (s: string) => (s || '').replace(/\D+/g, '');
    if (soDigitos(empresaSel.cnpj) !== soDigitos(efiscal.empresaCnpj)) {
      return (
        `Atencao: a empresa selecionada (${empresaSel.cnpj}) e diferente do CNPJ ` +
        `no cabecalho do PDF (${efiscal.empresaCnpj}). Confirme se o relatorio ` +
        `e da empresa certa.`
      );
    }
    return null;
  }, [efiscal, empresaSel]);

  const processar = useCallback(async (file: File) => {
    setErro(null);
    try {
      // Lê em UTF-8 (o CSV do Itaú vem com BOM, o parser já trata)
      const txt = await file.text();
      const parsed = parseExtratoConciliacao(txt);
      if (parsed.length === 0) {
        setErro('Nenhum lançamento de pagamento encontrado. Verifique se o arquivo é o CSV de conciliação (formato SP Contábil, com colunas Status/TIPO DESPESA/DATA PAGTO/DESPESAS).');
        setLancamentos([]);
        return;
      }
      setLancamentos(parsed);
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao processar o arquivo');
      setLancamentos([]);
    }
  }, []);

  const onFile = (f: File | null) => {
    setArquivo(f);
    if (f) processar(f);
  };

  const ajustarCategoria = (idx: number, novaCat: TipoDespesaCredito | '') => {
    setLancamentos(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      return {
        ...l,
        categoriaSugerida: novaCat === '' ? null : novaCat,
        confianca: 'ALTA',
        motivo: novaCat === '' ? 'Marcado como sem crédito pelo usuário' : 'Ajustado manualmente',
      };
    }));
  };

  const processarEfiscal = useCallback(async (file: File) => {
    setErro(null);
    setEfiscalCarregando(true);
    try {
      const parsed = await parseEfiscalPdf(file);
      setEfiscal(parsed);
      // O credito e o aviso de CNPJ sao calculados reativamente
      // (useMemo abaixo) — recalculam quando o PDF OU a empresa mudam.
      if (!parsed.validacao.ok) {
        setErro(
          'Atencao: os totais extraidos nao bateram 100% com o rodape do PDF. ' +
          'Revise antes de usar. Divergencias: ' + parsed.validacao.divergencias.join('; '),
        );
      }
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Erro ao processar o PDF E-Fiscal');
      setEfiscal(null);
    } finally {
      setEfiscalCarregando(false);
    }
  }, []);

  const onFileEfiscal = (f: File | null) => {
    setArquivo(f);
    if (f) processarEfiscal(f);
  };

  const exportarEfiscalXlsx = async () => {
    if (!efiscal) return;
    const XLSX = await import('xlsx');
    const linhas: (string | number)[][] = [];
    linhas.push(['RELACAO DE NFs DE SERVICOS TOMADOS - AGRUPADO POR FORNECEDOR']);
    linhas.push([`Empresa: ${efiscal.empresaCodigo} - ${efiscal.empresaNome}`]);
    linhas.push([`CNPJ: ${efiscal.empresaCnpj}   Periodo: ${efiscal.periodo}`]);
    linhas.push([]);
    linhas.push(['CNPJ/CPF', 'RAZAO SOCIAL', 'QTD NOTAS', 'VALOR DA NF', 'BASE DE CALCULO', 'VALOR ISS', 'ISS RETIDO']);
    for (const f of efiscal.fornecedores) {
      linhas.push([
        f.cnpjCpf, f.razaoSocial, f.qtdNotas,
        f.somaValorNf.toFixed(2).replace('.', ','),
        f.somaBaseCalculo.toFixed(2).replace('.', ','),
        f.somaValorIss.toFixed(2).replace('.', ','),
        f.somaIssRetido.toFixed(2).replace('.', ','),
      ]);
    }
    linhas.push([]);
    linhas.push([
      '', 'TOTAL', efiscal.notas.length,
      efiscal.totalCalculado.valorNf.toFixed(2).replace('.', ','),
      efiscal.totalCalculado.baseCalculo.toFixed(2).replace('.', ','),
      efiscal.totalCalculado.valorIss.toFixed(2).replace('.', ','),
      efiscal.totalCalculado.issRetido.toFixed(2).replace('.', ','),
    ]);
    const ws = XLSX.utils.aoa_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Servicos Tomados');
    XLSX.writeFile(wb, `ServicosTomados_${efiscal.empresaCodigo}_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const totais = useMemo(() => totalizarPorCategoria(lancamentos), [lancamentos]);
  const baseCreditos = useMemo(
    () => lancamentos.filter(l => l.categoriaSugerida !== null).reduce((acc, l) => acc + l.valor, 0),
    [lancamentos],
  );
  const creditoPis    = baseCreditos * ALIQ_PIS;
  const creditoCofins = baseCreditos * ALIQ_COFINS;
  const creditoTotal  = creditoPis + creditoCofins;

  const lancamentosFiltrados = useMemo(() => {
    switch (filtro) {
      case 'com_credito':  return lancamentos.filter(l => l.categoriaSugerida !== null);
      case 'sem_credito':  return lancamentos.filter(l => l.categoriaSugerida === null && l.confianca !== 'SEM_MATCH');
      case 'revisar':      return lancamentos.filter(l => l.confianca === 'SEM_MATCH' || l.confianca === 'BAIXA');
      default:             return lancamentos;
    }
  }, [lancamentos, filtro]);

  const exportarPDF = async () => {
    if (lancamentos.length === 0) return;
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
        pdf.text('SP Contabil - Credito PIS/COFINS (Extrato de Conciliacao)', m, 10);
        pdf.setFontSize(8); pdf.setFont('helvetica', 'normal');
        pdf.text('Gerado em: ' + now, W - m - 40, 10);
      };
      drawHeader();
      let y = 24;
      const checkPage = (h: number) => { if (y + h > H - 12) { pdf.addPage(); drawHeader(); y = 24; } };

      pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(2, 0, 38);
      pdf.text('RESUMO DE CREDITOS PIS/COFINS', m, y); y += 6;
      const kpis = [
        ['Base de Credito', 'R$ ' + brl(baseCreditos)],
        ['Credito PIS (1,65%)', 'R$ ' + brl(creditoPis)],
        ['Credito COFINS (7,60%)', 'R$ ' + brl(creditoCofins)],
        ['Credito Total', 'R$ ' + brl(creditoTotal)],
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
      pdf.text('DETALHAMENTO POR CATEGORIA E FORNECEDOR', m, y); y += 2;
      pdf.setDrawColor(200, 200, 200); pdf.line(m, y, W - m, y); y += 5;

      const porCategoria: Record<string, LancamentoExtrato[]> = {};
      for (const l of lancamentos) {
        if (l.categoriaSugerida === null) continue;
        (porCategoria[l.categoriaSugerida] ??= []).push(l);
      }

      for (const cat of CATEGORIAS_CREDITO) {
        const itens = porCategoria[cat];
        if (!itens || itens.length === 0) continue;
        const subtotal = itens.reduce((s, i) => s + i.valor, 0);

        checkPage(16);
        pdf.setFillColor(225, 235, 255); pdf.rect(m, y - 4, W - m * 2, 12, 'F');
        pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(2, 0, 38);
        pdf.text(cat, m + 2, y + 1);
        pdf.setTextColor(60, 60, 60);
        pdf.text('Total: R$ ' + brl(subtotal) + '  (' + itens.length + ' lanc.)', W - m - 60, y + 1);
        y += 14;

        checkPage(8);
        pdf.setFillColor(245, 245, 245); pdf.rect(m + 2, y - 3, W - m * 2 - 4, 6, 'F');
        pdf.setFontSize(7); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(80, 80, 80);
        pdf.text('DATA', m + 4, y + 1);
        pdf.text('FORNECEDOR', m + 22, y + 1);
        pdf.text('DESCRICAO', m + 80, y + 1);
        pdf.text('VALOR', W - m - 22, y + 1);
        y += 6;

        for (const it of itens) {
          checkPage(6);
          pdf.setFont('helvetica', 'normal'); pdf.setTextColor(50, 50, 50); pdf.setFontSize(7);
          pdf.text(String(it.data || '-').substring(0, 10), m + 4, y);
          pdf.text(String(it.favorecido || '-').substring(0, 35), m + 22, y);
          pdf.text(String(it.descricao || '-').substring(0, 42), m + 80, y);
          pdf.text('R$ ' + brl(it.valor), W - m - 22, y);
          y += 5;
        }
        y += 3;
        pdf.setDrawColor(230, 230, 230); pdf.line(m, y, W - m, y); y += 4;
      }

      checkPage(14);
      pdf.setFillColor(2, 0, 38); pdf.rect(m, y - 3, W - m * 2, 10, 'F');
      pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(255, 255, 255);
      pdf.text('TOTAL GERAL - BASE DE CREDITO', m + 2, y + 3);
      pdf.text('R$ ' + brl(baseCreditos), W - m - 40, y + 3);
      y += 14;

      pdf.setFontSize(6); pdf.setTextColor(150, 150, 150);
      pdf.text('Classificacao automatica com base em regras. Revise antes de enviar ao cliente.', m, H - 4);

      const blob = pdf.output('blob');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'relatorio_creditos_pis_cofins_' + new Date().toISOString().slice(0, 10) + '.pdf';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) { console.error(e); setErro('Erro ao gerar PDF: ' + (e instanceof Error ? e.message : 'desconhecido')); }
    finally { setExportandoPDF(false); }
  };

  const exportarRelatorio = async () => {
    const linhas = consolidarRelatorio(lancamentos);
    if (linhas.length === 0) { setErro('Nada pra exportar — nenhuma categoria gerando crédito.'); return; }

    // Lazy-import do SheetJS só quando for exportar
    const XLSX = await import('xlsx');
    const agrupado: Record<string, typeof linhas> = {};
    for (const l of linhas) (agrupado[l.tipoDespesa] ??= []).push(l);

    const linhasSheet: (string | number)[][] = [];
    linhasSheet.push(['DEMONSTRATIVO DE CRÉDITOS PARA CÁLCULO DE PIS E COFINS']);
    linhasSheet.push([]);
    linhasSheet.push(['DATA', 'NOTA', 'FORNECEDOR', 'TIPO DE DESPESA', 'VALOR']);
    let totalGeral = 0;
    for (const cat of CATEGORIAS_CREDITO) {
      const itens = agrupado[cat];
      if (!itens || itens.length === 0) continue;
      let subtotal = 0;
      for (const i of itens) {
        linhasSheet.push([i.data, i.nota, i.fornecedor, i.tipoDespesa, i.valor.toFixed(2).replace('.', ',')]);
        subtotal += i.valor;
      }
      linhasSheet.push(['', '', '', `TOTAL ${cat}`, subtotal.toFixed(2).replace('.', ',')]);
      linhasSheet.push([]);
      totalGeral += subtotal;
    }
    linhasSheet.push(['', '', '', 'BASE DE CÁLCULO', totalGeral.toFixed(2).replace('.', ',')]);
    linhasSheet.push(['', '', '', 'CRÉDITO PIS (1,65%)',    creditoPis.toFixed(2).replace('.', ',')]);
    linhasSheet.push(['', '', '', 'CRÉDITO COFINS (7,60%)', creditoCofins.toFixed(2).replace('.', ',')]);
    linhasSheet.push(['', '', '', 'CRÉDITO TOTAL',          creditoTotal.toFixed(2).replace('.', ',')]);

    const ws = XLSX.utils.aoa_to_sheet(linhasSheet);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Créditos');
    const fileName = `Relatorio_Creditos_PIS_COFINS_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const inp = "w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-teal-400";

  return (
    <div className="space-y-6 pb-10">
      <div>
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Análise de Créditos — Extrato de Conciliação</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Importa a planilha mensal de conciliação financeira (CSV Itaú) e classifica automaticamente os pagamentos nas 11 categorias de crédito PIS/COFINS (Lucro Real não-cumulativo).
        </p>
      </div>

      {/* ─── Toggle de modo ─────────────────────────────────────────────── */}
      <div className="flex gap-2">
        <button
          onClick={() => { setModo('csv'); setErro(null); }}
          className={`px-4 py-2 rounded-xl text-sm font-semibold ${modo==='csv'?'bg-teal-600 text-white':'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600'}`}
        >
          🏦 CSV Itaú (conciliação)
        </button>
        <button
          onClick={() => { setModo('efiscal'); setErro(null); }}
          className={`px-4 py-2 rounded-xl text-sm font-semibold ${modo==='efiscal'?'bg-teal-600 text-white':'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600'}`}
        >
          📄 PDF E-Fiscal (Serviços Tomados)
        </button>
      </div>

      {/* ─── Upload CSV ───────────────────────────────────────────────── */}
      {modo === 'csv' && (
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
        <div
          onClick={() => document.getElementById('input-extrato')?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); onFile(e.dataTransfer.files?.[0] ?? null); }}
          className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 text-center cursor-pointer hover:border-teal-400 transition-all"
        >
          <div className="text-3xl mb-1">🏦</div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {arquivo ? arquivo.name : 'Clique ou arraste o CSV de conciliação (padrão Itaú SP Contábil)'}
          </p>
          <p className="text-[11px] text-gray-400 mt-1">
            Colunas esperadas: Número, Status, TIPO DESPESA, NF, DATA PAGTO, DESCRIÇÃO, DESPESAS, MÊS
          </p>
        </div>
        <input
          id="input-extrato"
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={e => onFile(e.target.files?.[0] ?? null)}
        />
      </div>
      )}

      {/* ─── Upload PDF E-Fiscal ──────────────────────────────────────── */}
      {modo === 'efiscal' && (
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
        {/* Seletor de empresa tomadora */}
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-300 block mb-1">
            Empresa tomadora dos servicos
          </label>
          <select
            value={empresaSelId}
            onChange={e => setEmpresaSelId(e.target.value)}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
          >
            <option value="">— Selecione a empresa antes de subir o PDF —</option>
            {[...empresas].sort((a,b) => a.nome.localeCompare(b.nome)).map(e => (
              <option key={e.id} value={e.id}>
                {e.nome} ({e.cnpj}) · {e.regimeSugerido === 'SIMPLES' ? 'Simples'
                  : e.regimeSugerido === 'LUCRO_PRESUMIDO' ? 'Presumido' : 'Lucro Real'}
              </option>
            ))}
          </select>
          {empresas.length === 0 && (
            <p className="text-[11px] text-orange-500 mt-1">
              Nenhuma empresa cadastrada encontrada. Cadastre a empresa primeiro.
            </p>
          )}
        </div>
        <div
          className={empresaSelId ? '' : 'opacity-40 pointer-events-none'}
          onClick={() => empresaSelId && document.getElementById('input-efiscal')?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); onFileEfiscal(e.dataTransfer.files?.[0] ?? null); }}
          className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 text-center cursor-pointer hover:border-teal-400 transition-all"
        >
          <div className="text-3xl mb-1">📄</div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {arquivo ? arquivo.name : 'Clique ou arraste o PDF "Relação de NFs de Serviços Tomados" (Sistema E-Fiscal)'}
          </p>
          <p className="text-[11px] text-gray-400 mt-1">
            Layout fixo do E-Fiscal — extração por coordenada, validada contra o total do relatório.
          </p>
        </div>
        <input
          id="input-efiscal"
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={e => onFileEfiscal(e.target.files?.[0] ?? null)}
        />
        {efiscalCarregando && (
          <p className="text-xs text-teal-600 dark:text-teal-400">Processando PDF…</p>
        )}
      </div>
      )}

      {/* ─── Resultado E-Fiscal ───────────────────────────────────────── */}
      {modo === 'efiscal' && efiscal && (
        <>
          {/* Cabecalho do relatorio */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
            <h3 className="font-semibold text-gray-700 dark:text-gray-200 text-sm mb-1">
              {efiscal.empresaCodigo} — {efiscal.empresaNome}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              CNPJ {efiscal.empresaCnpj} · Período {efiscal.periodo} · {efiscal.notas.length} NFs · {efiscal.fornecedores.length} fornecedores
            </p>
          </div>

          {/* Aviso de divergencia de CNPJ */}
          {avisoCnpj && (
            <div className="rounded-xl p-4 text-sm border bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300">
              ⚠️ {avisoCnpj}
            </div>
          )}

          {/* Card de regime + credito */}
          {credito && (
            <div className={`rounded-2xl p-5 shadow-sm border ${
              credito.geraCredito
                ? 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700'
                : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-800'
            }`}>
              {credito.geraCredito ? (
                <>
                  <h3 className="font-semibold text-gray-700 dark:text-gray-200 text-sm mb-1">
                    Crédito PIS/COFINS — {credito.aliquota.label}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    Alíquotas: PIS {(credito.aliquota.pis*100).toFixed(2)}% · COFINS {(credito.aliquota.cofins*100).toFixed(2)}%
                    · base = soma da Base de Cálculo das NFs
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <CardTotal label="Base de Cálculo" valor={credito.baseTotal}   cor="bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-100" />
                    <CardTotal label="Crédito PIS"      valor={credito.creditoPis}    cor="bg-purple-50 dark:bg-purple-900/30 text-purple-800 dark:text-purple-100" />
                    <CardTotal label="Crédito COFINS"   valor={credito.creditoCofins} cor="bg-orange-50 dark:bg-orange-900/30 text-orange-800 dark:text-orange-100" />
                    <CardTotal label="Crédito Total"    valor={credito.creditoTotal}  cor="bg-teal-50 dark:bg-teal-900/30 text-teal-800 dark:text-teal-100" />
                  </div>
                </>
              ) : (
                <div className="flex items-start gap-3">
                  <span className="text-2xl">⚠️</span>
                  <div>
                    <h3 className="font-semibold text-yellow-800 dark:text-yellow-200 text-sm">
                      Empresa optante pelo Simples Nacional
                    </h3>
                    <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                      Empresas do Simples Nacional não geram crédito de PIS/COFINS sobre
                      serviços tomados — o recolhimento já ocorre dentro do DAS.
                      O relatório abaixo é exibido apenas para conferência.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tabela de categorias agrupadas */}
          {credito && credito.categorias.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                <h3 className="font-semibold text-gray-700 dark:text-gray-200 text-sm">Distribuição por Categoria</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Categoria</th>
                      <th className="px-3 py-2 text-right font-medium">Fornecedores</th>
                      <th className="px-3 py-2 text-right font-medium">NFs</th>
                      <th className="px-3 py-2 text-right font-medium">Base de Cálculo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {credito.categorias.map((cat, i) => (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                        <td className="px-3 py-2 text-gray-800 dark:text-gray-200 font-medium">
                          {cat.categoria === 'SEM_CATEGORIA' ? '— Sem categoria —' : cat.categoria}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{cat.qtdFornecedores}</td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{cat.qtdNotas}</td>
                        <td className="px-3 py-2 text-right text-gray-800 dark:text-gray-200 whitespace-nowrap font-semibold">R$ {brl(cat.somaBaseCalculo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Card de validacao */}
          <div className={`rounded-xl p-4 text-sm border ${
            efiscal.validacao.ok
              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
              : 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300'
          }`}>
            {efiscal.validacao.ok ? (
              <span>✓ Extração validada — os totais batem 100% com o rodapé do PDF.</span>
            ) : (
              <div>
                <p className="font-semibold mb-1">⚠️ Divergência na extração:</p>
                <ul className="list-disc list-inside text-xs">
                  {efiscal.validacao.divergencias.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </div>
            )}
          </div>

          {/* Totais */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <CardTotal label="Total Valor das NFs"  valor={efiscal.totalCalculado.valorNf}     cor="bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-100" qtde={efiscal.notas.length} />
            <CardTotal label="Total Base de Cálculo" valor={efiscal.totalCalculado.baseCalculo} cor="bg-purple-50 dark:bg-purple-900/30 text-purple-800 dark:text-purple-100" />
            <CardTotal label="Total Valor ISS"       valor={efiscal.totalCalculado.valorIss}    cor="bg-orange-50 dark:bg-orange-900/30 text-orange-800 dark:text-orange-100" />
            <CardTotal label="Total ISS Retido"      valor={efiscal.totalCalculado.issRetido}   cor="bg-teal-50 dark:bg-teal-900/30 text-teal-800 dark:text-teal-100" />
          </div>

          {/* Exportar */}
          <div className="flex justify-end">
            <button onClick={exportarEfiscalXlsx}
              className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm">
              📥 Exportar fornecedores .xlsx
            </button>
          </div>

          {/* Tabela de fornecedores agrupados */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">CNPJ/CPF</th>
                    <th className="px-3 py-2 text-left font-medium">Razão Social</th>
                    <th className="px-3 py-2 text-right font-medium">Qtd NFs</th>
                    <th className="px-3 py-2 text-right font-medium">Valor das NFs</th>
                    <th className="px-3 py-2 text-right font-medium">Base de Cálculo</th>
                    <th className="px-3 py-2 text-right font-medium">ISS Retido</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {efiscal.fornecedores.map((f, i) => (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap font-mono">{f.cnpjCpf}</td>
                      <td className="px-3 py-2 text-gray-800 dark:text-gray-200 font-medium">{f.razaoSocial}</td>
                      <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{f.qtdNotas}</td>
                      <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">R$ {brl(f.somaValorNf)}</td>
                      <td className="px-3 py-2 text-right text-gray-800 dark:text-gray-200 whitespace-nowrap font-semibold">R$ {brl(f.somaBaseCalculo)}</td>
                      <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">R$ {brl(f.somaIssRetido)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {erro && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-700 dark:text-red-300">
          ⚠️ {erro}
        </div>
      )}

      {modo === 'csv' && lancamentos.length > 0 && (
        <>
          {/* ─── Totais ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <CardTotal label="Base de Crédito" valor={baseCreditos}  cor="bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-100" qtde={lancamentos.filter(l=>l.categoriaSugerida).length} />
            <CardTotal label="Crédito PIS (1,65%)"    valor={creditoPis}    cor="bg-purple-50 dark:bg-purple-900/30 text-purple-800 dark:text-purple-100" />
            <CardTotal label="Crédito COFINS (7,60%)" valor={creditoCofins} cor="bg-orange-50 dark:bg-orange-900/30 text-orange-800 dark:text-orange-100" />
            <CardTotal label="Crédito Total" valor={creditoTotal} cor="bg-teal-50 dark:bg-teal-900/30 text-teal-800 dark:text-teal-100" />
          </div>

          {/* ─── Totais por categoria ───────────────────────────────────── */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700">
            <h3 className="font-semibold text-gray-700 dark:text-gray-200 mb-3 text-sm">Distribuição por Categoria</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {CATEGORIAS_CREDITO.filter(c => (totais[c] ?? 0) > 0).map(c => (
                <div key={c} className="flex justify-between bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2">
                  <span className="text-gray-600 dark:text-gray-300">{c}</span>
                  <span className="font-semibold text-gray-800 dark:text-white">R$ {brl(totais[c] ?? 0)}</span>
                </div>
              ))}
              {totais.SEM_CREDITO > 0 && (
                <div className="flex justify-between bg-gray-200 dark:bg-gray-700 rounded-lg px-3 py-2 col-span-2 sm:col-span-4 border-t border-gray-300 dark:border-gray-600">
                  <span className="text-gray-500 dark:text-gray-400 italic">Sem crédito</span>
                  <span className="font-semibold text-gray-600 dark:text-gray-300">R$ {brl(totais.SEM_CREDITO)}</span>
                </div>
              )}
            </div>
          </div>

          {/* ─── Filtros + Exportar ─────────────────────────────────────── */}
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="flex gap-2 flex-wrap">
              {([
                { v: 'todos',       l: `Todos (${lancamentos.length})` },
                { v: 'com_credito', l: `Com crédito (${lancamentos.filter(l=>l.categoriaSugerida).length})` },
                { v: 'sem_credito', l: `Sem crédito (${lancamentos.filter(l=>!l.categoriaSugerida && l.confianca!=='SEM_MATCH').length})` },
                { v: 'revisar',     l: `Revisar (${lancamentos.filter(l=>l.confianca==='SEM_MATCH'||l.confianca==='BAIXA').length})` },
              ] as const).map(b => (
                <button key={b.v} onClick={() => setFiltro(b.v)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium ${filtro===b.v?'bg-teal-600 text-white':'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600'}`}>
                  {b.l}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={exportarRelatorio}
                className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm">
                📥 Exportar .xlsx
              </button>
              <button onClick={exportarPDF} disabled={exportandoPDF}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm disabled:opacity-60">
                {exportandoPDF ? 'Gerando...' : '📄 Exportar PDF'}
              </button>
            </div>
          </div>

          {/* ─── Tabela ─────────────────────────────────────────────────── */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Data</th>
                    <th className="px-3 py-2 text-left font-medium">Fornecedor</th>
                    <th className="px-3 py-2 text-left font-medium">Descrição</th>
                    <th className="px-3 py-2 text-right font-medium">Valor</th>
                    <th className="px-3 py-2 text-left font-medium">Categoria</th>
                    <th className="px-3 py-2 text-left font-medium">Confiança</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {lancamentosFiltrados.map((l) => {
                    const idxReal = lancamentos.indexOf(l);
                    return (
                      <tr key={idxReal} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                        <td className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">{l.data}</td>
                        <td className="px-3 py-2 text-gray-800 dark:text-gray-200 font-medium">{l.favorecido}</td>
                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400 max-w-xs truncate" title={l.descricao}>{l.descricao}</td>
                        <td className="px-3 py-2 text-right text-gray-800 dark:text-gray-200 whitespace-nowrap">R$ {brl(l.valor)}</td>
                        <td className="px-3 py-2">
                          <select
                            value={l.categoriaSugerida ?? ''}
                            onChange={e => ajustarCategoria(idxReal, e.target.value as TipoDespesaCredito | '')}
                            className={inp}
                          >
                            <option value="">— Sem crédito —</option>
                            {CATEGORIAS_CREDITO.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-0.5">
                            <BadgeConfianca c={l.confianca} />
                            <span className="text-[10px] text-gray-400 italic" title={l.motivo}>{l.motivo.length > 30 ? l.motivo.slice(0, 28) + '…' : l.motivo}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {lancamentosFiltrados.length === 0 && (
              <div className="p-8 text-center text-sm text-gray-400">Nenhum lançamento neste filtro.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AnaliseCreditoExtrato;
