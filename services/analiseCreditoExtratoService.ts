// services/analiseCreditoExtratoService.ts
// Parser + classificador para planilha de conciliação financeira (CSV do Itaú,
// layout SP Contábil). Reaproveita as mesmas 11 categorias do Relatório de
// Créditos PIS/COFINS já usado pela Eunice.

export type TipoDespesaCredito =
  | 'ALUGUEL'
  | 'DEPRECIAÇÃO'
  | 'ENERGIA'
  | 'CONSULTORIA'
  | 'INTERNET'
  | 'LICENÇA TI'
  | 'MEDICINA'
  | 'NUTRIÇÃO'
  | 'PSICOLOGIA'
  | 'TELEFONIA'
  | 'TI';

export const CATEGORIAS_CREDITO: TipoDespesaCredito[] = [
  'ALUGUEL','DEPRECIAÇÃO','ENERGIA','CONSULTORIA','INTERNET','LICENÇA TI',
  'MEDICINA','NUTRIÇÃO','PSICOLOGIA','TELEFONIA','TI',
];

export interface LancamentoExtrato {
  linhaOriginal: number;          // número da linha no CSV (1-indexed), pra debug
  data: string;                   // ISO yyyy-mm-dd ou string original se não parseou
  favorecido: string;             // coluna "TIPO DESPESA" do CSV — é o nome
  nf: string;                     // coluna "NF"
  descricao: string;              // coluna "DESCRIÇÃO"
  valor: number;                  // valor absoluto em reais (sempre positivo)
  mesCompetencia: string;         // coluna "MÊS"
  categoriaSugerida: TipoDespesaCredito | null;  // null = sem crédito ou revisar
  confianca: 'ALTA' | 'MEDIA' | 'BAIXA' | 'SEM_MATCH';
  motivo: string;                 // qual keyword disparou a classificação
}

// ───────────────────────────────────────────────────────────────────────────────
// REGRAS DE CLASSIFICAÇÃO
// Ordem importa: a primeira regra que bater vence. Regras mais específicas
// devem vir ANTES das mais genéricas (ex: "VIVO INTERNET" antes de "VIVO").
// ───────────────────────────────────────────────────────────────────────────────

interface Regra {
  categoria: TipoDespesaCredito | 'SEM_CREDITO';
  keywords: string[];             // casa se qualquer keyword aparecer no texto
  campos?: ('favorecido'|'descricao')[];  // default: ambos
  confianca?: 'ALTA' | 'MEDIA' | 'BAIXA';
}

