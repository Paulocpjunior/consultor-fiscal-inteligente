// ============================================================================
// sefaz-backend/holerite-extracao.js  (ESM, puro)
//
// Leitura de holerites do IOB em PDF pelo Gemini, para o Consultor DP conferir
// o motor de cálculo dele contra a folha oficial (Paulo, 04/10/2026: "pode
// seguir com a conferência dos holerites pelo Gemini").
//
// O Gemini só TRANSCREVE: nome, CPF, código, cada verba com referência e
// valor, totais e bases como estão impressos. Nenhuma conta é pedida a ele —
// quem calcula é o motor do DP, e quem compara também. Por isso a resposta é
// conferida aqui (líquido = proventos − descontos; soma das verbas = total):
// leitura que não fecha volta com aviso, nunca "corrigida".
//
// O PDF tem dados pessoais (LGPD): não é gravado nem logado; o log leva só
// tamanho, quantidade e modelo.
// ============================================================================

/** Limite do PDF decodificado. O corpo JSON do servidor aceita 20 MB e o base64 cresce 1/3. */
export const MAX_PDF_BYTES = 14 * 1024 * 1024;

const NUM = { type: 'NUMBER', nullable: true };
const TXT = { type: 'STRING', nullable: true };

/** Schema da resposta (formato do @google/genai: OBJECT, ARRAY, STRING, NUMBER). */
export const SCHEMA_HOLERITES = {
    type: 'OBJECT',
    properties: {
        holerites: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    pagina: { type: 'INTEGER', nullable: true, description: 'Página do PDF onde o holerite começa.' },
                    nome: { type: 'STRING', description: 'Nome do funcionário como impresso.' },
                    cpf: { ...TXT, description: 'CPF do funcionário, se impresso.' },
                    codigo: { ...TXT, description: 'Código ou matrícula do funcionário no holerite.' },
                    competencia: { ...TXT, description: 'Mês de referência do holerite no formato AAAA-MM.' },
                    cargo: TXT,
                    salarioBase: { ...NUM, description: 'Salário-base impresso no rodapé ou cabeçalho.' },
                    verbas: {
                        type: 'ARRAY',
                        items: {
                            type: 'OBJECT',
                            properties: {
                                codigo: { ...TXT, description: 'Código do evento.' },
                                descricao: { type: 'STRING' },
                                referencia: { ...TXT, description: 'Coluna de referência (horas, dias, percentual) como impressa.' },
                                provento: { ...NUM, description: 'Valor na coluna de vencimentos/proventos.' },
                                desconto: { ...NUM, description: 'Valor na coluna de descontos.' },
                            },
                            required: ['descricao'],
                        },
                    },
                    totalProventos: NUM,
                    totalDescontos: NUM,
                    liquido: NUM,
                    baseInss: { ...NUM, description: 'Salário de contribuição do INSS.' },
                    baseFgts: { ...NUM, description: 'Base de cálculo do FGTS.' },
                    fgtsMes: { ...NUM, description: 'FGTS do mês.' },
                    baseIrrf: { ...NUM, description: 'Base de cálculo do IRRF.' },
                },
                required: ['nome', 'verbas'],
            },
        },
        observacoes: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['holerites'],
};

export function montarPromptHolerites({ competencia } = {}) {
    return [
        'Você recebe um PDF com holerites (recibos de pagamento de salário) gerados pelo sistema de folha IOB SAGE.',
        'TRANSCREVA cada holerite no JSON pedido. Regras:',
        '- Um item por funcionário. Se o mesmo holerite aparece em duas vias (empregador e empregado), transcreva uma vez só.',
        '- Copie cada linha de evento: código, descrição, referência (exatamente como impressa) e o valor na coluna em que aparece (proventos/vencimentos ou descontos).',
        '- Valores em reais como número decimal com ponto (1.518,00 → 1518.00). Não arredonde, não some, não calcule nada.',
        '- Totais, líquido e as bases do rodapé (salário-base, salário de contribuição do INSS, base do FGTS, FGTS do mês, base do IRRF): copie o que está impresso; se não estiver, use null.',
        '- CPF só com dígitos, se impresso; senão null. Competência no formato AAAA-MM.',
        '- Não invente funcionários nem eventos. Se algo estiver ilegível, use null e explique em "observacoes".',
        competencia ? `A competência esperada é ${competencia}; se o PDF for de outro mês, transcreva assim mesmo e diga em "observacoes".` : '',
    ].filter(Boolean).join('\n');
}

