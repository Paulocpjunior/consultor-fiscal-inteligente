/**
 * relatorioPdf.ts — casca PDF com a identidade da SP Assessoria Contábil.
 *
 * Formato escolhido pelo Paulo pro menu Relatórios (01/08): PDF com a cara da
 * SP — logo, cores do logo (#0E3BFA/#091D8D, as mesmas da casca de e-mail da
 * Legalização) e rodapé padrão. Toda aba do hub usa ESTA casca: cabeçalho,
 * tabela com quebra de página e numeração saem daqui, a aba só entrega
 * título, período e linhas.
 */

export interface ColunaPdf {
    titulo: string;
    /** Largura relativa (soma livre — normalizada pra área útil). */
    largura: number;
    alinhamento?: 'esquerda' | 'direita';
}

export interface RelatorioPdfParams {
    titulo: string;
    /** Ex.: 'Competência 06/2026 · EDUARDO GUERRA HORTIFRUTI'. */
    subtitulo: string;
    colunas: ColunaPdf[];
    linhas: (string | number)[][];
    /** Linha de totais (mesmo shape das linhas) — sai destacada no fim. */
    totais?: (string | number)[];
    /** Observações no rodapé do relatório (uma por linha). */
    observacoes?: string[];
    /**
     * Identificação obrigatória do relatório (Paulo, 01/08): responsável legal
     * da empresa e contador responsável. Quando o param vem, o bloco SEMPRE
     * sai — campo não cadastrado é escrito como "não cadastrado" (farol
     * honesto: o buraco fica visível no papel, não some).
     */
    identificacao?: IdentificacaoPdf;
    orientacao?: 'portrait' | 'landscape';
    fileName: string;
}

export interface IdentificacaoPdf {
    /** Ex.: 'JOÃO DA SILVA — CPF 123.456.789-00 · Sócio administrador'. */
    responsavel?: string | null;
    /** Ex.: 'MARIA SOUZA — CRC 1SP123456/O-8'. */
    contador?: string | null;
}

const fmtCpf = (c: string) => c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');

/**
 * Monta as linhas de identificação a partir do cadastro (dadosFiscais).
 * PURA — devolve null nos campos sem nome cadastrado, e a casca imprime
 * "não cadastrado" no lugar.
 */
export function montarIdentificacao(df?: {
    respLegalNome?: string | null; respLegalCpf?: string | null; respLegalCargo?: string | null;
    responsaveisLegais?: Array<{ nome?: string | null; cpf?: string | null; cargo?: string | null }> | null;
    contadorNome?: string | null; contadorCrc?: string | null; contadorCpf?: string | null;
} | null): IdentificacaoPdf {
    const fmtResp = (r: { nome?: string | null; cpf?: string | null; cargo?: string | null }) => {
        const nome = (r?.nome || '').trim();
        if (!nome) return null;
        const cpf = String(r?.cpf || '').replace(/\D/g, '');
        const cargo = (r?.cargo || '').trim();
        return [nome, cpf ? `CPF ${fmtCpf(cpf)}` : '', cargo].filter(Boolean).join(' — ');
    };
    // MÚLTIPLOS responsáveis (03/08): a lista vence e o PDF imprime TODOS;
    // os campos respLegal* seguem como legado/espelho do primeiro.
    const lista = (df?.responsaveisLegais || []).map(fmtResp).filter(Boolean) as string[];
    const responsavel = lista.length > 0
        ? lista.join('  ·  ')
        : fmtResp({ nome: df?.respLegalNome, cpf: df?.respLegalCpf, cargo: df?.respLegalCargo });

    const nomeCont = (df?.contadorNome || '').trim();
    const cpfCont = String(df?.contadorCpf || '').replace(/\D/g, '');
    const crc = (df?.contadorCrc || '').trim();
    return {
        responsavel: responsavel || null,
        contador: nomeCont
            ? [nomeCont, crc ? `CRC ${crc}` : '', cpfCont ? `CPF ${fmtCpf(cpfCont)}` : ''].filter(Boolean).join(' — ')
            : null,
    };
}

