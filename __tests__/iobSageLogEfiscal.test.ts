/**
 * Leitor do log de erros do E-Fiscal — caso real 31/07 (EDUARDO GUERRA,
 * 07/2026, "não importou"): 852 erros em cascata — 53 E010 sem UF + 31 E010
 * "CNPJ já cadastrado com outro Código" ⇒ 384 E200 "código não consta" ⇒ 384
 * E342 "nota não cadastrada". ZERO notas entraram e o colaborador só via
 * "não importou".
 */
import { parseLogEfiscal, cruzarLogComFml } from '../services/iobSageLogEfiscal';

// Formatos REAIS do log (conferidos no arquivo do caso 31/07): o E010 começa
// com "Linha"; E200/E342 têm um PREFIXO com o nº da NF antes da âncora.
const LOG = [
    '================',
    'Empresa 1137',
    '================',
    '(X)  Linha 000002 - Registro E010 - Campo 10, UF inválida ou não foi informada.',
    '----------------------------------------------------------------------------------------------------',
    '(X)  Linha 000003 - Registro E010 - Campo 14, CNPJ/CPF já cadastrado com outro Código de Faturamento no sistema Office Fiscal!',
    '----------------------------------------------------------------------------------------------------',
    '(X) NF SAÍDA - N° 0000429967- CÓDIGO DO CLIENTE: 61021325000145- SÉRIE: 1   Linha 000005 - Registro E200 - Campo 08, o código informado não consta no cadastro de Clientes e Fornecedores - EFD (a partir da coluna 25).',
    '----------------------------------------------------------------------------------------------------',
    '(X) NF SAÍDA  - N° 0000429967- CÓDIGO DO CLIENTE/FORNECEDOR: 61021325000145 Linha 000009 - Registro E342 - Nota fiscal não cadastrada.',
].join('\r\n');

// E010 com posições fixas: código 5-24, nome 25-124, CNPJ 360-373.
const e010 = (codigo: string, nome: string, cnpj: string) => {
    let linha = 'E010' + codigo.padEnd(20) + nome.padEnd(100);
    linha = linha.padEnd(359) + cnpj.padEnd(14);
    return linha.padEnd(977);
};

const FML = [
    'E00111372.0.060',
    e010('28585062649', 'JOSE SOARES FILHO E OUTROS', '28585062649'),      // linha 2 — sem UF
    e010('13294968000624', 'MARCOS M PONTES', '13294968000624'),           // linha 3 — código existente
    'E020...'.padEnd(486),
    'E200...'.padEnd(422),
].join('\r\n');

describe('parseLogEfiscal', () => {
    it('extrai linha, registro e categoriza cada erro', () => {
        const erros = parseLogEfiscal(LOG);
        expect(erros).toHaveLength(4);
        expect(erros[0]).toMatchObject({ linha: 2, registro: 'E010', categoria: 'uf-invalida' });
        expect(erros[1]).toMatchObject({ linha: 3, registro: 'E010', categoria: 'codigo-existente' });
        expect(erros[2]).toMatchObject({ linha: 5, registro: 'E200', categoria: 'participante-nao-consta' });
        expect(erros[3]).toMatchObject({ linha: 9, registro: 'E342', categoria: 'nota-nao-cadastrada' });
    });

    it('ignora separadores e cabeçalhos', () => {
        expect(parseLogEfiscal('=====\nEmpresa 1137\n-----')).toHaveLength(0);
    });
});

describe('cruzarLogComFml', () => {
    const cruz = cruzarLogComFml(parseLogEfiscal(LOG), FML);

    it('resolve a linha do log para o participante do FML (CNPJ + nome)', () => {
        expect(cruz.codigoExistente).toHaveLength(1);
        expect(cruz.codigoExistente[0]).toMatchObject({
            cnpjCpf: '13294968000624',
            nome: 'MARCOS M PONTES',
        });
        expect(cruz.semUf).toHaveLength(1);
        expect(cruz.semUf[0].cnpjCpf).toBe('28585062649');
    });

    it('o resumo explica a CASCATA: nota recusada é consequência do cadastro', () => {
        expect(cruz.resumo).toMatch(/REGERE/);
        expect(cruz.resumo).toMatch(/De→Para/);
        expect(cruz.resumo).toMatch(/CONSEQUÊNCIA/);
    });

    it('a orientação de UF manda SINCRONIZAR antes de regerar (o endereço vem da captura)', () => {
        // "basta regerar" era mentira enquanto a captura não gravava o
        // endereço do destinatário — regerar produzia o mesmo E010 sem UF.
        expect(cruz.resumo).toMatch(/sincroniza/i);
        expect(cruz.resumo).not.toMatch(/basta REGERAR/);
    });

    it('log sem erros orienta a conferir se o arquivo foi lido', () => {
        const vazio = cruzarLogComFml([], FML);
        expect(vazio.totalErros).toBe(0);
        expect(vazio.resumo).toMatch(/nem ter sido lido/);
    });
});
