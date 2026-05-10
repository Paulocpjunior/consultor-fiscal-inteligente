/**
 * services/danfseGenerator.ts
 * Gera o DANFSe (Documento Auxiliar da NFS-e) em PDF usando jsPDF.
 * Layout responsivo A4 com identidade SP Contábil.
 */
import jsPDF from 'jspdf';
import type { NfseNacionalEmitida } from '../types';

// Cores SP Contábil
const NAVY: [number, number, number] = [2, 0, 38];          // #020026
const GOLD: [number, number, number] = [201, 161, 74];      // #C9A14A
const SLATE_LIGHT: [number, number, number] = [241, 245, 249];
const SLATE_BORDER: [number, number, number] = [203, 213, 225];
const TEXT_DARK: [number, number, number] = [30, 41, 59];
const TEXT_MUTED: [number, number, number] = [100, 116, 139];
const RED: [number, number, number] = [220, 38, 38];

const PAGE_W = 210;
const MARGIN = 15;
const CONTENT_W = PAGE_W - MARGIN * 2;

const fmtBRL = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const fmtCnpj = (s?: string | null) => {
    if (!s) return '—';
    const d = s.replace(/\D/g, '');
    if (d.length === 14) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
    if (d.length === 11) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
    return s;
};

const fmtChave = (c: string) =>
    c ? c.replace(/(\w{4})/g, '$1 ').trim() : '—';

const fmtDataHora = (iso: string) => {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('pt-BR');
    } catch { return iso; }
};

