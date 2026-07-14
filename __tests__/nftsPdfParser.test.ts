/**
 * Testes do parser NFTS com fixture real (NFS-e Barueri/ALELO da amostra
 * usada na homologacao do Gerador de Lotes NFTS).
 */
jest.mock('pdfjs-dist', () => ({
    GlobalWorkerOptions: { workerSrc: '' },
    version: '0.0.0',
    getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }),
}));
import { parseNftsFromText, extrairNumeroSerie, extrairCnpjPrestador, montarNotaDeGemini } from '../services/nftsPdfParserService';

const FIXTURE_ALELO = `PREFEITURA MUNICIPAL DE BARUERI
SECRETARIA DE FINANÇAS
NOTA FISCAL ELETRONICA DE SERVICOS - NFE
Data Emissão Hora Emissão
05/06/2026 06:20
NOTA FISCAL ELETRÔNICA DE
SERVICOS E FATURA
Número da Nota
7076746
Série da Nota
Número RPS
0030141830
Prestador de Serviços ALELO S.A.
ALAMEDA XINGU , 512 - ANDAR 3 E 4 E 16 PARTE
ALPHAVILLE CENTRO INDUSTR E EMPR / ALPHAVILLE
CEP 06455-030 - BARUERI - SP
CNPJ/CPF 04.740.876/0001-25 Inscrição Municipal 4.44096-8
Nome Tomador de Serviços CPF/CNPJ
Endereço Complemento
CEP Bairro Cidade UF
Qtde Descrição do Serviço Código Serviço Alíquota Valor Unitário Valor Total
CADEIRAS GENNARO FERRANTE LTDA 60.882.552/0001-00
R BARAO DE MONTE SANTO, 200
03123-020 MOOCA São Paulo SP
1 Agenciamento, corretagem ou intermediação de contratos quais 100202220 2,00 1,00 1,00
DISCRIMINAÇÃO DOS SERVIÇOS E INFORMAÇÕES RELEVANTES
ALELO REFEICAO = R$ 7.648,80
VALOR LIQUIDO DA NOTA = R$ 7.648,80
Observações
ISSQN devido a: BARUERI-SP
IRRF PIS/PASEP COFINS CSLL
0,00 0,00 0,00 0,00
VALOR TOTAL DA NOTA 7.648,80`;

describe('parseNftsFromText — fixture Barueri/ALELO', () => {
    const r = parseNftsFromText('ALELO NF 7076746.pdf', 1, FIXTURE_ALELO, '60882552000100');

    it('aprova a nota', () => {
        expect(r.pendencia).toBeNull();
        expect(r.nota).not.toBeNull();
    });
    it('extrai numero com confianca alta', () => {
        expect(r.nota?.numero).toBe('7076746');
        expect(r.nota?.aviso).toContain('confianca alta');
    });
    it('extrai CNPJ do prestador (nao o do tomador)', () => {
        expect(r.nota?.cnpj).toBe('04740876000125');
    });
    it('extrai razao social do prestador', () => {
        expect(r.nota?.nome).toBe('ALELO S.A.');
    });
    it('extrai data e valor total', () => {
        expect(r.nota?.data).toBe('20260605');
        expect(r.nota?.valorCentavos).toBe(764880);
    });
    it('NAO usa fragmento de CEP como codigo de servico (bug do gerador original)', () => {
        expect(r.nota?.codigo).not.toBe('03123');
    });
    it('resolve codigo por semantica (agenciamento -> item 10.02)', () => {
        expect(r.nota?.subitem).toBe('1002');
    });
    it('ISS nao retido (retencoes federais ignoradas)', () => {
        expect(r.nota?.retido).toBe('2');
    });
    it('endereco do prestador em Barueri/SP', () => {
        expect(r.nota?.cidade.toUpperCase()).toBe('BARUERI');
        expect(r.nota?.uf).toBe('SP');
        expect(r.nota?.cep).toBe('06455030');
    });
});

describe('extrairNumeroSerie — fallbacks', () => {
    it('nome do arquivo como ultimo recurso (confianca baixa)', () => {
        const r = extrairNumeroSerie('FORNECEDOR NF. 55295.pdf', 'texto sem numero identificavel');
        expect(r.numero).toBe('55295');
        expect(r.confianca).toBe('baixa');
    });
    it('formato nacional 2026000086725 no nome vira 86725', () => {
        const r = extrairNumeroSerie('NFSE 2026000086725.pdf', 'sem numero');
        expect(r.numero).toBe('86725');
    });
});

describe('extrairNomePrestador — rotulos nao vazam como razao social', () => {
    const { extrairNomePrestador } = jest.requireActual('../services/nftsPdfParserService');
    it('"Prestador do servico" isolado nao vira nome; cai no fallback', () => {
        const texto = 'Prestador do servico\nCNPJ 23.098.923/0001-23\nDemais dados';
        const nome = extrairNomePrestador(texto, '23098923000123');
        expect(nome).toBe('PRESTADOR 23098923000123');
    });
});

describe('extrairCnpjPrestador', () => {
    it('ignora CNPJ do tomador informado', () => {
        const { cnpj } = extrairCnpjPrestador(FIXTURE_ALELO, '60882552000100');
        expect(cnpj).toBe('04740876000125');
    });
});

describe('montarNotaDeGemini — fallback IA', () => {
    const dadosOk = {
        numero: '58939', serie: '', dataEmissao: '10/06/2026', cnpjPrestador: '04740876000125',
        razaoSocial: 'ALELO S.A.', valorTotal: '1.500,00', itemLc116: '10.02',
        codigoServicoMunicipal: null, descricaoServico: 'Agenciamento de beneficios',
        issRetido: false, simplesNacional: false, mei: false, email: null,
        endereco: { tipoLogradouro: 'AL', logradouro: 'XINGU', numero: '512', complemento: '', bairro: 'ALPHAVILLE', cidade: 'BARUERI', uf: 'SP', cep: '06455030' },
    };
    it('monta nota valida a partir do JSON da IA com aviso de conferencia', () => {
        const r = montarNotaDeGemini('escaneada.pdf', dadosOk);
        expect(r.pendencia).toBeNull();
        expect(r.nota?.valorCentavos).toBe(150000);
        expect(r.nota?.origemExtracao).toBe('gemini');
        expect(r.nota?.aviso).toContain('IA');
    });
    it('CNPJ invalido vira pendencia', () => {
        const r = montarNotaDeGemini('x.pdf', { ...dadosOk, cnpjPrestador: '11111111111111' });
        expect(r.nota).toBeNull();
        expect(r.pendencia?.motivo).toContain('CNPJ');
    });
    it('nota com ISS retido e marcada para exclusao do lote', () => {
        const r = montarNotaDeGemini('y.pdf', { ...dadosOk, issRetido: true });
        expect(r.nota?.retido).toBe('1');
    });
    it('resposta nula da IA vira pendencia', () => {
        const r = montarNotaDeGemini('z.pdf', null);
        expect(r.nota).toBeNull();
    });
});
