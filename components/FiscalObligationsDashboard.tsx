import React, { useState, useMemo } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Regime = 'todos' | 'simples' | 'lucro_presumido' | 'lucro_real' | 'mei';
type Periodicidade = 'mensal' | 'trimestral' | 'anual' | 'eventual';
type Status = 'ok' | 'alerta' | 'vencendo' | 'vencido';

interface Obrigacao {
  id: string;
  nome: string;
  sigla: string;
  orgao: string;
  regimes: Regime[];
  periodicidade: Periodicidade;
  diaVencimento: number | string;
  descricao: string;
  penalidade: string;
  categoria: 'federal' | 'estadual' | 'municipal' | 'trabalhista' | 'previdenciaria';
  requerResponsavel?: boolean;
}

interface AlertaConfig {
  id: string;
  obrigacaoId: string;
  responsavel: string;
  email: string;
  diasAntecedencia: number;
  ativo: boolean;
}

// ─── Dados das Obrigações ─────────────────────────────────────────────────────

const OBRIGACOES: Obrigacao[] = [
  // FEDERAIS
  {
    id: 'das', nome: 'DAS - Documento de Arrecadação do Simples Nacional', sigla: 'DAS',
    orgao: 'Receita Federal', regimes: ['simples', 'mei'], periodicidade: 'mensal',
    diaVencimento: 20, descricao: 'Recolhimento unificado dos tributos do Simples Nacional (IRPJ, CSLL, PIS, COFINS, IPI, ICMS, ISS e CPP).',
    penalidade: 'Multa de 0,33% ao dia (máx 20%) + juros SELIC', categoria: 'federal', requerResponsavel: true,
  },
  {
    id: 'dasn', nome: 'DASN - Declaração Anual do Simples Nacional', sigla: 'DASN',
    orgao: 'Receita Federal', regimes: ['simples'], periodicidade: 'anual',
    diaVencimento: '31/03', descricao: 'Declaração anual de faturamento das empresas do Simples Nacional.',
    penalidade: 'Multa de R$ 100,00 por mês ou fração de atraso', categoria: 'federal', requerResponsavel: true,
  },
  {
    id: 'defis', nome: 'DEFIS - Declaração de Informações Socioeconômicas e Fiscais', sigla: 'DEFIS',
    orgao: 'Receita Federal', regimes: ['simples'], periodicidade: 'anual',
    diaVencimento: '31/03', descricao: 'Declaração com informações socioeconômicas e fiscais das empresas do Simples Nacional.',
    penalidade: 'Multa de R$ 500,00 por mês ou fração', categoria: 'federal',
  },
  {
    id: 'dctf', nome: 'DCTF - Declaração de Débitos e Créditos Tributários Federais', sigla: 'DCTF',
    orgao: 'Receita Federal', regimes: ['lucro_presumido', 'lucro_real'], periodicidade: 'mensal',
    diaVencimento: 15, descricao: 'Declaração mensal dos débitos e créditos de tributos federais (IRPJ, CSLL, PIS, COFINS, IPI, IRRF).',
    penalidade: 'Multa de 2% ao mês (máx 20%) sobre o valor dos tributos declarados', categoria: 'federal', requerResponsavel: true,
  },
  {
    id: 'sped_contabil', nome: 'SPED Contábil - ECD', sigla: 'ECD',
    orgao: 'Receita Federal', regimes: ['lucro_presumido', 'lucro_real'], periodicidade: 'anual',
    diaVencimento: '31/05', descricao: 'Escrituração Contábil Digital — substituição dos livros contábeis em papel.',
    penalidade: 'Multa de R$ 500,00 por mês, podendo chegar a R$ 5.000,00', categoria: 'federal', requerResponsavel: true,
  },
  {
    id: 'ecf', nome: 'ECF - Escrituração Contábil Fiscal', sigla: 'ECF',
    orgao: 'Receita Federal', regimes: ['lucro_presumido', 'lucro_real'], periodicidade: 'anual',
    diaVencimento: '31/07', descricao: 'Substituição da DIPJ — informações do IRPJ e CSLL das pessoas jurídicas.',
    penalidade: 'Multa de 0,25% sobre a Receita Bruta por mês de atraso (máx 10%)', categoria: 'federal', requerResponsavel: true,
  },
  {
    id: 'efd_contribuicoes', nome: 'EFD Contribuições', sigla: 'EFD-Contrib',
    orgao: 'Receita Federal', regimes: ['lucro_presumido', 'lucro_real'], periodicidade: 'mensal',
    diaVencimento: 10, descricao: 'Escrituração Fiscal Digital do PIS/COFINS e Contribuição Previdenciária sobre Receita Bruta.',
    penalidade: 'Multa de R$ 500,00 por mês ou fração', categoria: 'federal', requerResponsavel: true,
  },
  {
    id: 'efd_icms', nome: 'EFD ICMS/IPI - SPED Fiscal', sigla: 'SPED Fiscal',
    orgao: 'SEFAZ Estadual', regimes: ['lucro_presumido', 'lucro_real', 'simples'], periodicidade: 'mensal',
    diaVencimento: 15, descricao: 'Escrituração Fiscal Digital do ICMS e IPI — escrituração dos livros fiscais.',
    penalidade: 'Varia por estado. Em SP: R$ 1.500,00 a R$ 15.000,00', categoria: 'estadual', requerResponsavel: true,
  },
  {
    id: 'reinf', nome: 'EFD-Reinf - Escrituração Fiscal Digital de Retenções', sigla: 'REINF',
    orgao: 'Receita Federal', regimes: ['lucro_presumido', 'lucro_real'], periodicidade: 'mensal',
    diaVencimento: 15, descricao: 'Retenções na fonte (IRRF, CSLL, PIS, COFINS) e informações sobre receita bruta para apuração da CPRB.',
    penalidade: 'Multa de R$ 500,00 por grupo de 10 registros omitidos', categoria: 'previdenciaria', requerResponsavel: true,
  },
  {
    id: 'esocial', nome: 'eSocial — Eventos Trabalhistas e Previdenciários', sigla: 'eSocial',
    orgao: 'Receita Federal / MTE', regimes: ['simples', 'lucro_presumido', 'lucro_real', 'mei'], periodicidade: 'mensal',
    diaVencimento: 7, descricao: 'Informações trabalhistas, previdenciárias e fiscais relativas à relação de trabalho.',
    penalidade: 'Multa de R$ 402,53 a R$ 805,06 por trabalhador', categoria: 'trabalhista', requerResponsavel: true,
  },
  {
    id: 'gfip', nome: 'GFIP/SEFIP - Guia de Recolhimento do FGTS', sigla: 'GFIP',
    orgao: 'Caixa Econômica / Receita Federal', regimes: ['simples', 'lucro_presumido', 'lucro_real'], periodicidade: 'mensal',
    diaVencimento: 7, descricao: 'Informações à Previdência Social e recolhimento do FGTS dos empregados.',
    penalidade: 'Multa de 2% sobre o montante recolhido (mín R$ 200,00)', categoria: 'previdenciaria',
  },
  {
    id: 'dirf', nome: 'DIRF - Declaração do Imposto de Renda Retido na Fonte', sigla: 'DIRF',
    orgao: 'Receita Federal', regimes: ['simples', 'lucro_presumido', 'lucro_real'], periodicidade: 'anual',
    diaVencimento: '28/02', descricao: 'Declaração das retenções de IRRF efetuadas sobre rendimentos pagos ou creditados.',
    penalidade: 'Multa de R$ 500,00 por mês ou fração', categoria: 'federal', requerResponsavel: true,
  },
  {
    id: 'rais', nome: 'RAIS - Relação Anual de Informações Sociais', sigla: 'RAIS',
    orgao: 'Ministério do Trabalho', regimes: ['simples', 'lucro_presumido', 'lucro_real', 'mei'], periodicidade: 'anual',
    diaVencimento: '31/03', descricao: 'Informações sobre os trabalhadores ao Ministério do Trabalho e Emprego.',
    penalidade: 'Multa de R$ 425,64 + R$ 106,40 por bimestre em atraso', categoria: 'trabalhista',
  },
  {
    id: 'caged', nome: 'CAGED - Cadastro Geral de Empregados e Desempregados', sigla: 'CAGED',
    orgao: 'Ministério do Trabalho', regimes: ['simples', 'lucro_presumido', 'lucro_real'], periodicidade: 'mensal',
    diaVencimento: 7, descricao: 'Informações mensais sobre admissões, demissões e transferências de empregados.',
    penalidade: 'Multa de R$ 402,53 por informação omitida', categoria: 'trabalhista',
  },
  {
    id: 'nfe', nome: 'NF-e / NFS-e — Nota Fiscal Eletrônica', sigla: 'NF-e',
    orgao: 'SEFAZ / Prefeitura', regimes: ['todos'], periodicidade: 'eventual',
    diaVencimento: 'Por operação', descricao: 'Emissão obrigatória de Nota Fiscal Eletrônica para operações de venda de produtos (NF-e) ou serviços (NFS-e).',
    penalidade: 'Multa de 75% do valor do tributo omitido + 150% em caso de fraude', categoria: 'estadual',
  },
  // REFORMA TRIBUTÁRIA
  {
    id: 'ibs_cbs', nome: 'IBS/CBS — Imposto sobre Bens e Serviços (Reforma Tributária)', sigla: 'IBS/CBS',
    orgao: 'Comitê Gestor / Receita Federal', regimes: ['todos'], periodicidade: 'mensal',
    diaVencimento: 'A definir (transição 2026-2033)', descricao: 'Substituição gradual do ICMS, ISS, PIS e COFINS. Período de transição: 2026 a 2033 conforme EC 132/2023.',
    penalidade: 'A regulamentar', categoria: 'federal',
  },
];

