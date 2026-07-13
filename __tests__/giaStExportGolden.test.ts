/**
 * Teste-GABARITO do gerador de arquivo GIA-ST "Sistema Próprio".
 *
 * As linhas abaixo vieram de um arquivo REAL exportado pelo aplicativo
 * GIA-ST 3 da SEFAZ-RS (GIAST03_13072026_1241200355.TXT — FLANACAR,
 * período 05/2026, UF favorecida AL, com 1 nota no Anexo I). O gerador
 * precisa reproduzir o arquivo BYTE A BYTE: mesma largura, alinhamento,
 * zeros/espaços, CRLF e quebra final.
 */

jest.mock('../services/firebaseConfig', () => ({
    db: {},
    auth: { currentUser: null },
    isFirebaseConfigured: true,
    isFirebaseStorageConfigured: false,
}));

import { montarArquivoGiaSt, type GiaStDeclarante } from '../services/giaStExportService';
import { encodeWindows1252 } from '../services/iobSageExportService';
import { calcularGiaSt, type GiaStGuia, type GiaStValores } from '../services/giaStService';

// Linha A0 real (1031 posições) — quebrada em partes só para legibilidade.
const A0_REAL =
    'A0GST03052026247637319     NN20260609000000004090924'
    + ('00000000' + '0'.repeat(15)).repeat(5)
    + 'AL'
    + '000000013669281' // 7
    + '000000000000000' // 8
    + '000000000000000' // 9
    + '000000009141211' // 10
    + '000000000367840' // 11
    + '000000020108929' // 12
    + '000000004096791' // 13
    + '000000000005867' // 14
    + '000000000000000' // 15
    + '000000000000000' // 16
    + '000000000000000' // 17
    + '000000004090924' // 18
    + '000000000000000' // 19
    + '000000000000000' // 20
    + '000000004090924' // 21
    + '96312889000111'
    + 'CAIO VINICIUS VENCESLAU                       '
    + '37943918886'
    + 'SOCIO ADMINISTRADOR           '
    + '0011' + '050682268' + '0000' + '000000000'
    + 'alexandre@spassessoriacontabil.com.br'.padEnd(80, ' ')
    + 'são paulo'.padEnd(30, ' ')
    + '20260624'
    + ' '.repeat(65) + ' '.repeat(60) + ' '.repeat(60)
    + 'NN' + '      '
    + '000001' + '000000' + '000000'
    + '000000000000000'
    + 'N' + '0'.repeat(165);

const A1_REAL = 'A100000009706711  247791237     20260518000000000005867';

const declarante: GiaStDeclarante = {
    nome: 'CAIO VINICIUS VENCESLAU',
    cpf: '37943918886',
    cargo: 'SOCIO ADMINISTRADOR',
    telefoneDdd: '0011',
    telefoneNumero: '050682268',
    email: 'alexandre@spassessoriacontabil.com.br',
    local: 'são paulo',
};

function guiaReal(): GiaStGuia {
    const valores: GiaStValores = {
        c7ValorProdutos: 136692.81,
        c8ValorIpi: 0,
        c9DespesasAcessorias: 0,
        c10BcIcmsProprio: 91412.11,
        c11IcmsProprio: 3678.40,
        c12BcIcmsSt: 201089.29,
        c13IcmsRetidoSt: 40967.91,
        c14IcmsDevolucao: 58.67,
        c15IcmsRessarcimentos: 0,
        c16CreditoPeriodoAnterior: 0,
        c17PagamentosAntecipados: 0,
        c19RepasseRefinarias: 0,
        c39RepasseOutros: 0,
    };
    const calc = calcularGiaSt(valores);
    return {
        id: '96312889000111_AL_202605',
        empresaCnpj: '96312889000111',
        empresaNome: 'FLANACAR COMERCIO DE AUTO-PECAS LTDA',
        ufFavorecida: 'AL',
        inscricaoEstadualUfFavorecida: '247637319',
        competencia: '2026-05',
        semMovimento: false,
        retificacao: false,
        dataVencimento: '2026-06-09',
        informacoesComplementares: '',
        origemRelatorio: null,
        inconsistencias: [],
        ...valores,
        ...calc,
    };
}

describe('gabarito — arquivo real exportado pelo aplicativo GIA-ST 3', () => {
    it('o cálculo interno reproduz os campos 18/20/21 do arquivo real', () => {
        const g = guiaReal();
        expect(g.c18IcmsStDevido).toBeCloseTo(40909.24, 2);   // 40.967,91 − 58,67
        expect(g.c20CreditoPeriodoSeguinte).toBe(0);
        expect(g.c21TotalRecolher).toBeCloseTo(40909.24, 2);
    });

    it('reproduz o arquivo real byte a byte (A0 + A1 + CRLF final)', () => {
        const conteudo = montarArquivoGiaSt(
            [{
                guia: guiaReal(),
                anexoI: [{
                    numeroNf: '970671', serie: '1', inscricaoEstadual: '247791237',
                    dataEmissao: '2026-05-18', valor: 58.67,
                }],
            }],
            declarante,
            '2026-06-24', // data de preenchimento do arquivo real
        );
        const esperado = A0_REAL + '\r\n' + A1_REAL + '\r\n';
        expect(A0_REAL).toHaveLength(1031);
        expect(A1_REAL).toHaveLength(55);
        const [a0Gerado, a1Gerado] = conteudo.split('\r\n');
        // Comparação por fatia primeiro — diagnóstico legível se algo divergir
        for (const [ini, fim, rotulo] of [
            [0, 29, 'cabeçalho+IE+flags'], [29, 167, 'vencimentos'], [167, 394, 'UF+campos 7-21'],
            [394, 465, 'CNPJ+declarante+CPF'], [465, 639, 'cargo+contatos+local+data'],
            [639, 866, 'info compl+flags+contadores+c39+EC'], [866, 1031, 'bloco EC zerado'],
        ] as Array<[number, number, string]>) {
            expect(`${rotulo}:${a0Gerado.slice(ini, fim)}`).toBe(`${rotulo}:${A0_REAL.slice(ini, fim)}`);
        }
        expect(a1Gerado).toBe(A1_REAL);
        expect(conteudo).toBe(esperado);
    });

    it('codifica em Windows-1252 (ã = 0xE3, como no arquivo real)', () => {
        const bytes = encodeWindows1252('são paulo');
        expect(bytes[1]).toBe(0xE3);
    });
});
