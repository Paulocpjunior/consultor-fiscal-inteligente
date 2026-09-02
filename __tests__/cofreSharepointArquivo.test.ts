/**
 * Testes do caminho de pasta do arquivo no SharePoint (Fase 3) — mesma árvore
 * que o sharepoint-auto-sync usa para LER.
 */
// @ts-expect-error — módulo .js puro
import { buildFolderPathArquivo, rotuloDirecao } from '../sefaz-backend/cofre-sharepoint-arquivo.js';

describe('rotuloDirecao', () => {
  it('mapeia saida/entrada para os rótulos das pastas', () => {
    expect(rotuloDirecao('saida')).toBe('SAÍDA');
    expect(rotuloDirecao('entrada')).toBe('ENTRADA');
    expect(rotuloDirecao('desconhecida')).toBeNull();
  });
});

// 🚨 FIXTURE TROCADA EM 02/09 — ela travava um caminho que NÃO EXISTE.
//
// O antigo exigia `Empresas/{grupo}/DEPARTAMENTO FISCAL/{ano}/{mês}-{ano}/
// {empresa}/XML SAÍDA`. A árvore foi medida clique a clique pelo explorador e
// ela não tem GRUPO, tem empresa ANTES do departamento e o mês é por NOME.
// Ou seja: este teste passava VERDE descrevendo a pasta que produzia 404.
//
// ⚠️ E o `grupo` saiu da ASSINATURA de propósito — parâmetro que não existe na
// árvore convida alguém a preenchê-lo de novo.
describe('buildFolderPathArquivo — a árvore REAL, medida em 02/09', () => {
  it('monta a árvore exata do sync, a partir da pasta REAL da empresa', () => {
    const p = buildFolderPathArquivo('0040_Clinica Mantoan', '2026-05', 'saida');
    expect(p).toBe('Empresas/0040_Clinica Mantoan/Departamento Fiscal/2026/Maio/XML SAÍDA');
  });
  it('entrada vai para XML ENTRADA', () => {
    expect(buildFolderPathArquivo('0001_BRISKA', '2026-01', 'entrada'))
      .toBe('Empresas/0001_BRISKA/Departamento Fiscal/2026/Janeiro/XML ENTRADA');
  });
  // ⚠️ Ausência devolve null, nunca um caminho pela metade: `Empresas//…` foi
  // exatamente o 404 de 02/09, com um segmento VAZIO no meio.
  it('retorna null quando falta pasta/competência/direção', () => {
    expect(buildFolderPathArquivo('', '2026-01', 'saida')).toBeNull();
    expect(buildFolderPathArquivo('0001_BRISKA', 'xxxx', 'saida')).toBeNull();
    expect(buildFolderPathArquivo('0001_BRISKA', '2026-01', 'desconhecida')).toBeNull();
  });
});

// @ts-expect-error — módulo .js puro
import { elegivelParaArquivoSp } from '../sefaz-backend/cofre-sharepoint-arquivo.js';

describe('elegivelParaArquivoSp — todas as capturas (24/07)', () => {
  const base = {
    storagePath: 'xmls/emp1/chave.xml', tipoDoc: 'NFe',
    direcao: 'entrada', competencia: '2026-07',
  };

  it('nota completa de QUALQUER origem é elegível (DistDFe, cofre, manual…)', () => {
    expect(elegivelParaArquivoSp({ ...base, origem: 'sefaz' }).ok).toBe(true);
    expect(elegivelParaArquivoSp({ ...base, origem: 'email' }).ok).toBe(true);
    expect(elegivelParaArquivoSp({ ...base, origem: undefined }).ok).toBe(true);
  });

  it('já arquivado não sobe de novo (idempotência do ciclo)', () => {
    expect(elegivelParaArquivoSp({ ...base, spArquivadoEm: new Date() })).toEqual({ ok: false, motivo: 'ja-arquivado' });
  });

  it('resumo (resNFe) NÃO sobe — só a nota completa pós-Ciência', () => {
    expect(elegivelParaArquivoSp({ ...base, tipoDoc: 'resNFe' })).toEqual({ ok: false, motivo: 'resumo' });
  });

  it('sem storage / sem direção / sem competência ficam de fora com motivo', () => {
    expect(elegivelParaArquivoSp({ ...base, storagePath: null }).motivo).toBe('sem-storage');
    expect(elegivelParaArquivoSp({ ...base, direcao: 'desconhecida' }).motivo).toBe('sem-direcao');
    expect(elegivelParaArquivoSp({ ...base, competencia: '07/2026' }).motivo).toBe('sem-competencia');
    expect(elegivelParaArquivoSp(null).motivo).toBe('doc-vazio');
  });
});
