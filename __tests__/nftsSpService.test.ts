/**
 * Testes do motor NFTS SP: layout TXT V.001 (440 posicoes), deteccao de
 * ISS retido, selecao de codigo no catalogo e validacoes.
 */
import {
    cleanNfts, campoNum, campoTexto, parseValorCentavos, parseDataAAAAMMDD,
    detectarIssRetido, selecionarCodigoSp, normalizarItemLc116,
    validarNotaNfts, montarRegistroDetalhe, gerarLoteNfts, separarNotasIssRetido,
    NFTS_DETALHE_TAMANHO_FIXO, type NftsNota,
} from '../services/nftsSpService';
import { CATALOGO_NFTS_SP, CATALOGO_POR_CODIGO, CATALOGO_POR_ITEM, CODIGOS_ENCERRADOS_2025 } from '../services/nftsCatalogoSp';

// CNPJ valido de teste (digitos verificadores corretos): 11.222.333/0001-81
const CNPJ_VALIDO = '11222333000181';

function notaBase(overrides: Partial<NftsNota> = {}): NftsNota {
    const row = CATALOGO_NFTS_SP[0];
    return {
        arquivo: 'teste.pdf', pagina: 1, numero: '123', serie: '', data: '20260615',
        cnpj: CNPJ_VALIDO, nome: 'EMPRESA TESTE LTDA', valorCentavos: 123456,
        codigo: row.codigo, subitem: row.subitem, aliquota: row.aliquota,
        retido: '2', regime: '0', tipoLogradouro: 'RUA', logradouro: 'DAS FLORES',
        numeroEndereco: '100', complemento: '', bairro: 'CENTRO', cidade: 'SAO PAULO',
        uf: 'SP', cep: '01001000', email: 'a@b.com', descricao: 'Servico de teste',
        aviso: '', origemExtracao: 'pdfjs',
        ...overrides,
    };
}

describe('catalogo NFTS SP', () => {
    it('tem 645 correlacoes e indices consistentes', () => {
        expect(CATALOGO_NFTS_SP.length).toBe(645);
        expect(CATALOGO_POR_CODIGO.size).toBeGreaterThan(600);
        expect(CATALOGO_POR_ITEM.size).toBeGreaterThan(150);
        for (const row of CATALOGO_NFTS_SP) {
            expect(row.codigo).toMatch(/^\d{5}$/);
            expect(row.subitem).toMatch(/^\d{4}$/);
            expect(row.aliquota).toMatch(/^\d{4}$/);
        }
    });
});

describe('formatadores posicionais', () => {
    it('campoNum preenche com zeros a esquerda e trunca a esquerda', () => {
        expect(campoNum('123', 5)).toBe('00123');
        expect(campoNum('1234567', 5)).toBe('34567');
        expect(campoNum('', 4)).toBe('0000');
    });
    it('campoTexto normaliza acentos, corta e preenche a direita', () => {
        expect(campoTexto('São Paulo', 12)).toBe('SAO PAULO   ');
        expect(campoTexto('ABCDEFGHIJ', 5)).toBe('ABCDE');
    });
    it('cleanNfts converte quebras em pipe e remove nao-latin1', () => {
        expect(cleanNfts('linha1\nlinha2')).toBe('linha1|linha2');
        expect(cleanNfts('ação çÇ')).toBe('acao cC');
    });
    it('parseValorCentavos aceita formatos brasileiros', () => {
        expect(parseValorCentavos('1.234,56')).toBe(123456);
        expect(parseValorCentavos('170,00')).toBe(17000);
        expect(parseValorCentavos(99.9)).toBe(9990);
        expect(parseValorCentavos('abc')).toBeNull();
    });
    it('parseDataAAAAMMDD valida calendario', () => {
        expect(parseDataAAAAMMDD('15/06/2026')).toBe('20260615');
        expect(parseDataAAAAMMDD('31/02/2026')).toBe('');
        expect(parseDataAAAAMMDD('20260615')).toBe('20260615');
    });
});

describe('detectarIssRetido', () => {
    it('detecta retencao explicita com valor', () => {
        const r = detectarIssRetido('ISS RETIDO: R$ 150,00');
        expect(r.retido).toBe(true);
    });
    it('negativo tem precedencia sobre positivo', () => {
        const r = detectarIssRetido('ISSQN RETIDO: NAO');
        expect(r.retido).toBe(false);
    });
    it('responsavel tomador implica retencao', () => {
        const r = detectarIssRetido('RESPONSAVEL PELO RECOLHIMENTO DO ISSQN: TOMADOR');
        expect(r.retido).toBe(true);
    });
    it('responsavel prestador implica nao retido', () => {
        const r = detectarIssRetido('RESPONSAVEL PELO RECOLHIMENTO DO ISSQN: PRESTADOR');
        expect(r.retido).toBe(false);
    });
    it('ignora retencoes federais (IRRF/INSS/PIS/COFINS/CSLL)', () => {
        const r = detectarIssRetido('IRRF RETIDO: R$ 45,00 INSS RETIDO: R$ 100,00 PIS: 6,50');
        expect(r.retido).toBe(false);
    });
    it('valor zerado de ISS retido nao marca retencao', () => {
        const r = detectarIssRetido('ISS RETIDO: R$ 0,00');
        expect(r.retido).toBe(false);
    });
});

