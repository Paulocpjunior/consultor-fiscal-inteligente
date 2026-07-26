/**
 * legalizacaoNormalizer.test.ts — parser das submissions Jotform do
 * departamento de Legalização (sefaz-backend/legalizacao-normalizer.js).
 */
import {
    normalizarTexto,
    parseDataJotform,
    acharResposta,
    empresaInativa,
    normalizarSubmissionCertidao,
    normalizarSubmissionParcelamento,
    normalizarLote,
} from '../sefaz-backend/legalizacao-normalizer.js';

describe('normalizarTexto', () => {
    it('remove acento, caixa e espaços duplicados', () => {
        expect(normalizarTexto('  DATA  VENCIMENTO ')).toBe('data vencimento');
        expect(normalizarTexto('Selecione uma das Certidões abaixo .')).toBe('selecione uma das certidoes abaixo');
        expect(normalizarTexto('Ass. Responsavél')).toBe('ass responsavel');
    });
});

describe('parseDataJotform', () => {
    it('objeto {day,month,year} do control_datetime', () => {
        expect(parseDataJotform({ day: '5', month: '8', year: '2026' })).toBe('2026-08-05');
    });
    it('strings DD/MM/YYYY e YYYY-MM-DD', () => {
        expect(parseDataJotform('05/08/2026')).toBe('2026-08-05');
        expect(parseDataJotform('2026-08-05')).toBe('2026-08-05');
    });
    it('MM/DD inequívoco é invertido; inválido → null', () => {
        expect(parseDataJotform('08/25/2026')).toBe('2026-08-25');
        expect(parseDataJotform('40/40/2026')).toBeNull();
        expect(parseDataJotform('')).toBeNull();
        expect(parseDataJotform({ day: '', month: '', year: '' })).toBeNull();
    });
});

describe('acharResposta', () => {
    const answers = {
        '5': { text: 'Data Aviso de Vencimento', answer: '2026-01-01' },
        '7': { text: 'Data Vencimento', answer: '2026-06-30' },
    };
    it('pergunta que COMEÇA com o termo ganha da que só contém', () => {
        expect(acharResposta(answers, ['data vencimento'])).toBe('2026-06-30');
        expect(acharResposta(answers, ['data aviso de vencimento'])).toBe('2026-01-01');
    });
    it('campo vazio não casa', () => {
        expect(acharResposta({ '1': { text: 'CNPJ', answer: '' } }, ['cnpj'])).toBeNull();
    });
});

// Submissions no formato cru da API (answers por qid, text = pergunta).
const subCertidao = {
    id: '6100000000000000001',
    form_id: '203618343863862',
    status: 'ACTIVE',
    created_at: '2026-07-01 10:00:00',
    answers: {
        '3': { text: 'Empresa', answer: 'PADARIA DO ZÉ LTDA' },
        '4': { text: 'N.Empresa', answer: '123' },
        '5': { text: 'CNPJ', answer: '12.345.678/0001-99' },
        '6': { text: 'E-mail', answer: 'ze@padaria.com.br' },
        '7': { text: 'Data Emissao', answer: { day: '01', month: '07', year: '2026' } },
        '8': { text: 'Data Vencimento', answer: { day: '28', month: '12', year: '2026' } },
        '9': { text: 'Selecione uma das Certidões abaixo .', answer: '3 - CERTIDÃO FGTS - CRF' },
        '10': { text: 'Observação', answer: 'renovar antes do fim do ano' },
    },
};

