/**
 * Testes da decisão de gravação do xml-importer (decidirGravacaoNFe).
 *
 * Esta é a lógica delicada que governa duplicado / upgrade resumo→completa /
 * merge (preservar eventos). É extraída como função PURA justamente pra ser
 * travada por teste e reutilizada dentro da transação de escrita — a mesma
 * decisão roda no fast-path (get pré-storage) e DENTRO do runTransaction, então
 * um bug aqui afeta as duas pontas.
 *
 * Chaves de exemplo: posições 20-21 = modelo. '55' = NF-e, '65' = NFC-e,
 * '57' = CT-e (nunca tem itens), '58' = MDF-e.
 */

// @ts-expect-error — módulo .js puro
import { decidirGravacaoNFe } from '../sefaz-backend/xml-importer.js';

const CHAVE_NFE = '3'.padEnd(20, '0') + '55' + '1'.padEnd(22, '0'); // modelo 55
const CHAVE_NFCE = '3'.padEnd(20, '0') + '65' + '1'.padEnd(22, '0'); // modelo 65
const CHAVE_CTE = '3'.padEnd(20, '0') + '57' + '1'.padEnd(22, '0'); // modelo 57

describe('decidirGravacaoNFe — gravação nova', () => {
  it('doc não existe → grava novo (nem duplicado, nem upgrade, nem merge)', () => {
    const d = decidirGravacaoNFe({ existingData: null, tipoDoc: 'NFe', schema: 'procNFe', chave: CHAVE_NFE });
    expect(d).toEqual({ exists: false, upgrade: false, duplicado: false, merge: false });
  });
});

describe('decidirGravacaoNFe — duplicado', () => {
  it('completa já existe e chega completa igual → duplicado', () => {
    const existingData = { schema: 'procNFe', tipoDoc: 'NFe', temItens: true, eventosBeforeNFe: false };
    const d = decidirGravacaoNFe({ existingData, tipoDoc: 'NFe', schema: 'procNFe', chave: CHAVE_NFE });
    expect(d.duplicado).toBe(true);
    expect(d.upgrade).toBe(false);
    expect(d.merge).toBe(false);
  });

  it('resumo já existe e chega OUTRO resumo → duplicado (não re-grava)', () => {
    const existingData = { schema: 'resNFe', tipoDoc: 'resNFe', temItens: false, eventosBeforeNFe: false };
    const d = decidirGravacaoNFe({ existingData, tipoDoc: 'resNFe', schema: 'resNFe', chave: CHAVE_NFE });
    expect(d.duplicado).toBe(true);
    expect(d.upgrade).toBe(false);
  });
});

describe('decidirGravacaoNFe — upgrade resumo→completa', () => {
  it('resumo NF-e existe e chega a completa → upgrade + merge, não duplicado', () => {
    const existingData = { schema: 'resNFe', tipoDoc: 'NFe', temItens: false, eventosBeforeNFe: false };
    const d = decidirGravacaoNFe({ existingData, tipoDoc: 'NFe', schema: 'procNFe', chave: CHAVE_NFE });
    expect(d.duplicado).toBe(false);
    expect(d.upgrade).toBe(true);
    expect(d.merge).toBe(true); // preserva eventos/manifestações já anexados
  });

  it('resumo NFC-e (modelo 65) detectado por temItens=false → upgrade', () => {
    const existingData = { schema: 'desconhecido', tipoDoc: 'NFCe', temItens: false, eventosBeforeNFe: false };
    const d = decidirGravacaoNFe({ existingData, tipoDoc: 'NFCe', schema: 'procNFCe', chave: CHAVE_NFCE });
    expect(d.upgrade).toBe(true);
    expect(d.merge).toBe(true);
  });

  it('resCTe existe e chega procCTe → upgrade pelo schema (CT-e não tem itens)', () => {
    const existingData = { schema: 'resCTe', tipoDoc: 'CTe', temItens: false, eventosBeforeNFe: false };
    const d = decidirGravacaoNFe({ existingData, tipoDoc: 'CTe', schema: 'procCTe', chave: CHAVE_CTE });
    expect(d.upgrade).toBe(true);
  });
});

describe('decidirGravacaoNFe — CT-e completa NÃO é sobrescrita por resumo', () => {
  it('CTe completa (temItens=false, modelo 57) + chega resCTe → duplicado, sem upgrade', () => {
    // Regressão: usar temItens como proxy genérico fazia um resCTe de 531 bytes
    // "atualizar" (zerar) uma CTe COMPLETA. modeloComItens(57)=false protege.
    const existingData = { schema: 'procCTe', tipoDoc: 'CTe', temItens: false, eventosBeforeNFe: false };
    const d = decidirGravacaoNFe({ existingData, tipoDoc: 'resCTe', schema: 'resCTe', chave: CHAVE_CTE });
    expect(d.duplicado).toBe(true);
    expect(d.upgrade).toBe(false);
    expect(d.merge).toBe(false);
  });
});

describe('decidirGravacaoNFe — stub de evento', () => {
  it('stub de evento existe (eventosBeforeNFe) e chega a NFe completa → merge, não duplicado', () => {
    const existingData = { schema: null, tipoDoc: 'NFe', temItens: false, eventosBeforeNFe: true };
    const d = decidirGravacaoNFe({ existingData, tipoDoc: 'NFe', schema: 'procNFe', chave: CHAVE_NFE });
    expect(d.duplicado).toBe(false); // nunca é duplicado sobre um stub
    expect(d.merge).toBe(true);      // preserva eventos[] anexados antes da NFe
  });
});
