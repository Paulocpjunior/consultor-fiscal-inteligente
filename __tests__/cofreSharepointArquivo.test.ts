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