const AZUL: [number, number, number] = [14, 59, 250];      // #0E3BFA
const AZUL_ESCURO: [number, number, number] = [9, 29, 141]; // #091D8D
const TINTA: [number, number, number] = [30, 41, 59];
const CINZA: [number, number, number] = [100, 116, 139];
const BORDA: [number, number, number] = [203, 213, 225];

let logoCache: string | null | undefined;

/** Logo da SP como dataURL (uma busca por sessão; sem logo o PDF sai igual). */
async function carregarLogo(): Promise<string | null> {
    if (logoCache !== undefined) return logoCache;
    try {
        const r = await fetch('/sp-logo.png');
        if (!r.ok) throw new Error(String(r.status));
        const blob = await r.blob();
        logoCache = await new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.onerror = reject;
            fr.readAsDataURL(blob);
        });
    } catch {
        logoCache = null;
    }
    return logoCache;
}

export async function gerarRelatorioPdf(p: RelatorioPdfParams): Promise<void> {
    const { default: jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation: p.orientacao || 'landscape', unit: 'mm', format: 'a4' });
    const W = pdf.internal.pageSize.getWidth();
    const H = pdf.internal.pageSize.getHeight();
    const M = 10;
    const logo = await carregarLogo();

    const somaLarguras = p.colunas.reduce((a, c) => a + c.largura, 0);
    const areaUtil = W - 2 * M;
    const larguras = p.colunas.map(c => (c.largura / somaLarguras) * areaUtil);

    const fmtCell = (v: string | number) =>
        typeof v === 'number'
            ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : String(v ?? '');

    let paginas = 0;
    let y = 0;

    const cabecalho = () => {
        paginas++;
        // Faixa da marca.
        pdf.setFillColor(...AZUL_ESCURO);
        pdf.rect(0, 0, W, 16, 'F');
        if (logo) {
            try { pdf.addImage(logo, 'PNG', M, 2.5, 11, 11); } catch { /* logo corrompido não derruba o PDF */ }
        }
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(11).setFont('helvetica', 'bold');
        pdf.text(p.titulo, logo ? M + 14 : M, 8);
        pdf.setFontSize(8).setFont('helvetica', 'normal');
        pdf.text(p.subtitulo, logo ? M + 14 : M, 12.5);
        pdf.setFontSize(7);
        pdf.text('SP Assessoria Contábil · Consultor Fiscal Inteligente', W - M, 8, { align: 'right' });
        pdf.text(new Date().toLocaleString('pt-BR'), W - M, 12.5, { align: 'right' });

        // Cabeçalho da tabela.
        y = 22;
        pdf.setFillColor(...AZUL);
        pdf.rect(M, y - 4, areaUtil, 6, 'F');
        pdf.setTextColor(255, 255, 255).setFontSize(7).setFont('helvetica', 'bold');
        let x = M;
        p.colunas.forEach((c, i) => {
            const w = larguras[i] ?? 10;
            pdf.text(c.titulo, c.alinhamento === 'direita' ? x + w - 1.5 : x + 1.5, y, {
                align: c.alinhamento === 'direita' ? 'right' : 'left',
            });
            x += w;
        });
        y += 4.5;
        pdf.setFont('helvetica', 'normal').setTextColor(...TINTA);
    };

    const rodape = () => {
        pdf.setFontSize(6.5).setTextColor(...CINZA);
        pdf.text(`Página ${paginas}`, W - M, H - 5, { align: 'right' });
        pdf.text('Gerado pelo Consultor Fiscal Inteligente — conferir antes de protocolar.', M, H - 5);
    };

    const linhaTabela = (valores: (string | number)[], destaque = false) => {
        if (y > H - 14) { rodape(); pdf.addPage(); cabecalho(); }
        if (destaque) {
            pdf.setFillColor(226, 232, 240);
            pdf.rect(M, y - 3.2, areaUtil, 4.6, 'F');
            pdf.setFont('helvetica', 'bold');
        }
        let x = M;
        valores.forEach((v, i) => {
            const w = larguras[i] ?? 10;
            const txt = fmtCell(v);
            const maxChars = Math.floor(w / 1.55);
            // CORTE HONESTO: o "…" sozinho não diz que sobrou coisa nem quanto —
            // e num relatório fiscal isso vira conclusão errada (caso LAV,
            // 12/08: a lista de notas faltantes cortada pela largura da coluna,
            // sem nada avisando). Quando corta, o texto DIZ que cortou.
            const recortado = txt.length > maxChars
                ? txt.slice(0, Math.max(1, maxChars - 8)) + `…(+${txt.length - (maxChars - 8)})`
                : txt;
            pdf.setFontSize(6.8);
            pdf.text(recortado, p.colunas[i]?.alinhamento === 'direita' ? x + w - 1.5 : x + 1.5, y, {
                align: p.colunas[i]?.alinhamento === 'direita' ? 'right' : 'left',
            });
            x += w;
        });
        if (destaque) pdf.setFont('helvetica', 'normal');
        pdf.setDrawColor(...BORDA);
        pdf.setLineWidth(0.1);
        pdf.line(M, y + 1.3, W - M, y + 1.3);
        y += 4.6;
    };

    cabecalho();
    for (const linha of p.linhas) linhaTabela(linha);
    if (p.totais) linhaTabela(p.totais, true);

    if (p.identificacao) {
        if (y > H - 22) { rodape(); pdf.addPage(); cabecalho(); }
        y += 4;
        pdf.setFontSize(7.2).setTextColor(...TINTA);
        const naoCad = 'não cadastrado — completar em Dados Fiscais da empresa';
        pdf.setFont('helvetica', 'bold');
        pdf.text('Responsável pela empresa:', M, y);
        pdf.setFont('helvetica', p.identificacao.responsavel ? 'normal' : 'italic');
        pdf.text(p.identificacao.responsavel || naoCad, M + 34, y);
        y += 4;
        pdf.setFont('helvetica', 'bold');
        pdf.text('Contador responsável:', M, y);
        pdf.setFont('helvetica', p.identificacao.contador ? 'normal' : 'italic');
        pdf.text(p.identificacao.contador || naoCad, M + 34, y);
        y += 2;
        pdf.setFont('helvetica', 'normal');
    }

    if (p.observacoes?.length) {
        if (y > H - 20 - p.observacoes.length * 3.5) { rodape(); pdf.addPage(); cabecalho(); }
        y += 3;
        pdf.setFontSize(6.5).setTextColor(...CINZA);
        for (const obs of p.observacoes) {
            pdf.text(`• ${obs}`, M, y);
            y += 3.5;
        }
        pdf.setTextColor(...TINTA);
    }
    rodape();
    pdf.save(p.fileName);
}

