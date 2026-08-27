import { readFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';

const raiz = resolve(__dirname, '..');
const dockerfile = readFileSync(join(raiz, 'Dockerfile'), 'utf8');

describe('imagem Docker inclui dependencias locais do backend', () => {
  test('imports ../services usados pelo sefaz-backend sao copiados para a imagem final', () => {
    const arquivosBackend = [
      'sefaz-backend/whatsapp-webhook.js',
      'sefaz-backend/whatsapp-import-ultrafox.js',
    ];

    const dependencias = arquivosBackend.flatMap((arquivo) => {
      const conteudo = readFileSync(join(raiz, arquivo), 'utf8');
      return [...conteudo.matchAll(/from\s+['"](\.\.\/services\/[^'"]+\.js)['"]/g)].map(
        ([, importacao]) =>
          normalize(relative(raiz, resolve(dirname(join(raiz, arquivo)), importacao))),
      );
    });

    expect(dependencias.length).toBeGreaterThan(0);
    for (const dependencia of new Set(dependencias)) {
      const origem = dependencia.replaceAll('\\', '/');
      expect(dockerfile).toContain(`COPY ${origem} ./${origem}`);
    }
  });
});
