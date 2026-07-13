/**
 * Testes do gerador do arquivo "Sistema Próprio" GIA-ST 3 (layout v3.1
 * PROCERGS, 26/11/2015). Os casos A1/A2/A3 reproduzem EXATAMENTE as linhas do
 * "Exemplo de arquivo" da página 6 do documento oficial.
 */

jest.mock('../services/firebaseConfig', () => ({
    db: {},
    auth: { currentUser: null },
    isFirebaseConfigured: true,
    isFirebaseStorageConfigured: false,
}));

import {
    padA, padN, padValor, padData,
    montarRegistroA0, montarRegistroAnexoNf, montarRegistroA3, montarArquivoGiaSt,
    type GiaStDeclarante,
} from '../services/giaStExportService';
import { calcularGiaSt, type GiaStGuia, type GiaStValores } from '../services/giaStService';

const zero: GiaStValores = {
    c7ValorProdutos: 0, c8ValorIpi: 0, c9DespesasAcessorias: 0,
    c10BcIcmsProprio: 0, c11IcmsProprio: 0, c12BcIcmsSt: 0, c13IcmsRetidoSt: 0,
    c14IcmsDevolucao: 0, c15IcmsRessarcimentos: 0, c16CreditoPeriodoAnterior: 0,
    c17PagamentosAntecipados: 0, c19RepasseRefinarias: 0, c39RepasseOutros: 0,
};

const declarante: GiaStDeclarante = {
    nome: 'SANDRA PEREIRA', cpf: '12345678901', cargo: 'CONTADORA',
    telefoneDdd: '11', telefoneNumero: '999990000',
    email: 'fiscal@spassessoriacontabil.com.br', local: 'SAO PAULO',
};

function guiaBase(extra: Partial<GiaStGuia> = {}): GiaStGuia {
    const valores: GiaStValores = {
        ...zero,
        c7ValorProdutos: 1265056.70,
        c10BcIcmsProprio: 1032819.48,
        c11IcmsProprio: 185907.31,
        c12BcIcmsSt: 1845799.44,
        c13IcmsRetidoSt: 146859.55,
    };
    const calc = calcularGiaSt(valores);
    return {
        id: '96312889000111_SP_202606',
        empresaCnpj: '96312889000111',
        empresaNome: 'FLANACAR COMERCIO DE AUTO-PECAS LTDA',
        ufFavorecida: 'SP',
        inscricaoEstadualUfFavorecida: '110042490114',
        competencia: '2026-06',
        semMovimento: false,
        retificacao: false,
        dataVencimento: '2026-07-10',
        informacoesComplementares: '',
        origemRelatorio: null,
        inconsistencias: [],
        ...valores,
        ...calc,
        ...extra,
    };
}

describe('helpers de formatação', () => {
    it('padValor converte reais em centavos com 15 posições (exemplo do manual)', () => {
        expect(padValor(1995.23)).toBe('000000000199523');
        expect(padValor(-1995.23)).toBe('-00000000199523');
        expect(padValor(0)).toBe('000000000000000');
        expect(padValor(0.83)).toBe('000000000000083');
    });

    it('padA alinha à esquerda com espaços; padN à direita com zeros', () => {
        expect(padA('0010000259', 14)).toBe('0010000259    ');
        expect(padA('NOME MUITO GRANDE QUE ESTOURA', 10)).toBe('NOME MUITO');
        expect(padN('11', 4)).toBe('0011');
        expect(padN('96.312.889/0001-11', 14)).toBe('96312889000111');
    });

    it('padData converte AAAA-MM-DD e zera vazio', () => {
        expect(padData('2026-07-10')).toBe('20260710');
        expect(padData('')).toBe('00000000');
        expect(padData(null)).toBe('00000000');
    });
});

describe('montarRegistroA0', () => {
    const linha = montarRegistroA0(guiaBase(), declarante, { anexoI: 0, anexoII: 0, anexoIII: 0 });

    it('tem exatamente 1031 posições', () => {
        expect(linha).toHaveLength(1031);
    });

    it('posiciona cabeçalho, período, IE e flags conforme a coluna Soma', () => {
        expect(linha.slice(0, 2)).toBe('A0');
        expect(linha.slice(2, 5)).toBe('GST');
        expect(linha.slice(5, 7)).toBe('03');
        expect(linha.slice(7, 13)).toBe('062026');                 // MMAAAA
        expect(linha.slice(13, 27)).toBe('110042490114  ');        // IE 14 A
        expect(linha.slice(27, 28)).toBe('N');                     // sem movimento
        expect(linha.slice(28, 29)).toBe('N');                     // retificação
    });

    it('posiciona 1º vencimento (data+valor) e zera os demais 5 pares', () => {
        expect(linha.slice(29, 37)).toBe('20260710');
        expect(linha.slice(37, 52)).toBe(padValor(146859.55));     // c21 = c18 (sem repasses)
        expect(linha.slice(52, 167)).toBe(('00000000' + '0'.repeat(15)).repeat(5));
    });

    it('posiciona UF (169), campos 7-21 e CNPJ (408)', () => {
        expect(linha.slice(167, 169)).toBe('SP');
        expect(linha.slice(169, 184)).toBe(padValor(1265056.70));  // 7
        expect(linha.slice(244, 259)).toBe(padValor(1845799.44));  // 12
        expect(linha.slice(259, 274)).toBe(padValor(146859.55));   // 13
        expect(linha.slice(334, 349)).toBe(padValor(146859.55));   // 18
        expect(linha.slice(379, 394)).toBe(padValor(146859.55));   // 21
        expect(linha.slice(394, 408)).toBe('96312889000111');      // 28 CNPJ
    });

    it('posiciona declarante, contadores de anexos e bloco EC 87/15 zerado', () => {
        expect(linha.slice(408, 454)).toBe(padA('SANDRA PEREIRA', 46));
        expect(linha.slice(454, 465)).toBe('12345678901');
        expect(linha.slice(824, 825)).toBe('N');                   // 37
        expect(linha.slice(825, 826)).toBe('N');                   // 38 (sem Anexo III)
        expect(linha.slice(832, 838)).toBe('000000');              // qtd Anexo I
        expect(linha.slice(865, 866)).toBe('N');                   // EC 87/15
        expect(linha.slice(866, 1031)).toBe('0'.repeat(165));      // 11 campos × 15 zeros
    });

    it('marca S no campo 38 quando há Anexo III', () => {
        const l = montarRegistroA0(guiaBase(), declarante, { anexoI: 0, anexoII: 0, anexoIII: 2 });
        expect(l.slice(825, 826)).toBe('S');
        expect(l.slice(844, 850)).toBe('000002');
    });
});