// ─── Declaração de faturamento (documento assinado) ─────────────────────────
//
// Diferente de todo o resto do menu: não é um relatório de conferência
// interna, é um DOCUMENTO que sai do escritório assinado — vai a banco,
// licitação, locador. Por isso tem destinatário, texto declaratório, local/
// data e DUAS assinaturas (representante da empresa + contador com CRC).
//
// Modelo dado pelo Paulo (05/08, PDF do SAGE) — mesma estrutura, com a
// identidade da SP e leitura de relatório sério: bloco de identificação em
// duas colunas, tabela de meses com régua fina, total destacado.

export interface MesFaturamento {
    /** 'AAAA-MM' */
    competencia: string;
    valor: number;
    /** true quando o colaborador ajustou o valor proposto pelo app. */
    ajustado?: boolean;
}

export interface DeclaracaoFaturamentoParams {
    destinatario?: string | null;
    empresa: {
        nome: string; cnpj: string;
        endereco?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null;
        telefone?: string | null; inscricaoEstadual?: string | null; inscricaoMunicipal?: string | null;
        cnae?: string | null; regimeTributario?: string | null;
    };
    meses: MesFaturamento[];
    /** Cidade da assinatura (padrão: a cidade da empresa ou São Paulo). */
    localAssinatura?: string | null;
    identificacao?: IdentificacaoPdf;
    observacoes?: string[];
    fileName: string;
}

