// components/AnaliseCreditoExtrato.tsx
// Análise de Crédito PIS/COFINS a partir da planilha de conciliação financeira
// (layout SP Contábil — extrato Itaú pós-conciliação, separador ';' em CSV).
// Reaproveita as 11 categorias do Relatório de Créditos já usado pela Eunice.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AnaliseRetencoesNfseSP from './AnaliseRetencoesNfseSP';
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
import {
  carregarRegras,
  salvarRegra,
} from '../services/categoriaFornecedorService';
import {
  listarOcultos,
  ocultarFornecedor,
  restaurarTodos as restaurarTodosOcultos,
} from '../services/fornecedoresOcultosService';
import {
  listarNotasOcultas,
  ocultarNota,
  restaurarTodasNotas as restaurarTodasNotasOcultas,
  nfChave,
} from '../services/notasOcultasService';
import {
  listarInvoicesManuais,
  adicionarInvoice,
  removerInvoice,
  atualizarCategoriaInvoice,
  normalizarPeriodo,
  type InvoiceManual,
  type NovaInvoice,
} from '../services/invoicesManuaisService';
import {
  listarCustom,
  criarCategoria,
  renomearCategoria,
  removerCategoria,
  contarFornecedoresNaCategoria,
  type CategoriaCustom,
} from '../services/categoriasCreditoService';
import {
  carregarCreditConfig,
  salvarCreditConfig,
} from '../services/creditConfigService';
import { mesclarInvoicesEFiltrarOcultos } from '../services/analiseCreditoMerge';
import { gerarEfiscalPdf, gerarExtratoPdf, baixarBlob } from '../services/analiseCreditoPdf';
import type { EmpresaPerfilOption } from '../services/xmlFiscalService';
import type { User } from '../types';

// Alíquotas PIS/COFINS não-cumulativo (Lucro Real)
const ALIQ_PIS    = 0.0165;
const ALIQ_COFINS = 0.0760;

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });


// ════════════════════════════════════════════════════════════════════
// Modal: Cadastrar invoice manual (E-Fiscal)
// ════════════════════════════════════════════════════════════════════
interface ModalInvoiceManualProps {
  empresaId: string;
  periodoNormalizado: string;
  onFechar: () => void;
  onSalvo: () => void;
}

