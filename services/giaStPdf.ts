/**
 * services/giaStPdf.ts
 *
 * Espelho da GIA-ST em PDF (relatório de conferência no layout da guia do
 * aplicativo GIA-ST 3 — campos numerados 7-21 + 39). Não substitui a
 * transmissão: é o documento de conferência/arquivo do escritório.
 */

import type { GiaStGuia } from './giaStService';

const fmtBRL = (n: number): string =>
    (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtCnpj = (c: string): string => {
    const d = (c || '').replace(/\D/g, '');
    return d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : c;
};

const fmtCompetencia = (c: string): string => {
    const m = (c || '').match(/^(\d{4})-(\d{2})$/);
    return m ? `${m[2]}/${m[1]}` : c;
};

export async function gerarEspelhoGiaStPdf(guia: GiaStGuia): Promise<void> {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210;
    const ML = 14;
    const MR = W - 14;
    let y = 16;

    doc.setFont('helvetica', 'bold').setFontSize(13);
    doc.text('GIA-ST — Guia Nacional de Informação e Apuração do ICMS', W / 2, y, { align: 'center' });
    y += 5.5;
    doc.setFontSize(11);
    doc.text('Substituição Tributária — Espelho de Conferência', W / 2, y, { align: 'center' });
    y += 4;
    doc.setFont('helvetica', 'normal').setFontSize(8);
    doc.text('Documento interno de conferência — a entrega oficial é feita pelo aplicativo GIA-ST 3 (SEFAZ-RS) via TED.', W / 2, y, { align: 'center' });
    y += 6;

    // ── Identificação ──────────────────────────────────────────────
    doc.setDrawColor(60).setLineWidth(0.3);
    doc.rect(ML, y, MR - ML, 30);
    doc.setFont('helvetica', 'bold').setFontSize(9);
    doc.text('Identificação', ML + 2, y + 5);
    doc.setFont('helvetica', 'normal').setFontSize(9);
    const ident: Array<[string, string]> = [
        ['Contribuinte substituto', guia.empresaNome || '—'],
        ['CNPJ', fmtCnpj(guia.empresaCnpj)],
        ['Período de referência', fmtCompetencia(guia.competencia)],
        ['UF favorecida', guia.ufFavorecida],
        ['IE na UF favorecida', guia.inscricaoEstadualUfFavorecida || '—'],
        ['Vencimento do ICMS-ST', guia.dataVencimento ? guia.dataVencimento.split('-').reverse().join('/') : '—'],
    ];
    let yl = y + 10;
    for (let i = 0; i < ident.length; i += 2) {
        doc.setFont('helvetica', 'bold');
        doc.text(`${ident[i][0]}:`, ML + 2, yl);
        doc.setFont('helvetica', 'normal');
        doc.text(String(ident[i][1]), ML + 44, yl);
        if (ident[i + 1]) {
            doc.setFont('helvetica', 'bold');
            doc.text(`${ident[i + 1][0]}:`, ML + 100, yl);
            doc.setFont('helvetica', 'normal');
            doc.text(String(ident[i + 1][1]), ML + 142, yl);
        }
        yl += 6;
    }
    y += 34;

    if (guia.semMovimento || guia.retificacao) {
        doc.setFont('helvetica', 'bold').setFontSize(9);
        const flags = [guia.semMovimento ? '1. GIA-ST SEM MOVIMENTO' : null, guia.retificacao ? '2. GIA-ST RETIFICAÇÃO' : null]
            .filter(Boolean).join('    ·    ');
        doc.text(flags as string, ML, y);
        y += 6;
    }

    // ── Valores (campos 7-21 + 39) ─────────────────────────────────
    const linhas: Array<[string, number, boolean]> = [
        ['7. Valor dos Produtos', guia.c7ValorProdutos, false],
        ['8. Valor do IPI', guia.c8ValorIpi, false],
        ['9. Despesas Acessórias', guia.c9DespesasAcessorias, false],
        ['10. Base de Cálculo do ICMS Próprio', guia.c10BcIcmsProprio, false],
        ['11. ICMS Próprio', guia.c11IcmsProprio, false],
        ['12. Base de Cálculo ICMS-ST', guia.c12BcIcmsSt, false],
        ['13. ICMS Retido por ST', guia.c13IcmsRetidoSt, false],
        ['14. ICMS de Devolução de Mercadoria (Anexo I)', guia.c14IcmsDevolucao, false],
        ['15. ICMS de Ressarcimentos (Anexo II)', guia.c15IcmsRessarcimentos, false],
        ['16. Crédito de Período Anterior', guia.c16CreditoPeriodoAnterior, false],
        ['17. Pagamentos Antecipados', guia.c17PagamentosAntecipados, false],
        ['18. ICMS-ST Devido', guia.c18IcmsStDevido, true],
        ['19. Repasse ICMS Retido por Refinarias/Complementos', guia.c19RepasseRefinarias, false],
        ['39. Repasse ICMS Retido por Outros Contribuintes', guia.c39RepasseOutros, false],
        ['20. Crédito para Período Seguinte', guia.c20CreditoPeriodoSeguinte, true],
        ['21. Total do ICMS-ST a Recolher', guia.c21TotalRecolher, true],
    ];
    doc.setFont('helvetica', 'bold').setFontSize(9);
    doc.text('Valores', ML, y);
    y += 2;
    const rowH = 7;
    for (const [label, valor, calculado] of linhas) {
        doc.setDrawColor(150).setLineWidth(0.2);
        doc.rect(ML, y, MR - ML - 40, rowH);
        doc.rect(MR - 40, y, 40, rowH);
        if (calculado) {
            doc.setFillColor(238, 242, 255);
            doc.rect(MR - 40, y, 40, rowH, 'F');
            doc.rect(MR - 40, y, 40, rowH);
        }
        doc.setFont('helvetica', calculado ? 'bold' : 'normal').setFontSize(8.5);
        doc.text(label + (calculado ? '  (calculado)' : ''), ML + 2, y + 4.7);
        doc.text(fmtBRL(valor), MR - 2, y + 4.7, { align: 'right' });
        y += rowH;
    }
    y += 6;

    if (guia.informacoesComplementares?.trim()) {
        doc.setFont('helvetica', 'bold').setFontSize(9);
        doc.text('36. Informações Complementares', ML, y);
        y += 4.5;
        doc.setFont('helvetica', 'normal').setFontSize(8.5);
        const linhasInfo = doc.splitTextToSize(guia.informacoesComplementares.trim(), MR - ML - 4);
        doc.text(linhasInfo, ML + 2, y);
        y += linhasInfo.length * 4 + 4;
    }

    if (guia.inconsistencias?.length) {
        doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(180, 30, 30);
        doc.text('Inconsistências pendentes', ML, y);
        y += 4.5;
        doc.setFont('helvetica', 'normal').setFontSize(8);
        for (const inc of guia.inconsistencias) {
            const l = doc.splitTextToSize(`• ${inc}`, MR - ML - 4);
            doc.text(l, ML + 2, y);
            y += l.length * 3.8;
        }
        doc.setTextColor(0);
        y += 3;
    }

    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(110);
    doc.text(
        `Gerado pelo Consultor Fiscal Inteligente em ${new Date().toLocaleString('pt-BR')} — base: Livro de ICMS Substituto (Office Fiscal/IOB SAGE). Confira com as fontes oficiais.`,
        W / 2, 288, { align: 'center' },
    );

    const nome = `GIA-ST_${guia.ufFavorecida}_${guia.competencia.replace('-', '')}_${guia.empresaCnpj}.pdf`;
    doc.save(nome);
}