const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const fmtMesExtenso = (competencia: string): string => {
    const [ano, mes] = String(competencia || '').split('-');
    const i = Number(mes) - 1;
    return MESES_PT[i] ? `${MESES_PT[i]}/${ano}` : competencia;
};

const fmtDataExtenso = (d: Date): string =>
    `${String(d.getDate()).padStart(2, '0')} DE ${MESES_PT[d.getMonth()].toUpperCase()} DE ${d.getFullYear()}`;

const fmtCnpjDoc = (c: string) =>
    String(c || '').replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

export async function gerarDeclaracaoFaturamentoPdf(p: DeclaracaoFaturamentoParams): Promise<void> {
    const { default: jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = pdf.internal.pageSize.getWidth();
    const H = pdf.internal.pageSize.getHeight();
    const M = 18;
    const logo = await carregarLogo();

    pdf.setFillColor(...AZUL_ESCURO);
    pdf.rect(0, 0, W, 20, 'F');
    if (logo) {
        try { pdf.addImage(logo, 'PNG', M - 6, 4, 12, 12); } catch { /* logo corrompido não derruba o PDF */ }
    }
    pdf.setTextColor(255, 255, 255).setFontSize(13).setFont('helvetica', 'bold');
    pdf.text('DECLARAÇÃO DE FATURAMENTO', logo ? M + 9 : M, 12);
    pdf.setFontSize(7).setFont('helvetica', 'normal');
    pdf.text('SP Assessoria Contábil', W - M + 6, 12, { align: 'right' });

    let y = 32;
    pdf.setTextColor(...TINTA).setFontSize(9.5);
    if (p.destinatario) {
        pdf.setFont('helvetica', 'bold');
        pdf.text(`A(o) ${p.destinatario}`, M, y);
        pdf.setFont('helvetica', 'normal');
        y += 9;
    }
    const texto = 'Declaramos pela presente que o faturamento da empresa abaixo identificada, '
        + 'conforme registros fiscais, apresenta os valores a seguir demonstrados:';
    for (const linha of pdf.splitTextToSize(texto, W - 2 * M)) { pdf.text(linha, M, y); y += 5; }

    // ── Identificação da empresa ────────────────────────────────────────────
    y += 5;
    const periodo = p.meses.length
        ? `${fmtMesExtenso(p.meses[0].competencia)} a ${fmtMesExtenso(p.meses[p.meses.length - 1].competencia)}`
        : '—';
    const cidadeUf = [p.empresa.cidade, p.empresa.uf].filter(Boolean).join(' - ');
    // Campo em branco é escrito como "não informado": o buraco de cadastro
    // fica no papel (mesma regra do bloco de identificação dos relatórios).
    const campos: Array<[string, string | null | undefined]> = [
        ['Empresa', p.empresa.nome],
        ['CNPJ', fmtCnpjDoc(p.empresa.cnpj)],
        ['Endereço', p.empresa.endereco],
        ['Bairro', p.empresa.bairro],
        ['Cidade', cidadeUf],
        ['Telefone', p.empresa.telefone],
        ['Inscrição Estadual', p.empresa.inscricaoEstadual],
        ['Inscrição Municipal', p.empresa.inscricaoMunicipal],
        ['C.N.A.E.', p.empresa.cnae],
        ['Regime tributário', p.empresa.regimeTributario],
        ['Período', periodo],
    ];
    pdf.setFontSize(8.5);
    for (const [rotulo, valor] of campos) {
        pdf.setFont('helvetica', 'bold');
        pdf.text(rotulo, M, y);
        const txt = String(valor || '').trim();
        pdf.setFont('helvetica', txt ? 'normal' : 'italic');
        pdf.setTextColor(...(txt ? TINTA : CINZA));
        pdf.text(txt || 'não informado', M + 42, y);
        pdf.setTextColor(...TINTA);
        y += 5;
    }

    // ── Tabela de meses ─────────────────────────────────────────────────────
    y += 6;
    const larguraTabela = 96;
    pdf.setFillColor(...AZUL);
    pdf.rect(M, y - 4.4, larguraTabela, 6.4, 'F');
    pdf.setTextColor(255, 255, 255).setFontSize(8).setFont('helvetica', 'bold');
    pdf.text('Mês', M + 2, y);
    pdf.text('Faturamento (R$)', M + larguraTabela - 2, y, { align: 'right' });
    y += 5.5;
    pdf.setTextColor(...TINTA).setFont('helvetica', 'normal');

    const brl = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let total = 0;
    for (const m of p.meses) {
        if (y > H - 60) { pdf.addPage(); y = 24; }
        total += Number(m.valor) || 0;
        pdf.setFontSize(8.5);
        pdf.text(fmtMesExtenso(m.competencia) + (m.ajustado ? ' *' : ''), M + 2, y);
        pdf.text(brl(Number(m.valor) || 0), M + larguraTabela - 2, y, { align: 'right' });
        pdf.setDrawColor(...BORDA).setLineWidth(0.1);
        pdf.line(M, y + 1.6, M + larguraTabela, y + 1.6);
        y += 5.4;
    }
    pdf.setFillColor(226, 232, 240);
    pdf.rect(M, y - 3.6, larguraTabela, 5.8, 'F');
    pdf.setFont('helvetica', 'bold').setFontSize(9);
    pdf.text('TOTAL', M + 2, y);
    pdf.text(brl(total), M + larguraTabela - 2, y, { align: 'right' });
    pdf.setFont('helvetica', 'normal');
    y += 12;

    if (p.meses.some((m) => m.ajustado)) {
        pdf.setFontSize(6.8).setTextColor(...CINZA);
        pdf.text('* valor ajustado pelo responsável em relação ao apurado nos registros fiscais.', M, y);
        pdf.setTextColor(...TINTA);
        y += 6;
    }

    // ── Local, data e assinaturas ───────────────────────────────────────────
    if (y > H - 55) { pdf.addPage(); y = 30; }
    const local = (p.localAssinatura || p.empresa.cidade || 'SÃO PAULO').toUpperCase();
    pdf.setFontSize(9);
    pdf.text(`${local}, ${fmtDataExtenso(new Date())}.`, M, y);
    y += 26;

    const colDir = W / 2 + 4;
    pdf.setDrawColor(...TINTA).setLineWidth(0.3);
    pdf.line(M, y, M + 70, y);
    pdf.line(colDir, y, colDir + 70, y);
    y += 4.5;
    pdf.setFontSize(8);
    const naoCad = 'não cadastrado — completar em Dados Fiscais';
    const resp = p.identificacao?.responsavel;
    const cont = p.identificacao?.contador;
    pdf.setFont('helvetica', resp ? 'bold' : 'italic');
    for (const linha of pdf.splitTextToSize(resp || naoCad, 70)) { pdf.text(linha, M, y); y += 4; }
    let yCont = y - (resp ? pdf.splitTextToSize(resp, 70).length : 1) * 4;
    pdf.setFont('helvetica', cont ? 'bold' : 'italic');
    for (const linha of pdf.splitTextToSize(cont || naoCad, 70)) { pdf.text(linha, colDir, yCont); yCont += 4; }
    pdf.setFont('helvetica', 'normal').setFontSize(7);
    pdf.setTextColor(...CINZA);
    pdf.text('Representante da empresa', M, Math.max(y, yCont) + 2);
    pdf.text('Contador responsável', colDir, Math.max(y, yCont) + 2);

    if (p.observacoes?.length) {
        let yo = Math.max(y, yCont) + 10;
        pdf.setFontSize(6.8);
        for (const obs of p.observacoes) { pdf.text(`• ${obs}`, M, yo); yo += 3.6; }
    }

    pdf.setFontSize(6.5).setTextColor(...CINZA);
    pdf.text('Gerado pelo Consultor Fiscal Inteligente — conferir antes de assinar.', M, H - 8);
    pdf.save(p.fileName);
}