const REGRAS: Regra[] = [
  // ─── EXCLUSÕES (SEM CRÉDITO) ──────────────────────────────────────────────
  // Vêm primeiro porque são descartes claros — evita falso-positivo em regras
  // mais abaixo.
  { categoria: 'SEM_CREDITO', keywords: ['TARIFA BACARIA','TARIFA BANCARI','IOF','JUROS','MULTA'], confianca: 'ALTA' },
  { categoria: 'SEM_CREDITO', keywords: ['FOLHA DE PAGAMENTO','FÉRIAS','FERIAS','RESCISAO','RESCISÃO','13º','13o','DECIMO TERCEIRO','VALE TRANSPORTE','VALE REFEICAO','VALE ALIMENTACAO','ADIANTAMENTO'], confianca: 'ALTA' },
  { categoria: 'SEM_CREDITO', keywords: ['IPTU','ISS FATURAMENTO','DARF','GPS','INSS','FGTS','PIS FOLHA','SIMPLES NACIONAL','DAS '], confianca: 'ALTA' },
  { categoria: 'SEM_CREDITO', keywords: ['PIS FEVEREIRO','PIS JANEIRO','PIS MARÇO','PIS MARCO','PIS ABRIL','PIS MAIO','PIS JUNHO','PIS JULHO','PIS AGOSTO','PIS SETEMBRO','PIS OUTUBRO','PIS NOVEMBRO','PIS DEZEMBRO','COFINS FEVEREIRO','COFINS JANEIRO','COFINS MARÇO','COFINS MARCO','COFINS ABRIL','COFINS MAIO','COFINS JUNHO','COFINS JULHO','COFINS AGOSTO','COFINS SETEMBRO','COFINS OUTUBRO','COFINS NOVEMBRO','COFINS DEZEMBRO','CSLL','IRPJ'], campos: ['favorecido','descricao'], confianca: 'ALTA' },
  // Lançamentos em que o favorecido é o próprio tributo (ex: "COFINS" / "PIS" sozinho)
  { categoria: 'SEM_CREDITO', keywords: ['COFINS','PIS '], campos: ['favorecido'], confianca: 'ALTA' },
  { categoria: 'SEM_CREDITO', keywords: ['VALE TRANSPORTE','VT REFERENTE','VALE REFEIÇÃO','VR REFERENTE','BILHETE ÚNICO','BILHETE UNICO','SP TRANS','BENEFICIOS E PAGTOS','BENEFÍCIOS E PAGTOS','CAJU','VR BENEFICIOS','VALE ALIMENTAÇÃO'], confianca: 'ALTA' },
  { categoria: 'SEM_CREDITO', keywords: ['HONORARIOS ADVOCATICIOS','HONORÁRIOS ADVOCATÍCIOS','ASSESSORIA JURIDICA','ASSESSORIA JURÍDICA','ADVOGADOS','ADVOCACIA','SOCIEDADE DE ADVOGADOS','ESCRITORIO DE ADVOCACIA','ESCRITÓRIO DE ADVOCACIA'], confianca: 'ALTA' },
  { categoria: 'SEM_CREDITO', keywords: ['INTEGRALIZAÇÃO','INTEGRALIZACAO','AUMENTO DE CAPITAL','DIVIDENDOS','JUROS SOBRE CAPITAL'], confianca: 'ALTA' },
  { categoria: 'SEM_CREDITO', keywords: ['RECRUTAMENTO','GESTAO DE PESSOAS','GESTÃO DE PESSOAS','HEADHUNTER'], confianca: 'MEDIA' },
  { categoria: 'SEM_CREDITO', keywords: ['SINDICATO','CONVENÇÃO COLETIVA','CONVENCAO COLETIVA','CONTRIBUIÇÃO SINDICAL'], confianca: 'ALTA' },
  { categoria: 'SEM_CREDITO', keywords: ['ASSESSORIA CONTABIL','ASSESSORIA CONTÁBIL','HONORARIOS CONTABEIS','HONORÁRIOS CONTÁBEIS','CERTIFICADO DIGITAL'], confianca: 'MEDIA' },
  { categoria: 'SEM_CREDITO', keywords: ['PERSONAL TRAINER','NUTRIFIT','EDUCAÇÃO FÍSICA','EDUCACAO FISICA'], confianca: 'MEDIA' },
  { categoria: 'SEM_CREDITO', keywords: ['MATERIAL DE ESCRITORIO','MATERIAL DE ESCRITÓRIO','TROCA DE TECLADO','REPARO DE NOTEBOOK','CONSERTO DE COMPUTADOR','MANUTENÇÃO DE EQUIPAMENTO'], confianca: 'MEDIA' },
  { categoria: 'SEM_CREDITO', keywords: ['SERVIÇOS ADMINISTRATIVOS','SERVICOS ADMINISTRATIVOS'], campos: ['favorecido'], confianca: 'MEDIA' },
  { categoria: 'SEM_CREDITO', keywords: ['CARTAO ITAUCARD','CARTÃO ITAUCARD','FATURA DO CARTAO','FATURA DO CARTÃO','CREDICARD','VISA BUSINESS'], confianca: 'ALTA' },
  { categoria: 'SEM_CREDITO', keywords: ['ACORDO JUDICIAL','PROCESSO Nº','JUIZADO ESPECIAL','SENTENÇA'], confianca: 'ALTA' },
  { categoria: 'SEM_CREDITO', keywords: ['CORRETORA DE SEGUROS','COMISSÃO','COMISSAO DISTRIBUIDOR','INTERMEDIAÇÃO'], confianca: 'MEDIA' },
  { categoria: 'SEM_CREDITO', keywords: ['ALMOÇO','ALMOCO','RESTAURANTE','MATERIAL DE LIMPEZA','COPA E COZINHA','MERCADO','SUPERMERCADO','PAPELARIA'], confianca: 'MEDIA' },
  { categoria: 'SEM_CREDITO', keywords: ['CONDOMINIO','CONDOMÍNIO'], campos: ['favorecido'], confianca: 'BAIXA' }, // condomínio pode ou não gerar crédito — marca pra revisar

  // ─── ENERGIA ──────────────────────────────────────────────────────────────
  { categoria: 'ENERGIA', keywords: ['ENEL','CPFL','LIGHT','ENERGISA','COPEL','CEMIG','CELESC','EQUATORIAL','NEOENERGIA','CONTA DE ENERGIA','ENERGIA ELETRICA','ENERGIA ELÉTRICA'], confianca: 'ALTA' },

  // ─── TELEFONIA (vem ANTES de INTERNET pra "VIVO MOVEL" não cair em INTERNET) ─
  { categoria: 'TELEFONIA', keywords: ['VIVO MOVEL','VIVO MÓVEL','TIM MOVEL','CLARO MOVEL','OI MOVEL','TELEFONIA MOVEL','TELEFONIA MÓVEL','ALGAR TELECOM','ROCK TELECOM','SAFTECH','TELEFONIA FIXA','SERVIÇOS DE SMS','SERVICOS DE SMS'], confianca: 'ALTA' },

  // ─── INTERNET ─────────────────────────────────────────────────────────────
  { categoria: 'INTERNET', keywords: ['VIVO INTERNET','VIVO FIBRA','INTERNET FIBRA','CTINET','CTI COMUNICAÇÃO','CTI COMUNICACAO','LP DE DADOS','MONITORA DADOS','BANDA LARGA','LINK DEDICADO','PROVEDOR INTERNET','CONECTIVIDADE'], confianca: 'ALTA' },
  { categoria: 'INTERNET', keywords: ['INTERNET'], confianca: 'MEDIA' }, // fallback genérico

  // ─── LICENÇA TI (SaaS, software, nuvem) ───────────────────────────────────
  { categoria: 'LICENÇA TI', keywords: [
      'LICENÇA DE USO DE SOFTWARE','LICENCA DE USO DE SOFTWARE','ASSINATURA MENSAL','ASSINATURA ANUAL',
      'SAAS','SOFTWARE AS A SERVICE','CLOUD COMPUTING',
      // fornecedores conhecidos (do relatório Eunice + extrato):
      'MICROSOFT','AMAZON AWS','AWS ','OPENAI','CLOUDFLARE','ATLASSIAN','GOOGLE CLOUD','GOOGLE WORKSPACE',
      'ADOBE','FIGMA','CANVA','MIRO','ZAPIER','LUCIDCHART','ACTIVECAMPAIGN','FREEPIK','ENVATO',
      'PIPEFY','REPORTEI','GODADDY','TWILIO','SLACK','NOTION','LINEAR','GITHUB','GITLAB',
      'RAMPER','EVOPE','RD GESTÃO','RD GESTAO','DISTRITO TECNOLOGIA','CLICKSIGN','TD SYNNEX',
      'OMIEXPERIENCE','VIDALINK','OBVIO BRASIL','INTUIX','REGISTRO.COM','REGISTRO BR','NIC.BR',
      'HUBSPOT','MAILCHIMP','SENDGRID','STRIPE FEE','JIRA','CONFLUENCE','TRELLO','BITRIX',
    ], confianca: 'ALTA' },
  { categoria: 'LICENÇA TI', keywords: ['ASSINATURA WATSAPP','WATSAPP BUSINESS','WHATSAPP BUSINESS API','SISTEMA DE GERENCIAMENTO','DOMINIO','DOMÍNIO','CERTIFICADO DIGITAL'], confianca: 'MEDIA' },

  // ─── MEDICINA ─────────────────────────────────────────────────────────────
  { categoria: 'MEDICINA', keywords: [
      'MEDICINA OCUPACIONAL','MEDICINA DO TRABALHO','SERVIÇO MEDICO','SERVICOS MEDICOS','SERVIÇOS MEDICOS',
      'CLINICA MEDICA','CLÍNICA MÉDICA','TELECONSULTA','CONSULTA MEDICA','CONSULTA MÉDICA',
      'ASSISTENCIA MEDICA','ASSISTÊNCIA MÉDICA','PEDIATRIA','TELEPSIQUIATRICA','MASTMED',
      'CENTRO MEDICO','CENTRO MÉDICO','SERVIÇOS MÉDICOS','SAUDE MENTAL','SAÚDE MENTAL',
      'PLANO DE SAUDE','PLANO DE SAÚDE','SUL AMERICA','SULAMÉRICA','UNIMED','BRADESCO SAUDE','BRADESCO SAÚDE',
      'AMIL','HAPVIDA','NOTREDAME INTERMEDICA','PORTO SEGURO SAUDE','PORTO SEGURO SAÚDE',
      'DIRETORA CLINICA','DIRETORA CLÍNICA','DIRETOR CLINICO','DIRETOR CLÍNICO',
      'COORDENADORA DA ATENÇÃO','COORDENADOR MÉDICO','COORDENADORA MÉDICA',
      'TOTAL PASS','WELLHUB','GYMPASS',
    ], confianca: 'ALTA' },

  // ─── PSICOLOGIA ───────────────────────────────────────────────────────────
  { categoria: 'PSICOLOGIA', keywords: [
      'PSICOLOGIA','PSICOLOGA','PSICOLOGO','PSICÓLOGA','PSICÓLOGO','PSI ','SERVIÇOS DE PSICOLOGIA','SERVICOS DE PSICOLOGIA',
      'PSICOFLORESCER','CONSULTORIO DE PSICOLOGIA',
    ], confianca: 'ALTA' },

  // ─── NUTRIÇÃO ─────────────────────────────────────────────────────────────
  { categoria: 'NUTRIÇÃO', keywords: ['NUTRIÇÃO','NUTRICAO','NUTRICIONISTA','NUTRIC.','SERVIÇOS DE NUTRIÇÃO','SERVICOS DE NUTRICAO'], confianca: 'ALTA' },

  // ─── ALUGUEL ──────────────────────────────────────────────────────────────
  { categoria: 'ALUGUEL', keywords: ['ALUGUEL','LOCAÇÃO DE IMOVEL','LOCACAO DE IMOVEL','LOCACAO IMOBILIARIA','VAGAS DE GARAGEM','VAGA DE GARAGEM'], confianca: 'ALTA' },
  { categoria: 'ALUGUEL', keywords: ['FELTRIM CONSULTORIA','CLAUDIO MONTEIRO SOARES ADM DE BENS'], campos: ['favorecido'], confianca: 'ALTA' }, // locadores conhecidos

  // ─── TI (serviços de desenvolvimento / suporte) ──────────────────────────
  { categoria: 'TI', keywords: [
      'NOX SOLUCOES','NOX SOLUÇÕES','DESENVOLVIMENTO DE SOFTWARE','SEGURANÇA DO SISTEMA','SEGURANCA DO SISTEMA',
      'CONSULTORIA EM INFORMATICA','CONSULTORIA EM INFORMÁTICA','CONSULTORIA EM TI','SUPORTE TECNICO','SUPORTE TÉCNICO',
      'INFRAESTRUTURA DE TI','SERVIDOR DE REDE','SUSTENTAÇÃO DE SISTEMA','SUSTENTACAO DE SISTEMA',
      'ASDEVELOPER','CALACA','SYMP MARKETING',
    ], confianca: 'ALTA' },
  // Padrão "Serviços prestados por X - <cargo TI>" — comum em PJs do time de tecnologia
  { categoria: 'TI', keywords: [
      'DESENVOLVEDOR','DESENVOLVEDORA','PRODUCT DESIGNER','PRODUCT MANAGER','PRODUCT OWNER',
      'UX DESIGNER','UI DESIGNER','FULL STACK','FULLSTACK','BACK-END','BACKEND','FRONT-END','FRONTEND',
      'DEVOPS','DATA ENGINEER','DATA SCIENTIST','ENGENHEIRO DE SOFTWARE','ENGENHEIRA DE SOFTWARE',
      'LIDER DE TECNOLOGIA','LÍDER DE TECNOLOGIA','ANALISTA DE SUPORTE','COORDENADOR DE SUPORTE',
      'GERENTE COMERCIAL','ANALISTA DE CUSTOMER','DESIGNER/ MKT','DESIGNER/MKT','DESIGNER / MKT',
      'ANALISTA PROGRAMADOR','ANALISTA PROGRAMADORA','ANALISTA DE QA','ANALISTA QA',
      'ANALISTA FINANCEIRO','ANALISTA FINANCEIRA','ANALISTA DE DADOS','ANALISTA DE SISTEMAS',
    ], campos: ['descricao'], confianca: 'MEDIA' },

  // ─── CONSULTORIA (genérica — vem por último pra não capturar TI/ALUGUEL) ──
  { categoria: 'CONSULTORIA', keywords: ['CONSULTORIA','ASSESSORIA ESTRATEGICA','ASSESSORIA ESTRATÉGICA','PROSPECCAO MERCADOLOGICA','PROSPECÇÃO MERCADOLÓGICA'], confianca: 'MEDIA' },

  // ─── DEPRECIAÇÃO (normalmente lançamento contábil, raro no extrato) ──────
  { categoria: 'DEPRECIAÇÃO', keywords: ['DEPRECIAÇÃO','DEPRECIACAO'], confianca: 'ALTA' },
];