// ─── Utils ────────────────────────────────────────────────────────────────────

const getDiasParaVencimento = (diaVencimento: number | string): number | null => {
  if (typeof diaVencimento !== 'number') return null;
  const hoje = new Date();
  const vencimento = new Date(hoje.getFullYear(), hoje.getMonth(), diaVencimento);
  if (vencimento < hoje) vencimento.setMonth(vencimento.getMonth() + 1);
  return Math.ceil((vencimento.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
};

const getStatus = (dias: number | null): Status => {
  if (dias === null) return 'ok';
  if (dias < 0) return 'vencido';
  if (dias <= 3) return 'vencendo';
  if (dias <= 7) return 'alerta';
  return 'ok';
};

const REGIME_LABELS: Record<Regime, string> = {
  todos: 'Todos', simples: 'Simples Nacional', lucro_presumido: 'Lucro Presumido',
  lucro_real: 'Lucro Real', mei: 'MEI',
};

const CATEGORIA_COLORS: Record<string, string> = {
  federal: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  estadual: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  municipal: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  trabalhista: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  previdenciaria: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
};

const STATUS_CONFIG: Record<Status, { bg: string; text: string; label: string; icon: string }> = {
  ok:       { bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-600 dark:text-emerald-400', label: 'Em dia', icon: '✓' },
  alerta:   { bg: 'bg-yellow-50 dark:bg-yellow-900/20', text: 'text-yellow-600 dark:text-yellow-400', label: 'Atenção', icon: '⚠' },
  vencendo: { bg: 'bg-orange-50 dark:bg-orange-900/20', text: 'text-orange-600 dark:text-orange-400', label: 'Vencendo', icon: '🔥' },
  vencido:  { bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-600 dark:text-red-400', label: 'Vencido', icon: '✕' },
};

// ─── Component ────────────────────────────────────────────────────────────────

const FiscalObligationsDashboard: React.FC = () => {
  const [regimeFiltro, setRegimeFiltro] = useState<Regime>('todos');
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>('todos');
  const [periodicidadeFiltro, setPeriodicidadeFiltro] = useState<string>('todos');
  const [busca, setBusca] = useState('');
  const [alertas, setAlertas] = useState<AlertaConfig[]>([]);
  const [showAlertaModal, setShowAlertaModal] = useState(false);
  const [obrigacaoSelecionada, setObrigacaoSelecionada] = useState<Obrigacao | null>(null);
  const [novoAlerta, setNovoAlerta] = useState({ responsavel: '', email: '', diasAntecedencia: 5 });
  const [expandido, setExpandido] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const obrigacoesFiltradas = useMemo(() => {
    return OBRIGACOES.filter(o => {
      const matchRegime = regimeFiltro === 'todos' || o.regimes.includes(regimeFiltro) || o.regimes.includes('todos');
      const matchCategoria = categoriaFiltro === 'todos' || o.categoria === categoriaFiltro;
      const matchPeriodicidade = periodicidadeFiltro === 'todos' || o.periodicidade === periodicidadeFiltro;
      const matchBusca = !busca || o.nome.toLowerCase().includes(busca.toLowerCase()) || o.sigla.toLowerCase().includes(busca.toLowerCase());
      return matchRegime && matchCategoria && matchPeriodicidade && matchBusca;
    });
  }, [regimeFiltro, categoriaFiltro, periodicidadeFiltro, busca]);

  // Agrupar por periodicidade para o calendário
  const porPeriodicidade = useMemo(() => ({
    mensal: obrigacoesFiltradas.filter(o => o.periodicidade === 'mensal'),
    trimestral: obrigacoesFiltradas.filter(o => o.periodicidade === 'trimestral'),
    anual: obrigacoesFiltradas.filter(o => o.periodicidade === 'anual'),
    eventual: obrigacoesFiltradas.filter(o => o.periodicidade === 'eventual'),
  }), [obrigacoesFiltradas]);

  // Alertas ativos para obrigações
  const getAlertasObrigacao = (id: string) => alertas.filter(a => a.obrigacaoId === id && a.ativo);

  const handleSalvarAlerta = () => {
    if (!obrigacaoSelecionada || !novoAlerta.responsavel || !novoAlerta.email) return;
    const alerta: AlertaConfig = {
      id: Date.now().toString(),
      obrigacaoId: obrigacaoSelecionada.id,
      ...novoAlerta,
      ativo: true,
    };
    setAlertas(prev => [...prev, alerta]);
    setShowAlertaModal(false);
    setNovoAlerta({ responsavel: '', email: '', diasAntecedencia: 5 });
    showToast(`✅ Alerta configurado para ${obrigacaoSelecionada.sigla}!`);
  };

  const handleRemoverAlerta = (id: string) => {
    setAlertas(prev => prev.filter(a => a.id !== id));
    showToast('Alerta removido.');
  };

  // KPIs
  const kpis = useMemo(() => {
    const mensais = OBRIGACOES.filter(o => o.periodicidade === 'mensal');
    const comAlerta = mensais.filter(o => {
      const dias = getDiasParaVencimento(o.diaVencimento as number);
      return getStatus(dias) !== 'ok';
    });
    return {
      total: obrigacoesFiltradas.length,
      mensais: porPeriodicidade.mensal.length,
      vencendoHoje: mensais.filter(o => {
        const dias = getDiasParaVencimento(o.diaVencimento as number);
        return dias !== null && dias <= 3;
      }).length,
      alertasAtivos: alertas.filter(a => a.ativo).length,
      criticas: comAlerta.length,
    };
  }, [obrigacoesFiltradas, alertas, porPeriodicidade]);

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-4 right-4 z-50 bg-sky-600 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-bold animate-fade-in">
          {toastMsg}
        </div>
      )}

      {/* Header */}
      <div className="bg-gradient-to-r from-sky-600 to-indigo-600 rounded-2xl p-6 text-white">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight">📋 Obrigações Fiscais & Acessórias</h1>
            <p className="text-sky-100 text-sm mt-1">Controle de prazos, vencimentos e alertas por regime tributário</p>
          </div>
          <div className="flex items-center gap-2 bg-white/10 rounded-xl px-4 py-2 text-sm">
            <span>🗓</span>
            <span className="font-bold">{new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          {[
            { label: 'Obrigações', value: kpis.total, icon: '📄', color: 'bg-white/15' },
            { label: 'Mensais', value: kpis.mensais, icon: '🔄', color: 'bg-white/15' },
            { label: 'Vencendo (≤3 dias)', value: kpis.vencendoHoje, icon: '🔥', color: kpis.vencendoHoje > 0 ? 'bg-orange-500/40' : 'bg-white/15' },
            { label: 'Alertas Ativos', value: kpis.alertasAtivos, icon: '🔔', color: kpis.alertasAtivos > 0 ? 'bg-emerald-500/30' : 'bg-white/15' },
          ].map(kpi => (
            <div key={kpi.label} className={`${kpi.color} rounded-xl p-3 text-center backdrop-blur-sm`}>
              <div className="text-2xl">{kpi.icon}</div>
              <div className="text-2xl font-black">{kpi.value}</div>
              <div className="text-xs text-sky-100">{kpi.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Reforma Tributária Banner */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 flex gap-3">
        <span className="text-2xl">⚡</span>
        <div>
          <p className="font-bold text-amber-800 dark:text-amber-300 text-sm">Reforma Tributária em andamento — EC 132/2023</p>
          <p className="text-amber-700 dark:text-amber-400 text-xs mt-0.5">
            IBS e CBS entram em vigor gradualmente de 2026 a 2033. ICMS, ISS, PIS e COFINS serão extintos progressivamente.
            Fique atento às novas obrigações acessórias do sistema dual.
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sky-500">🔍</span>
          <h2 className="font-bold text-slate-700 dark:text-slate-200 text-sm uppercase tracking-wider">Filtros</h2>
        </div>

        {/* Busca */}
        <input
          type="text"
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por nome ou sigla (ex: DCTF, eSocial, SPED...)"
          className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500 outline-none"
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Regime */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Regime Tributário</label>
            <select value={regimeFiltro} onChange={e => setRegimeFiltro(e.target.value as Regime)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500 outline-none">
              {Object.entries(REGIME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          {/* Categoria */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Categoria</label>
            <select value={categoriaFiltro} onChange={e => setCategoriaFiltro(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500 outline-none">
              <option value="todos">Todas</option>
              <option value="federal">Federal</option>
              <option value="estadual">Estadual</option>
              <option value="municipal">Municipal</option>
              <option value="trabalhista">Trabalhista</option>
              <option value="previdenciaria">Previdenciária</option>
            </select>
          </div>

          {/* Periodicidade */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Periodicidade</label>
            <select value={periodicidadeFiltro} onChange={e => setPeriodicidadeFiltro(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500 outline-none">
              <option value="todos">Todas</option>
              <option value="mensal">Mensal</option>
              <option value="trimestral">Trimestral</option>
              <option value="anual">Anual</option>
              <option value="eventual">Eventual</option>
            </select>
          </div>
        </div>
      </div>

      {/* Seções por periodicidade */}
      {(['mensal', 'anual', 'trimestral', 'eventual'] as Periodicidade[]).map(periodo => {
        const lista = porPeriodicidade[periodo];
        if (lista.length === 0) return null;
        const periodoLabel = { mensal: '🔄 Mensais', anual: '📅 Anuais', trimestral: '📆 Trimestrais', eventual: '⚡ Eventuais / Reforma' };

        return (
          <div key={periodo} className="bg-white dark:bg-slate-800 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <h2 className="font-black text-slate-700 dark:text-slate-200">{periodoLabel[periodo]}</h2>
              <span className="text-xs bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-400 px-2 py-0.5 rounded-full font-bold">{lista.length}</span>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {lista.map(obrigacao => {
                const dias = getDiasParaVencimento(obrigacao.diaVencimento as number);
                const status = getStatus(dias);
                const sc = STATUS_CONFIG[status];
                const alertasOb = getAlertasObrigacao(obrigacao.id);
                const isExpanded = expandido === obrigacao.id;

                return (
                  <div key={obrigacao.id} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    {/* Row principal */}
                    <div className="px-5 py-4 flex items-center gap-4 cursor-pointer" onClick={() => setExpandido(isExpanded ? null : obrigacao.id)}>

                      {/* Status indicator */}
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg flex-shrink-0 ${sc.bg} ${sc.text}`}>
                        {sc.icon}
                      </div>

                      {/* Info */}
                      <div className="flex-grow min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-black text-slate-800 dark:text-white text-sm">{obrigacao.sigla}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${CATEGORIA_COLORS[obrigacao.categoria]}`}>
                            {obrigacao.categoria}
                          </span>
                          {alertasOb.length > 0 && (
                            <span className="text-xs bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full font-bold">
                              🔔 {alertasOb.length} alerta{alertasOb.length > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{obrigacao.nome}</p>
                      </div>

                      {/* Vencimento */}
                      <div className="text-right flex-shrink-0">
                        <div className={`font-black text-sm ${sc.text}`}>
                          {typeof obrigacao.diaVencimento === 'number'
                            ? `Dia ${obrigacao.diaVencimento}`
                            : obrigacao.diaVencimento}
                        </div>
                        {dias !== null && (
                          <div className="text-xs text-slate-400">
                            {dias < 0 ? `${Math.abs(dias)}d em atraso` : dias === 0 ? 'Hoje!' : `${dias}d`}
                          </div>
                        )}
                      </div>

                      {/* Expand arrow */}
                      <div className={`text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</div>
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="px-5 pb-5 space-y-4 border-t border-slate-100 dark:border-slate-700 pt-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs font-bold text-slate-500 uppercase mb-1">Descrição</p>
                            <p className="text-sm text-slate-700 dark:text-slate-300">{obrigacao.descricao}</p>
                          </div>
                          <div>
                            <p className="text-xs font-bold text-red-500 uppercase mb-1">⚠ Penalidade por atraso</p>
                            <p className="text-sm text-slate-700 dark:text-slate-300">{obrigacao.penalidade}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-slate-500">Aplica-se a:</span>
                          {obrigacao.regimes.map(r => (
                            <span key={r} className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full">
                              {REGIME_LABELS[r]}
                            </span>
                          ))}
                          <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-500 px-2 py-0.5 rounded-full">
                            {obrigacao.orgao}
                          </span>
                        </div>

                        {/* Alertas existentes */}
                        {alertasOb.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-bold text-slate-500 uppercase">Alertas Configurados</p>
                            {alertasOb.map(alerta => (
                              <div key={alerta.id} className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2">
                                <div className="text-xs">
                                  <span className="font-bold text-slate-700 dark:text-slate-300">{alerta.responsavel}</span>
                                  <span className="text-slate-500"> — {alerta.email}</span>
                                  <span className="text-emerald-600 dark:text-emerald-400"> ({alerta.diasAntecedencia}d antes)</span>
                                </div>
                                <button onClick={() => handleRemoverAlerta(alerta.id)} className="text-red-400 hover:text-red-600 text-xs font-bold px-2">✕</button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Botão adicionar alerta */}
                        <button
                          onClick={() => { setObrigacaoSelecionada(obrigacao); setShowAlertaModal(true); }}
                          className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded-lg transition-colors"
                        >
                          🔔 Configurar Alerta de Vencimento
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Vazio */}
      {obrigacoesFiltradas.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <p className="text-4xl mb-3">🔍</p>
          <p className="font-bold">Nenhuma obrigação encontrada</p>
          <p className="text-sm">Ajuste os filtros para ver resultados</p>
        </div>
      )}

      {/* Modal Alerta */}
      {showAlertaModal && obrigacaoSelecionada && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="font-black text-slate-800 dark:text-white text-lg mb-1">🔔 Configurar Alerta</h3>
            <p className="text-sm text-slate-500 mb-5">
              Alerta para: <span className="font-bold text-sky-600">{obrigacaoSelecionada.sigla}</span>
              {typeof obrigacaoSelecionada.diaVencimento === 'number' && ` — Vence dia ${obrigacaoSelecionada.diaVencimento}`}
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Responsável</label>
                <input
                  type="text"
                  value={novoAlerta.responsavel}
                  onChange={e => setNovoAlerta(p => ({ ...p, responsavel: e.target.value }))}
                  placeholder="Nome do responsável"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500 outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">E-mail</label>
                <input
                  type="email"
                  value={novoAlerta.email}
                  onChange={e => setNovoAlerta(p => ({ ...p, email: e.target.value }))}
                  placeholder="email@empresa.com.br"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500 outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">
                  Alertar com quantos dias de antecedência?
                </label>
                <select
                  value={novoAlerta.diasAntecedencia}
                  onChange={e => setNovoAlerta(p => ({ ...p, diasAntecedencia: Number(e.target.value) }))}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500 outline-none"
                >
                  <option value={1}>1 dia antes</option>
                  <option value={3}>3 dias antes</option>
                  <option value={5}>5 dias antes</option>
                  <option value={7}>7 dias antes (1 semana)</option>
                  <option value={15}>15 dias antes</option>
                  <option value={30}>30 dias antes</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowAlertaModal(false)}
                className="flex-1 py-2.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-sm font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSalvarAlerta}
                disabled={!novoAlerta.responsavel || !novoAlerta.email}
                className="flex-1 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors"
              >
                Salvar Alerta
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FiscalObligationsDashboard;
