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

export function coletarInconsistenciasManuais(analise: NfpAnaliseEmpresa): PdfInconsistenciaManual[] {
    const itens: PdfInconsistenciaManual[] = [];

    analise.obrigacoes.forEach((o: NfpObrigacao) => {
        const detalhe = normalizeText(o.observacao);
        if (!detalhe) return;
        itens.push({
            titulo: `${o.sigla || 'Obrigação'} - ${o.nome || 'Obrigação acessória'}`,
            categoria: `Obrigação ${esferaLabel(o.esfera)}`,
            status: statusLabel(o.status),
            competencia: o.competencia,
            detalhe,
        });
    });

    analise.debitos.forEach((d: NfpDebito) => {
        const detalhe = normalizeText(d.observacao);
        if (!detalhe) return;
        itens.push({
            titulo: d.descricao || 'Débito informado manualmente',
            categoria: `Débito ${esferaLabel(d.esfera)}`,
            status: statusLabel(d.status),
            detalhe,
        });
    });

    analise.certidoes.forEach((c: NfpCertidao) => {
        const detalhe = normalizeText(c.motivoImpedimento);
        if (!detalhe && c.fonte !== 'manual') return;
        itens.push({
            titulo: c.tipo || 'Certidão informada manualmente',
            categoria: `Certidão ${esferaLabel(c.esfera)}`,
            status: statusLabel(c.status),
            detalhe: detalhe || 'Registro incluído manualmente para acompanhamento da situação fiscal.',
        });
    });

    analise.acoes.forEach((a: NfpAcaoJudicial) => {
        const detalhe = normalizeText(a.observacao);
        if (!detalhe) return;
        itens.push({
            titulo: a.numero ? `Ação ${a.numero}` : a.descricao || 'Ação judicial',
            categoria: 'Ação judicial',
            status: statusLabel(a.status),
            detalhe,
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
    if (inconsistenciasManuais.length) alertas.push(`${inconsistenciasManuais.length} inconsistência(s) documentada(s) manualmente`);

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
    infoCard(margin + (cardW + cardGap) * 2, cardY2, cardW, cardH, 'Pendências manuais', String(inconsistenciasManuais.length), 'Incluídas ou complementadas pela equipe', inconsistenciasManuais.length ? AMBER : GREEN);
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
    if (inconsistenciasManuais.length > 0) findings.push(`${inconsistenciasManuais.length} inconsistência(s) informada(s) manualmente foram incorporadas ao relatório.`);
    findings.forEach(f => paragraph(`- ${f}`, { indent: 2, color: INK, fontSize: 8.5 }));

    // Inconsistências manuais
    pdf.addPage();
    y = margin;
    drawPageHeader();
    sectionTitle('Inconsistências e pendências informadas manualmente', 'Registros complementares inseridos pela equipe durante a análise. Estes itens fazem parte do dossiê e devem ser tratados no plano de ação.');
    if (inconsistenciasManuais.length === 0) {
        drawEmpty('Nenhuma inconsistência manual registrada.');
    } else {
        inconsistenciasManuais.forEach((item, idx) => {
            const boxLines = pdf.splitTextToSize(item.detalhe, contentW - 10) as string[];
            const boxH = Math.max(24, 18 + boxLines.length * 4);
            checkPage(boxH + 4);
            pdf.setFillColor(SOFT_FILL[0], SOFT_FILL[1], SOFT_FILL[2]);
            pdf.setDrawColor(SOFT_BORDER[0], SOFT_BORDER[1], SOFT_BORDER[2]);
            pdf.roundedRect(margin, y, contentW, boxH, 2, 2, 'FD');
            setText(INK, 8.5, 'bold');
            pdf.text(`${idx + 1}. ${item.titulo}`, margin + 4, y + 6, { maxWidth: contentW - 8 });
            setText(MUTED, 7.3, 'normal');
            const meta = [
                item.categoria,
                `Status: ${item.status}`,
                item.competencia ? `Competência: ${item.competencia}` : '',
            ].filter(Boolean).join(' | ');
            pdf.text(meta, margin + 4, y + 11, { maxWidth: contentW - 8 });
            setText(INK, 7.8, 'normal');
            pdf.text(boxLines, margin + 4, y + 18);
            y += boxH + 4;
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
        const dCols = [
            { label: 'Esfera', x: margin, w: 20 },
            { label: 'Órgão', x: margin + 22, w: 28 },
            { label: 'Descrição', x: margin + 52, w: 54 },
            { label: 'Original', x: margin + 108, w: 25 },
            { label: 'Atualizado', x: margin + 135, w: 27 },
            { label: 'Status', x: margin + 164, w: 22 },
        ];
        drawTableHeader(dCols);
        debitos.forEach(d => drawTableRow([
            { text: esferaLabel(d.esfera), x: margin, w: 20 },
            { text: d.orgao || '-', x: margin + 22, w: 28 },
            { text: d.descricao || '-', x: margin + 52, w: 54 },
            { text: fmtCurrency(d.valorOriginal), x: margin + 108, w: 25 },
            { text: fmtCurrency(d.valorAtualizado || d.valorOriginal), x: margin + 135, w: 27 },
            { text: statusLabel(d.status), x: margin + 164, w: 22, color: statusColor(d.status), bold: true },
        ]));
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
        const cCols = [
            { label: 'Esfera', x: margin, w: 19 },
            { label: 'Órgão', x: margin + 21, w: 37 },
            { label: 'Tipo', x: margin + 60, w: 35 },
            { label: 'Status', x: margin + 97, w: 39 },
            { label: 'Validade', x: margin + 138, w: 22 },
            { label: 'Impedimento', x: margin + 162, w: 25 },
        ];
        drawTableHeader(cCols);
        analise.certidoes.forEach(c => drawTableRow([
            { text: esferaLabel(c.esfera), x: margin, w: 19 },
            { text: c.orgao || '-', x: margin + 21, w: 37 },
            { text: c.tipo || '-', x: margin + 60, w: 35 },
            { text: statusLabel(c.status), x: margin + 97, w: 39, color: statusColor(c.status), bold: true },
            { text: formatDateBR(c.dataValidade), x: margin + 138, w: 22 },
            { text: c.motivoImpedimento || '-', x: margin + 162, w: 25 },
        ]));
    }

    // Obrigações
    pdf.addPage();
    y = margin;
    drawPageHeader();
    sectionTitle('Obrigações acessórias', 'Obrigações mensais, trimestrais, anuais ou eventuais consideradas no escopo.');
    if (analise.obrigacoes.length === 0) {
        drawEmpty('Nenhuma obrigação registrada.');
    } else {
        const oCols = [
            { label: 'Esfera', x: margin, w: 21 },
            { label: 'Sigla', x: margin + 23, w: 23 },
            { label: 'Nome', x: margin + 48, w: 48 },
            { label: 'Status', x: margin + 98, w: 32 },
            { label: 'Competência', x: margin + 132, w: 26 },
            { label: 'Entrega', x: margin + 160, w: 24 },
        ];
        drawTableHeader(oCols);
        analise.obrigacoes.forEach(o => {
            drawTableRow([
                { text: esferaLabel(o.esfera), x: margin, w: 21 },
                { text: o.sigla || '-', x: margin + 23, w: 23, bold: true },
                { text: o.nome || '-', x: margin + 48, w: 48 },
                { text: statusLabel(o.status), x: margin + 98, w: 32, color: statusColor(o.status), bold: true },
                { text: o.competencia || '-', x: margin + 132, w: 26 },
                { text: formatDateBR(o.dataEntrega), x: margin + 160, w: 24 },
            ]);
        });
    }

    // Parcelamentos
    if (analise.parcelamentos.length > 0) {
        pdf.addPage();
        y = margin;
        drawPageHeader();
        sectionTitle('Parcelamentos', 'Consolidação dos parcelamentos registrados e respectivos status.');
        const pCols = [
            { label: 'Programa', x: margin, w: 50 },
            { label: 'Esfera', x: margin + 52, w: 22 },
            { label: 'Parcelas', x: margin + 76, w: 24 },
            { label: 'Progresso', x: margin + 102, w: 25 },
            { label: 'Valor total', x: margin + 130, w: 30 },
            { label: 'Status', x: margin + 163, w: 22 },
        ];
        drawTableHeader(pCols);
        analise.parcelamentos.forEach(p => {
            const pct = p.parcelas > 0 ? Math.round((p.parcelasPagas / p.parcelas) * 100) : 0;
            drawTableRow([
                { text: p.programa || '-', x: margin, w: 50 },
                { text: esferaLabel(p.esfera), x: margin + 52, w: 22 },
                { text: `${p.parcelasPagas}/${p.parcelas}`, x: margin + 76, w: 24 },
                { text: `${pct}%`, x: margin + 102, w: 25 },
                { text: fmtCurrency(p.valorTotal), x: margin + 130, w: 30 },
                { text: statusLabel(p.status), x: margin + 163, w: 22, color: statusColor(p.status), bold: true },
            ]);
        });
    }

    // Plano de ação
    pdf.addPage();
    y = margin;
    drawPageHeader();
    sectionTitle('Plano de ação', 'Ações sugeridas para saneamento, ordenadas por criticidade.');
    if (analise.planoAcao.length === 0) {
        drawEmpty('Nenhuma ação registrada no plano.');
    } else {
        const sorted = [...analise.planoAcao].sort((a: NfpPlanoAcao, b: NfpPlanoAcao) => {
            const order: Record<string, number> = { alta: 0, media: 1, baixa: 2 };
            return (order[a.gravidade] ?? 2) - (order[b.gravidade] ?? 2);
        });
        const aCols = [
            { label: 'Gravidade', x: margin, w: 22 },
            { label: 'Descrição', x: margin + 24, w: 74 },
            { label: 'Esfera', x: margin + 100, w: 22 },
            { label: 'Prazo', x: margin + 124, w: 24 },
            { label: 'Responsável', x: margin + 150, w: 25 },
            { label: 'Status', x: margin + 177, w: 12 },
        ];
        drawTableHeader(aCols);
        sorted.forEach(a => drawTableRow([
            { text: statusLabel(a.gravidade), x: margin, w: 22, color: statusColor(a.gravidade), bold: true },
            { text: a.descricao || '-', x: margin + 24, w: 74 },
            { text: esferaLabel(a.esfera), x: margin + 100, w: 22 },
            { text: formatDateBR(a.prazo), x: margin + 124, w: 24 },
            { text: a.responsavel || '-', x: margin + 150, w: 25 },
            { text: statusLabel(a.status), x: margin + 177, w: 12, color: statusColor(a.status), bold: true },
        ]));
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
