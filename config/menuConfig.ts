/**
 * config/menuConfig.ts
 *
 * Descricoes de cada SearchType (mostradas nos cards do menu) e a
 * estrutura visual do menu agrupado por genero. Antes viviam inline em
 * App.tsx -- isoladas pra reuso e leitura.
 *
 * MENU_GRUPOS: cada card tem icone proprio + cor do grupo. Resolve o
 * "layout que foi se perdendo": antes era um grid plano de 38 itens sem
 * simbolos. As sub-abas consolidadas (ex: Cobertura, Prazos) NAO
 * aparecem aqui -- vivem dentro dos hubs. `label` sobrescreve o nome do
 * enum quando o card e um hub-mae (ex: SAUDE_GERAL -> "Diagnostico & Saude").
 */
import React from 'react';
import { SearchType, type User } from '../types';
import {
    BuildingIcon, CalculatorIcon, DocumentTextIcon, SearchIcon, TagIcon,
    CalendarIcon, DownloadIcon, ScaleIcon, ShieldIcon, BriefcaseIcon,
    UserGroupIcon, RocketIcon, GlobeIcon, NewspaperIcon, ChatBubbleIcon,
} from '../components/Icons';

export const searchDescriptions: Record<SearchType, string> = {
    [SearchType.CFOP]: 'Consulte códigos de operação e entenda a aplicação e tributação.',
    [SearchType.NCM]: 'Classificação fiscal de mercadorias e incidência de impostos (IPI, ICMS).',
    [SearchType.SERVICO]: 'Análise de retenção de ISS, local de incidência e alíquotas.',
    [SearchType.REFORMA_TRIBUTARIA]: 'Simule o impacto da Reforma Tributária (IBS/CBS) para sua atividade.',
    [SearchType.SIMPLES_NACIONAL]: 'Gestão de empresas do Simples, cálculo de DAS e Fator R.',
    [SearchType.LUCRO_PRESUMIDO_REAL]: 'Ficha Financeira e Cadastro para Lucro Presumido/Real.',
    [SearchType.OBRIGACOES_FISCAIS]: 'Acompanhamento de obrigações, vencimentos e alertas fiscais.',
    [SearchType.IMPORTA_XML]: 'Central de Documentos Fiscais — importação de XMLs/PDFs (NFSe), captura, dashboards e relatórios.',
    [SearchType.ANALISE_RELATORIO_SAGE]: 'Analise relatórios SAGE (XLSX/XML) e identifique gaps, canceladas, denegadas e segregação E/S.',
    [SearchType.ANALISADOR_REGIME]: 'Compare cenários de tributação (Simples, Lucro Presumido, Lucro Real) e identifique o regime mais vantajoso.',
    [SearchType.ANALISE_CREDITOS]: 'Análise de créditos PIS/COFINS, conciliação bancária e mapeamento por categoria fiscal.',
    [SearchType.SPED_FISCAL]: 'Geração do arquivo SPED Fiscal (EFD ICMS/IPI) — escrituração digital mensal.',
    [SearchType.NFTS_SP]: 'NFTS São Paulo — lê PDFs de serviços tomados (com IA para escaneados) e gera o TXT de importação em lote na PMSP.',
    [SearchType.CAIXA_POSTAL]: 'Caixa Postal e-CAC — mensagens da Receita Federal por empresa (intimações, malha fiscal, comunicados).',
    [SearchType.DAS_SIMPLES]: 'DAS Simples Nacional — emissão regular (com PGDAS-D) e avulso, controle de pagamentos por empresa.',
    [SearchType.DCTFWEB]: 'DCTFWeb — Declaração de Débitos e Créditos Tributários Federais Previdenciários (empresas Lucro Presumido/Real), com transmissão, DARF e MIT.',
    [SearchType.EFD_REINF]: 'EFD-Reinf × DCTFWeb — confere as retenções declaradas na EFD-Reinf (INSS/IRRF/CSRF) contra o débito consolidado na DCTFWeb.',
    [SearchType.NFSE_NAC_COBERTURA]: 'Cobertura ADN (NFS-e Nac.) — diagnóstico e habilitação em massa da captura nacional de NFS-e por empresa (somente administradores).',
    [SearchType.DAS_COBERTURA_PGDAS]: 'Cobertura PGDAS-D — heatmap por empresa × mês mostrando quais Simples NÃO tiveram DAS emitido (gera autuação automática).',
    [SearchType.DCTFWEB_COBERTURA]: 'Cobertura DCTFWeb — heatmap por empresa Lucro × mês mostrando quais NÃO transmitiram a DCTFWeb (gera autuação automática).',
    [SearchType.CAIXA_POSTAL_RADAR]: 'Radar fiscal (e-CAC) — mensagens não lidas classificadas por risco real (intimações, malha, exclusão Simples, autos de infração) ordenadas por urgência.',
    [SearchType.MINHA_AGENDA]: 'Minha Agenda Fiscal — consolidado por carteira: PGDAS-D / DCTFWeb pendentes + caixa postal crítica em UM lugar, priorizado por risco (0-100).',
    [SearchType.RECUPERACAO_PRAZOS]: 'Prazos de Prescrição — para cada oportunidade de recuperação tributária, mostra quanto falta pra expirar (5 anos CTN art 168). URGENTE = ≤90 dias.',
    [SearchType.VENCIMENTOS_SEMANA]: 'Vencimentos da Semana — obrigações fiscais que vencem nos próximos 7 dias (ou estão atrasadas), filtradas pela sua carteira. Visão do dia-a-dia.',
    [SearchType.DIAGNOSTICO_DOCS]: 'Diagnóstico Docs Fiscais — varredura de saúde das NF-e capturadas: notas sem chave/competência/direção/valor, chaves duplicadas em 2+ docs (somente administradores).',
    [SearchType.SIMPLES_SUBLIMITE]: 'Alerta de sublimite Simples — calcula RBT12 de cada empresa Simples e classifica contra teto (R$ 4,8M) e sublimite ICMS/ISS (R$ 3,6M). Risco de exclusão automática.',
    [SearchType.DIAGNOSTICO_CADASTROS]: 'Cadastros Incompletos — empresas com UF/IBGE/anexo/CNAE faltando que bloqueiam o SPED ou cálculo do DAS (somente administradores).',
    [SearchType.CERT_MONITOR]: 'Certificados Digitais — monitora vencimento dos certs (S&P + por empresa). Cert vencido = SERPRO/SEFAZ/e-CAC param sem aviso.',
    [SearchType.DIAGNOSTICO_CONFIG]: 'Configurações Operacionais — detecta env vars faltando (SERPRO/SharePoint/CRON_SECRET/etc) e modos operacionais incorretos. Só admin, sem expor valores.',
    [SearchType.SAUDE_GERAL]: 'Saúde Geral — agrega os 4 diagnósticos (cadastros + documentos + certs + configs) numa única tela. Status global OK/MÉDIO/ALTO/CRÍTICO/DEGRADADO.',
    [SearchType.CARTEIRA]: 'Carteira de Clientes — atribuição de empresas a colaboradores responsáveis (somente administradores).',
    [SearchType.AGENTES_A3]: 'Agentes A3 — gerenciar API keys do agente local cfi-a3 e marcar empresas como A3 (somente administradores).',
    [SearchType.NFSE_NACIONAL]: 'NFS-e Nacional (CGSN 189/2026) — emissão e gestão de notas de serviço no padrão nacional, obrigatório set/2026.',
    [SearchType.DASHBOARD_CEO]: 'Dashboard CEO — visão executiva unificada com KPIs e recomendações da IA.',
    [SearchType.ANOMALIAS]: 'Detector de Anomalias — análise estatística + IA detecta irregularidades no DAS de cada empresa.',
    [SearchType.SIMULADOR_IBS_CBS]: 'Simulador IBS/CBS — projeção da carga tributária 2026-2033 sob a Reforma Tributária (LC 214/2025).',
    [SearchType.EMISSAO_TRIBUTOS]: 'Central de Emissões — emissão unificada de DAS (Simples) e DARF (IRPJ/CSLL/PIS/COFINS para Presumido e Real) com controle de pagamento.',
    [SearchType.GIA_ST]: 'GIA-ST — importa o Livro de ICMS Substituto do Office Fiscal (IOB/SAGE) e gera a guia por UF favorecida validada no padrão do aplicativo GIA-ST 3 (SEFAZ-RS).',
    [SearchType.RECUPERACAO_TRIBUTARIA]: 'Recuperação Tributária — identifica impostos pagos a maior e oportunidades de restituição/compensação.',
    [SearchType.NFP_PRO_CLOUD]: 'Consulta de situação fiscal: débitos, certidões, obrigações, parcelamentos e plano de ação. Acesso restrito — liberado pelo administrador.',
    [SearchType.LEGALIZACAO]: 'Departamento de Legalização — aberturas, alterações, encerramentos, contratos, certidões, certificados digitais, procurações e parcelamentos, com análise de vencimentos (Jotform) e alertas antecipados ao cliente.',
};

