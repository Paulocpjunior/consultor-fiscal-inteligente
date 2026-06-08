/**
 * services/nfpProCloudPdf.ts
 *
 * Geracao do "Relatorio de Situacao Fiscal" (NfpProCloud) em PDF.
 * Extraido de components/NfpProCloud/index.tsx (~450 linhas que viviam
 * inline como useCallback dentro do componente React).
 *
 * Layout (padrao Big4):
 *   - Pagina 1: Capa com nome da empresa + semaforo (verde/amarelo/vermelho)
 *   - Pagina 2: Resumo executivo (5 KPIs + principais constatacoes)
 *   - Pagina 3: Debitos (tabela)
 *   - Pagina 4: Certidoes (tabela)
 *   - Pagina 5: Obrigacoes (tabela)
 *   - Pagina condicional: Parcelamentos (so se houver)
 *   - Pagina final: Plano de Acao (ordenado por gravidade)
 *   - Footer com numero de pagina em todas
 *
 * Esta funcao eh pura quanto a I/O do navegador -- retorna um Blob.
 * O caller decide se faz `pdf.save()` direto ou cria um link de download.
 * jsPDF eh importado dinamicamente (ESM-only) -- nao impacta bundle inicial.
 */
import type { NfpAnaliseEmpresa } from '../types';
import { regimeLabel, type TaxProfile } from './nfpTaxRulesEngine';
import * as nfpService from './nfpProCloudService';

type Semaforo = 'verde' | 'amarelo' | 'vermelho';

// Helpers privados ────────────────────────────────────────────────────────