describe('normalizarSubmissionCertidao', () => {
    it('extrai o doc completo de uma certidão', () => {
        const doc = normalizarSubmissionCertidao(subCertidao)!;
        expect(doc).toMatchObject({
            origem: 'jotform',
            submissionId: '6100000000000000001',
            categoria: 'certidao',
            tipoDetalhe: '3 - CERTIDÃO FGTS - CRF',
            empresaNome: 'PADARIA DO ZÉ LTDA',
            cnpj: '12345678000199',
            emailCliente: 'ze@padaria.com.br',
            dataEmissao: '2026-07-01',
            dataVencimento: '2026-12-28',
        });
    });

    it('campo de certificado preenchido → categoria certificado', () => {
        const doc = normalizarSubmissionCertidao({
            ...subCertidao,
            answers: {
                ...subCertidao.answers,
                '9': { text: 'Selecione uma das Certidões abaixo .', answer: '' },
                '11': { text: 'Selecione um dos Certificados abaixo .', answer: 'E-CNPJ A1' },
            },
        })!;
        expect(doc.categoria).toBe('certificado');
        expect(doc.tipoDetalhe).toBe('E-CNPJ A1');
    });

    it('sem empresa ou sem vencimento → null (não rastreável)', () => {
        expect(normalizarSubmissionCertidao({ ...subCertidao, answers: { '8': subCertidao.answers['8'] } })).toBeNull();
        expect(normalizarSubmissionCertidao({ ...subCertidao, answers: { '3': subCertidao.answers['3'] } })).toBeNull();
    });

    it('submission DELETED é ignorada', () => {
        expect(normalizarSubmissionCertidao({ ...subCertidao, status: 'DELETED' })).toBeNull();
    });

    // Casos vindos da análise da tabela real (26/07/2026, 850 registros):

    it('CNPJ placeholder 00-000-000/0000-00 vira null (não é documento)', () => {
        const doc = normalizarSubmissionCertidao({
            ...subCertidao,
            answers: { ...subCertidao.answers, '5': { text: 'CNPJ', answer: '00-000-000/0000-00' } },
        })!;
        expect(doc.cnpj).toBeNull();
    });

    it('"7-PROCURAÇÃO ELETRONICA" no campo de certificados → categoria procuracao', () => {
        const doc = normalizarSubmissionCertidao({
            ...subCertidao,
            answers: {
                ...subCertidao.answers,
                '9': { text: 'Selecione uma das Certidões abaixo .', answer: '' },
                '11': { text: 'Selecione um dos Certificados abaixo .', answer: "7-PROCURAÇÃO ELETRONICA 'PAPEL'" },
            },
        })!;
        expect(doc.categoria).toBe('procuracao');
        expect(doc.semDocumento).toBe(false);
    });

    it('"8- NÃO POSSUE CERTIFICADO" marca semDocumento (não alertar cliente)', () => {
        const doc = normalizarSubmissionCertidao({
            ...subCertidao,
            answers: {
                ...subCertidao.answers,
                '9': { text: 'Selecione uma das Certidões abaixo .', answer: '' },
                '11': { text: 'Selecione um dos Certificados abaixo .', answer: '8- NÃO POSSUE CERTIFICADO' },
            },
        })!;
        expect(doc.categoria).toBe('certificado');
        expect(doc.semDocumento).toBe(true);
    });

    it('prefixo (INATIVA)/(PARALIZADO)/(suspensa)/(encerrada) marca empresaInativa', () => {
        expect(empresaInativa('(INATIVA) AQUA PLASTIC BRASIL')).toBe(true);
        expect(empresaInativa('( INATIVA) ESCADA INDUSTRIA LTDA')).toBe(true);
        expect(empresaInativa('(PARALIZADO) BAR E LANCHE FREI AGOSTINHO LTDA')).toBe(true);
        expect(empresaInativa('(suspensa) ADITIVA ENSINO')).toBe(true);
        expect(empresaInativa('(encerrada) R. P. CARDOSO')).toBe(true);
        expect(empresaInativa('PADARIA DO ZÉ LTDA')).toBe(false);

        const doc = normalizarSubmissionCertidao({
            ...subCertidao,
            answers: { ...subCertidao.answers, '3': { text: 'Empresa', answer: '(INATIVA) PADARIA DO ZÉ LTDA' } },
        })!;
        expect(doc.empresaInativa).toBe(true);
    });
});

describe('normalizarSubmissionParcelamento', () => {
    const subParc = {
        id: '6100000000000000002',
        form_id: '210087778597674',
        status: 'ACTIVE',
        created_at: '2026-07-02 09:00:00',
        answers: {
            '3': { text: 'EMPRESA', answer: 'MERCADO BOM PREÇO LTDA' },
            '4': { text: 'CNPJ', answer: '98.765.432/0001-11' },
            '5': { text: 'E-mail CLIENTE ', answer: 'financeiro@bompreco.com.br' },
            '6': { text: 'PARCELAMENTO ORGÃO ', answer: 'PGFN' },
            '7': { text: 'NUMERO PROCESSO -ACORDO ', answer: '1234567-89' },
            '8': { text: 'N.PARCELAS', answer: '60' },
            '9': { text: 'DATA  VENCIMENTO ', answer: '20/08/2026' },
            '10': { text: 'VALOR PARCELA', answer: 'R$ 1.234,56' },
        },
    };

    it('extrai o doc do parcelamento (pergunta com espaço duplo casa mesmo assim)', () => {
        const doc = normalizarSubmissionParcelamento(subParc)!;
        expect(doc).toMatchObject({
            categoria: 'parcelamento',
            tipoDetalhe: 'PGFN',
            empresaNome: 'MERCADO BOM PREÇO LTDA',
            cnpj: '98765432000111',
            emailCliente: 'financeiro@bompreco.com.br',
            numeroProcesso: '1234567-89',
            numeroParcelas: '60',
            dataVencimento: '2026-08-20',
            valorParcela: 'R$ 1.234,56',
        });
    });
});

describe('normalizarLote', () => {
    it('docId determinístico jf_{submissionId} — re-sync nunca duplica', () => {
        const { docs, ignorados } = normalizarLote(
            [subCertidao, subCertidao, { id: 'x', status: 'DELETED' }],
            normalizarSubmissionCertidao,
        );
        expect(docs.size).toBe(1);
        expect([...docs.keys()]).toEqual(['jf_6100000000000000001']);
        expect(ignorados).toBe(1);
    });
});