// ───────────────────────────────────────────────────────────────────────────────
// PARSER
// ───────────────────────────────────────────────────────────────────────────────

/** Remove BOM, CR e normaliza espaços em uma célula. */
const norm = (s: string): string => (s ?? '').replace(/^\uFEFF/, '').trim();

/** Converte "-R$ 1,075.33" → 1075.33 (absoluto). Retorna 0 se não parsear. */
const parseValorDespesa = (raw: string): number => {
  if (!raw) return 0;
  const s = String(raw).replace(/\s+/g, '').replace(/R\$/gi, '').replace(/^-/, '').trim();
  // formato anglófono do Itaú: 1,075.33  → remove vírgula (milhar), mantém ponto
  // MAS se tiver só vírgula e nenhum ponto (formato BR: 1.075,33), trata
  const temPonto = s.includes('.');
  const temVirgula = s.includes(',');
  let normalized = s;
  if (temPonto && temVirgula) {
    // decide pelo último separador: o último é o decimal
    const iPonto = s.lastIndexOf('.');
    const iVirgula = s.lastIndexOf(',');
    if (iPonto > iVirgula) {
      normalized = s.replace(/,/g, '');                // 1,075.33
    } else {
      normalized = s.replace(/\./g, '').replace(',', '.'); // 1.075,33
    }
  } else if (temVirgula) {
    // só vírgula — provavelmente decimal BR (ex: "226,57")
    normalized = s.replace(',', '.');
  }
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
};

