/**
 * Testes de regressão do filtro da Central de Documentos Fiscais.
 *
 * Este filtro quebrou 3 vezes seguidas em produção (PRs #44/#45/#46) com o
 * mesmo escritório (S&P) e a mesma NFe (BRASLIMPO R$ 547,70). Cada teste aqui
 * trava um daqueles bugs pra ele não voltar.
 */
import { applyDocumentosFilters } from '../services/xmlDocumentosFilter';

const SP = '44388152000189';

// Fixtures espelhando os dados reais das telas reportadas pelo usuário.
const docs: any[] = [
    // BRASLIMPO: NFe Resumo (resNFe). empresaCnpj=S&P mas empresaNome VAZIO
    // (importer SEFAZ não popula nome). Resumo não tem bloco <dest>, só emit.
    {
        id: 'braslimpo', empresaNome: null, empresaCnpj: SP,
        cnpjEmit: '65833410000169', cnpjDest: null,
        emitente: { nome: 'BRASLIMPO COMERCIAL LTDA', cnpj: '65833410000169' },
        numero: '1615949', chave: '35260565833410000169550000016159491663624193',
        direcao: 'entrada', tipo: 'NFe', tipoDoc: 'NFe', status: 'desconhecido', origem: 'sefaz',
    },
    // NFSe reais da S&P (S&P é tomador) — empresaNome populado.
    {
        id: 'amil', empresaNome: 'S&P ASSESSORIA CONTABIL S/S', empresaCnpj: SP,
        emitente: { nome: 'AMIL ASSISTENCIA MEDICA INTERNACIONAL', cnpj: '29309127000179' },
        tomador: { cnpj: SP }, numero: '69806333', direcao: 'entrada',
        tipo: 'NFSe', status: 'cancelado', origem: 'sefaz',
    },
    {
        id: 'pluxee', empresaNome: 'S&P ASSESSORIA CONTABIL S/S', empresaCnpj: SP,
        emitente: { nome: 'PLUXEE BENEFICIOS BRASIL S.A.', cnpj: '69034668000156' },
        tomador: { cnpj: SP }, numero: '7951131', direcao: 'entrada',
        tipo: 'NFSe', status: 'autorizado', origem: 'sefaz',
    },
    // NFSe que a S&P EMITIU pro cliente (S&P=prestador). É SAÍDA da S&P, então
    // gravada com empresaCnpj=S&P e direcao='saida' (modelo real — por isso, na
    // data do usuário, "S&P"/"44388" + entrada batem: estas ficam fora do
    // entrada). Cobre o caso "44388/S&P + saída".
    {
        id: 'carlezzo', empresaNome: 'S&P ASSESSORIA CONTABIL S/S', empresaCnpj: SP,
        prestador: { nome: 'S&P ASSESSORIA CONTABIL S/S', cnpj: SP },
        tomador: { nome: 'CARLEZZO ADVOGADOS', cnpj: '11222333000144' },
        numero: '2803', direcao: 'saida', tipo: 'NFSe', status: 'autorizado', origem: 'sefaz',
    },
    // Falsos positivos do bug "sp" como substring (PR #45). NENHUM tem S&P.
    {
        id: 'hs', empresaNome: 'HS PROJETOS E AGRIMENSURA S/S', empresaCnpj: '22222222000122',
        emitente: { nome: 'LOGGI TECNOLOGIA LTDA' }, numero: '6055969', direcao: 'entrada',
        tipo: 'NFSe', status: 'autorizado', origem: 'sefaz',
    },
    {
        id: 'spa', empresaNome: 'S.P.A. SAUDE - SISTEMA DE PROMOCAO', empresaCnpj: '44444444000144',
        emitente: { nome: 'CASA DE SAUDE SANTA RITA S A' }, numero: '296596', direcao: 'entrada',
        tipo: 'NFSe', status: 'autorizado', origem: 'sefaz',
    },
    // Falso positivo da CHAVE (PR #40/#44): CNPJ não relacionado cuja chave de
    // 44 dígitos contém "44388" em algum lugar.
    {
        id: 'chave-fp', empresaNome: 'XYZ TRADING', empresaCnpj: '51227692000146',
        cnpjEmit: '51227692000146', numero: '500',
        chave: '35260' + '44388' + '000000000000000000000000000000000000000',
        direcao: 'saida', tipo: 'NFe', status: 'autorizado', origem: 'sefaz',
    },
];