function applyCnpjMaskInterno(raw: string): string {
    const d = raw.replace(/\D/g, '').slice(0, 14);
    if (d.length !== 14) return raw;
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function certidaoLabelInterno(status: string): string {
    switch (status) {
        case 'negativa': return 'Negativa (Regular)';
        case 'positiva': return 'Positiva (Impedimento)';
        case 'positiva_efeitos_negativa': return 'Positiva c/ Efeitos Neg.';
        case 'indisponivel': return 'Indisponivel';
        case 'nao_consultada': return 'Nao Consultada';
        default: return status;
    }
}

const SEMAFORO_COLORS: Record<Semaforo, [number, number, number]> = {
    verde: [34, 197, 94],
    amarelo: [245, 158, 11],
    vermelho: [239, 68, 68],
};
const SEMAFORO_LABELS: Record<Semaforo, string> = {
    verde: 'SITUACAO REGULAR',
    amarelo: 'ATENCAO NECESSARIA',
    vermelho: 'SITUACAO CRITICA',
};

function statusColor(status: string): [number, number, number] {
    if (['aberto', 'positiva', 'atrasada', 'inadimplente', 'alta'].includes(status)) return [239, 68, 68];
    if (['parcelado', 'pendente', 'positiva_efeitos_negativa', 'em_andamento', 'media', 'em_analise'].includes(status)) return [245, 158, 11];
    if (['quitado', 'negativa', 'entregue', 'concluida', 'ativo'].includes(status)) return [34, 197, 94];
    return [120, 120, 120];
}

// Resultado da geracao
export interface RelatorioPdfResult {
    blob: Blob;
    nomeArquivo: string;
}

export async function gerarRelatorioPdfNfp(params: {
    analise: NfpAnaliseEmpresa;
    taxaSelic: number;
    taxProfile: TaxProfile | null;
}): Promise<RelatorioPdfResult> {
    const { analise, taxaSelic, taxProfile } = params;

    const { default: jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 15;
    const contentW = pageW - margin * 2;
    let y = margin;

    const debitos = nfpService.atualizarDebitosSelic(analise.debitos, taxaSelic);
    const debitosAbertos = debitos.filter(d => d.status === 'aberto');
    const certNeg = analise.certidoes.filter(c => c.status === 'negativa').length;
    const certPos = analise.certidoes.filter(c => c.status === 'positiva').length;
    const certPEN = analise.certidoes.filter(c => c.status === 'positiva_efeitos_negativa').length;
    const obrigPend = analise.obrigacoes.filter(o => o.status === 'pendente' || o.status === 'atrasada').length;
    const acoesAtivas = analise.acoes.filter(a => a.status === 'em_andamento').length;
    const parcelAtivos = analise.parcelamentos.filter(p => p.status === 'ativo');

    let semaforo: Semaforo = 'verde';
    if (debitosAbertos.length > 0 || certPos > 0) semaforo = 'vermelho';
    else if (obrigPend > 0 || certPEN > 0 || acoesAtivas > 0) semaforo = 'amarelo';

    const fmtCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const dataHoje = new Date().toLocaleDateString('pt-BR');
    const dataAnalise = analise.dataAnalise ? new Date(analise.dataAnalise).toLocaleDateString('pt-BR') : dataHoje;

    const checkPage = (needed: number) => {
        if (y + needed > pageH - margin) { pdf.addPage(); y = margin; }
    };
    const hLine = (yPos: number) => {
        pdf.setDrawColor(200, 200, 200);
        pdf.setLineWidth(0.3);
        pdf.line(margin, yPos, pageW - margin, yPos);
    };
    const sectionTitle = (title: string) => {
        checkPage(20);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(14);
        pdf.setTextColor(30, 30, 30);
        pdf.text(title, margin, y);
        y += 2;
        hLine(y);
        y += 8;
    };
    const tableHeader = (cols: { label: string; x: number; w: number }[]) => {
        checkPage(12);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(80, 80, 80);
        pdf.setFillColor(245, 245, 245);
        pdf.rect(margin, y - 4, contentW, 8, 'F');
        cols.forEach(c => { pdf.text(c.label, c.x, y, { maxWidth: c.w }); });
        y += 6;
        hLine(y);
        y += 3;
    };
    const tableRow = (cols: { text: string; x: number; w: number; color?: [number, number, number] }[]) => {
        checkPage(10);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        cols.forEach(c => {
            if (c.color) pdf.setTextColor(c.color[0], c.color[1], c.color[2]);
            else pdf.setTextColor(50, 50, 50);
            pdf.text(c.text || '-', c.x, y, { maxWidth: c.w });
        });
        y += 6;
    };

    // ===== PAGE 1: COVER =====
    pdf.setFillColor(30, 58, 95);
    pdf.rect(0, 0, pageW, 100, 'F');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(24);
    pdf.setTextColor(255, 255, 255);
    pdf.text('RELATORIO DE', margin, 40);
    pdf.text('SITUACAO FISCAL', margin, 52);

    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(200, 215, 235);
    pdf.text('Preparado por SP Assessoria Contabil', margin, 68);
    pdf.text(dataHoje, margin, 76);

    y = 120;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.setTextColor(30, 30, 30);
    pdf.text(analise.empresaNome || 'Empresa', margin, y);
    y += 10;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);
    pdf.setTextColor(80, 80, 80);
    const cnpjFormatted = analise.empresaCnpj ? applyCnpjMaskInterno(analise.empresaCnpj) : '-';
    pdf.text(`CNPJ: ${cnpjFormatted}`, margin, y);
    y += 8;
    pdf.text(`Data da Analise: ${dataAnalise}`, margin, y);
    y += 8;

    if (taxProfile) {
        pdf.text(`Regime Tributario: ${regimeLabel(taxProfile.regime)}`, margin, y);
        y += 8;
        if (taxProfile.cnae) {
            pdf.text(`CNAE: ${taxProfile.cnae}${taxProfile.descricaoCnae ? ' - ' + taxProfile.descricaoCnae : ''}`, margin, y);
            y += 8;
        }
    }

    y += 10;
    const [sr, sg, sb] = SEMAFORO_COLORS[semaforo];
    pdf.setFillColor(sr, sg, sb);
    pdf.roundedRect(margin, y, contentW, 20, 3, 3, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.setTextColor(255, 255, 255);
    pdf.text(SEMAFORO_LABELS[semaforo], margin + contentW / 2, y + 13, { align: 'center' });

    // ===== PAGE 2: EXECUTIVE SUMMARY =====
    pdf.addPage();
    y = margin;
    sectionTitle('Resumo Executivo');

    pdf.setFillColor(sr, sg, sb);
    pdf.roundedRect(margin, y, 60, 10, 2, 2, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(255, 255, 255);
    const semaforoEmoji = semaforo === 'verde' ? 'VERDE' : semaforo === 'amarelo' ? 'AMARELO' : 'VERMELHO';
    pdf.text(`Status: ${semaforoEmoji}`, margin + 30, y + 7, { align: 'center' });
    y += 16;

    const kpis = [
        { label: 'Debitos Abertos', value: String(debitosAbertos.length), detail: fmtCurrency(debitosAbertos.reduce((s, d) => s + (d.valorAtualizado || d.valorOriginal), 0)) },
        { label: 'Certidoes Negativas', value: `${certNeg}/${analise.certidoes.length}`, detail: certPos > 0 ? `${certPos} positiva(s)` : 'Sem impedimentos' },
        { label: 'Obrigacoes Pendentes', value: String(obrigPend), detail: `de ${analise.obrigacoes.length} totais` },
        { label: 'Acoes em Andamento', value: String(acoesAtivas), detail: `de ${analise.acoes.length} totais` },
        { label: 'Parcelamentos Ativos', value: String(parcelAtivos.length), detail: fmtCurrency(parcelAtivos.reduce((s, p) => s + p.valorTotal, 0)) },
    ];

    const kpiW = contentW / 3;
    kpis.forEach((kpi, i) => {
        const col = i % 3;
        if (i > 0 && col === 0) y += 22;
        checkPage(22);
        const kx = margin + col * kpiW;
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(120, 120, 120);
        pdf.text(kpi.label, kx, y);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(16);
        pdf.setTextColor(30, 30, 30);
        pdf.text(kpi.value, kx, y + 8);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(100, 100, 100);
        pdf.text(kpi.detail, kx, y + 14);
    });
    y += 28;

    checkPage(30);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(30, 30, 30);
    pdf.text('Principais Constatacoes', margin, y);
    y += 8;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(50, 50, 50);

    const findings: string[] = [];
    if (debitosAbertos.length > 0) {
        findings.push(`Existem ${debitosAbertos.length} debito(s) em aberto totalizando ${fmtCurrency(debitosAbertos.reduce((s, d) => s + (d.valorAtualizado || d.valorOriginal), 0))}.`);
    } else {
        findings.push('Nao ha debitos em aberto registrados.');
    }
    if (certPos > 0) {
        findings.push(`${certPos} certidao(oes) com status positivo (irregular) identificada(s).`);
    } else if (certNeg === analise.certidoes.length && analise.certidoes.length > 0) {
        findings.push('Todas as certidoes estao com status negativo (regular).');
    }
    if (obrigPend > 0) {
        findings.push(`${obrigPend} obrigacao(oes) acessoria(s) pendente(s) ou atrasada(s).`);
    } else {
        findings.push('Obrigacoes acessorias em dia.');
    }
    findings.forEach(f => {
        checkPage(8);
        pdf.text(`  •  ${f}`, margin, y, { maxWidth: contentW });
        y += 7;
    });

    // ===== PAGE 3: DEBITOS =====
    pdf.addPage();
    y = margin;
    sectionTitle('Debitos');

    if (debitos.length === 0) {
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(10);
        pdf.setTextColor(120, 120, 120);
        pdf.text('Nenhum debito registrado.', margin, y);
        y += 10;
    } else {
        const dCols = [
            { label: 'Esfera', x: margin, w: 20 },
            { label: 'Orgao', x: margin + 22, w: 30 },
            { label: 'Descricao', x: margin + 54, w: 45 },
            { label: 'Valor Original', x: margin + 101, w: 28 },
            { label: 'Valor Atualizado', x: margin + 131, w: 28 },
            { label: 'Status', x: margin + 161, w: 20 },
        ];
        tableHeader(dCols);
        debitos.forEach(d => {
            tableRow([
                { text: d.esfera, x: margin, w: 20 },
                { text: d.orgao || '-', x: margin + 22, w: 30 },
                { text: d.descricao || '-', x: margin + 54, w: 45 },
                { text: fmtCurrency(d.valorOriginal), x: margin + 101, w: 28 },
                { text: fmtCurrency(d.valorAtualizado || d.valorOriginal), x: margin + 131, w: 28 },
                { text: d.status.replace('_', ' '), x: margin + 161, w: 20, color: statusColor(d.status) },
            ]);
        });
        y += 2;
        hLine(y);
        y += 6;
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(30, 30, 30);
        const totalOriginal = debitos.reduce((s, d) => s + d.valorOriginal, 0);
        const totalAtualizado = debitos.reduce((s, d) => s + (d.valorAtualizado || d.valorOriginal), 0);
        pdf.text('TOTAL', margin, y);
        pdf.text(fmtCurrency(totalOriginal), margin + 101, y);
        pdf.text(fmtCurrency(totalAtualizado), margin + 131, y);
        y += 10;
    }

    // ===== PAGE 4: CERTIDOES =====
    pdf.addPage();
    y = margin;
    sectionTitle('Certidoes');

    if (analise.certidoes.length === 0) {
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(10);
        pdf.setTextColor(120, 120, 120);
        pdf.text('Nenhuma certidao registrada.', margin, y);
        y += 10;
    } else {
        const cCols = [
            { label: 'Esfera', x: margin, w: 20 },
            { label: 'Orgao', x: margin + 22, w: 42 },
            { label: 'Tipo', x: margin + 66, w: 38 },
            { label: 'Status', x: margin + 106, w: 32 },
            { label: 'Validade', x: margin + 140, w: 22 },
            { label: 'Impedimento', x: margin + 164, w: 18 },
        ];
        tableHeader(cCols);
        analise.certidoes.forEach(c => {
            const statusLabel = certidaoLabelInterno(c.status);
            tableRow([
                { text: c.esfera, x: margin, w: 20 },
                { text: c.orgao || '-', x: margin + 22, w: 42 },
                { text: c.tipo || '-', x: margin + 66, w: 38 },
                { text: statusLabel, x: margin + 106, w: 32, color: statusColor(c.status) },
                { text: c.dataValidade ? new Date(c.dataValidade).toLocaleDateString('pt-BR') : '-', x: margin + 140, w: 22 },
                { text: c.motivoImpedimento || '-', x: margin + 164, w: 18 },
            ]);
        });
    }

    // ===== PAGE 5: OBRIGACOES =====
    pdf.addPage();
    y = margin;
    sectionTitle('Obrigacoes Acessorias');

    if (analise.obrigacoes.length === 0) {
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(10);
        pdf.setTextColor(120, 120, 120);
        pdf.text('Nenhuma obrigacao registrada.', margin, y);
        y += 10;
    } else {
        const oCols = [
            { label: 'Esfera', x: margin, w: 22 },
            { label: 'Sigla', x: margin + 24, w: 22 },
            { label: 'Nome', x: margin + 48, w: 48 },
            { label: 'Status', x: margin + 98, w: 28 },
            { label: 'Competencia', x: margin + 128, w: 26 },
            { label: 'Entrega', x: margin + 156, w: 26 },
        ];
        tableHeader(oCols);
        analise.obrigacoes.forEach(o => {
            tableRow([
                { text: o.esfera, x: margin, w: 22 },
                { text: o.sigla || '-', x: margin + 24, w: 22 },
                { text: o.nome || '-', x: margin + 48, w: 48 },
                { text: o.status.replace('_', ' '), x: margin + 98, w: 28, color: statusColor(o.status) },
                { text: o.competencia || '-', x: margin + 128, w: 26 },
                { text: o.dataEntrega ? new Date(o.dataEntrega).toLocaleDateString('pt-BR') : '-', x: margin + 156, w: 26 },
            ]);
        });
    }

    // ===== PARCELAMENTOS (conditional) =====
    if (analise.parcelamentos.length > 0) {
        pdf.addPage();
        y = margin;
        sectionTitle('Parcelamentos');

        const pCols = [
            { label: 'Programa', x: margin, w: 45 },
            { label: 'Esfera', x: margin + 47, w: 22 },
            { label: 'Parcelas', x: margin + 71, w: 28 },
            { label: 'Progresso', x: margin + 101, w: 28 },
            { label: 'Valor Total', x: margin + 131, w: 28 },
            { label: 'Status', x: margin + 161, w: 20 },
        ];
        tableHeader(pCols);
        analise.parcelamentos.forEach(p => {
            const pct = p.parcelas > 0 ? Math.round((p.parcelasPagas / p.parcelas) * 100) : 0;
            tableRow([
                { text: p.programa || '-', x: margin, w: 45 },
                { text: p.esfera, x: margin + 47, w: 22 },
                { text: `${p.parcelasPagas}/${p.parcelas}`, x: margin + 71, w: 28 },
                { text: `${pct}%`, x: margin + 101, w: 28 },
                { text: fmtCurrency(p.valorTotal), x: margin + 131, w: 28 },
                { text: p.status, x: margin + 161, w: 20, color: statusColor(p.status) },
            ]);
        });
    }

    // ===== LAST PAGE: PLANO DE ACAO =====
    pdf.addPage();
    y = margin;
    sectionTitle('Plano de Acao');

    if (analise.planoAcao.length === 0) {
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(10);
        pdf.setTextColor(120, 120, 120);
        pdf.text('Nenhuma acao registrada no plano.', margin, y);
        y += 10;
    } else {
        const sorted = [...analise.planoAcao].sort((a, b) => {
            const order: Record<string, number> = { alta: 0, media: 1, baixa: 2 };
            return (order[a.gravidade] ?? 2) - (order[b.gravidade] ?? 2);
        });
        const aCols = [
            { label: 'Gravidade', x: margin, w: 22 },
            { label: 'Descricao', x: margin + 24, w: 65 },
            { label: 'Esfera', x: margin + 91, w: 22 },
            { label: 'Prazo', x: margin + 115, w: 24 },
            { label: 'Responsavel', x: margin + 141, w: 24 },
            { label: 'Status', x: margin + 167, w: 18 },
        ];
        tableHeader(aCols);
        sorted.forEach(a => {
            tableRow([
                { text: a.gravidade.toUpperCase(), x: margin, w: 22, color: statusColor(a.gravidade) },
                { text: a.descricao || '-', x: margin + 24, w: 65 },
                { text: a.esfera, x: margin + 91, w: 22 },
                { text: a.prazo ? new Date(a.prazo).toLocaleDateString('pt-BR') : '-', x: margin + 115, w: 24 },
                { text: a.responsavel || '-', x: margin + 141, w: 24 },
                { text: a.status.replace('_', ' '), x: margin + 167, w: 18, color: statusColor(a.status) },
            ]);
        });
    }

    // Footer em todas as paginas
    const totalPages = pdf.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(160, 160, 160);
        pdf.text(`SP Assessoria Contabil  |  ${analise.empresaNome}  |  ${dataHoje}`, margin, pageH - 8);
        pdf.text(`Pagina ${i} de ${totalPages}`, pageW - margin, pageH - 8, { align: 'right' });
    }

    const nomeArquivo = (analise.empresaNome || 'empresa').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
    const dataArquivo = new Date().toISOString().slice(0, 10);
    const blob = pdf.output('blob');

    return {
        blob,
        nomeArquivo: `relatorio-fiscal-${nomeArquivo}-${dataArquivo}.pdf`,
    };
}