/** Converte data no formato "4-mar" (ou "10/03/2026") para ISO yyyy-mm-dd. */
const parseDataPagto = (raw: string, anoRef: number): string => {
  if (!raw) return '';
  const s = raw.trim();
  // formato completo dd/mm/yyyy ou dd/mm/yy
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m1) {
    const d = m1[1] || '';
    const mm = m1[2] || '';
    let y = m1[3] || '';
    if (y.length === 2) y = `20${y}`;
    return `${y}-${mm.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  // formato abreviado "4-mar", "15-mar", "10-abr"
  const meses: Record<string, string> = {
    jan:'01', fev:'02', mar:'03', abr:'04', mai:'05', jun:'06',
    jul:'07', ago:'08', set:'09', out:'10', nov:'11', dez:'12',
  };
  const m2 = s.toLowerCase().match(/^(\d{1,2})[-\/\s]([a-zç]{3})/);
  if (m2) {
    const d = m2[1] || '';
    const mmAbr = m2[2] || '';
    const mm = meses[mmAbr.replace('ç','c')];
    if (mm) return `${anoRef}-${mm}-${d.padStart(2,'0')}`;
  }
  return s; // devolve original se não reconhecer
};

/** Detecta a linha de cabeçalho de mês (ex: "MARÇO 2026") e retorna {mes, ano}. */
const detectarMesAno = (row: string[]): { mes: number; ano: number } | null => {
  const texto = row.map(norm).join(' ').toUpperCase();
  const map: Record<string, number> = {
    'JANEIRO':1,'FEVEREIRO':2,'MARÇO':3,'MARCO':3,'ABRIL':4,'MAIO':5,'JUNHO':6,
    'JULHO':7,'AGOSTO':8,'SETEMBRO':9,'OUTUBRO':10,'NOVEMBRO':11,'DEZEMBRO':12,
  };
  for (const nomeM of Object.keys(map)) {
    const re = new RegExp(`\\b${nomeM}\\s+(\\d{4})\\b`);
    const m = texto.match(re);
    const mesNum = map[nomeM];
    if (m && mesNum !== undefined) return { mes: mesNum, ano: parseInt(m[1] || '', 10) };
  }
  return null;
};

/** Parse manual de linhas CSV com delimitador `;` respeitando aspas. */
const parseCsvLinha = (linha: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (inQuotes && linha[i+1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === ';' && !inQuotes) {
      out.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
};

/** Lê o texto do CSV completo e devolve só os pagamentos classificáveis.
 *  Ignora cabeçalhos, linhas vazias, subtotais diários e a seção de créditos/aportes.
 */
export const parseExtratoConciliacao = (csvText: string): LancamentoExtrato[] => {
  const linhasRaw = csvText.split(/\r?\n/);
  const linhas = linhasRaw.map(parseCsvLinha);

  let anoRef = new Date().getFullYear();
  let mesRef = new Date().getMonth() + 1;
  let dentroSecaoCreditos = false;

  const out: LancamentoExtrato[] = [];

  for (let i = 0; i < linhas.length; i++) {
    const row = linhas[i];
    if (!row || row.every(c => !norm(c))) continue;

    // Detecta entrada na seção de créditos/aportes (positivos) — ignorar
    const texto = row.map(norm).join(' ').toUpperCase();
    if (texto.includes('CREDITOS E APORTES') || texto.includes('CRÉDITOS E APORTES')) {
      dentroSecaoCreditos = true;
      continue;
    }
    if (dentroSecaoCreditos) continue;

    // Linha de total geral
    if (texto.includes('TOTAL DE PAGAMENTOS')) continue;
    // Cabeçalho de mês (ex: "MARÇO 2026")
    const detMes = detectarMesAno(row);
    if (detMes) { mesRef = detMes.mes; anoRef = detMes.ano; continue; }
    // Cabeçalho da tabela ("Número;Status;TIPO DESPESA;…")
    if (norm(row[1] || '').toUpperCase() === 'STATUS') continue;
    // Banner informativo ("DEMONSTRATIVO…")
    if (texto.includes('DEMONSTRATIVO DA MOVIMENTA')) continue;
    // Subtotal diário: campo DESCRIÇÃO começa com "Pagamentos em"
    if (norm(row[5] || '').toLowerCase().startsWith('pagamentos em')) continue;

    // Só considera linhas com Status = PAGO
    if (norm(row[1] || '').toUpperCase() !== 'PAGO') continue;

    const favorecido   = norm(row[2] || '');
    const nf           = norm(row[3] || '');
    const dataStr      = norm(row[4] || '');
    const descricao    = norm(row[5] || '');
    const valorRaw     = norm(row[6] || '');
    const mesComp      = norm(row[7] || '');

    if (!favorecido && !descricao) continue;       // linha inútil
    const valor = parseValorDespesa(valorRaw);
    if (valor <= 0) continue;                      // ignora linhas sem valor de despesa

    const { categoria, confianca, motivo } = classificar(favorecido, descricao);
    out.push({
      linhaOriginal:    i + 1,
      data:             parseDataPagto(dataStr, anoRef),
      favorecido,
      nf,
      descricao,
      valor,
      mesCompetencia:   mesComp,
      categoriaSugerida: categoria === 'SEM_CREDITO' ? null : categoria,
      confianca:        categoria === 'SEM_CREDITO' ? 'ALTA' : confianca,
      motivo,
    });
  }
  // avoid unused-var lint on mesRef (está exportado via parseDataPagto anoRef)
  void mesRef;
  return out;
};

// ───────────────────────────────────────────────────────────────────────────────
// CLASSIFICADOR
// ───────────────────────────────────────────────────────────────────────────────

export const classificar = (favorecido: string, descricao: string): {
  categoria: TipoDespesaCredito | 'SEM_CREDITO' | null;
  confianca: 'ALTA' | 'MEDIA' | 'BAIXA' | 'SEM_MATCH';
  motivo: string;
} => {
  const fav = (favorecido || '').toUpperCase();
  const desc = (descricao || '').toUpperCase();

  for (const regra of REGRAS) {
    const campos = regra.campos || ['favorecido','descricao'];
    for (const kw of regra.keywords) {
      const KW = kw.toUpperCase();
      const matchFav = campos.includes('favorecido') && fav.includes(KW);
      const matchDesc = campos.includes('descricao') && desc.includes(KW);
      if (matchFav || matchDesc) {
        return {
          categoria: regra.categoria,
          confianca: regra.confianca || 'MEDIA',
          motivo: `"${kw}" em ${matchFav ? 'TIPO DESPESA' : 'DESCRIÇÃO'}`,
        };
      }
    }
  }
  return { categoria: null, confianca: 'SEM_MATCH', motivo: 'Nenhuma regra bateu — revisar manualmente' };
};

// ───────────────────────────────────────────────────────────────────────────────
// CONSOLIDAÇÃO — saída no formato do Relatório de Créditos
// ───────────────────────────────────────────────────────────────────────────────

export interface LinhaRelatorioCredito {
  data: string;                           // yyyy-mm-dd
  nota: string;                           // ex: "NF - 217908", "FATURA", "BOLETO"
  fornecedor: string;
  tipoDespesa: TipoDespesaCredito;
  valor: number;
}

/** Converte os lançamentos com categoria válida em linhas do relatório. */
export const consolidarRelatorio = (lancs: LancamentoExtrato[]): LinhaRelatorioCredito[] => {
  return lancs
    .filter(l => l.categoriaSugerida !== null)
    .map(l => ({
      data:         l.data,
      nota:         l.nf || 'FATURA',
      fornecedor:   l.favorecido,
      tipoDespesa:  l.categoriaSugerida as TipoDespesaCredito,
      valor:        l.valor,
    }));
};

/** Soma por categoria (pra dashboard/cards). */
export const totalizarPorCategoria = (lancs: LancamentoExtrato[]): Record<string, number> => {
  const out: Record<string, number> = { SEM_CREDITO: 0 };
  CATEGORIAS_CREDITO.forEach(c => { out[c] = 0; });
  for (const l of lancs) {
    const k = l.categoriaSugerida ?? 'SEM_CREDITO';
    out[k] = (out[k] || 0) + l.valor;
  }
  return out;
};
