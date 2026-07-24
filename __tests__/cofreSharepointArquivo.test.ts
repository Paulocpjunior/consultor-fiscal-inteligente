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

describe('buildFolderPathArquivo', () => {
  it('monta a árvore exata do sync', () => {
    const p = buildFolderPathArquivo('GRUPO X', 'APATEL', '2026-05', 'saida');
    expect(p).toBe('Empresas/GRUPO X/DEPARTAMENTO FISCAL/2026/05-2026/APATEL/XML SAÍDA');
  });
  it('entrada vai para XML ENTRADA', () => {
    expect(buildFolderPathArquivo('G', 'E', '2026-01', 'entrada'))
      .toBe('Empresas/G/DEPARTAMENTO FISCAL/2026/01-2026/E/XML ENTRADA');
  });
  it('retorna null quando falta grupo/pasta/competência/direção', () => {
    expect(buildFolderPathArquivo('', 'E', '2026-01', 'saida')).toBeNull();
    expect(buildFolderPathArquivo('G', '', '2026-01', 'saida')).toBeNull();
    expect(buildFolderPathArquivo('G', 'E', 'xxxx', 'saida')).toBeNull();
    expect(buildFolderPathArquivo('G', 'E', '2026-01', 'desconhecida')).toBeNull();
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