/** Confere o PDF antes de gastar uma chamada: base64 válido, assinatura %PDF e tamanho. */
export function validarPdf(base64) {
    if (typeof base64 !== 'string' || !base64.trim()) return { ok: false, erro: 'Envie o PDF dos holerites.' };
    const limpo = base64.replace(/^data:application\/pdf;base64,/, '').replace(/\s+/g, '');
    // Avoid a quantified whole-input regexp: large PDFs can exhaust V8's regexp stack.
    const semPadding = limpo.replace(/={1,2}$/, '');
    if (!semPadding || /[^A-Za-z0-9+/]/.test(semPadding)) return { ok: false, erro: 'Arquivo em formato inválido.' };
    const buf = Buffer.from(limpo, 'base64');
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return { ok: false, erro: 'O arquivo não é um PDF.' };
    if (buf.length > MAX_PDF_BYTES) return { ok: false, erro: `PDF com ${(buf.length / 1048576).toFixed(1)} MB: o limite é ${MAX_PDF_BYTES / 1048576} MB. Divida o arquivo.` };
    return { ok: true, base64: limpo, bytes: buf.length };
}

const centavos = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : null);
const texto = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
const brl = (c) => (c / 100).toFixed(2).replace('.', ',');

/**
 * Lê o JSON do Gemini e devolve os holerites em centavos, com avisos de
 * leitura que não fecha. JSON quebrado (resposta truncada) é erro.
 */
export function lerRespostaHolerites(textoResposta, { competencia } = {}) {
    let bruto;
    try {
        const t = String(textoResposta ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
        bruto = JSON.parse(t);
    } catch {
        throw new Error('A leitura do PDF voltou incompleta. Divida o arquivo em partes menores e tente de novo.');
    }
    const lista = Array.isArray(bruto?.holerites) ? bruto.holerites : [];
    const avisos = (Array.isArray(bruto?.observacoes) ? bruto.observacoes : []).map(texto).filter(Boolean);
    const holerites = lista.map((h, i) => {
        const verbas = (Array.isArray(h?.verbas) ? h.verbas : []).map((v) => ({
            codigo: texto(v?.codigo), descricao: texto(v?.descricao), referencia: texto(v?.referencia),
            provento: centavos(v?.provento) ?? 0, desconto: centavos(v?.desconto) ?? 0,
        })).filter((v) => v.descricao && (v.provento || v.desconto));
        const cpf = texto(h?.cpf).replace(/\D/g, '');
        const comp = texto(h?.competencia);
        const out = {
            pagina: Number.isInteger(h?.pagina) ? h.pagina : null,
            nome: texto(h?.nome), cpf: cpf.length === 11 ? cpf : '', codigo: texto(h?.codigo),
            competencia: /^\d{4}-(0[1-9]|1[0-2])$/.test(comp) ? comp : '', cargo: texto(h?.cargo),
            verbas,
            salarioBase: centavos(h?.salarioBase), totalProventos: centavos(h?.totalProventos), totalDescontos: centavos(h?.totalDescontos),
            liquido: centavos(h?.liquido), baseInss: centavos(h?.baseInss), baseFgts: centavos(h?.baseFgts),
            fgtsMes: centavos(h?.fgtsMes), baseIrrf: centavos(h?.baseIrrf),
            avisos: [],
        };
        const somaP = verbas.reduce((s, v) => s + v.provento, 0);
        const somaD = verbas.reduce((s, v) => s + v.desconto, 0);
        if (out.totalProventos !== null && Math.abs(somaP - out.totalProventos) > 1) out.avisos.push(`Soma dos proventos lidos (${brl(somaP)}) difere do total impresso (${brl(out.totalProventos)}): confira a leitura.`);
        if (out.totalDescontos !== null && Math.abs(somaD - out.totalDescontos) > 1) out.avisos.push(`Soma dos descontos lidos (${brl(somaD)}) difere do total impresso (${brl(out.totalDescontos)}): confira a leitura.`);
        if (out.totalProventos !== null && out.totalDescontos !== null && out.liquido !== null && Math.abs(out.totalProventos - out.totalDescontos - out.liquido) > 1)
            out.avisos.push('Líquido impresso não fecha com proventos − descontos: confira a leitura.');
        if (!out.nome) out.avisos.push(`Holerite ${i + 1} sem nome legível.`);
        if (competencia && out.competencia && out.competencia !== competencia) out.avisos.push(`Holerite de ${out.competencia}, diferente da competência conferida (${competencia}).`);
        return out;
    }).filter((h) => h.nome || h.verbas.length);
    if (!holerites.length) avisos.push('Nenhum holerite encontrado no PDF.');
    return { holerites, avisos };
}
