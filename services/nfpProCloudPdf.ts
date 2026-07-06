/**
 * services/nfpProCloudPdf.ts
 *
 * Gera o Relatório de Situação Fiscal (NfpProCloud) em PDF.
 * O desenho segue uma linguagem executiva: capa objetiva, indicadores,
 * achados, inconsistências manuais, resumo técnico e plano de ação.
 */
import type {
    NfpAcaoJudicial,
    NfpAnaliseEmpresa,
    NfpApontamentoTrabalhista,
    NfpCertidao,
    NfpDebito,
    NfpObrigacao,
    NfpParcelamento,
    NfpPlanoAcao,
} from '../types';
import { regimeLabel, type TaxProfile } from './nfpTaxRulesEngine';

type Semaforo = 'verde' | 'amarelo' | 'vermelho';
type Rgb = [number, number, number];

export interface RelatorioPdfResult {
    blob: Blob;
    nomeArquivo: string;
}

export interface PdfInconsistenciaManual {
    titulo: string;
    categoria: string;
    status: string;
    competencia?: string;
    detalhe: string;
    evidencias?: PdfField[];
}

export interface PdfField {
    label: string;
    value: string;
}

const NAVY: Rgb = [17, 31, 52];
const BLUE: Rgb = [37, 99, 235];
const CYAN: Rgb = [14, 165, 233];
const GREEN: Rgb = [22, 163, 74];
const AMBER: Rgb = [217, 119, 6];
const RED: Rgb = [220, 38, 38];
const INK: Rgb = [15, 23, 42];
const MUTED: Rgb = [100, 116, 139];
const SOFT_BORDER: Rgb = [226, 232, 240];
const SOFT_FILL: Rgb = [248, 250, 252];

const SEMAFORO_COLORS: Record<Semaforo, Rgb> = {
    verde: GREEN,
    amarelo: AMBER,
    vermelho: RED,
};

const SEMAFORO_LABELS: Record<Semaforo, string> = {
    verde: 'Situação regular',
    amarelo: 'Atenção necessária',
    vermelho: 'Situação crítica',
};

function applyCnpjMaskInterno(raw: string): string {
    const d = raw.replace(/\D/g, '').slice(0, 14);
    if (d.length !== 14) return raw;
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function formatDateBR(value?: string): string {
    if (!value) return '-';
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    return date.toLocaleDateString('pt-BR');
}

function esferaLabel(value: string): string {
    const map: Record<string, string> = {
        federal: 'Federal',
        estadual: 'Estadual',
        municipal: 'Municipal',
    };
    return map[value] || value;
}

function statusLabel(value: string): string {
    const map: Record<string, string> = {
        aberto: 'Aberto',
        parcelado: 'Parcelado',
        quitado: 'Quitado',
        em_analise: 'Em análise',
        prescrito: 'Prescrito',
        negativa: 'Negativa',
        positiva: 'Positiva',
        positiva_efeitos_negativa: 'Positiva com efeitos de negativa',
        indisponivel: 'Indisponível',
        nao_consultada: 'Não consultada',
        entregue: 'Entregue',
        pendente: 'Pendente',
        atrasada: 'Atrasada',
        dispensada: 'Dispensada',
        nao_verificada: 'Não verificada',
        ativo: 'Ativo',
        inadimplente: 'Inadimplente',
        cancelado: 'Cancelado',
        em_andamento: 'Em andamento',
        encerrada: 'Encerrada',
        arquivada: 'Arquivada',
        alta: 'Alta',
        media: 'Média',
        baixa: 'Baixa',
        concluida: 'Concluída',
    };
    return map[value] || value;
}

function periodicidadeLabel(value?: string): string {
    const map: Record<string, string> = {
        mensal: 'Mensal',
        trimestral: 'Trimestral',
        anual: 'Anual',
        eventual: 'Eventual',
    };
    return value ? map[value] || value : '';
}

function tipoAcaoLabel(value?: string): string {
    const map: Record<string, string> = {
        civil: 'Civil',
        trabalhista: 'Trabalhista',
        tributaria: 'Tributária',
        criminal: 'Criminal',
    };
    return value ? map[value] || value : '';
}

function certidaoFonteLabel(value?: string): string {
    const map: Record<string, string> = {
        serpro: 'SERPRO',
        consulta_publica: 'Consulta pública',
        manual: 'Manual',
    };
    return value ? map[value] || value : '';
}

function statusColor(status: string): Rgb {
    if (['aberto', 'positiva', 'atrasada', 'inadimplente', 'alta'].includes(status)) return RED;
    if (['parcelado', 'pendente', 'positiva_efeitos_negativa', 'em_andamento', 'media', 'em_analise'].includes(status)) return AMBER;
    if (['quitado', 'negativa', 'entregue', 'concluida', 'ativo'].includes(status)) return GREEN;
    return MUTED;
}

function fonteLabel(fonte: NfpAnaliseEmpresa['fonte']): string {
    const map: Record<NfpAnaliseEmpresa['fonte'], string> = {
        certificado_escritorio: 'Certificado do escritório',
        certificado_cliente: 'Certificado do cliente',
        offline: 'Inclusão manual / offline',
    };
    return map[fonte];
}

function normalizeText(value?: string): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function textFromRecord(record: unknown, keys: string[]): string {
    if (!record || typeof record !== 'object') return '';
    const data = record as Record<string, unknown>;
    for (const key of keys) {
        const value = data[key];
        if (typeof value !== 'string' && typeof value !== 'number') continue;
        const text = normalizeText(String(value));
        if (text) return text;
    }
    return '';
}

function observacaoObrigacao(o: NfpObrigacao): string {
    return textFromRecord(o, [
        'observacao',
        'observacoes',
        'observacaoPendencia',
        'observacaoManual',
        'pendencia',
        'comentario',
        'comentarioTecnico',
        'motivo',
        'motivoImpedimento',
    ]);
}

function certidaoDataEmissao(c: NfpCertidao): string {
    return textFromRecord(c, [
        'dataEmissao',
        'dataCertidao',
        'dataExpedicao',
        'emissao',
        'expedicao',
        'emitidaEm',
    ]);
}

function certidaoDataValidade(c: NfpCertidao): string {
    return textFromRecord(c, [
        'dataValidade',
        'validade',
        'dataVencimento',
        'vencimento',
        'validaAte',
    ]);
}

function certidaoNumero(c: NfpCertidao): string {
    return textFromRecord(c, [
        'numeroCertidao',
        'numero',
        'codigoCertidao',
        'protocolo',
    ]);
}

function certidaoMotivo(c: NfpCertidao): string {
    return textFromRecord(c, [
        'motivoImpedimento',
        'motivo',
        'observacao',
        'observacoes',
        'pendencia',
        'comentario',
    ]);
}

function hasValue(value?: string | number | null): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'number') return Number.isFinite(value);
    return normalizeText(value).length > 0;
}

