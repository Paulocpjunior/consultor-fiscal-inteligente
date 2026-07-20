/**
 * Testes da atribuição de XML → empresa-cliente dona (compartilhado entre a
 * colheita autXML e a ingestão por e-mail).
 */
// @ts-expect-error — módulo .js puro
import { acharDono, extrairCnpjs, atribuirXml } from '../sefaz-backend/xml-empresa-matcher.js';
// @ts-expect-error — módulo .js puro
import { decodeAnexoXml } from '../sefaz-backend/xml-email-ingestor.js';

const CLIENTE = '51593093000146'; // APATEL
const RAIZ = CLIENTE.slice(0, 8);
const porCnpj = new Map([[CLIENTE, { empresaId: 'apatel', cnpj: CLIENTE, nome: 'APATEL' }]]);
const porRaiz = new Map([[RAIZ, { empresaId: 'apatel', cnpj: CLIENTE, nome: 'APATEL' }]]);

function nfe({ emit, dest }: { emit: string; dest: string }): string {
  return `<nfeProc><NFe><infNFe><emit><CNPJ>${emit}</CNPJ></emit><dest><CNPJ>${dest}</CNPJ></dest></infNFe></NFe></nfeProc>`;
}

describe('extrairCnpjs', () => {
  it('pega emit e dest de uma NFe completa', () => {
    const { cnpjEmit, cnpjDest } = extrairCnpjs(nfe({ emit: CLIENTE, dest: '02137309000153' }));
    expect(cnpjEmit).toBe(CLIENTE);
    expect(cnpjDest).toBe('02137309000153');
  });
  it('pega emit de um resumo (resNFe)', () => {
    const { cnpjEmit } = extrairCnpjs(`<resNFe><CNPJ>${CLIENTE}</CNPJ></resNFe>`);
    expect(cnpjEmit).toBe(CLIENTE);
  });
});

describe('acharDono', () => {
  it('casa por CNPJ exato', () => {
    expect(acharDono(CLIENTE, porCnpj, porRaiz)?.viaRaiz).toBe(false);
  });
  it('casa por raiz (filial diferente)', () => {
    const filial = RAIZ + '000227';
    const d = acharDono(filial, porCnpj, porRaiz);
    expect(d?.emp.empresaId).toBe('apatel');
    expect(d?.viaRaiz).toBe(true);
  });
  it('não casa CNPJ de terceiro', () => {
    expect(acharDono('99999999000191', porCnpj, porRaiz)).toBeNull();
  });
});

describe('atribuirXml', () => {
  it('emit = cliente → SAÍDA', () => {
    const a = atribuirXml(nfe({ emit: CLIENTE, dest: '02137309000153' }), porCnpj, porRaiz);
    expect(a?.tipo).toBe('saida');
    expect(a?.cnpjNota).toBe(CLIENTE);
  });
  it('dest = cliente → ENTRADA', () => {
    const a = atribuirXml(nfe({ emit: '02137309000153', dest: CLIENTE }), porCnpj, porRaiz);
    expect(a?.tipo).toBe('entrada');
  });
  it('prioriza saída quando cliente é emit e dest de outra nota', () => {
    // cliente como emitente vence
    const a = atribuirXml(nfe({ emit: CLIENTE, dest: CLIENTE }), porCnpj, porRaiz);
    expect(a?.tipo).toBe('saida');
  });
  it('nota entre terceiros → null (sem dono)', () => {
    expect(atribuirXml(nfe({ emit: '11111111000191', dest: '22222222000172' }), porCnpj, porRaiz)).toBeNull();
  });
});

describe('decodeAnexoXml', () => {
  it('decodifica base64 do anexo do Graph em XML utf-8', () => {
    const xml = nfe({ emit: CLIENTE, dest: '02137309000153' });
    const b64 = Buffer.from(xml, 'utf-8').toString('base64');
    expect(decodeAnexoXml(b64)).toBe(xml);
  });
  it('base64 vazio → string vazia (não quebra)', () => {
    expect(decodeAnexoXml('')).toBe('');
  });
});