export interface MenuCard {
    type: SearchType;
    label?: string;
    Icon: React.FC<{ className?: string }>;
    adminOnly?: boolean;
}

export interface MenuGrupo {
    titulo: string;
    cor: string;
    cards: MenuCard[];
}

export const MENU_GRUPOS: MenuGrupo[] = [
    {
        titulo: 'Consultas', cor: '#2563eb', cards: [
            { type: SearchType.CFOP, Icon: TagIcon },
            { type: SearchType.NCM, Icon: DocumentTextIcon },
            { type: SearchType.SERVICO, Icon: BuildingIcon },
            { type: SearchType.REFORMA_TRIBUTARIA, Icon: NewspaperIcon },
            { type: SearchType.SIMULADOR_IBS_CBS, Icon: CalculatorIcon },
        ],
    },
    {
        titulo: 'Regimes & Apuração', cor: '#7c3aed', cards: [
            { type: SearchType.SIMPLES_NACIONAL, Icon: CalculatorIcon },
            { type: SearchType.LUCRO_PRESUMIDO_REAL, Icon: BuildingIcon },
            { type: SearchType.ANALISADOR_REGIME, Icon: ScaleIcon },
        ],
    },
    {
        titulo: 'Documentos Fiscais', cor: '#16a34a', cards: [
            { type: SearchType.IMPORTA_XML, label: 'Central de Documentos Fiscais', Icon: DownloadIcon },
            { type: SearchType.SPED_FISCAL, label: 'SPED Fiscal', Icon: DocumentTextIcon },
            { type: SearchType.NFTS_SP, label: 'NFTS São Paulo', Icon: DocumentTextIcon },
            { type: SearchType.ANALISE_RELATORIO_SAGE, label: 'Análise SAGE', Icon: DocumentTextIcon },
            { type: SearchType.ANALISE_CREDITOS, Icon: CalculatorIcon },
            { type: SearchType.EMISSAO_TRIBUTOS, Icon: RocketIcon },
        ],
    },
    {
        titulo: 'Vencimentos & Guias', cor: '#d97706', cards: [
            { type: SearchType.OBRIGACOES_FISCAIS, label: 'Vencimentos & Obrigações', Icon: CalendarIcon },
            { type: SearchType.DAS_SIMPLES, Icon: CalculatorIcon },
            { type: SearchType.DCTFWEB, Icon: DocumentTextIcon },
            { type: SearchType.GIA_ST, Icon: DocumentTextIcon },
            { type: SearchType.NFSE_NACIONAL, Icon: GlobeIcon },
            { type: SearchType.CAIXA_POSTAL, Icon: ChatBubbleIcon },
        ],
    },
    {
        titulo: 'Fiscalização & Recuperação', cor: '#0891b2', cards: [
            { type: SearchType.SAUDE_GERAL, label: 'Diagnóstico & Saúde', Icon: ShieldIcon },
            { type: SearchType.RECUPERACAO_TRIBUTARIA, Icon: ScaleIcon },
            { type: SearchType.NFP_PRO_CLOUD, label: 'Consulta Situação Fiscal', Icon: SearchIcon, adminOnly: true },
        ],
    },
    {
        titulo: 'Legalização & Societário', cor: '#be185d', cards: [
            { type: SearchType.LEGALIZACAO, label: 'Legalização', Icon: BriefcaseIcon },
        ],
    },
    {
        titulo: 'Gestão', cor: '#475569', cards: [
            { type: SearchType.DASHBOARD_CEO, Icon: RocketIcon },
            { type: SearchType.CARTEIRA, Icon: UserGroupIcon },
            { type: SearchType.AGENTES_A3, Icon: BriefcaseIcon },
        ],
    },
];

