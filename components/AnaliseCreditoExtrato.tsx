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

const AnaliseCreditoExtrato: React.FC = () => {
  const [arquivo, setArquivo]       = useState<File | null>(null);
  const [lancamentos, setLancamentos] = useState<LancamentoExtrato[]>([]);
  const [erro, setErro]             = useState<string | null>(null);
  const [filtro, setFiltro]         = useState<'todos' | 'com_credito' | 'sem_credito' | 'revisar'>('todos');

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

      {/* ─── Upload ───────────────────────────────────────────────────────── */}
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

      {erro && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-700 dark:text-red-300">
          ⚠️ {erro}
        </div>
      )}

      {lancamentos.length > 0 && (
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
            <button onClick={exportarRelatorio}
              className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm">
              📥 Exportar Relatório .xlsx
            </button>
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