describe('selecionarCodigoSp', () => {
    it('codigo municipal exato tem precedencia', () => {
        const alvo = CATALOGO_NFTS_SP[0];
        const r = selecionarCodigoSp('qualquer texto', '', alvo.codigo);
        expect(r?.codigo).toBe(alvo.codigo);
    });
    it('resolve por item LC116', () => {
        const r = selecionarCodigoSp('servicos de consultoria', '17.01', '');
        expect(r).not.toBeNull();
        expect(r?.item).toBe('17.01');
    });
    it('fallback semantico por keywords', () => {
        const r = selecionarCodigoSp('manutencao e conserto de equipamentos de refrigeracao');
        expect(r).not.toBeNull();
        expect(r?.item).toBe('14.01');
    });
    it('NUNCA seleciona automaticamente codigo encerrado (IN 3/2026)', () => {
        expect(CODIGOS_ENCERRADOS_2025.size).toBe(30);
        // Para cada codigo encerrado presente no catalogo, a selecao exata
        // por codigo nao pode retorna-lo.
        for (const cod of CODIGOS_ENCERRADOS_2025) {
            const r = selecionarCodigoSp('texto qualquer', '', cod);
            if (r) expect(CODIGOS_ENCERRADOS_2025.has(r.codigo)).toBe(false);
        }
    });
    it('normalizarItemLc116 aceita variantes', () => {
        expect(normalizarItemLc116('07,02')).toBe('7.02');
        expect(normalizarItemLc116('17.01')).toBe('17.01');
        expect(normalizarItemLc116('')).toBe('');
    });
});

describe('validarNotaNfts', () => {
    it('nota valida passa sem erros', () => {
        const { erros } = validarNotaNfts(notaBase());
        expect(erros).toEqual([]);
    });
    it('CNPJ invalido gera erro', () => {
        const { erros } = validarNotaNfts(notaBase({ cnpj: '11111111111111' }));
        expect(erros.some(e => e.includes('CNPJ'))).toBe(true);
    });
    it('valor zerado gera erro', () => {
        const { erros } = validarNotaNfts(notaBase({ valorCentavos: 0 }));
        expect(erros.some(e => e.includes('valor'))).toBe(true);
    });
    it('codigo fora do catalogo gera AVISO (pode ser codigo novo de 2026)', () => {
        const { erros, avisos } = validarNotaNfts(notaBase({ codigo: '99999' }));
        expect(erros).toEqual([]);
        expect(avisos.some(a => a.includes('fora do catalogo'))).toBe(true);
    });
    it('codigo ENCERRADO pela IN SF/SUREM 3/2026 gera erro bloqueante', () => {
        const { erros } = validarNotaNfts(notaBase({ codigo: '02693' }));
        expect(erros.some(e => e.includes('ENCERRADO'))).toBe(true);
    });
    it('extracao por IA gera aviso de conferencia', () => {
        const { avisos } = validarNotaNfts(notaBase({ origemExtracao: 'gemini' }));
        expect(avisos.some(a => a.includes('IA'))).toBe(true);
    });
});

describe('montarRegistroDetalhe (registro tipo 4)', () => {
    it('parte fixa tem exatamente 440 posicoes', () => {
        const n = notaBase();
        const reg = montarRegistroDetalhe(n);
        expect(reg.slice(0, NFTS_DETALHE_TAMANHO_FIXO).length).toBe(440);
        expect(reg.startsWith('402')).toBe(true); // tipo 4 + doc 02
    });
    it('campos posicionais ficam nas posicoes corretas', () => {
        const n = notaBase({ numero: '987', valorCentavos: 123456 });
        const reg = montarRegistroDetalhe(n);
        // serie: pos 3-8 (5); numero: pos 8-20 (12)
        expect(reg.slice(8, 20)).toBe('000000000987');
        // data: pos 20-28
        expect(reg.slice(20, 28)).toBe('20260615');
        // situacao + tributacao
        expect(reg.slice(28, 30)).toBe('NT');
        // valor servicos: pos 30-45
        expect(reg.slice(30, 45)).toBe('000000000123456');
        // CNPJ prestador: pos 75-89
        expect(reg.slice(75, 89)).toBe(CNPJ_VALIDO);
    });
    it('descricao vai apos a parte fixa', () => {
        const reg = montarRegistroDetalhe(notaBase({ descricao: 'Consultoria mensal' }));
        expect(reg.slice(NFTS_DETALHE_TAMANHO_FIXO)).toBe('Consultoria mensal');
    });
});