export function gerarDanfseBlob(nfse: NfseNacionalEmitida, modoTeste: boolean = true): Blob {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    let y = 0;

    // ─── Header navy ────────────────────────────────────────────────────
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, PAGE_W, 18, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('DANFSe', MARGIN, 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Documento Auxiliar da NFS-e Nacional', MARGIN + 28, 11);

    doc.setTextColor(...GOLD);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('SP ASSESSORIA CONTÁBIL', PAGE_W - MARGIN, 8, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('Consultor Fiscal Inteligente', PAGE_W - MARGIN, 13, { align: 'right' });
    y = 24;

    // ─── Watermark MODO TESTE ───────────────────────────────────────────
    if (modoTeste) {
        doc.setTextColor(255, 100, 100);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(60);
        doc.text('MODO TESTE', PAGE_W / 2, 150, { align: 'center', angle: 35, opacity: 0.15 } as any);
    }

    // ─── Box principal: número, chave, status ───────────────────────────
    doc.setDrawColor(...SLATE_BORDER);
    doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN, y, CONTENT_W, 22, 1, 1, 'D');

    doc.setTextColor(...TEXT_MUTED);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('NÚMERO', MARGIN + 3, y + 4);
    doc.text('SÉRIE', MARGIN + 50, y + 4);
    doc.text('DATA DE EMISSÃO', MARGIN + 80, y + 4);
    doc.text('STATUS', MARGIN + 130, y + 4);

    doc.setTextColor(...TEXT_DARK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(nfse.numero || '—', MARGIN + 3, y + 9);
    doc.text('001', MARGIN + 50, y + 9);
    doc.setFontSize(9);
    doc.text(fmtDataHora(nfse.dataEmissao), MARGIN + 80, y + 9);

    if (nfse.status === 'autorizada') {
        doc.setTextColor(34, 139, 34);
    } else if (nfse.status === 'cancelada') {
        doc.setTextColor(...RED);
    } else {
        doc.setTextColor(...TEXT_DARK);
    }
    doc.setFontSize(11);
    doc.text(nfse.status?.toUpperCase() || '—', MARGIN + 130, y + 9);

    doc.setTextColor(...TEXT_MUTED);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('CHAVE DE ACESSO', MARGIN + 3, y + 14);
    doc.setTextColor(...TEXT_DARK);
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.text(fmtChave(nfse.chave), MARGIN + 3, y + 19);
    y += 26;

    // ─── Prestador ──────────────────────────────────────────────────────
    sectionTitle(doc, 'PRESTADOR DE SERVIÇOS', y);
    y += 5;
    doc.setDrawColor(...SLATE_BORDER);
    doc.roundedRect(MARGIN, y, CONTENT_W, 16, 1, 1, 'D');
    keyValue(doc, 'CNPJ', fmtCnpj(nfse.prestador?.cnpj), MARGIN + 3, y + 5);
    keyValue(doc, 'INSCRIÇÃO MUNICIPAL', nfse.prestador?.im || '—', MARGIN + 60, y + 5);
    keyValue(doc, 'RAZÃO SOCIAL', nfse.prestador?.nome || '—', MARGIN + 3, y + 11);
    y += 20;

    // ─── Tomador ────────────────────────────────────────────────────────
    sectionTitle(doc, 'TOMADOR DE SERVIÇOS', y);
    y += 5;
    doc.roundedRect(MARGIN, y, CONTENT_W, 16, 1, 1, 'D');
    const docTomador = nfse.tomador?.cnpj || nfse.tomador?.cpf;
    const labelDoc = nfse.tomador?.cnpj ? 'CNPJ' : (nfse.tomador?.cpf ? 'CPF' : 'DOC');
    keyValue(doc, labelDoc, fmtCnpj(docTomador as any), MARGIN + 3, y + 5);
    keyValue(doc, 'NOME', nfse.tomador?.nome || '—', MARGIN + 60, y + 5);
    if (nfse.tomador?.endereco) {
        const e = nfse.tomador.endereco;
        const end = `${e.logradouro || ''} ${e.numero || ''} - ${e.bairro || ''}, ${e.cidade || ''}/${e.uf || ''}`;
        keyValue(doc, 'ENDEREÇO', end.trim().substring(0, 90), MARGIN + 3, y + 11);
    }
    y += 20;

    // ─── Servico ────────────────────────────────────────────────────────
    sectionTitle(doc, 'DISCRIMINAÇÃO DOS SERVIÇOS', y);
    y += 5;
    const altDescricao = Math.max(20, Math.ceil(nfse.servico.descricao.length / 80) * 5 + 10);
    doc.roundedRect(MARGIN, y, CONTENT_W, altDescricao, 1, 1, 'D');

    keyValue(doc, 'CÓDIGO NBS', nfse.servico.codigoNbs || '—', MARGIN + 3, y + 5);
    if (nfse.servico.cIndOp) {
        keyValue(doc, 'cIndOp', nfse.servico.cIndOp, MARGIN + 60, y + 5);
    }
    if (nfse.servico.cClassTrib && nfse.servico.cClassTrib !== '00000000') {
        keyValue(doc, 'cClassTrib', nfse.servico.cClassTrib, MARGIN + 100, y + 5);
    }
    if (nfse.servico.municipioPrestacao) {
        keyValue(doc, 'MUNICÍPIO', nfse.servico.municipioPrestacao, MARGIN + 145, y + 5);
    }

    doc.setTextColor(...TEXT_MUTED);
    doc.setFontSize(7);
    doc.text('DESCRIÇÃO', MARGIN + 3, y + 11);
    doc.setTextColor(...TEXT_DARK);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const linhasDesc = doc.splitTextToSize(nfse.servico.descricao, CONTENT_W - 6);
    doc.text(linhasDesc, MARGIN + 3, y + 16);
    y += altDescricao + 4;

    // ─── Valores ────────────────────────────────────────────────────────
    sectionTitle(doc, 'VALORES', y);
    y += 5;
    doc.roundedRect(MARGIN, y, CONTENT_W, 26, 1, 1, 'D');

    const colW = CONTENT_W / 4;
    const valorBruto = nfse.servico.valor;
    const issValor = nfse.servico.issValor || 0;
    const issRetido = nfse.servico.issRetido || 0;
    const valorLiquido = valorBruto - issRetido;

    keyValueValor(doc, 'VALOR BRUTO', fmtBRL(valorBruto), MARGIN + 3, y + 6);
    keyValueValor(doc, `ISS (${(nfse.servico.aliquotaIss || 0).toFixed(2)}%)`, fmtBRL(issValor), MARGIN + 3 + colW, y + 6);
    keyValueValor(doc, 'ISS RETIDO', fmtBRL(issRetido), MARGIN + 3 + colW * 2, y + 6, issRetido > 0 ? RED : TEXT_DARK);
    keyValueValor(doc, 'VALOR LÍQUIDO', fmtBRL(valorLiquido), MARGIN + 3 + colW * 3, y + 6, [34, 139, 34]);

    if (issRetido > 0) {
        doc.setTextColor(...TEXT_MUTED);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'italic');
        doc.text('* ISS retido pelo tomador (substituição tributária). Prestador não recolhe.',
                 MARGIN + 3, y + 22);
    }
    y += 30;

    // ─── Cancelamento (se aplicável) ────────────────────────────────────
    if (nfse.status === 'cancelada' && nfse.canceladaEm) {
        doc.setFillColor(...RED);
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.roundedRect(MARGIN, y, CONTENT_W, 10, 1, 1, 'F');
        doc.text('🚫 NFSe CANCELADA', MARGIN + 3, y + 6);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(`em ${fmtDataHora(nfse.canceladaEm)}`, MARGIN + 60, y + 6);
        if (nfse.motivoCancelamento) {
            doc.text(`Motivo: ${nfse.motivoCancelamento.substring(0, 80)}`, MARGIN + 3, y + 8.5);
        }
        y += 14;
    }

    // ─── Footer ─────────────────────────────────────────────────────────
    const footerY = 280;
    doc.setDrawColor(...SLATE_BORDER);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, footerY, PAGE_W - MARGIN, footerY);

    doc.setTextColor(...TEXT_MUTED);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('Este DANFSe é representação simplificada da NFS-e Nacional.', MARGIN, footerY + 4);
    doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, MARGIN, footerY + 8);

    if (modoTeste) {
        doc.setTextColor(...RED);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text('⚠ DOCUMENTO EM MODO TESTE — SEM VALIDADE FISCAL', MARGIN, footerY + 12);
    } else {
        doc.text('Para validar, consulte o portal NFS-e da Receita Federal', MARGIN, footerY + 12);
    }

    doc.setTextColor(...GOLD);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('SP ASSESSORIA CONTÁBIL', PAGE_W - MARGIN, footerY + 4, { align: 'right' });
    doc.setTextColor(...TEXT_MUTED);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('spassessoriacontabil.com.br', PAGE_W - MARGIN, footerY + 8, { align: 'right' });

    return doc.output('blob');
}

// ─── Helpers de layout ───────────────────────────────────────────────────

function sectionTitle(doc: jsPDF, text: string, y: number) {
    doc.setFillColor(...NAVY);
    doc.rect(MARGIN, y, CONTENT_W, 4, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(text, MARGIN + 2, y + 3);
}

function keyValue(doc: jsPDF, label: string, value: string, x: number, y: number) {
    doc.setTextColor(...TEXT_MUTED);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(label, x, y - 2);
    doc.setTextColor(...TEXT_DARK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(value, x, y + 2);
}

function keyValueValor(doc: jsPDF, label: string, value: string, x: number, y: number, cor: [number, number, number] = TEXT_DARK) {
    doc.setTextColor(...TEXT_MUTED);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(label, x, y);
    doc.setTextColor(...cor);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(value, x, y + 6);
}

export function baixarDanfse(nfse: NfseNacionalEmitida, modoTeste: boolean = true) {
    const blob = gerarDanfseBlob(nfse, modoTeste);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DANFSe-${nfse.numero || nfse.id}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