describe('registros de anexo — exemplos oficiais da página 6 do layout', () => {
    it('A1 reproduz a linha do exemplo', () => {
        const l = montarRegistroAnexoNf('A1', {
            numeroNf: '3360455', serie: '13', inscricaoEstadual: '0010000259',
            dataEmissao: '2014-05-04', valor: 0.83,
        });
        expect(l).toBe('A1000000336045513 0010000259    20140504000000000000083');
        expect(l).toHaveLength(55);
    });

    it('A2 reproduz a linha do exemplo', () => {
        const l = montarRegistroAnexoNf('A2', {
            numeroNf: '54838367', serie: '1', inscricaoEstadual: '0010000259',
            dataEmissao: '2014-05-31', valor: 118.22,
        });
        expect(l).toBe('A200000548383671  0010000259    20140531000000000011822');
        expect(l).toHaveLength(55);
    });

    it('A3 reproduz a linha do exemplo', () => {
        const l = montarRegistroA3({
            inscricaoEstadual: '0010000259', baseCalculo: 460561.37, valorIcmsDestacado: 43508.65,
        });
        expect(l).toBe('A30010000259    000000046056137000000004350865');
        expect(l).toHaveLength(46);
    });
});

describe('montarArquivoGiaSt', () => {
    it('gera A0 + anexos com CRLF e valida soma dos anexos contra campos 14/15', () => {
        const guia = guiaBase({
            c14IcmsDevolucao: 100.50,
            ...calcularGiaSt({ ...guiaBase(), c14IcmsDevolucao: 100.50 }),
        });
        const conteudo = montarArquivoGiaSt([{
            guia,
            anexoI: [
                { numeroNf: '123', serie: '1', inscricaoEstadual: '110042490114', dataEmissao: '2026-06-05', valor: 60.50 },
                { numeroNf: '456', serie: '1', inscricaoEstadual: '110042490114', dataEmissao: '2026-06-20', valor: 40.00 },
            ],
        }], declarante);
        const linhas = conteudo.split('\r\n').filter(Boolean);
        expect(linhas).toHaveLength(3);
        expect(linhas[0].slice(0, 2)).toBe('A0');
        expect(linhas[0].slice(832, 838)).toBe('000002');
        expect(linhas[1].slice(0, 2)).toBe('A1');
        expect(conteudo.endsWith('\r\n')).toBe(true);
    });

    it('recusa quando a soma do Anexo I difere do campo 14', () => {
        const guia = guiaBase({
            c14IcmsDevolucao: 100,
            ...calcularGiaSt({ ...guiaBase(), c14IcmsDevolucao: 100 }),
        });
        expect(() => montarArquivoGiaSt([{ guia, anexoI: [] }], declarante))
            .toThrow(/campo 14 .* difere da soma do Anexo I/i);
    });

    it('recusa guia com inconsistências pendentes e declarante inválido', () => {
        expect(() => montarArquivoGiaSt([{ guia: guiaBase({ inconsistencias: ['IE ausente'] }) }], declarante))
            .toThrow(/inconsistência/i);
        expect(() => montarArquivoGiaSt([{ guia: guiaBase() }], { ...declarante, cpf: '123' }))
            .toThrow(/CPF/i);
    });

    it('empilha múltiplas GIA-ST (uma por UF) no mesmo arquivo', () => {
        const spGuia = guiaBase();
        const mgGuia = guiaBase({ id: '96312889000111_MG_202606', ufFavorecida: 'MG', inscricaoEstadualUfFavorecida: '0623079040081' });
        const conteudo = montarArquivoGiaSt([{ guia: spGuia }, { guia: mgGuia }], declarante);
        const linhas = conteudo.split('\r\n').filter(Boolean);
        expect(linhas).toHaveLength(2);
        expect(linhas[0].slice(167, 169)).toBe('SP');
        expect(linhas[1].slice(167, 169)).toBe('MG');
    });
});