describe('gerarLoteNfts', () => {
    it('gera header, detalhes e totalizador com CRLF', () => {
        const notas = [notaBase({ numero: '1', data: '20260601', valorCentavos: 10000 }),
                       notaBase({ numero: '2', data: '20260630', valorCentavos: 25050 })];
        const lote = gerarLoteNfts(notas, '12345678');
        const linhas = lote.conteudo.split('\r\n');
        expect(linhas[0]).toBe('1' + '001' + '12345678' + '20260601' + '20260630');
        expect(linhas.length).toBe(5); // header + 2 detalhes + footer + linha vazia final
        const footer = linhas[3];
        expect(footer[0]).toBe('9');
        expect(footer.slice(1, 8)).toBe('0000002');
        expect(footer.slice(8, 23)).toBe('000000000035050');
        expect(lote.valorTotalCentavos).toBe(35050);
    });
    it('rejeita CCM invalido', () => {
        expect(() => gerarLoteNfts([notaBase()], '123')).toThrow(/CCM/);
    });
    it('rejeita lote vazio', () => {
        expect(() => gerarLoteNfts([], '12345678')).toThrow(/Nenhuma nota/);
    });
    it('bytes sao latin1 (1 byte por caractere)', () => {
        const lote = gerarLoteNfts([notaBase()], '12345678');
        expect(lote.bytes.length).toBe(lote.conteudo.length);
    });
});

describe('enriquecimento cadastral via CNPJ', () => {
    const { nomePrestadorSuspeito, enderecoIncompletoNfts, aplicarDadosCnpjNaNota } = jest.requireActual('../services/nftsSpService');
    it('detecta rotulos vazados como razao social', () => {
        expect(nomePrestadorSuspeito('Prestador do servico')).toBe(true);
        expect(nomePrestadorSuspeito('PRESTADOR DE SERVICOS')).toBe(true);
        expect(nomePrestadorSuspeito('Dados do Prestador')).toBe(true);
        expect(nomePrestadorSuspeito('PRESTADOR 23098923000123')).toBe(true);
        expect(nomePrestadorSuspeito('ALELO S.A.')).toBe(false);
        expect(nomePrestadorSuspeito('HE SERVICOS GERAIS LTDA')).toBe(false);
    });
    it('detecta endereco incompleto', () => {
        expect(enderecoIncompletoNfts(notaBase({ uf: '' }))).toBe(true);
        expect(enderecoIncompletoNfts(notaBase({ cep: '00000000' }))).toBe(true);
        expect(enderecoIncompletoNfts(notaBase())).toBe(false);
    });
    it('aplica dados da Receita substituindo nome e endereco', () => {
        const n = notaBase({ nome: 'Prestador do servico', cidade: '', uf: '', cep: '' });
        const enriquecida = aplicarDadosCnpjNaNota(n, {
            razaoSocial: '23.098.923 ELOVI HIRT',
            logradouro: 'RUA OTTERNO SCHAEFFER', numero: '856',
            bairro: 'CANABARRO', municipio: 'Teutônia', uf: 'RS', cep: '95890-000',
        });
        expect(enriquecida.nome).toBe('23.098.923 ELOVI HIRT');
        expect(enriquecida.tipoLogradouro).toBe('RUA');
        expect(enriquecida.logradouro).toBe('OTTERNO SCHAEFFER');
        expect(enriquecida.cidade).toBe('Teutonia');
        expect(enriquecida.uf).toBe('RS');
        expect(enriquecida.cep).toBe('95890000');
        expect(enriquecida.aviso).toContain('Receita Federal');
        const { erros } = validarNotaNfts(enriquecida);
        expect(erros).toEqual([]);
    });
    it('nao sobrescreve nome legitimo, so endereco', () => {
        const n = notaBase({ nome: 'EMPRESA BOA LTDA', cidade: '', uf: '', cep: '' });
        const e = aplicarDadosCnpjNaNota(n, {
            razaoSocial: 'OUTRO NOME', logradouro: 'AV BRASIL', numero: '1',
            bairro: 'CENTRO', municipio: 'SAO PAULO', uf: 'SP', cep: '01001000',
        });
        expect(e.nome).toBe('EMPRESA BOA LTDA');
        expect(e.cidade).toBe('SAO PAULO');
    });
});

describe('separarNotasIssRetido', () => {
    it('remove notas retidas do lote', () => {
        const notas = [notaBase({ retido: '2' }), notaBase({ retido: '1' }), notaBase({ retido: '2' })];
        const { mantidas, retidas } = separarNotasIssRetido(notas);
        expect(mantidas.length).toBe(2);
        expect(retidas.length).toBe(1);
    });
});
