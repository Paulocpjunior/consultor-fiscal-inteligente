// ============================================================================
// sefaz-backend/legalizacao-normalizer.js
// Converte submissions CRUS da API do Jotform nos docs da coleção
// `legalizacao_vencimentos`. PURO (sem I/O) — testado em
// __tests__/legalizacaoNormalizer.test.ts.
//
// Formulários de origem (departamento de Legalização):
//   - "Controle de Vencimentos de Certidões e Certificados Digitais" —
//     certidões (Federal/Trabalhista/FGTS/Municipal/Estadual) e certificados
//     digitais (e-CNPJ/e-CPF A1/A3).
//   - "CONTROLE DE PARCELAMENTOS" — parcelamentos por órgão, com data de
//     vencimento da parcela.
//
// O casamento de campos é pelo TEXTO da pergunta (normalizado, sem acento),
// não pelo qid — sobrevive a reordenação/duplicação anual dos formulários
// ("...-2026" vira "...-2027" sem quebrar o sync).
// ============================================================================

/** minúsculas, sem acento, espaços colapsados, sem pontuação nas bordas. */
export function normalizarTexto(s) {
    return String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[.:*]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Data de resposta Jotform → "YYYY-MM-DD" | null.
 * Formatos aceitos: objeto {day,month,year} (control_datetime), "DD/MM/YYYY",
 * "YYYY-MM-DD". Ambíguo a/b/YYYY assume dia-primeiro (formulários BR).
 */
export function parseDataJotform(answer) {
    if (!answer) return null;
    if (typeof answer === 'object') {
        const { day, month, year } = answer;
        if (day && month && year) {
            const y = String(year).padStart(4, '0');
            const m = String(month).padStart(2, '0');
            const d = String(day).padStart(2, '0');
            if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
                return `${y}-${m}-${d}`;
            }
        }
        return null;
    }
    const s = String(answer).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
        let dia = Number(m[1]); let mes = Number(m[2]);
        // "07/25/2026" só pode ser MM/DD (25 não é mês) — inverte.
        if (mes > 12 && dia <= 12) { const t = dia; dia = mes; mes = t; }
        if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
        return `${m[3]}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    }
    return null;
}

/** Resposta de um campo cujo TEXTO da pergunta contém algum dos termos (normalizados). */
export function acharResposta(answers, termos) {
    const lista = Object.values(answers || {});
    const termosNorm = termos.map(normalizarTexto);
    // Match mais específico primeiro: pergunta que COMEÇA com o termo ganha de
    // pergunta que só contém (evita "data vencimento" casar "data aviso de vencimento").
    for (const modo of ['inicia', 'contem']) {
        for (const t of termosNorm) {
            for (const campo of lista) {
                const q = normalizarTexto(campo?.text || campo?.name || '');
                if (!q) continue;
                const casa = modo === 'inicia' ? q.startsWith(t) : q.includes(t);
                if (casa && campo.answer !== undefined && campo.answer !== null && campo.answer !== '') {
                    return campo.answer;
                }
            }
        }
    }
    return null;
}

const texto = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'object') return null; // datas/estruturas não viram texto solto
    const s = String(v).trim();
    return s || null;
};

const cnpjDigits = (v) => {
    const d = String(v || '').replace(/\D/g, '');
    return d.length >= 11 ? d : null; // aceita CPF (11) e CNPJ (14)
};

function emailValido(v) {
    const s = texto(v);
    if (!s) return null;
    const primeiro = s.split(/[;,\s]+/)[0];
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(primeiro) ? primeiro.toLowerCase() : null;
}

/**
 * Submission do form de certidões/certificados → doc | null.
 * null = sem empresa OU sem data de vencimento (não rastreável).
 */
export function normalizarSubmissionCertidao(sub) {
    if (!sub || sub.status === 'DELETED') return null;
    const a = sub.answers || {};
    const empresaNome = texto(acharResposta(a, ['empresa']));
    const dataVencimento = parseDataJotform(acharResposta(a, ['data vencimento']));
    if (!empresaNome || !dataVencimento) return null;

    const tipoCertificado = texto(acharResposta(a, ['selecione um dos certificados']));
    const tipoCertidao = texto(acharResposta(a, ['selecione uma das certidoes']));
    const categoria = tipoCertificado ? 'certificado' : 'certidao';

    return {
        origem: 'jotform',
        formId: String(sub.form_id || ''),
        submissionId: String(sub.id),
        categoria,
        tipoDetalhe: tipoCertificado || tipoCertidao || 'Não informado',
        empresaNome,
        empresaNumero: texto(acharResposta(a, ['n empresa'])),
        cnpj: cnpjDigits(acharResposta(a, ['cnpj'])),
        emailCliente: emailValido(acharResposta(a, ['e-mail', 'email'])),
        dataEmissao: parseDataJotform(acharResposta(a, ['data emissao'])),
        dataVencimento,
        dataAviso: parseDataJotform(acharResposta(a, ['data aviso de vencimento'])),
        responsavel: texto(acharResposta(a, ['ass responsavel', 'responsavel'])),
        observacao: texto(acharResposta(a, ['observacao'])),
        criadoNoJotformEm: texto(sub.created_at),
    };
}

/** Submission do form de parcelamentos → doc | null. */
export function normalizarSubmissionParcelamento(sub) {
    if (!sub || sub.status === 'DELETED') return null;
    const a = sub.answers || {};
    const empresaNome = texto(acharResposta(a, ['empresa']));
    const dataVencimento = parseDataJotform(acharResposta(a, ['data vencimento']));
    if (!empresaNome || !dataVencimento) return null;

    return {
        origem: 'jotform',
        formId: String(sub.form_id || ''),
        submissionId: String(sub.id),
        categoria: 'parcelamento',
        tipoDetalhe: texto(acharResposta(a, ['parcelamento orgao'])) || 'Parcelamento',
        empresaNome,
        empresaNumero: texto(acharResposta(a, ['n empresa'])),
        cnpj: cnpjDigits(acharResposta(a, ['cnpj'])),
        emailCliente: emailValido(acharResposta(a, ['e-mail cliente', 'email cliente'])),
        numeroProcesso: texto(acharResposta(a, ['numero processo'])),
        numeroParcelas: texto(acharResposta(a, ['n parcelas'])),
        valorParcela: texto(acharResposta(a, ['valor parcela'])),
        valorTotalDivida: texto(acharResposta(a, ['valor total da divida'])),
        dataInicio: parseDataJotform(acharResposta(a, ['data inicio parcelamento'])),
        dataVencimento,
        responsavel: texto(acharResposta(a, ['responsavel pelo parcelamento'])),
        criadoNoJotformEm: texto(sub.created_at),
    };
}

/**
 * Lote de submissions → { docs: Map<docId, doc>, ignorados }.
 * docId determinístico `jf_{submissionId}` — re-sync sobrescreve, nunca duplica.
 */
export function normalizarLote(subs, normalizarUma) {
    const docs = new Map();
    let ignorados = 0;
    for (const sub of subs || []) {
        const doc = normalizarUma(sub);
        if (doc) docs.set(`jf_${doc.submissionId}`, doc);
        else ignorados++;
    }
    return { docs, ignorados };
}