function pdfField(label: string, value?: string | number | null, formatter?: (value: any) => string): PdfField | null {
    if (!hasValue(value)) return null;
    const formatted = formatter ? formatter(value) : String(value);
    const clean = normalizeText(formatted);
    if (!clean || clean === '-') return null;
    return { label, value: clean };
}

function collectFields(fields: Array<PdfField | null>): PdfField[] {
    return fields.filter((field): field is PdfField => !!field);
}

function currencyBR(value?: number | null): string {
    const n = Number(value || 0);
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function atualizarDebitosSelicLocal(debitos: NfpDebito[], taxaSelicAnual: number): NfpDebito[] {
    const hoje = new Date();
    return debitos.map(d => {
        if (d.status !== 'aberto') return d;
        const venc = new Date(d.dataVencimento);
        const diffMs = hoje.getTime() - venc.getTime();
        if (diffMs <= 0) return { ...d, valorAtualizado: d.valorOriginal, dataAtualizacao: hoje.toISOString() };
        const diasAtraso = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const valorAtualizado = d.valorOriginal * (1 + (taxaSelicAnual / 100) * diasAtraso / 365);
        return {
            ...d,
            valorAtualizado: Math.round(valorAtualizado * 100) / 100,
            dataAtualizacao: hoje.toISOString(),
        };
    });
}

function addDaysISO(base: Date, days: number): string {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

function inferirEsferaPendencia(categoria: string): NfpPlanoAcao['esfera'] {
    const text = categoria.toLowerCase();
    if (text.includes('estadual')) return 'estadual';
    if (text.includes('municipal')) return 'municipal';
    return 'federal';
}

function inferirGravidadePendencia(status: string): NfpPlanoAcao['gravidade'] {
    const text = status.toLowerCase();
    if (text.includes('positiva') || text.includes('atrasada') || text.includes('inadimplente') || text.includes('aberto')) return 'alta';
    if (text.includes('pendente') || text.includes('não consultada') || text.includes('não verificada') || text.includes('em andamento')) return 'media';
    return 'baixa';
}

export function montarPlanoAcaoRelatorioPdf(
    analise: NfpAnaliseEmpresa,
    pendencias: PdfInconsistenciaManual[],
    hoje: Date = new Date(),
): NfpPlanoAcao[] {
    if (analise.planoAcao.length > 0) return analise.planoAcao;
    return pendencias.map((p, idx) => {
        const gravidade = inferirGravidadePendencia(p.status);
        const prazoDias = gravidade === 'alta' ? 3 : gravidade === 'media' ? 7 : 15;
        return {
            id: `pdf_sugerido_${idx + 1}`,
            empresaId: analise.empresaId,
            descricao: `Validar e regularizar: ${p.titulo}`,
            gravidade,
            esfera: inferirEsferaPendencia(p.categoria),
            prazo: addDaysISO(hoje, prazoDias),
            responsavel: 'Equipe fiscal',
            status: 'pendente',
        };
    });
}

export function montarCamposDebitoPdf(d: NfpDebito): PdfField[] {
    return collectFields([
        pdfField('Esfera', esferaLabel(d.esfera)),
        pdfField('Órgão', d.orgao),
        pdfField('Descrição', d.descricao),
        pdfField('Valor original', d.valorOriginal, currencyBR),
        pdfField('Valor atualizado', d.valorAtualizado, currencyBR),
        pdfField('Vencimento', d.dataVencimento, formatDateBR),
        pdfField('Data da atualização', d.dataAtualizacao, formatDateBR),
        pdfField('Status', statusLabel(d.status)),
        pdfField('Parcelamento vinculado', d.parcelamentoId),
        pdfField('Observação / pendência', d.observacao),
    ]);
}

export function montarCamposCertidaoPdf(c: NfpCertidao): PdfField[] {
    const dataEmissao = certidaoDataEmissao(c);
    const dataValidade = certidaoDataValidade(c);
    const numero = certidaoNumero(c);
    const motivo = certidaoMotivo(c);
    return collectFields([
        pdfField('Esfera', esferaLabel(c.esfera)),
        pdfField('Órgão', c.orgao),
        pdfField('Tipo', c.tipo),
        pdfField('Status', statusLabel(c.status)),
        pdfField('Data de emissão', dataEmissao, formatDateBR),
        pdfField('Data de validade', dataValidade, formatDateBR),
        pdfField('Data da consulta', c.dataConsulta, formatDateBR),
        pdfField('Número da certidão', numero),
        pdfField('Motivo / observação', motivo),
        pdfField('Origem', certidaoFonteLabel(c.fonte)),
        pdfField('Portal oficial', c.portalUrl),
        pdfField('Documento', c.urlDocumento),
        pdfField('PDF anexado', c.pdfBase64 ? 'Sim' : undefined),
    ]);
}

export function montarCamposObrigacaoPdf(o: NfpObrigacao): PdfField[] {
    const observacao = observacaoObrigacao(o);
    return collectFields([
        pdfField('Esfera', esferaLabel(o.esfera)),
        pdfField('Sigla', o.sigla),
        pdfField('Obrigação', o.nome),
        pdfField('Periodicidade', periodicidadeLabel(o.periodicidade)),
        pdfField('Competência', o.competencia),
        pdfField('Prazo legal', o.prazoLegal, formatDateBR),
        pdfField('Data de entrega', o.dataEntrega, formatDateBR),
        pdfField('Status', statusLabel(o.status)),
        pdfField('Observação / pendência', observacao),
    ]);
}

export function montarCamposParcelamentoPdf(p: NfpParcelamento): PdfField[] {
    return collectFields([
        pdfField('Esfera', esferaLabel(p.esfera)),
        pdfField('Programa', p.programa),
        pdfField('Valor total', p.valorTotal, currencyBR),
        pdfField('Quantidade de parcelas', p.parcelas),
        pdfField('Parcelas pagas', p.parcelasPagas),
        pdfField('Valor da parcela', p.valorParcela, currencyBR),
        pdfField('Status', statusLabel(p.status)),
        pdfField('Data de início', p.dataInicio, formatDateBR),
        pdfField('Data de fim', p.dataFim, formatDateBR),
    ]);
}

export function montarCamposAcaoPdf(a: NfpAcaoJudicial): PdfField[] {
    return collectFields([
        pdfField('Tipo', tipoAcaoLabel(a.tipo)),
        pdfField('Número', a.numero),
        pdfField('Vara', a.vara),
        pdfField('Descrição', a.descricao),
        pdfField('Valor da causa', a.valorCausa, currencyBR),
        pdfField('Status', statusLabel(a.status)),
        pdfField('Data de distribuição', a.dataDistribuicao, formatDateBR),
        pdfField('Observação', a.observacao),
    ]);
}

export function montarCamposApontamentoTrabalhistaPdf(t: NfpApontamentoTrabalhista): PdfField[] {
    const tipoLabel: Record<string, string> = {
        sem_registro: 'Funcionário sem registro',
        registro_fora_prazo: 'Registro efetivado fora do prazo',
        outro: 'Outra irregularidade',
    };
    const fonteTrabLabel: Record<string, string> = {
        folha: 'Folha de Pagamentos',
        esocial: 'eSocial',
        manual: 'Apuração manual',
    };
    const statusTrabLabel: Record<string, string> = {
        pendente: 'Pendente',
        em_regularizacao: 'Em regularização',
        regularizado: 'Regularizado',
    };
    return collectFields([
        pdfField('Funcionário', t.funcionario),
        pdfField('CPF', t.cpf),
        pdfField('Apontamento', tipoLabel[t.tipo] || t.tipo),
        pdfField('Início real dos trabalhos', t.dataInicioTrabalho, formatDateBR),
        pdfField('Data do registro', t.tipo === 'sem_registro' ? 'Sem registro' : t.dataRegistro, t.tipo === 'sem_registro' ? undefined : formatDateBR),
        pdfField('Fonte da apuração', fonteTrabLabel[t.fonte] || t.fonte),
        pdfField('Gravidade', statusLabel(t.gravidade)),
        pdfField('Status', statusTrabLabel[t.status] || t.status),
        pdfField('Observação', t.observacao),
    ]);
}

export function montarCamposPlanoAcaoPdf(p: NfpPlanoAcao): PdfField[] {
    return collectFields([
        pdfField('Gravidade', statusLabel(p.gravidade)),
        pdfField('Descrição', p.descricao),
        pdfField('Esfera', esferaLabel(p.esfera)),
        pdfField('Prazo', p.prazo, formatDateBR),
        pdfField('Responsável', p.responsavel),
        pdfField('Status', statusLabel(p.status)),
        pdfField('Tipo de ação', p.tipo ? tipoAcaoLabel(p.tipo) : undefined),
    ]);
}

export function coletarInconsistenciasManuais(analise: NfpAnaliseEmpresa): PdfInconsistenciaManual[] {
    const itens: PdfInconsistenciaManual[] = [];

    analise.obrigacoes.forEach((o: NfpObrigacao) => {
        const detalhe = observacaoObrigacao(o);
        const requerAtencao = !['entregue', 'dispensada'].includes(o.status);
        if (!detalhe && !requerAtencao) return;
        itens.push({
            titulo: `${o.sigla || 'Obrigação'} - ${o.nome || 'Obrigação acessória'}`,
            categoria: `Obrigação ${esferaLabel(o.esfera)}`,
            status: statusLabel(o.status),
            competencia: o.competencia,
            detalhe: detalhe || `Obrigação com status ${statusLabel(o.status)}. Validar evidência, competência e regularização.`,
            evidencias: montarCamposObrigacaoPdf(o),
        });
    });

    analise.debitos.forEach((d: NfpDebito) => {
        const detalhe = normalizeText(d.observacao);
        const requerAtencao = !['quitado', 'prescrito'].includes(d.status);
        if (!detalhe && !requerAtencao) return;
        itens.push({
            titulo: d.descricao || 'Débito informado manualmente',
            categoria: `Débito ${esferaLabel(d.esfera)}`,
            status: statusLabel(d.status),
            detalhe: detalhe || `Débito com status ${statusLabel(d.status)}. Conferir valor, vencimento e providência aplicável.`,
            evidencias: montarCamposDebitoPdf(d),
        });
    });

    analise.certidoes.forEach((c: NfpCertidao) => {
        const detalhe = certidaoMotivo(c);
        const requerAtencao = c.status !== 'negativa' || c.fonte === 'manual';
        if (!detalhe && !requerAtencao) return;
        itens.push({
            titulo: c.tipo || 'Certidão informada manualmente',
            categoria: `Certidão ${esferaLabel(c.esfera)}`,
            status: statusLabel(c.status),
            detalhe: detalhe || `Certidão com status ${statusLabel(c.status)}. Validar emissão, validade e documento comprobatório.`,
            evidencias: montarCamposCertidaoPdf(c),
        });
    });

    analise.parcelamentos.forEach((p: NfpParcelamento) => {
        if (!['inadimplente', 'cancelado'].includes(p.status)) return;
        itens.push({
            titulo: p.programa || 'Parcelamento informado',
            categoria: `Parcelamento ${esferaLabel(p.esfera)}`,
            status: statusLabel(p.status),
            detalhe: `Parcelamento com status ${statusLabel(p.status)}. Conferir parcelas, saldo e regularização.`,
            evidencias: montarCamposParcelamentoPdf(p),
        });
    });

    analise.acoes.forEach((a: NfpAcaoJudicial) => {
        const detalhe = normalizeText(a.observacao);
        const requerAtencao = a.status === 'em_andamento';
        if (!detalhe && !requerAtencao) return;
        itens.push({
            titulo: a.numero ? `Ação ${a.numero}` : a.descricao || 'Ação judicial',
            categoria: 'Ação judicial',
            status: statusLabel(a.status),
            detalhe: detalhe || `Ação judicial com status ${statusLabel(a.status)}. Acompanhar andamento e providências.`,
            evidencias: montarCamposAcaoPdf(a),
        });
    });

    return itens;
}

export function montarResumoTecnicoNfp(params: {
    analise: NfpAnaliseEmpresa;
    semaforo: Semaforo;
    debitosAbertos: NfpDebito[];
    obrigacoesPendentes: NfpObrigacao[];
    certidoesRestritivas: NfpCertidao[];
    inconsistenciasManuais: PdfInconsistenciaManual[];
    parcelamentosIrregulares: NfpParcelamento[];
}): string[] {
    const {
        analise,
        semaforo,
        debitosAbertos,
        obrigacoesPendentes,
        certidoesRestritivas,
        inconsistenciasManuais,
        parcelamentosIrregulares,
    } = params;

    const linhas: string[] = [];
    const fontes = analise.fonte === 'offline'
        ? 'dados inseridos manualmente'
        : 'dados disponíveis na integração e registros complementares';
    linhas.push(`A análise foi preparada com base em ${fontes}, considerando débitos, certidões, obrigações acessórias, parcelamentos, ações judiciais e pendências documentadas no módulo.`);

    if (semaforo === 'vermelho') {
        linhas.push('O enquadramento técnico indica situação crítica, com necessidade de saneamento prioritário antes de qualquer conclusão de regularidade fiscal.');
    } else if (semaforo === 'amarelo') {
        linhas.push('O enquadramento técnico indica atenção necessária: não há evidência suficiente para classificar a empresa como plenamente regular sem tratar as pendências listadas.');
    } else {
        linhas.push('O enquadramento técnico indica situação regular nos itens analisados, sem prejuízo de validação documental periódica e revisão de competências futuras.');
    }

    const alertas: string[] = [];
    if (debitosAbertos.length) alertas.push(`${debitosAbertos.length} débito(s) em aberto`);
    if (certidoesRestritivas.length) alertas.push(`${certidoesRestritivas.length} certidão(ões) restritiva(s) ou não conclusiva(s)`);
    if (obrigacoesPendentes.length) alertas.push(`${obrigacoesPendentes.length} obrigação(ões) pendente(s), atrasada(s) ou não verificada(s)`);
    if (parcelamentosIrregulares.length) alertas.push(`${parcelamentosIrregulares.length} parcelamento(s) com atenção`);
    if (inconsistenciasManuais.length) alertas.push(`${inconsistenciasManuais.length} pendência(s), inconsistência(s) ou ponto(s) não conclusivo(s)`);

    if (alertas.length) {
        linhas.push(`Principais vetores de risco identificados: ${alertas.join('; ')}.`);
    } else {
        linhas.push('Não foram identificados vetores materiais de risco nos registros disponíveis para este relatório.');
    }

    linhas.push('Recomendação: executar o plano de ação por criticidade, anexar evidências de regularização e reemitir o relatório após atualização das competências e documentos comprobatórios.');
    return linhas;
}

export async function gerarRelatorioPdfNfp(params: {
    analise: NfpAnaliseEmpresa;
    taxaSelic: number;
    taxProfile: TaxProfile | null;
}): Promise<RelatorioPdfResult> {
    const { analise, taxaSelic, taxProfile } = params;

    const jsPdfModule = await import('jspdf') as any;
    const JsPDF = jsPdfModule.jsPDF || jsPdfModule.default?.jsPDF || jsPdfModule.default;
    const pdf = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 14;
    const contentW = pageW - margin * 2;
    let y = margin;

    const debitos = atualizarDebitosSelicLocal(analise.debitos, taxaSelic);
    const debitosAbertos = debitos.filter(d => d.status === 'aberto');
    const certNeg = analise.certidoes.filter(c => c.status === 'negativa').length;
    const certPos = analise.certidoes.filter(c => c.status === 'positiva').length;
    const certPEN = analise.certidoes.filter(c => c.status === 'positiva_efeitos_negativa').length;
    const certRestritivas = analise.certidoes.filter(c => c.status !== 'negativa');
    const obrigPend = analise.obrigacoes.filter(o => o.status === 'pendente' || o.status === 'atrasada');
    const obrigNaoVerificadas = analise.obrigacoes.filter(o => o.status === 'nao_verificada');
    const obrigAlertas = analise.obrigacoes.filter(o => ['pendente', 'atrasada', 'nao_verificada'].includes(o.status));
    const acoesAtivas = analise.acoes.filter(a => a.status === 'em_andamento').length;
    const parcelAtivos = analise.parcelamentos.filter(p => p.status === 'ativo');
    const parcelIrregulares = analise.parcelamentos.filter(p => p.status === 'inadimplente' || p.status === 'cancelado');
    const inconsistenciasManuais = coletarInconsistenciasManuais(analise);
    const planoAcaoRelatorio = montarPlanoAcaoRelatorioPdf(analise, inconsistenciasManuais);

    let semaforo: Semaforo = 'verde';
    if (debitosAbertos.length > 0 || certPos > 0 || obrigPend.some(o => o.status === 'atrasada') || parcelIrregulares.length > 0) semaforo = 'vermelho';
    else if (obrigPend.length > 0 || obrigNaoVerificadas.length > 0 || certPEN > 0 || acoesAtivas > 0 || inconsistenciasManuais.length > 0) semaforo = 'amarelo';

    const resumoTecnico = montarResumoTecnicoNfp({
        analise,
        semaforo,
        debitosAbertos,
        obrigacoesPendentes: obrigAlertas,
        certidoesRestritivas: certRestritivas,
        inconsistenciasManuais,
        parcelamentosIrregulares: parcelIrregulares,
    });

    const fmtCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const dataHoje = new Date().toLocaleDateString('pt-BR');
    const dataAnalise = analise.dataAnalise ? formatDateBR(analise.dataAnalise) : dataHoje;

    const setText = (color: Rgb, fontSize: number, style: 'normal' | 'bold' | 'italic' = 'normal') => {
        pdf.setFont('helvetica', style);
        pdf.setFontSize(fontSize);
        pdf.setTextColor(color[0], color[1], color[2]);
    };

    const checkPage = (needed: number) => {
        if (y + needed > pageH - 18) {
            pdf.addPage();
            y = margin;
            drawPageHeader();
        }
    };

    const hLine = (yPos: number, color: Rgb = SOFT_BORDER) => {
        pdf.setDrawColor(color[0], color[1], color[2]);
        pdf.setLineWidth(0.25);
        pdf.line(margin, yPos, pageW - margin, yPos);
    };

    const drawPageHeader = () => {
        pdf.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
        pdf.rect(0, 0, pageW, 7, 'F');
        setText(MUTED, 7, 'normal');
        pdf.text('Relatório de Situação Fiscal', margin, 12);
        pdf.text(analise.empresaNome || 'Empresa', pageW - margin, 12, { align: 'right' });
        y = 20;
    };

    const sectionTitle = (title: string, subtitle?: string) => {
        checkPage(subtitle ? 20 : 14);
        setText(INK, 14, 'bold');
        pdf.text(title, margin, y);
        y += 3;
        hLine(y, [203, 213, 225]);
        y += 6;
        if (subtitle) {
            setText(MUTED, 8, 'normal');
            const lines = pdf.splitTextToSize(subtitle, contentW) as string[];
            pdf.text(lines, margin, y);
            y += lines.length * 4 + 4;
        }
    };

    const paragraph = (text: string, options?: { color?: Rgb; fontSize?: number; style?: 'normal' | 'bold' | 'italic'; indent?: number; width?: number }) => {
        const indent = options?.indent ?? 0;
        const width = options?.width ?? contentW - indent;
        const lines = pdf.splitTextToSize(text, width) as string[];
        checkPage(lines.length * 4.6 + 2);
        setText(options?.color || INK, options?.fontSize || 8.5, options?.style || 'normal');
        pdf.text(lines, margin + indent, y);
        y += lines.length * 4.6 + 2;
    };

    const infoCard = (x: number, cardY: number, w: number, h: number, title: string, value: string, detail: string, accent: Rgb = BLUE) => {
        pdf.setDrawColor(SOFT_BORDER[0], SOFT_BORDER[1], SOFT_BORDER[2]);
        pdf.setFillColor(255, 255, 255);
        pdf.roundedRect(x, cardY, w, h, 2, 2, 'FD');
        pdf.setFillColor(accent[0], accent[1], accent[2]);
        pdf.rect(x, cardY, 1.8, h, 'F');
        setText(MUTED, 7.2, 'bold');
        pdf.text(title.toUpperCase(), x + 5, cardY + 6);
        setText(INK, 14, 'bold');
        pdf.text(value, x + 5, cardY + 15);
        setText(MUTED, 7.5, 'normal');
        const detailLines = pdf.splitTextToSize(detail, w - 10) as string[];
        pdf.text(detailLines.slice(0, 2), x + 5, cardY + 22);
    };

    const drawTableHeader = (cols: { label: string; x: number; w: number }[]) => {
        checkPage(11);
        pdf.setFillColor(SOFT_FILL[0], SOFT_FILL[1], SOFT_FILL[2]);
        pdf.rect(margin, y - 4, contentW, 8, 'F');
        setText(MUTED, 7.3, 'bold');
        cols.forEach(c => pdf.text(c.label, c.x, y, { maxWidth: c.w }));
        y += 6;
        hLine(y);
        y += 3;
    };

    const drawTableRow = (cols: { text: string; x: number; w: number; color?: Rgb; bold?: boolean }[]) => {
        const lineGroups = cols.map(c => pdf.splitTextToSize(c.text || '-', c.w) as string[]);
        const maxLines = Math.max(1, ...lineGroups.map(lines => lines.length));
        const rowH = Math.max(7, maxLines * 3.6 + 2);
        checkPage(rowH + 1);
        cols.forEach((c, idx) => {
            setText(c.color || INK, 7.2, c.bold ? 'bold' : 'normal');
            pdf.text(lineGroups[idx] || ['-'], c.x, y, { maxWidth: c.w });
        });
        y += rowH;
    };

    const drawEmpty = (text: string) => {
        checkPage(14);
        pdf.setFillColor(SOFT_FILL[0], SOFT_FILL[1], SOFT_FILL[2]);
        pdf.roundedRect(margin, y, contentW, 14, 2, 2, 'F');
        setText(MUTED, 8.5, 'italic');
        pdf.text(text, margin + 4, y + 8);
        y += 18;
    };

    const drawDetailCard = (title: string, fields: PdfField[], accent: Rgb = BLUE, detail?: string) => {
        const contentFields = fields.length > 0 ? fields : [{ label: 'Registro', value: 'Sem campos preenchidos.' }];
        const fieldLayouts = contentFields.map(field => {
            const valueLines = pdf.splitTextToSize(field.value, contentW - 58) as string[];
            return { field, valueLines, height: Math.max(5, valueLines.length * 3.8 + 1.5) };
        });
        const detailLines = detail ? pdf.splitTextToSize(detail, contentW - 10) as string[] : [];
        const boxH = Math.max(24, 12 + fieldLayouts.reduce((sum, item) => sum + item.height, 0) + (detailLines.length ? detailLines.length * 3.8 + 5 : 0));
        checkPage(boxH + 5);
        pdf.setFillColor(255, 255, 255);
        pdf.setDrawColor(SOFT_BORDER[0], SOFT_BORDER[1], SOFT_BORDER[2]);
        pdf.roundedRect(margin, y, contentW, boxH, 2, 2, 'FD');
        pdf.setFillColor(accent[0], accent[1], accent[2]);
        pdf.rect(margin, y, 1.8, boxH, 'F');

        setText(INK, 8.5, 'bold');
        pdf.text(pdf.splitTextToSize(title, contentW - 8).slice(0, 2), margin + 5, y + 6);
        let innerY = y + 13;

        fieldLayouts.forEach(({ field, valueLines, height }) => {
            setText(MUTED, 7, 'bold');
            pdf.text(`${field.label}:`, margin + 5, innerY, { maxWidth: 38 });
            setText(INK, 7.5, 'normal');
            pdf.text(valueLines, margin + 47, innerY);
            innerY += height;
        });

        if (detailLines.length > 0) {
            setText(AMBER, 7.2, 'bold');
            pdf.text('Comentário técnico:', margin + 5, innerY + 1);
            setText(INK, 7.4, 'normal');
            pdf.text(detailLines, margin + 47, innerY + 1);
        }

        y += boxH + 4;
    };

    // Capa
    pdf.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
    pdf.rect(0, 0, pageW, 112, 'F');
    pdf.setFillColor(CYAN[0], CYAN[1], CYAN[2]);
    pdf.rect(0, 108, pageW, 4, 'F');

    setText([255, 255, 255], 22, 'bold');
    pdf.text('Relatório de', margin, 38);
    pdf.text('Situação Fiscal', margin, 50);
    setText([203, 213, 225], 9, 'normal');
    pdf.text('Preparado por SP Assessoria Contábil', margin, 67);
    pdf.text(`Emitido em ${dataHoje}`, margin, 75);
    pdf.text(`Fonte da análise: ${fonteLabel(analise.fonte)}`, margin, 83);

    y = 132;
    setText(INK, 17, 'bold');
    pdf.text(analise.empresaNome || 'Empresa', margin, y, { maxWidth: contentW });
    y += 10;
    setText(MUTED, 9.5, 'normal');
    const cnpjFormatted = analise.empresaCnpj ? applyCnpjMaskInterno(analise.empresaCnpj) : '-';
    pdf.text(`CNPJ: ${cnpjFormatted}`, margin, y);
    y += 6;
    pdf.text(`Data da análise: ${dataAnalise}`, margin, y);
    y += 6;

    if (taxProfile) {
        pdf.text(`Regime tributário: ${regimeLabel(taxProfile.regime)}`, margin, y);
        y += 6;
        if (taxProfile.cnae) {
            const cnaeText = `CNAE: ${taxProfile.cnae}${taxProfile.descricaoCnae ? ' - ' + taxProfile.descricaoCnae : ''}`;
            paragraph(cnaeText, { color: MUTED, fontSize: 9.5, width: contentW });
            y += 2;
        }
    }

    const [sr, sg, sb] = SEMAFORO_COLORS[semaforo];
    y += 8;
    pdf.setFillColor(sr, sg, sb);
    pdf.roundedRect(margin, y, contentW, 18, 2.5, 2.5, 'F');
    setText([255, 255, 255], 13, 'bold');
    pdf.text(SEMAFORO_LABELS[semaforo].toUpperCase(), margin + contentW / 2, y + 12, { align: 'center' });

    y += 34;
    setText(INK, 11, 'bold');
    pdf.text('Escopo do relatório', margin, y);
    y += 7;
    paragraph('Este relatório consolida a situação fiscal registrada na ferramenta, com foco em débitos, certidões, obrigações acessórias, parcelamentos, ações judiciais e inconsistências informadas manualmente pela equipe responsável.', { color: MUTED, fontSize: 8.5 });

    // Resumo executivo
    pdf.addPage();
    y = margin;
    drawPageHeader();
    sectionTitle('Resumo executivo', 'Visão consolidada dos principais indicadores e riscos fiscais identificados para a empresa.');

    const cardGap = 5;
    const cardW = (contentW - cardGap * 2) / 3;
    const cardH = 28;
    const totalDebitosAbertos = debitosAbertos.reduce((s, d) => s + (d.valorAtualizado || d.valorOriginal), 0);
    const cardY1 = y;
    infoCard(margin, cardY1, cardW, cardH, 'Débitos em aberto', String(debitosAbertos.length), fmtCurrency(totalDebitosAbertos), debitosAbertos.length ? RED : GREEN);
    infoCard(margin + cardW + cardGap, cardY1, cardW, cardH, 'Certidões regulares', `${certNeg}/${analise.certidoes.length}`, certPos > 0 ? `${certPos} positiva(s)` : 'Sem impedimento positivo', certPos > 0 ? RED : GREEN);
    infoCard(margin + (cardW + cardGap) * 2, cardY1, cardW, cardH, 'Obrigações com alerta', String(obrigAlertas.length), `${obrigPend.length} pendente(s)/atrasada(s)`, obrigAlertas.length ? AMBER : GREEN);
    y += cardH + 6;
    const cardY2 = y;
    infoCard(margin, cardY2, cardW, cardH, 'Ações em andamento', String(acoesAtivas), `de ${analise.acoes.length} registro(s)`, acoesAtivas ? AMBER : GREEN);
    infoCard(margin + cardW + cardGap, cardY2, cardW, cardH, 'Parcelamentos ativos', String(parcelAtivos.length), fmtCurrency(parcelAtivos.reduce((s, p) => s + p.valorTotal, 0)), parcelIrregulares.length ? RED : BLUE);
    infoCard(margin + (cardW + cardGap) * 2, cardY2, cardW, cardH, 'Pendências registradas', String(inconsistenciasManuais.length), 'Manuais, não conclusivas ou com alerta', inconsistenciasManuais.length ? AMBER : GREEN);
    y += cardH + 14;

    sectionTitle('Resumo técnico automatizado');
    resumoTecnico.forEach(text => paragraph(text, { color: INK, fontSize: 8.5 }));

    sectionTitle('Principais constatações');
    const findings: string[] = [];
    if (debitosAbertos.length > 0) {
        findings.push(`Existem ${debitosAbertos.length} débito(s) em aberto, totalizando ${fmtCurrency(totalDebitosAbertos)} com atualização pela taxa Selic informada.`);
    } else {
        findings.push('Não há débitos em aberto registrados no escopo analisado.');
    }
    if (certPos > 0) findings.push(`${certPos} certidão(ões) com status positivo foram identificadas e impedem conclusão de regularidade plena.`);
    else if (certNeg === analise.certidoes.length && analise.certidoes.length > 0) findings.push('As certidões registradas constam como negativas no escopo analisado.');
    if (obrigAlertas.length > 0) findings.push(`${obrigAlertas.length} obrigação(ões) acessória(s) estão pendentes, atrasadas ou não verificadas.`);
    if (inconsistenciasManuais.length > 0) findings.push(`${inconsistenciasManuais.length} pendência(s), inconsistência(s) ou ponto(s) não conclusivo(s) foram incorporados ao relatório.`);
    findings.forEach(f => paragraph(`- ${f}`, { indent: 2, color: INK, fontSize: 8.5 }));

    // Inconsistências manuais
    pdf.addPage();
    y = margin;
    drawPageHeader();
    sectionTitle('Pendências, inconsistências e pontos não conclusivos', 'Registros preenchidos manualmente, itens com status não conclusivo e demais pontos que exigem validação ou evidência antes da conclusão de regularidade.');
    if (inconsistenciasManuais.length === 0) {
        drawEmpty('Nenhuma pendência ou inconsistência registrada.');
    } else {
        inconsistenciasManuais.forEach((item, idx) => {
            const evidenciasDetalhadas = (item.evidencias || [])
                .filter(e => e.label !== 'Status' && e.label !== 'Competência');
            const evidencias = [
                { label: 'Categoria', value: item.categoria },
                { label: 'Status', value: item.status },
                ...(item.competencia ? [{ label: 'Competência', value: item.competencia }] : []),
                ...evidenciasDetalhadas,
            ];
            const comentarioTecnico = evidencias.some(e => e.value === item.detalhe) ? undefined : item.detalhe;
            drawDetailCard(`${idx + 1}. ${item.titulo}`, evidencias, AMBER, comentarioTecnico);
        });
    }

    // Débitos
    pdf.addPage();
    y = margin;
    drawPageHeader();
    sectionTitle('Débitos', 'Débitos registrados e valores atualizados conforme a taxa Selic informada na ferramenta.');
    if (debitos.length === 0) {
        drawEmpty('Nenhum débito registrado.');
    } else {
        debitos.forEach((d, idx) => {
            drawDetailCard(`${idx + 1}. ${d.descricao || 'Débito registrado'}`, montarCamposDebitoPdf(d), statusColor(d.status));
        });
        hLine(y);
        y += 6;
        setText(INK, 8.5, 'bold');
        pdf.text('TOTAL', margin, y);
        pdf.text(fmtCurrency(debitos.reduce((s, d) => s + d.valorOriginal, 0)), margin + 108, y);
        pdf.text(fmtCurrency(debitos.reduce((s, d) => s + (d.valorAtualizado || d.valorOriginal), 0)), margin + 135, y);
        y += 8;
    }

    // Certidões
    pdf.addPage();
    y = margin;
    drawPageHeader();
    sectionTitle('Certidões', 'Situação das certidões e eventuais impedimentos reportados ou informados manualmente.');
    if (analise.certidoes.length === 0) {
        drawEmpty('Nenhuma certidão registrada.');
    } else {
        analise.certidoes.forEach((c, idx) => {
            drawDetailCard(`${idx + 1}. ${c.tipo || 'Certidão registrada'}`, montarCamposCertidaoPdf(c), statusColor(c.status));
        });
    }

    // Obrigações
    pdf.addPage();
    y = margin;
    drawPageHeader();
    sectionTitle('Obrigações acessórias', 'Obrigações mensais, trimestrais, anuais ou eventuais consideradas no escopo.');
    if (analise.obrigacoes.length === 0) {
        drawEmpty('Nenhuma obrigação registrada.');
    } else {
        analise.obrigacoes.forEach((o, idx) => {
            const title = `${idx + 1}. ${o.sigla || 'Obrigação'} - ${o.nome || 'Obrigação registrada'}`;
            drawDetailCard(title, montarCamposObrigacaoPdf(o), statusColor(o.status));
        });
    }

    // Parcelamentos
    if (analise.parcelamentos.length > 0) {
        pdf.addPage();
        y = margin;
        drawPageHeader();
        sectionTitle('Parcelamentos', 'Consolidação dos parcelamentos registrados e respectivos status.');
        analise.parcelamentos.forEach((p, idx) => {
            drawDetailCard(`${idx + 1}. ${p.programa || 'Parcelamento registrado'}`, montarCamposParcelamentoPdf(p), statusColor(p.status));
        });
    }

    // Apontamentos trabalhistas (Folha × eSocial)
    const apontamentosTrabalhistas = analise.apontamentosTrabalhistas || [];
    if (apontamentosTrabalhistas.length > 0) {
        pdf.addPage();
        y = margin;
        drawPageHeader();
        sectionTitle('Apontamentos trabalhistas (Folha × eSocial)', 'Funcionários sem registro ou com registro efetivado fora do prazo, apurados no confronto entre a Folha de Pagamentos e o eSocial.');
        apontamentosTrabalhistas.forEach((t, idx) => {
            const cor = t.status === 'regularizado' ? statusColor('concluida') : statusColor(t.gravidade);
            drawDetailCard(`${idx + 1}. ${t.funcionario || 'Funcionário não identificado'}`, montarCamposApontamentoTrabalhistaPdf(t), cor);
        });
    }

    // Plano de ação
    pdf.addPage();
    y = margin;
    drawPageHeader();
    sectionTitle('Plano de ação', analise.planoAcao.length > 0
        ? 'Ações salvas na análise, ordenadas por criticidade.'
        : 'Ações sugeridas automaticamente a partir das pendências do relatório, ordenadas por criticidade.');
    if (planoAcaoRelatorio.length === 0) {
        drawEmpty('Nenhuma ação registrada no plano.');
    } else {
        const sorted = [...planoAcaoRelatorio].sort((a: NfpPlanoAcao, b: NfpPlanoAcao) => {
            const order: Record<string, number> = { alta: 0, media: 1, baixa: 2 };
            return (order[a.gravidade] ?? 2) - (order[b.gravidade] ?? 2);
        });
        sorted.forEach((a, idx) => {
            drawDetailCard(`${idx + 1}. ${a.descricao || 'Ação do plano'}`, montarCamposPlanoAcaoPdf(a), statusColor(a.gravidade));
        });
    }

    // Análise da IA (quando gerada na aba Análise)
    if (analise.analiseIA?.texto) {
        pdf.addPage();
        y = margin;
        drawPageHeader();
        sectionTitle('Análise da IA', `Parecer gerado em ${formatDateBR(analise.analiseIA.geradoEm)}${analise.analiseIA.geradoPor ? ` por ${analise.analiseIA.geradoPor}` : ''}.`);
        for (const bloco of analise.analiseIA.texto.split(/\n{2,}/)) {
            const texto = bloco.replace(/\s*\n\s*/g, ' ').trim();
            if (texto) paragraph(texto);
        }
    }

    // Footer
    const totalPages = pdf.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        setText([148, 163, 184], 7, 'normal');
        pdf.text(`SP Assessoria Contábil | ${analise.empresaNome} | ${dataHoje}`, margin, pageH - 8);
        pdf.text(`Página ${i} de ${totalPages}`, pageW - margin, pageH - 8, { align: 'right' });
    }

    const nomeArquivo = (analise.empresaNome || 'empresa').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
    const dataArquivo = new Date().toISOString().slice(0, 10);
    const blob = pdf.output('blob');

    return {
        blob,
        nomeArquivo: `relatorio-fiscal-${nomeArquivo}-${dataArquivo}.pdf`,
    };
}
