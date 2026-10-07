import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const raiz = resolve(__dirname, '..');
const dockerfile = readFileSync(join(raiz, 'Dockerfile'), 'utf8');
const etapaFinal = dockerfile.split(/^FROM .+$/m).at(-1) || '';
const copias = [...etapaFinal.matchAll(/^COPY\s+(?! --from=|--from=)(\S+)\s+(\S+)\s*$/gm)]
  .map(([, origem, destino]) => ({ origem, destino }));
function arquivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name);
    return e.isDirectory() ? arquivos(p) : /\.(?:c?js|mjs)$/.test(e.name) ? [p] : [];
  });
}
function presenteNaImagem(arquivo: string): boolean {
  const esperado = relative(raiz, arquivo).replaceAll('\\', '/');
  return copias.some(({ origem, destino }) => {
    if (origem.includes('*')) return false;
    const absOrigem = resolve(raiz, origem);
    const diretorio = statSync(absOrigem).isDirectory();
    const sufixo = diretorio ? relative(absOrigem, arquivo) : '';
    if (diretorio ? sufixo.startsWith('..') : absOrigem !== arquivo) return false;
    const alvo = destino.endsWith('/') ? join(destino, origem) : destino;
    return join(alvo, sufixo).replaceAll('\\', '/') === esperado;
  });
}

describe('imagem Docker inclui dependencias locais do backend', () => {
  test('todos os imports locais resolvem para arquivos copiados à etapa final', () => {
    const fila = [join(raiz, 'server.js'), ...arquivos(join(raiz, 'sefaz-backend'))];
    const visitados = new Set<string>();
    const faltantes: string[] = [];
    for (let i = 0; i < fila.length; i++) {
      const arquivo = fila[i]!;
      if (visitados.has(arquivo)) continue;
      visitados.add(arquivo);
      const texto = readFileSync(arquivo, 'utf8');
      for (const [, caminho] of texto.matchAll(/(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"](\.[^'"]+\.(?:c?js|mjs|json))['"]/g)) {
        const dependencia = resolve(dirname(arquivo), caminho!);
        if (!presenteNaImagem(dependencia)) faltantes.push(`${relative(raiz, arquivo)} -> ${caminho}`);
        if (!dependencia.endsWith('.json')) fila.push(dependencia);
      }
    }
    expect(visitados.size).toBeGreaterThan(10);
    expect(faltantes).toEqual([]);
  });
});