const ids = (list: any[]) => list.map(d => d.id).sort();
const filtra = (f: any) => ids(applyDocumentosFilters(docs, f));

const SP_ENTRADAS = ['amil', 'braslimpo', 'pluxee'].sort();

describe('applyDocumentosFilters — busca por CNPJ (PR #44)', () => {
    it('CNPJ parcial "44388" + entrada → só entradas da S&P (com BRASLIMPO)', () => {
        expect(filtra({ busca: '44388', direcao: 'entrada' })).toEqual(SP_ENTRADAS);
    });

    it('CNPJ completo "44388152000189" + entrada → inclui o resumo BRASLIMPO (não some)', () => {
        // Bug #44: resumo sem <dest> sumia na busca por CNPJ completo.
        expect(filtra({ busca: SP, direcao: 'entrada' })).toContain('braslimpo');
        expect(filtra({ busca: SP, direcao: 'entrada' })).toEqual(SP_ENTRADAS);
    });

    it('"44388" + saída → a NFSe que a S&P emitiu pro cliente (CARLEZZO)', () => {
        expect(filtra({ busca: '44388', direcao: 'saida' })).toEqual(['carlezzo']);
    });

    it('falso positivo da chave de 44 dígitos NÃO entra', () => {
        expect(filtra({ busca: '44388' })).not.toContain('chave-fp');
    });
});

describe('applyDocumentosFilters — busca textual por token (PR #45)', () => {
    it('"S&P" NÃO traz HS PROJETOS / S.P.A. / CARPETES (substring "sp")', () => {
        const r = filtra({ busca: 'S&P', direcao: 'entrada' });
        expect(r).not.toContain('hs');
        expect(r).not.toContain('spa');
    });

    it('"SP" (sem &) funciona igual — token exato pra termo <4 chars', () => {
        expect(filtra({ busca: 'SP', direcao: 'entrada' })).toEqual(SP_ENTRADAS);
    });

    it('prefixo ≥4 chars: "BRASLI" acha BRASLIMPO', () => {
        expect(filtra({ busca: 'BRASLI' })).toEqual(['braslimpo']);
    });
});

describe('applyDocumentosFilters — fallback CNPJ→nome (PR #46)', () => {
    it('"44388" e "S&P" retornam EXATAMENTE o mesmo conjunto', () => {
        const porCnpj = filtra({ busca: '44388', direcao: 'entrada' });
        const porNome = filtra({ busca: 'S&P', direcao: 'entrada' });
        expect(porNome).toEqual(porCnpj);
        expect(porNome).toEqual(SP_ENTRADAS);
    });

    it('"S&P" acha a BRASLIMPO mesmo com empresaNome vazio (via CNPJ→nome)', () => {
        expect(filtra({ busca: 'S&P' })).toContain('braslimpo');
    });
});

describe('applyDocumentosFilters — outros filtros', () => {
    it('busca por número da nota funciona com direção', () => {
        expect(filtra({ busca: '1615949', direcao: 'entrada' })).toEqual(['braslimpo']);
    });

    it('filtro por status', () => {
        expect(filtra({ status: 'cancelado' as any })).toEqual(['amil']);
    });

    it('filtro por tipoDoc (NFe vs NFSe)', () => {
        const nfe = filtra({ tipoDoc: 'NFe' });
        expect(nfe).toContain('braslimpo');
        expect(nfe).not.toContain('pluxee');
    });

    it('sem filtros → todos os docs', () => {
        expect(applyDocumentosFilters(docs, {}).length).toBe(docs.length);
    });

    it('direção sem busca usa a direção gravada no doc', () => {
        // Sem busca, usa d.direcao literal. Saídas: carlezzo (S&P emitiu) e
        // chave-fp.
        expect(filtra({ direcao: 'saida' })).toEqual(['carlezzo', 'chave-fp'].sort());
    });
});