function ModalInvoiceManual({
  empresaId, periodoNormalizado, onFechar, onSalvo,
}: ModalInvoiceManualProps): React.ReactElement {
  const [emissao, setEmissao] = useState('');
  const [numero, setNumero] = useState('');
  const [serie, setSerie] = useState('');
  const [cnpjCpf, setCnpjCpf] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [valorNf, setValorNf] = useState('');
  const [baseCalculo, setBaseCalculo] = useState('');
  const [aliquota, setAliquota] = useState('');
  const [valorIss, setValorIss] = useState('');
  const [issRetido, setIssRetido] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErroLocal] = useState<string | null>(null);

  // "1.234,56" -> 1234.56 (vazio -> 0)
  const parseBR = (s: string): number => {
    if (!s) return 0;
    const limpo = s.trim().replace(/\./g, '').replace(',', '.');
    const n = parseFloat(limpo);
    return isNaN(n) ? 0 : n;
  };

  const podeSalvar = cnpjCpf.trim() && razaoSocial.trim() && baseCalculo.trim();

  const salvar = async () => {
    setErroLocal(null);
    if (!podeSalvar) {
      setErroLocal('CNPJ, Razão Social e Base de Cálculo são obrigatórios.');
      return;
    }
    setSalvando(true);
    const r = await adicionarInvoice({
      empresaId,
      periodo: periodoNormalizado,
      emissao: emissao.trim(),
      numero: numero.trim(),
      serie: serie.trim(),
      cnpjCpf: cnpjCpf.trim(),
      razaoSocial: razaoSocial.trim(),
      valorNf: parseBR(valorNf) || parseBR(baseCalculo),
      baseCalculo: parseBR(baseCalculo),
      aliquota: parseBR(aliquota),
      valorIss: parseBR(valorIss),
      issRetido: parseBR(issRetido),
    });
    setSalvando(false);
    if (r.ok) {
      onSalvo();
      onFechar();
    } else {
      setErroLocal('Erro ao salvar: ' + (r.error || 'desconhecido'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFechar}>
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">Adicionar invoice manual</h3>
          <button onClick={onFechar} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Período: <strong>{periodoNormalizado}</strong>. A invoice manual entra no cálculo do crédito como uma NF normal.
          </p>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-300">Emissão</label>
              <input value={emissao} onChange={e => setEmissao(e.target.value)} placeholder="dd/mm/aaaa"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700" />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-300">Número</label>
              <input value={numero} onChange={e => setNumero(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700" />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-300">Série</label>
              <input value={serie} onChange={e => setSerie(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-300">CNPJ/CPF *</label>
              <input value={cnpjCpf} onChange={e => setCnpjCpf(e.target.value)} placeholder="00.000.000/0000-00"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 font-mono bg-white dark:bg-gray-700" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-600 dark:text-gray-300">Razão Social *</label>
              <input value={razaoSocial} onChange={e => setRazaoSocial(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-300">Valor NF (R$)</label>
              <input value={valorNf} onChange={e => setValorNf(e.target.value)} placeholder="0,00"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-right bg-white dark:bg-gray-700" />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-300">Base de Cálculo (R$) *</label>
              <input value={baseCalculo} onChange={e => setBaseCalculo(e.target.value)} placeholder="0,00"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-right bg-white dark:bg-gray-700 font-semibold" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-300">Alíquota (%)</label>
              <input value={aliquota} onChange={e => setAliquota(e.target.value)} placeholder="0,00"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-right bg-white dark:bg-gray-700" />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-300">Valor ISS (R$)</label>
              <input value={valorIss} onChange={e => setValorIss(e.target.value)} placeholder="0,00"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-right bg-white dark:bg-gray-700" />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-300">ISS Retido (R$)</label>
              <input value={issRetido} onChange={e => setIssRetido(e.target.value)} placeholder="0,00"
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-right bg-white dark:bg-gray-700" />
            </div>
          </div>

          {erro && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded p-2 text-xs text-red-700 dark:text-red-300">
              {erro}
            </div>
          )}

          <p className="text-[11px] text-gray-400">
            * obrigatorio. Use vírgula como separador decimal (ex: 1.234,56).
          </p>
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onFechar}
            className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
            Cancelar
          </button>
          <button onClick={salvar} disabled={!podeSalvar || salvando}
            className="px-3 py-1.5 text-sm rounded bg-amber-600 hover:bg-amber-700 text-white font-semibold disabled:opacity-50">
            {salvando ? 'Salvando...' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
// Modal: Gerenciar categorias customizadas
// ════════════════════════════════════════════════════════════════════
interface ModalGerenciarCategoriasProps {
  onFechar: () => void;
  onMudou: () => void;
}

function ModalGerenciarCategorias({ onFechar, onMudou }: ModalGerenciarCategoriasProps): React.ReactElement {
  const [custom, setCustom] = useState<CategoriaCustom[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [nova, setNova] = useState('');
  const [criando, setCriando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editandoNome, setEditandoNome] = useState('');
  const [usados, setUsados] = useState<Record<string, number>>({});  // id -> contagem
  const [erro, setErroLocal] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    const list = await listarCustom();
    setCustom(list);
    // calcula uso pra cada custom (em paralelo)
    const counts: Record<string, number> = {};
    await Promise.all(list.map(async cat => {
      counts[cat.id] = await contarFornecedoresNaCategoria(cat.nome);
    }));
    setUsados(counts);
    setCarregando(false);
  }, []);

  useEffect(() => { recarregar(); }, [recarregar]);

  const adicionar = async () => {
    setErroLocal(null);
    if (!nova.trim()) return;
    setCriando(true);
    const r = await criarCategoria(nova);
    setCriando(false);
    if (r.ok) {
      setNova('');
      if (r.jaExistia) setErroLocal(`Categoria "${r.nome}" ja existia — reutilizada.`);
      await recarregar();
      onMudou();
    } else {
      setErroLocal(r.error || 'Erro ao criar');
    }
  };

  const salvarEdicao = async (id: string) => {
    setErroLocal(null);
    if (!editandoNome.trim()) { setEditandoId(null); return; }
    const r = await renomearCategoria(id, editandoNome);
    if (r.ok) {
      setEditandoId(null);
      await recarregar();
      onMudou();
    } else {
      setErroLocal(r.error || 'Erro ao renomear');
    }
  };

  const apagar = async (cat: CategoriaCustom) => {
    setErroLocal(null);
    if (!confirm(`Apagar categoria "${cat.nome}"?`)) return;
    const r = await removerCategoria(cat.id, cat.nome);
    if (r.ok) {
      await recarregar();
      onMudou();
    } else if (r.bloqueado) {
      setErroLocal(`${r.usados} fornecedor(es) ainda usam essa categoria. Reclassifique antes de apagar.`);
    } else {
      setErroLocal(r.error || 'Erro ao apagar');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFechar}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">Gerenciar categorias</h3>
          <button onClick={onFechar} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            As 11 categorias padrao (MEDICINA, TI, etc.) sao imutaveis. Voce pode adicionar, renomear e apagar suas proprias categorias.
          </p>

          {/* Adicionar nova */}
          <div className="flex gap-2">
            <input
              value={nova}
              onChange={e => setNova(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') adicionar(); }}
              placeholder="Ex: MARKETING, TREINAMENTO..."
              className="flex-1 text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 bg-white dark:bg-gray-700"
            />
            <button
              onClick={adicionar}
              disabled={criando || !nova.trim()}
              className="px-3 py-1.5 text-sm rounded bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50"
            >
              {criando ? 'Adicionando...' : '+ Adicionar'}
            </button>
          </div>

          {erro && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded p-2 text-xs text-amber-800 dark:text-amber-200">
              {erro}
            </div>
          )}

          {/* Lista das custom */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900/50 text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">
              Categorias customizadas {custom.length > 0 && `(${custom.length})`}
            </div>
            {carregando ? (
              <p className="p-3 text-xs text-gray-400">Carregando...</p>
            ) : custom.length === 0 ? (
              <p className="p-3 text-xs text-gray-400">Nenhuma categoria customizada ainda. Adicione uma acima.</p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {custom.map(cat => (
                  <li key={cat.id} className="px-3 py-2 flex items-center gap-2 text-sm">
                    {editandoId === cat.id ? (
                      <>
                        <input
                          value={editandoNome}
                          onChange={e => setEditandoNome(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') salvarEdicao(cat.id); }}
                          className="flex-1 text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700"
                          autoFocus
                        />
                        <button onClick={() => salvarEdicao(cat.id)} className="text-teal-600 hover:text-teal-800 text-xs font-semibold">salvar</button>
                        <button onClick={() => setEditandoId(null)} className="text-gray-400 hover:text-gray-600 text-xs">cancelar</button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-gray-800 dark:text-gray-200 font-medium">{cat.nome}</span>
                        <span className="text-[11px] text-gray-400">
                          {usados[cat.id] > 0 ? `${usados[cat.id]} usado(s)` : 'nao usado'}
                        </span>
                        <button
                          onClick={() => { setEditandoId(cat.id); setEditandoNome(cat.nome); }}
                          className="text-blue-600 hover:text-blue-800 text-xs"
                          title="Renomear"
                        >✏️</button>
                        <button
                          onClick={() => apagar(cat)}
                          disabled={usados[cat.id] > 0}
                          className="text-red-600 hover:text-red-800 text-xs disabled:opacity-30 disabled:cursor-not-allowed"
                          title={usados[cat.id] > 0 ? `${usados[cat.id]} fornecedor(es) usam esta categoria` : 'Apagar'}
                        >🗑️</button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button onClick={onFechar} className="px-3 py-1.5 text-sm rounded bg-gray-600 hover:bg-gray-700 text-white font-semibold">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

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

  // Modo de entrada: 'csv' (extrato Itau), 'efiscal' (PDF Servicos Tomados),
  // 'nfsesp' (CSV de NFSe SP capturadas — analise de retencoes).
  const [modo, setModo] = useState<'csv' | 'efiscal' | 'nfsesp'>('csv');
  const [efiscal, setEfiscal] = useState<EfiscalPdfParsed | null>(null);
  const [efiscalCarregando, setEfiscalCarregando] = useState(false);
  const [empresaSelId, setEmpresaSelId] = useState<string>('');

  // Empresa tomadora selecionada (objeto completo)
  const empresaSel = useMemo(
    () => empresas.find(e => e.id === empresaSelId) ?? null,
    [empresas, empresaSelId],
  );

  // Regras manuais CNPJ->categoria da empresa selecionada (tabela Firestore).
  // Sobrepoem a classificacao automatica. Recarregadas quando a empresa muda.
  const [overrides, setOverrides] = useState<Map<string, TipoDespesaCredito>>(new Map());
  const [overridesVersao, setOverridesVersao] = useState(0);

  useEffect(() => {
    let ativo = true;
    if (!empresaSel?.id) { setOverrides(new Map()); return; }
    carregarRegras(empresaSel.id).then(mapa => {
      if (ativo) setOverrides(mapa);
    });
    return () => { ativo = false; };
  }, [empresaSel?.id, overridesVersao]);

  // Invoices lancadas manualmente (Firestore: invoices_manuais).
  // Filtradas por empresa + periodo normalizado (MM/AAAA) do PDF.
  const [invoicesManuais, setInvoicesManuais] = useState<InvoiceManual[]>([]);
  const [invoicesVersao, setInvoicesVersao] = useState(0);
  const [modalInvoiceAberto, setModalInvoiceAberto] = useState(false);

  // Categorias customizadas (Firestore). 11 fixas + estas.
  const [categoriasCustom, setCategoriasCustom] = useState<CategoriaCustom[]>([]);
  const [categoriasVersao, setCategoriasVersao] = useState(0);
  const [modalCategoriasAberto, setModalCategoriasAberto] = useState(false);

  useEffect(() => {
    let ativo = true;
    listarCustom().then(list => {
      if (ativo) setCategoriasCustom(list);
    });
    return () => { ativo = false; };
  }, [categoriasVersao]);

  // Categorias marcadas como nao-creditaveis para a empresa selecionada.
  // Items nessas categorias tem base 0 (no agrupamento e no baseTotal).
  // Persistido em empresa_credito_config/{empresaId}.
  const [categoriasNaoCreditaveis, setCategoriasNaoCreditaveis] = useState<Set<string>>(new Set());

  // ── Exclusao local de fornecedores (some so nessa sessao) ───────────────
  // Versao 1 (local, nao persistido): o usuario clica lixeira -> modal ->
  // confirma -> CNPJ vai pra Set -> fornecedor some da listagem E do calculo
  // de credito. Ao recarregar o PDF, fornecedor volta a aparecer.
  //
  // Evolucao possivel (versao 2): persistir como regra na empresa via
  // collection `fornecedores_ocultos` no Firestore. Ai a regra dura entre
  // sessoes. Nao implementado nesta versao.
  const [fornecedoresOcultos, setFornecedoresOcultos] = useState<Set<string>>(new Set());
  const [confirmandoExclusao, setConfirmandoExclusao] = useState<
    { cnpj: string; razaoSocial: string; qtdNotas: number; somaValorNf: number } | null
  >(null);
  // Normaliza CNPJ (so digitos) para chave consistente no Set
  const cnpjKey = (c: string) => (c || '').replace(/\D+/g, '');

  // ── Exclusao PERSISTIDA (regra "sempre nessa empresa") ──────────────────
  // Carregado do Firestore (collection `fornecedores_ocultos`) quando a
  // empresa muda. Modal oferece DOIS botoes:
  //   - "So desta vez" -> vai pro Set local (fornecedoresOcultos acima)
  //   - "Sempre nessa empresa" -> grava no Firestore E aparece aqui
  // O calculo de credito (useMemo abaixo) usa a UNIAO dos dois Sets.
  const [fornecedoresOcultosPersistidos, setFornecedoresOcultosPersistidos] = useState<Set<string>>(new Set());
  const [salvandoExclusaoPersistida, setSalvandoExclusaoPersistida] = useState(false);

  useEffect(() => {
    if (!empresaSel?.id) {
      setFornecedoresOcultosPersistidos(new Set());
      return;
    }
    let alive = true;
    listarOcultos(empresaSel.id)
      .then(set => { if (alive) setFornecedoresOcultosPersistidos(set); })
      .catch(e => console.error('[AnaliseCredito] listarOcultos:', e));
    return () => { alive = false; };
  }, [empresaSel?.id]);

  // Uniao Local + Persistido — eh isso que o calculo de credito usa.
  const fornecedoresOcultosEfetivos = useMemo(() => {
    const s = new Set<string>(fornecedoresOcultos);
    for (const k of fornecedoresOcultosPersistidos) s.add(k);
    return s;
  }, [fornecedoresOcultos, fornecedoresOcultosPersistidos]);

  // ── Exclusao por NF INDIVIDUAL (granularidade fina) ─────────────────────
  // Diferente da exclusao por FORNECEDOR (acima, que zera TODAS as NFs do
  // CNPJ): aqui o usuario clica lixeira numa NF especifica dentro da tabela
  // aninhada de Categoria. Chave: nfChave(cnpj, numero, serie).
  //
  // Caso de uso: prestador legitimo, mas UMA NF nao deve entrar (cancelada,
  // duplicada, reembolsada). Adicionar nova NF do mesmo CNPJ via
  // "Adicionar invoice manual" funciona — a nova tem chave diferente.
  const [notasOcultas, setNotasOcultas] = useState<Set<string>>(new Set());
  const [notasOcultasPersistidas, setNotasOcultasPersistidas] = useState<Set<string>>(new Set());
  const [confirmandoExclusaoNf, setConfirmandoExclusaoNf] = useState<
    { cnpj: string; razaoSocial: string; numero: string; serie: string; emissao: string; valorNf: number } | null
  >(null);
  const [salvandoExclusaoNfPersistida, setSalvandoExclusaoNfPersistida] = useState(false);

  useEffect(() => {
    if (!empresaSel?.id) {
      setNotasOcultasPersistidas(new Set());
      return;
    }
    let alive = true;
    listarNotasOcultas(empresaSel.id)
      .then(s => { if (alive) setNotasOcultasPersistidas(s); })
      .catch(e => console.error('[AnaliseCredito] listarNotasOcultas:', e));
    return () => { alive = false; };
  }, [empresaSel?.id]);

  const notasOcultasEfetivas = useMemo(() => {
    const s = new Set<string>(notasOcultas);
    for (const k of notasOcultasPersistidas) s.add(k);
    return s;
  }, [notasOcultas, notasOcultasPersistidas]);
  const [salvandoCategoriaCredito, setSalvandoCategoriaCredito] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    if (!empresaSel?.id) { setCategoriasNaoCreditaveis(new Set()); return; }
    carregarCreditConfig(empresaSel.id).then(cfg => {
      if (ativo) setCategoriasNaoCreditaveis(new Set(cfg.categoriasNaoCreditaveis));
    });
    return () => { ativo = false; };
  }, [empresaSel?.id]);

  const toggleCategoriaCredito = useCallback(async (categoria: string) => {
    if (!empresaSel?.id) return;
    if (categoria === 'SEM_CATEGORIA') return;  // sempre nao-creditavel, nao da pra mexer
    const novo = new Set(categoriasNaoCreditaveis);
    if (novo.has(categoria)) novo.delete(categoria);
    else novo.add(categoria);
    setCategoriasNaoCreditaveis(novo);  // otimista
    setSalvandoCategoriaCredito(categoria);
    const r = await salvarCreditConfig(empresaSel.id, Array.from(novo));
    setSalvandoCategoriaCredito(null);
    if (!r.ok) {
      // rollback em caso de falha
      setCategoriasNaoCreditaveis(categoriasNaoCreditaveis);
      setErro('Erro ao salvar config de crédito: ' + (r.error || 'desconhecido'));
    }
  }, [empresaSel?.id, categoriasNaoCreditaveis]);

  // Todas as opcoes de categoria do dropdown (11 fixas + custom, ordenadas A-Z).
  const todasCategorias = useMemo(() => {
    const customNomes = categoriasCustom.map(c => c.nome);
    return [...CATEGORIAS_CREDITO, ...customNomes].sort((a, b) => a.localeCompare(b));
  }, [categoriasCustom]);

  const periodoNormalizado = useMemo(
    () => efiscal ? normalizarPeriodo(efiscal.periodo) : '',
    [efiscal],
  );

  useEffect(() => {
    let ativo = true;
    if (!empresaSel?.id || !periodoNormalizado) { setInvoicesManuais([]); return; }
    listarInvoicesManuais(empresaSel.id, periodoNormalizado).then(list => {
      if (ativo) setInvoicesManuais(list);
    });
    return () => { ativo = false; };
  }, [empresaSel?.id, periodoNormalizado, invoicesVersao]);

  // Salva (ou troca) a categoria de um fornecedor na tabela CNPJ->categoria
  // da empresa. Apos salvar, recarrega os overrides -> credito recalcula.
  const [salvandoCnpj, setSalvandoCnpj] = useState<string | null>(null);

  const salvarCategoriaFornecedor = useCallback(async (
    cnpjFornecedor: string,
    razaoSocial: string,
    categoria: string,
  ) => {
    if (!empresaSel?.id) return;
    setSalvandoCnpj(cnpjFornecedor);
    const r = await salvarRegra({
      empresaId: empresaSel.id,
      cnpjFornecedor,
      razaoSocial,
      categoria,
    });
    setSalvandoCnpj(null);
    if (r.ok) {
      setOverridesVersao(v => v + 1);  // dispara reload das regras
    } else {
      setErro('Erro ao salvar categoria: ' + (r.error || 'desconhecido'));
    }
  }, [empresaSel?.id]);

  // Loading state pra dropdown de categoria de invoice manual individual.
  // Separado do salvandoCnpj porque sao tabelas diferentes (UX feedback
  // local) e nao queremos um afetar o outro.
  const [salvandoInvoiceId, setSalvandoInvoiceId] = useState<string | null>(null);

  /**
   * Salva categoria fixada de UMA invoice manual individual.
   *
   * Diferente de salvarCategoriaFornecedor (que casa por CNPJ): essa salva
   * direto no doc da invoice. Necessario porque invoices estrangeiras tem
   * CNPJ 00000000000000 — varias empresas distintas com mesmo CNPJ-zero,
   * que de outro modo compartilhariam o mesmo override (estragando uma
   * quando o usuario tenta reclassificar outra).
   */
  const salvarCategoriaInvoice = useCallback(async (
    invoiceId: string,
    categoria: string,
  ) => {
    setSalvandoInvoiceId(invoiceId);
    const r = await atualizarCategoriaInvoice(invoiceId, categoria || null);
    setSalvandoInvoiceId(null);
    if (r.ok) {
      setInvoicesVersao(v => v + 1);  // recarrega lista -> credito recalcula
    } else {
      setErro('Erro ao salvar categoria da invoice: ' + (r.error || 'desconhecido'));
    }
  }, []);

  // Credito recalcula sempre que o PDF parseado OU a empresa mudam.
  const credito = useMemo<CreditoEfiscal | null>(() => {
    if (!efiscal || !empresaSel) return null;
    const regCalc = regimeParaCalculo(empresaSel.regimeSugerido);

    // Merge invoices manuais + filtros de ocultos extraido para
    // services/analiseCreditoMerge.ts. Logica era ~150 linhas inline aqui;
    // agora eh testavel sem render. Documentacao das regras de negocio
    // (chave sintetica __inv__, desconto de NFs individuais, etc) vive la.
    const { fornFiltrados, notasFiltradas, overridesSinteticos } = mesclarInvoicesEFiltrarOcultos({
      efiscal,
      invoicesManuais,
      overrides,
      fornecedoresOcultos: fornecedoresOcultosEfetivos,
      notasOcultas: notasOcultasEfetivas,
    });

    return calcularCreditoEfiscal(fornFiltrados, regCalc, notasFiltradas, overridesSinteticos, categoriasNaoCreditaveis);
  }, [efiscal, empresaSel, overrides, invoicesManuais, categoriasNaoCreditaveis, fornecedoresOcultosEfetivos, notasOcultasEfetivas]);

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

  // Categoria expandida na tabela de distribuicao (mostra as NFs do grupo)
  const [catExpandida, setCatExpandida] = useState<string | null>(null);

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

  const exportarEfiscalPdf = async () => {
    if (!efiscal) return;
    try {
      const blob = await gerarEfiscalPdf(efiscal, credito);
      baixarBlob(blob, `Analise_Creditos_${efiscal.empresaCodigo}_${new Date().toISOString().slice(0,10)}.pdf`);
    } catch (e) {
      console.error(e);
      setErro('Erro ao gerar PDF: ' + (e instanceof Error ? e.message : 'desconhecido'));
    }
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
      const blob = await gerarExtratoPdf({
        lancamentos,
        categoriasCredito: CATEGORIAS_CREDITO,
        baseCreditos, creditoPis, creditoCofins, creditoTotal,
      });
      baixarBlob(blob, 'relatorio_creditos_pis_cofins_' + new Date().toISOString().slice(0, 10) + '.pdf');
    } catch (e) {
      console.error(e);
      setErro('Erro ao gerar PDF: ' + (e instanceof Error ? e.message : 'desconhecido'));
    } finally {
      setExportandoPDF(false);
    }
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
        <button
          onClick={() => { setModo('nfsesp'); setErro(null); }}
          className={`px-4 py-2 rounded-xl text-sm font-semibold ${modo==='nfsesp'?'bg-teal-600 text-white':'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600'}`}
        >
          🔍 Auditoria de Retenções (CSV NFSe SP)
        </button>
      </div>

      {modo === 'nfsesp' && <AnaliseRetencoesNfseSP currentUser={currentUser} />}

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
          className={`border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 text-center cursor-pointer hover:border-teal-400 transition-all ${empresaSelId ? '' : 'opacity-40 pointer-events-none'}`}
          onClick={() => empresaSelId && document.getElementById('input-efiscal')?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); onFileEfiscal(e.dataTransfer.files?.[0] ?? null); }}
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

          {/* Tabela de categorias agrupadas — expansivel */}
          {credito && credito.categorias.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                <h3 className="font-semibold text-gray-700 dark:text-gray-200 text-sm">Distribuição por Categoria</h3>
                <p className="text-[11px] text-gray-400 mt-0.5">Clique numa categoria para ver as notas fiscais do grupo.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium w-8"></th>
                      <th className="px-3 py-2 text-left font-medium">Categoria</th>
                      <th className="px-3 py-2 text-right font-medium">Fornecedores</th>
                      <th className="px-3 py-2 text-right font-medium">NFs</th>
                      <th className="px-3 py-2 text-right font-medium">Base de Cálculo</th>
                      <th className="px-3 py-2 text-center font-medium">Crédito</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {credito.categorias.map((cat) => {
                      const chave = String(cat.categoria);
                      const aberta = catExpandida === chave;
                      const label = cat.categoria === 'SEM_CATEGORIA' ? '— Sem categoria —' : cat.categoria;
                      return (
                        <React.Fragment key={chave}>
                          <tr
                            onClick={() => setCatExpandida(aberta ? null : chave)}
                            className="hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer"
                          >
                            <td className="px-3 py-2 text-gray-400 select-none">{aberta ? '▾' : '▸'}</td>
                            <td className="px-3 py-2 text-gray-800 dark:text-gray-200 font-medium">{label}</td>
                            <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{cat.qtdFornecedores}</td>
                            <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{cat.qtdNotas}</td>
                            <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${cat.creditavel ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500 line-through'}`}>
                              R$ {brl(cat.creditavel ? cat.somaBaseCalculo : 0)}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {cat.categoria === 'SEM_CATEGORIA' ? (
                                <span className="text-[10px] text-gray-400 italic">não gera crédito</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); toggleCategoriaCredito(cat.categoria); }}
                                  disabled={!empresaSel?.id || salvandoCategoriaCredito === cat.categoria}
                                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors disabled:opacity-50 ${
                                    cat.creditavel
                                      ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300 hover:bg-green-100'
                                      : 'bg-gray-100 border-gray-300 text-gray-500 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-400 hover:bg-gray-200'
                                  }`}
                                  title={empresaSel?.id ? 'Alternar: gera / não gera crédito PIS/COFINS' : 'Selecione a empresa primeiro'}
                                >
                                  {salvandoCategoriaCredito === cat.categoria
                                    ? 'salvando…'
                                    : cat.creditavel ? '✓ gera crédito' : '✗ não gera crédito'}
                                </button>
                              )}
                            </td>
                          </tr>
                          {aberta && (
                            <tr>
                              <td colSpan={6} className="bg-gray-50 dark:bg-gray-900/40 px-3 py-3">
                                <div className="overflow-x-auto">
                                  <table className="min-w-full text-[11px]">
                                    <thead className="text-gray-500 dark:text-gray-400 uppercase">
                                      <tr>
                                        <th className="px-2 py-1 text-left font-medium">Emissão</th>
                                        <th className="px-2 py-1 text-left font-medium">Número</th>
                                        <th className="px-2 py-1 text-left font-medium">Série</th>
                                        <th className="px-2 py-1 text-left font-medium">CNPJ/CPF</th>
                                        <th className="px-2 py-1 text-left font-medium">Razão Social</th>
                                        <th className="px-2 py-1 text-right font-medium">Valor NF</th>
                                        <th className="px-2 py-1 text-right font-medium">Base Cálculo</th>
                                        <th className="px-2 py-1 text-right font-medium">Alíq.</th>
                                        <th className="px-2 py-1 text-right font-medium">Valor ISS</th>
                                        <th className="px-2 py-1 text-right font-medium">Iss Retido</th>
                                        <th className="px-2 py-1 text-center font-medium">Ações</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                      {cat.notas.map((nf, j) => (
                                        <tr key={j}>
                                          <td className="px-2 py-1 text-gray-600 dark:text-gray-400 whitespace-nowrap">{nf.emissao}</td>
                                          <td className="px-2 py-1 text-gray-600 dark:text-gray-400">{nf.numero}</td>
                                          <td className="px-2 py-1 text-gray-600 dark:text-gray-400">{nf.serie || '—'}</td>
                                          <td className="px-2 py-1 text-gray-600 dark:text-gray-400 font-mono whitespace-nowrap">{nf.cnpjCpf}</td>
                                          <td className="px-2 py-1 text-gray-700 dark:text-gray-300">{nf.razaoSocial}</td>
                                          <td className="px-2 py-1 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">R$ {brl(nf.valorNf)}</td>
                                          <td className={`px-2 py-1 text-right whitespace-nowrap font-semibold ${cat.creditavel ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500 line-through'}`}>
                                            R$ {brl(cat.creditavel ? nf.baseCalculo : 0)}
                                          </td>
                                          <td className="px-2 py-1 text-right text-gray-600 dark:text-gray-400">{nf.aliquota ? nf.aliquota.toFixed(2) : '—'}</td>
                                          <td className="px-2 py-1 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">R$ {brl(nf.valorIss)}</td>
                                          <td className="px-2 py-1 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">R$ {brl(nf.issRetido)}</td>
                                          <td className="px-2 py-1 text-center">
                                            <button
                                              type="button"
                                              onClick={() => setConfirmandoExclusaoNf({
                                                cnpj: nf.cnpjCpf,
                                                razaoSocial: nf.razaoSocial,
                                                numero: nf.numero,
                                                serie: nf.serie || '',
                                                emissao: nf.emissao,
                                                valorNf: nf.valorNf,
                                              })}
                                              className="text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 transition-colors p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                                              title="Excluir somente esta NF (mantem outras NFs do mesmo prestador)"
                                            >
                                              🗑️
                                            </button>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  {cat.notas.length === 0 && (
                                    <p className="text-gray-400 py-2">Nenhuma NF neste grupo.</p>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
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

          {/* Listagem das invoices manuais cadastradas (se houver) */}
          {invoicesManuais.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-3">
              <h4 className="font-semibold text-amber-800 dark:text-amber-200 text-xs uppercase mb-2">
                Invoices manuais cadastradas ({invoicesManuais.length})
              </h4>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="text-amber-700 dark:text-amber-300">
                    <tr>
                      <th className="px-2 py-1 text-left">Emissão</th>
                      <th className="px-2 py-1 text-left">Número</th>
                      <th className="px-2 py-1 text-left">CNPJ</th>
                      <th className="px-2 py-1 text-left">Razão Social</th>
                      <th className="px-2 py-1 text-left">Categoria</th>
                      <th className="px-2 py-1 text-right">Valor NF</th>
                      <th className="px-2 py-1 text-right">Base Cálc.</th>
                      <th className="px-2 py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoicesManuais.map(im => (
                      <tr key={im.id} className="border-t border-amber-200/40">
                        <td className="px-2 py-1">{im.emissao || '—'}</td>
                        <td className="px-2 py-1">{im.numero || '—'}</td>
                        <td className="px-2 py-1 font-mono">{im.cnpjCpf}</td>
                        <td className="px-2 py-1">{im.razaoSocial}</td>
                        <td className="px-2 py-1">
                          <select
                            value={im.categoria || ''}
                            disabled={salvandoInvoiceId === im.id}
                            onChange={e => {
                              const v = e.target.value;
                              if (v === '__gerenciar__') {
                                setModalCategoriasAberto(true);
                                return;
                              }
                              salvarCategoriaInvoice(im.id, v);
                            }}
                            className="text-xs bg-transparent border border-amber-300 dark:border-amber-700 rounded px-1.5 py-0.5 text-gray-700 dark:text-gray-200 disabled:opacity-50"
                            title="Categoria fixada desta invoice (substitui a classificação automática)"
                          >
                            <option value="">— auto (pela razão social) —</option>
                            {todasCategorias.map(cat => (
                              <option key={cat} value={cat}>{cat}</option>
                            ))}
                            <option value="__gerenciar__">⚙️ Gerenciar categorias…</option>
                          </select>
                          {salvandoInvoiceId === im.id && (
                            <span className="ml-1 text-[10px] text-gray-400">salvando…</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right">R$ {brl(Number(im.valorNf) || 0)}</td>
                        <td className="px-2 py-1 text-right font-semibold">R$ {brl(Number(im.baseCalculo) || 0)}</td>
                        <td className="px-2 py-1 text-right">
                          <button
                            onClick={async () => {
                              if (!confirm('Remover esta invoice manual?')) return;
                              const r = await removerInvoice(im.id);
                              if (r.ok) setInvoicesVersao(v => v + 1);
                              else setErro('Erro ao remover: ' + (r.error || ''));
                            }}
                            className="text-red-600 hover:text-red-800 text-xs"
                            title="Remover invoice manual"
                          >🗑️</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Exportar / Adicionar */}
          <div className="flex justify-end gap-2 flex-wrap">
            <button
              onClick={() => setModalInvoiceAberto(true)}
              disabled={!empresaSel?.id || !efiscal}
              className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              title={empresaSel?.id && efiscal ? 'Adicionar uma invoice manual a este período' : 'Selecione empresa e suba o PDF primeiro'}
            >
              ➕ Adicionar invoice
            </button>
            <button onClick={exportarEfiscalXlsx}
              className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm">
              📥 Exportar fornecedores .xlsx
            </button>
            <button onClick={exportarEfiscalPdf}
              className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm">
              📄 Exportar relatório PDF
            </button>
          </div>

          {/* Modal: cadastrar invoice manual */}
          {modalInvoiceAberto && empresaSel?.id && periodoNormalizado && (
            <ModalInvoiceManual
              empresaId={empresaSel.id}
              periodoNormalizado={periodoNormalizado}
              onFechar={() => setModalInvoiceAberto(false)}
              onSalvo={() => setInvoicesVersao(v => v + 1)}
            />
          )}

          {/* Modal: gerenciar categorias customizadas */}
          {modalCategoriasAberto && (
            <ModalGerenciarCategorias
              onFechar={() => setModalCategoriasAberto(false)}
              onMudou={() => setCategoriasVersao(v => v + 1)}
            />
          )}

          {/* Tabela de fornecedores agrupados */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">CNPJ/CPF</th>
                    <th className="px-3 py-2 text-left font-medium">Razão Social</th>
                    <th className="px-3 py-2 text-left font-medium">Categoria</th>
                    <th className="px-3 py-2 text-right font-medium">Qtd NFs</th>
                    <th className="px-3 py-2 text-right font-medium">Valor das NFs</th>
                    <th className="px-3 py-2 text-right font-medium">Base de Cálculo</th>
                    <th className="px-3 py-2 text-right font-medium">ISS Retido</th>
                    <th className="px-3 py-2 text-center font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {(credito ? credito.fornecedoresClassificados : efiscal.fornecedores).map((f: any, i: number) => {
                    const naoCreditavel = !f.categoria || categoriasNaoCreditaveis.has(f.categoria);
                    // Base de Calculo agora reflete a BASE EFETIVA (valor NF se gera credito,
                    // 0 se nao gera). Fallback `somaBaseCalculo` cobre o caso pre-credito
                    // (modo CSV ou variante sem classificacao).
                    const baseExibir = naoCreditavel
                      ? 0
                      : (typeof f.somaBaseEfetiva === 'number' ? f.somaBaseEfetiva : f.somaBaseCalculo);
                    return (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap font-mono">{f.cnpjCpf}</td>
                      <td className="px-3 py-2 text-gray-800 dark:text-gray-200 font-medium">{f.razaoSocial}</td>
                      <td className="px-3 py-2">
                        <select
                          value={f.categoria ?? ''}
                          disabled={!empresaSel?.id || salvandoCnpj === f.cnpjCpf}
                          onChange={e => {
                            const v = e.target.value;
                            if (v === '__gerenciar__') {
                              setModalCategoriasAberto(true);
                              return;
                            }
                            // "" (sem categoria) salva como string vazia — permite desclassificar
                            salvarCategoriaFornecedor(f.cnpjCpf, f.razaoSocial, v);
                          }}
                          className="text-xs bg-transparent border border-gray-200 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-700 dark:text-gray-200 disabled:opacity-50"
                          title={empresaSel?.id ? 'Definir categoria — salva como regra para esta empresa' : 'Selecione a empresa primeiro'}
                        >
                          <option value="">— sem categoria —</option>
                          {todasCategorias.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                          <option value="__gerenciar__">⚙️ Gerenciar categorias…</option>
                        </select>
                        {salvandoCnpj === f.cnpjCpf && (
                          <span className="ml-1 text-[10px] text-gray-400">salvando…</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{f.qtdNotas}</td>
                      <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">R$ {brl(f.somaValorNf)}</td>
                      <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${naoCreditavel ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-800 dark:text-gray-200'}`}>
                        R$ {brl(baseExibir)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">R$ {brl(f.somaIssRetido)}</td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => setConfirmandoExclusao({
                            cnpj: f.cnpjCpf,
                            razaoSocial: f.razaoSocial,
                            qtdNotas: f.qtdNotas,
                            somaValorNf: f.somaValorNf,
                          })}
                          className="text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 transition-colors p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                          title="Excluir este fornecedor da analise (some desta sessao)"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Banner de restaurar — aparece quando ha fornecedores OU notas ocultas */}
            {(fornecedoresOcultosEfetivos.size > 0 || notasOcultasEfetivas.size > 0) && (
              <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 bg-amber-50 dark:bg-amber-900/20 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between gap-3">
                <span>
                  {fornecedoresOcultosEfetivos.size > 0 && (
                    <>
                      {fornecedoresOcultosEfetivos.size} fornecedor{fornecedoresOcultosEfetivos.size > 1 ? 'es' : ''} oculto{fornecedoresOcultosEfetivos.size > 1 ? 's' : ''}
                      {fornecedoresOcultosPersistidos.size > 0 && (
                        <span className="text-amber-700 dark:text-amber-300 ml-1">
                          ({fornecedoresOcultosPersistidos.size} 🔒)
                        </span>
                      )}
                    </>
                  )}
                  {fornecedoresOcultosEfetivos.size > 0 && notasOcultasEfetivas.size > 0 && ' e '}
                  {notasOcultasEfetivas.size > 0 && (
                    <>
                      {notasOcultasEfetivas.size} NF{notasOcultasEfetivas.size > 1 ? 's' : ''} oculta{notasOcultasEfetivas.size > 1 ? 's' : ''}
                      {notasOcultasPersistidas.size > 0 && (
                        <span className="text-amber-700 dark:text-amber-300 ml-1">
                          ({notasOcultasPersistidas.size} 🔒)
                        </span>
                      )}
                    </>
                  )}
                  {' '}desta analise.
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    setFornecedoresOcultos(new Set());
                    setNotasOcultas(new Set());
                    const totalPersistidos = fornecedoresOcultosPersistidos.size + notasOcultasPersistidas.size;
                    if (totalPersistidos > 0 && empresaSel?.id) {
                      const ok = window.confirm(
                        `Tambem restaurar ${totalPersistidos} regra(s) persistente(s)?\n` +
                        `(isso apaga as regras do Firestore — sera reversivel apenas excluindo de novo).`
                      );
                      if (ok) {
                        if (fornecedoresOcultosPersistidos.size > 0) {
                          const r = await restaurarTodosOcultos(empresaSel.id);
                          if (r.ok) setFornecedoresOcultosPersistidos(new Set());
                          else alert('Erro ao restaurar fornecedores persistentes: ' + (r.error || 'desconhecido'));
                        }
                        if (notasOcultasPersistidas.size > 0) {
                          const r = await restaurarTodasNotasOcultas(empresaSel.id);
                          if (r.ok) setNotasOcultasPersistidas(new Set());
                          else alert('Erro ao restaurar NFs persistentes: ' + (r.error || 'desconhecido'));
                        }
                      }
                    }
                  }}
                  className="px-2 py-0.5 rounded border border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-800/40 font-medium whitespace-nowrap"
                >
                  Restaurar
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Modal de confirmacao de exclusao de fornecedor (HIBRIDO: local OR persistido) */}
      {confirmandoExclusao && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[80] animate-fade-in"
          onClick={() => !salvandoExclusaoPersistida && setConfirmandoExclusao(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md p-6"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2">
              Excluir fornecedor desta analise?
            </h3>
            <div className="text-sm text-gray-600 dark:text-gray-400 mb-4 space-y-1">
              <div><span className="font-medium text-gray-800 dark:text-gray-200">{confirmandoExclusao.razaoSocial}</span></div>
              <div className="font-mono text-xs">CNPJ {confirmandoExclusao.cnpj}</div>
              <div className="text-xs">{confirmandoExclusao.qtdNotas} NF{confirmandoExclusao.qtdNotas > 1 ? 's' : ''} no valor total de R$ {brl(confirmandoExclusao.somaValorNf)}</div>
            </div>

            <div className="space-y-2 mb-4">
              {/* Opcao 1: SO DESTA VEZ (local) */}
              <button
                type="button"
                disabled={salvandoExclusaoPersistida}
                onClick={() => {
                  setFornecedoresOcultos(prev => {
                    const next = new Set(prev);
                    next.add(cnpjKey(confirmandoExclusao.cnpj));
                    return next;
                  });
                  setConfirmandoExclusao(null);
                }}
                className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-50"
              >
                <div className="font-medium text-gray-800 dark:text-gray-200 text-sm">
                  📋 So desta vez
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Some apenas nesta sessao. Ao recarregar o PDF, fornecedor volta a aparecer.
                </div>
              </button>

              {/* Opcao 2: SEMPRE NESSA EMPRESA (persistido) */}
              <button
                type="button"
                disabled={salvandoExclusaoPersistida || !empresaSel?.id}
                onClick={async () => {
                  if (!empresaSel?.id) return;
                  setSalvandoExclusaoPersistida(true);
                  const r = await ocultarFornecedor({
                    empresaId: empresaSel.id,
                    cnpjFornecedor: confirmandoExclusao.cnpj,
                    razaoSocial: confirmandoExclusao.razaoSocial,
                  });
                  setSalvandoExclusaoPersistida(false);
                  if (r.ok) {
                    setFornecedoresOcultosPersistidos(prev => {
                      const next = new Set(prev);
                      next.add(cnpjKey(confirmandoExclusao.cnpj));
                      return next;
                    });
                    setConfirmandoExclusao(null);
                  } else {
                    alert('Erro ao salvar regra: ' + (r.error || 'desconhecido'));
                  }
                }}
                className="w-full text-left p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50/40 dark:bg-red-900/10 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                title={empresaSel?.id ? '' : 'Selecione uma empresa para criar regra persistente'}
              >
                <div className="font-medium text-red-700 dark:text-red-300 text-sm">
                  🔒 Sempre nessa empresa {salvandoExclusaoPersistida && '(salvando...)'}
                </div>
                <div className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5">
                  Cadastra regra no sistema: esse fornecedor sera ignorado em toda analise futura desta empresa. Reversivel.
                </div>
              </button>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                disabled={salvandoExclusaoPersistida}
                onClick={() => setConfirmandoExclusao(null)}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 font-medium hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmacao de exclusao de UMA NF (HIBRIDO local/persistido) */}
      {confirmandoExclusaoNf && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[80] animate-fade-in"
          onClick={() => !salvandoExclusaoNfPersistida && setConfirmandoExclusaoNf(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md p-6"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2">
              Excluir esta NF da analise?
            </h3>
            <div className="text-sm text-gray-600 dark:text-gray-400 mb-4 space-y-1">
              <div><span className="font-medium text-gray-800 dark:text-gray-200">{confirmandoExclusaoNf.razaoSocial}</span></div>
              <div className="font-mono text-xs">CNPJ {confirmandoExclusaoNf.cnpj}</div>
              <div className="text-xs">
                NF nº {confirmandoExclusaoNf.numero}
                {confirmandoExclusaoNf.serie && ` série ${confirmandoExclusaoNf.serie}`}
                {' '}— emitida em {confirmandoExclusaoNf.emissao}
              </div>
              <div className="text-xs">Valor: R$ {brl(confirmandoExclusaoNf.valorNf)}</div>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-3 italic">
              Apenas esta NF — outras NFs deste mesmo prestador continuam na analise.
            </div>

            <div className="space-y-2 mb-4">
              <button
                type="button"
                disabled={salvandoExclusaoNfPersistida}
                onClick={() => {
                  setNotasOcultas(prev => {
                    const next = new Set(prev);
                    next.add(nfChave(confirmandoExclusaoNf.cnpj, confirmandoExclusaoNf.numero, confirmandoExclusaoNf.serie));
                    return next;
                  });
                  setConfirmandoExclusaoNf(null);
                }}
                className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 disabled:opacity-50"
              >
                <div className="font-medium text-gray-800 dark:text-gray-200 text-sm">📋 So desta vez</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Some apenas nesta sessao. Ao recarregar o PDF, volta a aparecer.
                </div>
              </button>

              <button
                type="button"
                disabled={salvandoExclusaoNfPersistida || !empresaSel?.id}
                onClick={async () => {
                  if (!empresaSel?.id) return;
                  setSalvandoExclusaoNfPersistida(true);
                  const r = await ocultarNota({
                    empresaId: empresaSel.id,
                    cnpjFornecedor: confirmandoExclusaoNf.cnpj,
                    numero: confirmandoExclusaoNf.numero,
                    serie: confirmandoExclusaoNf.serie,
                    razaoSocial: confirmandoExclusaoNf.razaoSocial,
                  });
                  setSalvandoExclusaoNfPersistida(false);
                  if (r.ok) {
                    setNotasOcultasPersistidas(prev => {
                      const next = new Set(prev);
                      next.add(nfChave(confirmandoExclusaoNf.cnpj, confirmandoExclusaoNf.numero, confirmandoExclusaoNf.serie));
                      return next;
                    });
                    setConfirmandoExclusaoNf(null);
                  } else {
                    alert('Erro ao salvar regra: ' + (r.error || 'desconhecido'));
                  }
                }}
                className="w-full text-left p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50/40 dark:bg-red-900/10 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                title={empresaSel?.id ? '' : 'Selecione uma empresa para criar regra persistente'}
              >
                <div className="font-medium text-red-700 dark:text-red-300 text-sm">
                  🔒 Sempre nessa empresa {salvandoExclusaoNfPersistida && '(salvando...)'}
                </div>
                <div className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5">
                  Cadastra regra: esta NF especifica (numero+serie) sera ignorada sempre que reimportar PDFs desta empresa.
                </div>
              </button>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                disabled={salvandoExclusaoNfPersistida}
                onClick={() => setConfirmandoExclusaoNf(null)}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 font-medium hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
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