/**
 * Cards restritos (adminOnly) — o admin pode liberar acesso individual a
 * colaboradores via Gerenciar Usuários (campo `modulosPermitidos` do perfil).
 */
export const MODULOS_RESTRITOS: MenuCard[] = MENU_GRUPOS
    .flatMap(g => g.cards)
    .filter(c => c.adminOnly);

/**
 * Permissões funcionais — não escondem card do menu (continua visível a
 * todos), mas o BACKEND as exige em ações sensíveis. Gravadas no mesmo
 * campo `modulosPermitidos` do perfil e alternadas pelo admin em
 * Gerenciar Usuários. Hoje: emissão de tributos — as rotas /emitir* de
 * DAS/DARF/Central exigem admin OU esta permissão
 * (sefaz-backend/require-admin.js + emissao-permissao.js).
 */
export const PERMISSOES_FUNCIONAIS: MenuCard[] = [
    { type: SearchType.EMISSAO_TRIBUTOS, label: 'Emissão de Tributos (DAS/DARF)', Icon: RocketIcon },
];

/**
 * Admin acessa tudo; colaborador acessa card restrito apenas se o admin
 * liberou o módulo (modulosPermitidos contém o SearchType do card).
 */
export const podeAcessarCard = (
    user: Pick<User, 'role' | 'modulosPermitidos'>,
    card: MenuCard,
): boolean =>
    !card.adminOnly
    || user.role === 'admin'
    || (user.modulosPermitidos ?? []).includes(card.type);
